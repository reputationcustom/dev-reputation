// supabase/functions/bw-sync/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Acionada por pg_cron a cada ~20-30s
// (nunca pelo frontend, por isso sem CORS — Princípio técnico 5, ressalva de
// funções só-cron; verify_jwt=false em supabase/config.toml pelo mesmo
// motivo).
//
// Implementa o fluxo completo de .dev/specs/foundation/sync-brandwatch.md:
// semeadura de sync_cursors, bootstrap de metadata (project/queries/
// query-groups/categories), polling de mentions, métricas diárias/semanais/
// mensais (com throttle) e Share of Voice de Query Group. Cada chamada à
// Brandwatch é sequencial (nunca paralela — best practice oficial) e passa
// por callBrandwatch(), que aplica backoff em 429.
//
// ⚠️ Não testado contra a API real (sem credenciais disponíveis neste
// ambiente) — os nomes de campo de mention foram confirmados contra exemplos
// documentados (skill brandwatch-api, references/mentions.md e
// data-restrictions-compliance.md), mas o formato exato de
// data/volume/queryGroups/weeks foi inferido da descrição da doc, não de um
// payload capturado. Ver comentário em syncQueryGroupSov() abaixo.
//
// Deliberadamente fora desta leva: full_text de mentions (dobraria as
// chamadas por poll via /data/mentions/fulltext), Tags/Custom Alerts/Author
// Lists (fora do Sprint 1 por decisão em brandwatch-setup.md), cache do
// token em Vault (ainda minta um token novo por invocação).

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// =========================================================================
// Logging — prefixo [bw-sync], visível em Dashboard → Edge Functions → Logs.
// Única observabilidade disponível hoje (sync_log só é gravado ao final de
// uma invocação bem-sucedida ou com erro tratado). NUNCA logar
// password/access_token — só metadados.
// =========================================================================

function log(step: string, data?: Record<string, unknown>) {
  console.log(`[bw-sync] ${step}`, data ? JSON.stringify(data) : "");
}
function logError(step: string, err: unknown) {
  console.error(`[bw-sync] ${step}`, err instanceof Error ? err.message : String(err));
}

// =========================================================================
// Autenticação Brandwatch (grant_type=api-password — ver brandwatch-setup.md
// §1, sem token de longa duração pré-gerado neste MVP)
// =========================================================================

const BRANDWATCH_BASE_URL = "https://api.brandwatch.com";
const BRANDWATCH_OAUTH_URL = `${BRANDWATCH_BASE_URL}/oauth/token`;
// Literal fixo da Brandwatch (o mesmo para qualquer integrador, documentado
// publicamente) — não é segredo, por isso hardcoded em vez de env var.
const BRANDWATCH_OAUTH_CLIENT_ID = "brandwatch-api-client";
const TIMEZONE = "America/Sao_Paulo";

interface BrandwatchToken {
  accessToken: string;
  expiresAt: Date;
}

async function mintBrandwatchAccessToken(): Promise<BrandwatchToken> {
  const username = Deno.env.get("BRANDWATCH_USERNAME");
  const password = Deno.env.get("BRANDWATCH_PASSWORD");
  const platformClientId = Deno.env.get("BRANDWATCH_PLATFORM_CLIENT_ID");

  if (!username || !password) {
    throw new Error(
      "BRANDWATCH_USERNAME/BRANDWATCH_PASSWORD não configurados (secrets da Edge Function).",
    );
  }

  const params = new URLSearchParams({
    grant_type: "api-password",
    client_id: BRANDWATCH_OAUTH_CLIENT_ID,
    username,
  });
  if (platformClientId) params.set("platform_client_id", platformClientId);

  log("mintBrandwatchAccessToken:start", { username, platformClientId: platformClientId ?? null });

  // A senha vai no corpo (x-www-form-urlencoded), nunca na query string —
  // evita vazar em logs de URL/proxies.
  const response = await fetch(`${BRANDWATCH_OAUTH_URL}?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(password)}`,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logError("mintBrandwatchAccessToken:http_error", `${response.status} ${body}`);
    throw new Error(`Brandwatch OAuth error ${response.status}: ${body}`);
  }

  const json = await response.json() as { access_token: string; expires_in: number };
  log("mintBrandwatchAccessToken:success", {
    expiresInSeconds: json.expires_in,
    accessTokenLength: json.access_token.length,
  });

  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  };
}

// =========================================================================
// Cliente HTTP serial com backoff (best practice oficial: nunca chamadas
// paralelas — ver skill brandwatch-api, scripts/brandwatch-client.ts de
// referência, adaptado inline por não poder importar de `_shared/`).
// =========================================================================

// Erro tipado com o status HTTP — permite que chamadores decidam tratar
// certos status (ex: 404 em endpoints opcionais como query-groups) como
// "recurso não configurado" em vez de falha real. Ver refreshMetadata().
class BrandwatchApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BrandwatchApiError";
    this.status = status;
  }
}

async function callBrandwatch(path: string, token: string): Promise<any> {
  const url = `${BRANDWATCH_BASE_URL}${path}`;

  for (let attempt = 0; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 429) {
      if (attempt === 3) {
        throw new Error(`Brandwatch rate limit excedido após 3 tentativas em ${path}`);
      }
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 20_000;
      logError("callBrandwatch:429", `${path} — aguardando ${retryAfterMs}ms (tentativa ${attempt + 1}/3)`);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new BrandwatchApiError(response.status, `Brandwatch API error ${response.status} em ${path}: ${body}`);
    }

    log("callBrandwatch:ok", { path, rateLimitUsed: response.headers.get("x-rate-limit-used") });
    return await response.json();
  }

  throw new Error(`callBrandwatch: loop inesperado em ${path}`);
}

function formatBrandwatchDate(date: Date): string {
  // Brandwatch espera "+0000" em vez de "Z" — URLSearchParams cuida do
  // percent-encoding do "+" (vira %2B) automaticamente.
  return date.toISOString().replace("Z", "+0000");
}

function toDateOnly(isoString: string): string {
  return isoString.slice(0, 10);
}

// Data mínima de histórico a considerar para mentions — parametrizável via
// secret (BRANDWATCH_MENTIONS_START_DATE, "YYYY-MM-DD"), default 2026-01-01
// se não configurada. A Brandwatch exige startDate em /data/mentions mesmo
// no polling (o exemplo de "bootstrap" da doc omite o parâmetro, mas a API
// real rejeita sem ele — "This method requires a start date").
function getMentionsStartDate(): Date {
  const raw = Deno.env.get("BRANDWATCH_MENTIONS_START_DATE");
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    logError("getMentionsStartDate:invalid", `BRANDWATCH_MENTIONS_START_DATE="${raw}" inválida, usando default`);
  }
  return new Date("2026-01-01T00:00:00.000Z");
}

// =========================================================================
// Passo 0 — Semeadura inicial de sync_cursors (ver sync-brandwatch.md,
// passo 0). MVP de Client único: usa BRANDWATCH_PROJECT_ID/QUERY_IDS em vez
// de descobrir automaticamente todos os projects/queries da conta.
// =========================================================================

async function ensureBootstrapSeed(supabase: SupabaseClient): Promise<void> {
  const projectIdRaw = Deno.env.get("BRANDWATCH_PROJECT_ID");
  const queryIdsRaw = Deno.env.get("BRANDWATCH_QUERY_IDS");

  if (!projectIdRaw || !queryIdsRaw) {
    log("ensureBootstrapSeed:skipped", { reason: "BRANDWATCH_PROJECT_ID/QUERY_IDS não configurados" });
    return;
  }

  const projectId = Number(projectIdRaw);
  const queryIds = queryIdsRaw.split(",").map((id) => Number(id.trim())).filter((id) => !Number.isNaN(id));

  if (!Number.isFinite(projectId) || queryIds.length === 0) {
    throw new Error(
      `BRANDWATCH_PROJECT_ID/BRANDWATCH_QUERY_IDS inválidos (recebido: "${projectIdRaw}" / "${queryIdsRaw}").`,
    );
  }

  log("ensureBootstrapSeed:start", { projectId, queryIds });

  // MVP de organização única: usa a primeira linha de brandwatch_credentials
  // como dona do project_id acima.
  const { data: credentials, error: credentialsError } = await supabase
    .from("brandwatch_credentials")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  if (credentialsError) {
    logError("ensureBootstrapSeed:brandwatch_credentials_error", credentialsError.message);
    throw new Error(`Erro lendo brandwatch_credentials: ${credentialsError.message}`);
  }
  if (!credentials) {
    const msg = "Nenhuma linha em brandwatch_credentials — crie a organização e a credencial antes (ver brandwatch-setup.md).";
    logError("ensureBootstrapSeed:no_credentials", msg);
    throw new Error(msg);
  }

  const { error: projectError } = await supabase
    .from("bw_projects")
    .upsert(
      { id: projectId, organization_id: credentials.organization_id, name: "(aguardando bootstrap de metadata)" },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (projectError) {
    logError("ensureBootstrapSeed:bw_projects_error", projectError.message);
    throw new Error(`Erro semeando bw_projects: ${projectError.message}`);
  }

  const { error: queriesError } = await supabase
    .from("bw_queries")
    .upsert(
      queryIds.map((id) => ({ id, project_id: projectId, name: "(aguardando bootstrap de metadata)" })),
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (queriesError) {
    logError("ensureBootstrapSeed:bw_queries_error", queriesError.message);
    throw new Error(`Erro semeando bw_queries: ${queriesError.message}`);
  }

  const { error: cursorsError } = await supabase
    .from("sync_cursors")
    .upsert(
      queryIds.map((queryId) => ({ project_id: projectId, query_id: queryId })),
      { onConflict: "project_id,query_id", ignoreDuplicates: true },
    );
  if (cursorsError) {
    logError("ensureBootstrapSeed:sync_cursors_error", cursorsError.message);
    throw new Error(`Erro semeando sync_cursors: ${cursorsError.message}`);
  }

  log("ensureBootstrapSeed:done", { projectId, queryIds, organizationId: credentials.organization_id });
}

// =========================================================================
// Passo 3 — Bootstrap de metadata (condicional: nome ainda placeholder OU
// synced_at > 24h OU zero Categories cacheadas). Busca project/queries/
// query-groups/categories reais.
// =========================================================================

async function needsMetadataRefresh(supabase: SupabaseClient, projectId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("bw_projects")
    .select("name, synced_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new Error(`Erro lendo bw_projects: ${error.message}`);
  if (!data) return true;
  if (data.name === "(aguardando bootstrap de metadata)") return true;

  // Correção 2026-07-10 (relatado pelo usuário: Categories/Tags foram
  // configuradas na Brandwatch DEPOIS do primeiro refresh de metadata —
  // como esse primeiro refresh cacheou "zero Categories" e o throttle de
  // 24h não reconsidera isso, narratives ficaria vazia por até 24h mesmo
  // com Categories já existindo do lado da Brandwatch). Zero linhas em
  // bw_categories força um refresh mesmo dentro da janela de 24h — é
  // autocorretivo: para de forçar assim que categorias existirem de
  // verdade, sem precisar de intervenção manual/env var.
  const { count: categoriesCount, error: categoriesError } = await supabase
    .from("bw_categories")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (categoriesError) throw new Error(`Erro checando bw_categories: ${categoriesError.message}`);
  if (!categoriesCount) return true;

  const syncedAt = new Date(data.synced_at as string).getTime();
  return Date.now() - syncedAt > 24 * 60 * 60 * 1000;
}

async function refreshMetadata(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  organizationId: string,
): Promise<void> {
  log("refreshMetadata:start", { projectId });

  const project = await callBrandwatch(`/projects/${projectId}`, token);
  const { error: projectError } = await supabase
    .from("bw_projects")
    .upsert({
      id: projectId,
      organization_id: organizationId,
      name: project.name,
      description: project.description ?? null,
      timezone: project.timezone ?? null,
      synced_at: new Date().toISOString(),
    }, { onConflict: "id" });
  if (projectError) throw new Error(`Erro atualizando bw_projects: ${projectError.message}`);

  const queriesResponse = await callBrandwatch(`/projects/${projectId}/queries/summary`, token);
  const queries = (queriesResponse.results ?? []) as any[];
  if (queries.length > 0) {
    const { error } = await supabase.from("bw_queries").upsert(
      queries.map((q) => ({
        id: q.id,
        project_id: projectId,
        name: q.name,
        boolean_query: q.booleanQuery ?? null,
        type: q.type ?? "monitor",
        content_sources: q.contentSources ?? [],
        languages: q.languages ?? [],
        start_date: q.startDate ?? null,
        sampled: q.sampled ?? null,
        sample_percentage: q.samplePercentage ?? null,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    );
    if (error) throw new Error(`Erro atualizando bw_queries: ${error.message}`);
  }

  // Query Groups são opcionais — nem todo Project tem um configurado (só é
  // necessário para o card de SOV, ver brandwatch-setup.md §4), e a
  // Brandwatch responde 404 nesse caso em vez de `{results: []}`. Trata como
  // "nenhum grupo" em vez de derrubar o bootstrap inteiro (mentions/métricas
  // do par continuam rodando normalmente).
  let queryGroups: any[] = [];
  try {
    const queryGroupsResponse = await callBrandwatch(`/projects/${projectId}/query-groups`, token);
    queryGroups = (queryGroupsResponse.results ?? []) as any[];
  } catch (err) {
    if (err instanceof BrandwatchApiError && err.status === 404) {
      log("refreshMetadata:query_groups_not_found", { projectId });
    } else {
      throw err;
    }
  }
  if (queryGroups.length > 0) {
    const { error } = await supabase.from("bw_query_groups").upsert(
      queryGroups.map((g) => ({
        id: g.id,
        project_id: projectId,
        name: g.name,
        query_ids: g.queryIds ?? [],
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    );
    if (error) throw new Error(`Erro atualizando bw_query_groups: ${error.message}`);
  }

  const categoriesResponse = await callBrandwatch(`/projects/${projectId}/rulecategories`, token);
  const categories = (categoriesResponse.results ?? []) as any[];
  // Diagnóstico 2026-07-10 (usuário relatou Categories configuradas na
  // Brandwatch que não chegam em bw_categories/narratives): loga
  // resultsTotal vs. categories.length pra flagrar qualquer truncamento —
  // o envelope da resposta (resultsTotal/resultsPage/resultsPageSize)
  // sugere que o endpoint suporta paginação, mesmo sem exemplo documentado
  // de quando ela entra em vigor.
  log("refreshMetadata:categories_fetched", {
    projectId,
    resultsTotal: categoriesResponse.resultsTotal ?? null,
    categoriesReturned: categories.length,
  });
  const categoryRows: Record<string, unknown>[] = [];
  for (const category of categories) {
    categoryRows.push({
      id: category.id,
      project_id: projectId,
      parent_id: null,
      name: category.name,
      matching_type: category.matchingType ?? null,
      synced_at: new Date().toISOString(),
    });
    for (const child of category.children ?? []) {
      categoryRows.push({
        id: child.id,
        project_id: projectId,
        parent_id: category.id,
        name: child.name,
        matching_type: category.matchingType ?? null,
        synced_at: new Date().toISOString(),
      });
    }
  }
  if (categoryRows.length > 0) {
    const { error } = await supabase.from("bw_categories").upsert(categoryRows, { onConflict: "id" });
    if (error) throw new Error(`Erro atualizando bw_categories: ${error.message}`);
  }

  const narrativesCreated = await ensureNarrativesFromCategories(supabase, organizationId, categoryRows);

  if (categoryRows.length === 0) {
    // Narrativas são criadas a partir de bw_categories (ver
    // ensureNarrativesFromCategories abaixo) — se rulecategories veio
    // vazio, não há nenhuma Category configurada neste Project na
    // Brandwatch ainda, e narratives vai continuar vazia até que existam
    // Categories lá (configuração feita na própria Brandwatch, ver
    // brandwatch-setup.md — bw-sync só espelha o que já existe, não cria
    // Categories). Log explícito pra não precisar cruzar categoriesCount
    // manualmente ao investigar "narrativas continuam nulas".
    log("refreshMetadata:no_categories_found", {
      projectId,
      hint: "rulecategories voltou vazio — configure Categories no Project na Brandwatch (brandwatch-setup.md) para que narratives seja populada",
    });
  }

  log("refreshMetadata:done", {
    projectId,
    queriesCount: queries.length,
    queryGroupsCount: queryGroups.length,
    categoriesCount: categoryRows.length,
    narrativesCreated,
  });
}

// narratives.md: criação/edição de Narrativa não tem UI no Sprint 1 — o
// design ("Narrativa = Category, caso particular opcional", ver overview.md)
// já permite mapeamento 1:1 direto, então em vez de deixar a tabela vazia
// esperando um seed manual que nunca roda, cada Category de topo (não
// subcategoria — fica pra curadoria manual futura, mais granular) vira uma
// Narrativa automaticamente. Idempotente: só insere as que ainda não têm
// `bw_category_id` mapeado para esta organização; nunca sobrescreve
// title/stage/risk_level já editados manualmente por um analista.
async function ensureNarrativesFromCategories(
  supabase: SupabaseClient,
  organizationId: string,
  categoryRows: Record<string, unknown>[],
): Promise<number> {
  const topLevel = categoryRows.filter((c) => c.parent_id === null);
  if (topLevel.length === 0) return 0;

  const topLevelIds = topLevel.map((c) => c.id as number);
  const { data: existing, error: existingError } = await supabase
    .from("narratives")
    .select("bw_category_id")
    .eq("organization_id", organizationId)
    .in("bw_category_id", topLevelIds);
  if (existingError) throw new Error(`Erro lendo narratives existentes: ${existingError.message}`);

  const existingCategoryIds = new Set((existing ?? []).map((n) => (n as { bw_category_id: number }).bw_category_id));
  const missing = topLevel.filter((c) => !existingCategoryIds.has(c.id as number));
  if (missing.length === 0) return 0;

  const { error: insertError } = await supabase.from("narratives").insert(
    missing.map((c) => ({
      organization_id: organizationId,
      bw_category_id: c.id,
      title: c.name,
    })),
  );
  if (insertError) throw new Error(`Erro criando narratives a partir de bw_categories: ${insertError.message}`);
  return missing.length;
}

// =========================================================================
// Passo 4 — Polling de mentions
// =========================================================================

// ⚠️ Correção 2026-07-10 (relatado pelo usuário: mentions parou de crescer
// além de ~100 linhas mesmo depois do fix de paginação): o bug original
// (bootstrap com orderDirection=desc) já tinha avançado
// sync_cursors.last_added_cursor pra perto de "agora" antes de este fix
// existir — e o MAX(added) em `mentions` tem exatamente a mesma leva
// viciada (são as mentions mais recentes, não as mais antigas). Ou seja,
// nenhum dos dois sinais (cursor ou dado já persistido) distingue "já
// varri tudo" de "o cursor pulou o histórico por um bug". Migration
// `20260710020000` reseta last_added_cursor pra null e adiciona
// sync_cursors.backfill_completed_at — enquanto backfill_completed_at for
// null, o walk ascendente confia **só** em last_added_cursor (progresso
// real dentro do próprio walk corrigido), nunca no MAX(added) de
// `mentions`. Só depois que um walk completo alcança o presente pela
// primeira vez (backfill_completed_at passa a ter valor) é que o
// fallback por MAX(added) volta a ser seguro de usar (modo de polling
// incremental normal, ver ramo abaixo).
async function resolveMentionsSinceAdded(
  supabase: SupabaseClient,
  queryId: number,
  cursor: { last_added_cursor: string | null; backfill_completed_at: string | null },
): Promise<{ sinceAdded: Date; useSourceTypeNew: boolean }> {
  if (!cursor.backfill_completed_at) {
    return {
      sinceAdded: cursor.last_added_cursor ? new Date(cursor.last_added_cursor) : getMentionsStartDate(),
      useSourceTypeNew: false,
    };
  }

  let lastAdded = cursor.last_added_cursor;
  if (!lastAdded) {
    const { data, error } = await supabase
      .from("mentions")
      .select("added")
      .eq("query_id", queryId)
      .order("added", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Erro lendo último "added" de mentions: ${error.message}`);
    lastAdded = (data as { added: string } | null)?.added ?? null;
  }

  return {
    sinceAdded: lastAdded ? new Date(new Date(lastAdded).getTime() - 5 * 60 * 1000) : getMentionsStartDate(),
    useSourceTypeNew: Boolean(lastAdded),
  };
}

// Máximo aceito pela Brandwatch em paginação clássica (`pageSize`: 1–5000,
// ver references/mentions.md). ⚠️ Correção 2026-07-10 (relatado pelo
// usuário: "está dando erro de memória excedida", HTTP 546
// `WORKER_RESOURCE_LIMIT` em produção): o valor inicial dessa correção
// (5000, o máximo documentado pela Brandwatch) somado a
// MAX_MENTIONS_PAGES_PER_INVOCATION alto derrubava a Edge Function por
// estourar o limite de memória/CPU do runtime (Deno isolate) — cada
// mention tem um payload relativamente grande (raw completo + arrays de
// engajamento/classificações), e 5000 delas de uma vez, serializadas pro
// upsert do Supabase, é pesado demais pro runtime de uma Edge Function.
// Reduzido pra 1000 — ainda 10x o valor original (100) sem chegar perto do
// teto documentado pela Brandwatch, que era o que estava causando o
// estouro.
const MENTIONS_PAGE_SIZE = 1000;

// Quantas páginas de mentions uma única invocação pode buscar antes de
// seguir pras métricas — sem isso, backfill de meses de histórico levaria
// uma invocação por página (invocações são manuais/espaçadas hoje, sem
// pg_cron real ainda). ⚠️ Correção 2026-07-10 (mesmo incidente de memória
// acima): reduzido de 20 pra 10 — 10 páginas * 1000 = até 10k
// mentions/invocação (ante ~100k antes), bem mais seguro pro limite de
// memória do runtime, ainda deixando orçamento de rate limit (30
// chamadas/10min) pra bootstrap condicional + métricas depois. Ver também
// MENTIONS_LOOP_BUDGET_MS abaixo — a invocação também para voluntariamente
// por tempo decorrido, não só por contagem de páginas, pra nunca ser morta
// à força pelo runtime (o que pularia a atualização de sync_cursors, já
// que um kill do isolate não é um erro capturável pelo try/catch do
// handler). Se a Query tiver mais que isso pendente, a invocação seguinte
// continua de onde parou (sync_cursors.last_added_cursor/
// backfill_completed_at).
const MAX_MENTIONS_PAGES_PER_INVOCATION = 10;

// Orçamento de tempo (ms) que o loop de paginação de mentions pode consumir
// antes de parar voluntariamente e deixar o resto da invocação (métricas)
// rodar — separado do limite por contagem de páginas acima, como uma
// segunda rede de segurança contra estourar o timeout/CPU do runtime em
// Queries com respostas mais lentas que o normal.
const MENTIONS_LOOP_BUDGET_MS = 20_000;

async function fetchMentions(
  projectId: number,
  queryId: number,
  token: string,
  sinceAdded: Date,
  useSourceTypeNew: boolean,
): Promise<any[]> {
  // orderDirection=asc (não desc): caminha cronologicamente a partir do mais
  // antigo (startDate = BRANDWATCH_MENTIONS_START_DATE, default 2026-01-01)
  // até o presente — correção 2026-07-10. Antes, a primeira chamada (sem
  // cursor) pegava as mentions mais recentes (orderDirection=desc&page=0) e
  // o cursor pulava direto pra "agora", nunca voltando a buscar o histórico
  // de Jan-Jun/26.
  const params = new URLSearchParams({
    queryId: String(queryId),
    pageSize: String(MENTIONS_PAGE_SIZE),
    orderBy: "added",
    orderDirection: "asc",
    // Obrigatório pela API mesmo no polling ("This method requires a start
    // date") — ver getMentionsStartDate(). endDate = agora, sempre.
    startDate: formatBrandwatchDate(getMentionsStartDate()),
    endDate: formatBrandwatchDate(new Date()),
    sinceAdded: formatBrandwatchDate(sinceAdded),
  });
  // sourceType=new ("ignora mentions reprocessadas por backfill") só faz
  // sentido quando já existe histórico coletado — na primeiríssima leva
  // pra um par, backfill É o que queremos capturar.
  if (useSourceTypeNew) params.set("sourceType", "new");

  const json = await callBrandwatch(`/projects/${projectId}/data/mentions?${params.toString()}`, token);
  return json.results ?? [];
}

// `mentions` é particionada por mês (mention_date) — a migration inicial só
// pré-cria o mês do deploy + o seguinte. Como BRANDWATCH_MENTIONS_START_DATE
// pode trazer histórico de meses arbitrários (e não há pg_cron criando
// partições futuras com antecedência), garantimos aqui, sob demanda, que a
// partição de cada mês presente no lote existe antes do upsert — evita
// "no partition of relation \"mentions\" found for row".
async function ensureMentionPartitions(supabase: SupabaseClient, mentionDates: string[]): Promise<void> {
  const months = new Set(mentionDates.map((d) => d.slice(0, 7) + "-01"));
  for (const month of months) {
    const { error } = await supabase.rpc("create_mentions_partition", { p_month: month });
    if (error) throw new Error(`Erro criando partição de mentions para ${month}: ${error.message}`);
  }
}

// Campos de engajamento são por plataforma, sem nome genérico (ver
// mention-metadata-field-definitions da Brandwatch, pesquisado
// 2026-07-10) — em vez de ~20 colunas tipadas sem consumidor ainda,
// extraímos só as chaves presentes na mention pra um jsonb compacto.
const ENGAGEMENT_FIELDS = [
  "twitterFollowers", "twitterFollowing", "twitterLikeCount", "twitterRetweets", "twitterReplyCount",
  "instagramFollowerCount", "instagramLikeCount", "instagramCommentCount",
  "facebookLikes", "facebookComments", "facebookShares",
  "tiktokLikes", "tiktokComments", "tiktokShares",
  "blueskyFollowers", "blueskyLikes", "blueskyReplies", "blueskyReposts",
  "linkedinLikes", "linkedinComments", "linkedinShares", "linkedinImpressions",
] as const;

function extractEngagement(m: any): Record<string, unknown> {
  const engagement: Record<string, unknown> = {};
  for (const field of ENGAGEMENT_FIELDS) {
    if (m[field] !== undefined && m[field] !== null) engagement[field] = m[field];
  }
  return engagement;
}

// classifications é um array de {classifierId, labelId, name, trainingId,
// confidence} — emoção não é um campo próprio da mention, é best-effort:
// primeiro classifier cujo classifierId/name indica "emotions" (ex:
// "emotions:Anger" no formato addClassifications de editing-mentions).
function extractEmotion(classifications: any[]): string | null {
  for (const c of classifications ?? []) {
    const name: string = c?.name ?? "";
    if (name.toLowerCase().startsWith("emotions:")) return name.slice("emotions:".length);
    if (typeof c?.classifierId === "string" && c.classifierId.toLowerCase().includes("emotion")) {
      return c?.name ?? null;
    }
  }
  return null;
}

async function upsertMentions(
  supabase: SupabaseClient,
  organizationId: string,
  projectId: number,
  queryId: number,
  mentions: any[],
): Promise<{ count: number; maxAdded: string | null }> {
  if (mentions.length === 0) return { count: 0, maxAdded: null };

  let maxAdded: string | null = null;
  const rows = mentions.map((m) => {
    if (!maxAdded || new Date(m.added).getTime() > new Date(maxAdded).getTime()) maxAdded = m.added;
    const classifications = m.classifications ?? [];
    return {
      organization_id: organizationId,
      project_id: projectId,
      query_id: queryId,
      resource_id: String(m.resourceId),
      category_ids: m.categories ?? [],
      tag_names: m.tags ?? [],
      sentiment: m.sentiment ?? null,
      author: m.author ?? null,
      // full_text fica null nesta leva — /data/mentions/fulltext dobraria as
      // chamadas por poll (ver comentário no topo do arquivo).
      reach_estimate: m.reachEstimate ?? null,
      domain: m.domain ?? null,
      snippet: m.snippet ?? null,
      added: m.added,
      mention_date: toDateOnly(m.date ?? m.added),
      // Campos adicionados 2026-07-10 (pedido do usuário: garantir que
      // tudo necessário pra visões estilo "Relatório de Insights" já é
      // capturado) — nomes confirmados contra
      // mention-metadata-field-definitions da Brandwatch.
      gender: m.gender ?? null,
      country_code: m.countryCode ?? null,
      region: m.region ?? null,
      city: m.city ?? null,
      continent_code: m.continentCode ?? null,
      // pageType é deprecated pela Brandwatch — usar contentSource.
      content_source: m.contentSource ?? null,
      language: m.language ?? null,
      impressions: m.impressions ?? null,
      impact: m.impact ?? null,
      classifications,
      emotion: extractEmotion(classifications),
      insights_hashtag: m.insightsHashtag ?? [],
      insights_mentioned: m.insightsMentioned ?? [],
      reply_to: m.replyTo ?? null,
      retweet_of: m.retweetOf ?? null,
      engagement: extractEngagement(m),
      raw: m,
    };
  });

  await ensureMentionPartitions(supabase, rows.map((r) => r.mention_date));

  const { error } = await supabase
    .from("mentions")
    .upsert(rows, { onConflict: "query_id,resource_id,mention_date" });

  if (error) throw new Error(`Erro upsertando mentions: ${error.message}`);
  return { count: rows.length, maxAdded };
}

// =========================================================================
// Passos 5-6 — Métricas diárias/semanais/mensais (sentiment por grão)
// =========================================================================

interface SentimentChartPoint {
  date: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
}

function pivotSentimentChart(json: { results?: { id: string; values?: { id: string; value: number }[] }[] }): SentimentChartPoint[] {
  const byDate = new Map<string, SentimentChartPoint>();
  for (const bucket of json.results ?? []) {
    for (const point of bucket.values ?? []) {
      const dateKey = toDateOnly(point.id);
      const entry = byDate.get(dateKey) ?? { date: dateKey, total: 0, positive: 0, neutral: 0, negative: 0 };
      if (bucket.id === "positive") entry.positive = point.value;
      else if (bucket.id === "negative") entry.negative = point.value;
      else if (bucket.id === "neutral") entry.neutral = point.value;
      entry.total = entry.positive + entry.neutral + entry.negative;
      byDate.set(dateKey, entry);
    }
  }
  return Array.from(byDate.values());
}

type MetricGrain = "days" | "weeks" | "months";

const GRAIN_CONFIG: Record<MetricGrain, { table: string; dateColumn: string }> = {
  days: { table: "bw_query_metrics_daily", dateColumn: "metric_date" },
  weeks: { table: "bw_query_metrics_weekly", dateColumn: "metric_week" },
  months: { table: "bw_query_metrics_monthly", dateColumn: "metric_month" },
};

async function syncSentimentMetrics(
  supabase: SupabaseClient,
  token: string,
  grain: MetricGrain,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const config = GRAIN_CONFIG[grain];
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });
  if (categoryId) params.set("category", String(categoryId));

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/sentiment/${grain}?${params.toString()}`, token);
  const points = pivotSentimentChart(json);

  if (points.length === 0) {
    log("syncSentimentMetrics:empty", { grain, projectId, queryId, categoryId });
    return;
  }

  const rows = points.map((p) => ({
    project_id: projectId,
    query_id: queryId,
    category_id: categoryId,
    [config.dateColumn]: p.date,
    total_mentions: p.total,
    sentiment_positive: p.positive,
    sentiment_neutral: p.neutral,
    sentiment_negative: p.negative,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from(config.table)
    .upsert(rows, { onConflict: `project_id,query_id,category_id_key,${config.dateColumn}` });

  if (error) throw new Error(`Erro upsertando ${config.table}: ${error.message}`);
  log("syncSentimentMetrics:done", { grain, projectId, queryId, categoryId, rows: rows.length });
}

// Throttle: só busca semanal/mensal se não existir linha "fresca" ainda —
// evita gastar rate limit em toda invocação (~20-30s) num dado que muda bem
// mais devagar.
async function isGrainStale(
  supabase: SupabaseClient,
  grain: "weeks" | "months",
  projectId: number,
  queryId: number,
  categoryId: number | null,
  maxAgeMs: number,
): Promise<boolean> {
  const config = GRAIN_CONFIG[grain];
  let query = supabase
    .from(config.table)
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1);

  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro checando frescor de ${config.table}: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

// Mesma ideia de isGrainStale(), mas para bw_query_group_metrics_weekly —
// schema diferente (query_group_id + query_id, sem category_id), por isso
// uma função separada em vez de reusar isGrainStale() com IDs trocados.
async function isQueryGroupSovStale(
  supabase: SupabaseClient,
  queryGroupId: number,
  maxAgeMs: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("bw_query_group_metrics_weekly")
    .select("synced_at")
    .eq("query_group_id", queryGroupId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Erro checando frescor de bw_query_group_metrics_weekly: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

async function fetchNarrativeCategoryIds(supabase: SupabaseClient, projectId: number): Promise<number[]> {
  const { data: categories, error: categoriesError } = await supabase
    .from("bw_categories")
    .select("id")
    .eq("project_id", projectId);
  if (categoriesError) throw new Error(`Erro lendo bw_categories: ${categoriesError.message}`);

  const categoryIds = (categories ?? []).map((c: any) => c.id as number);
  if (categoryIds.length === 0) return [];

  const { data: narratives, error: narrativesError } = await supabase
    .from("narratives")
    .select("bw_category_id")
    .in("bw_category_id", categoryIds);
  if (narrativesError) throw new Error(`Erro lendo narratives: ${narrativesError.message}`);

  return Array.from(new Set((narratives ?? []).map((n: any) => n.bw_category_id as number)));
}

// =========================================================================
// Passo 6b — Share of Voice de Query Group (mesmo throttle semanal)
//
// ⚠️ Correção 2026-07-10: a chamada original usava
// `data/volume/queryGroups/weeks?queryGroupId=X` (dimensão `queryGroups`),
// mas o exemplo real confirmado na doc oficial
// (developers.brandwatch.com/docs/basic-charts) mostra que essa dimensão
// devolve **um item por Query Group inteiro** (`results[].id` = o próprio
// queryGroupId, volume agregado do grupo todo) — não um breakdown por Query
// dentro do grupo, que é o que o produto precisa pra comparar candidato ×
// concorrentes. Trocado para `data/volume/queries/weeks?queryGroupId=X`
// (dimensão `queries`, válida conforme chart-dimensions-and-aggregates;
// queryGroupId author como filtro/escopo) — não há exemplo oficial
// mostrando os dois parâmetros juntos, então o *shape* da resposta
// (`results[].id` = queryId dentro do grupo) continua não 100% confirmado,
// mas é a hipótese mais bem fundamentada hoje. Revisar contra os logs
// [bw-sync] reais após deploy.
// =========================================================================

async function syncQueryGroupSov(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryGroupId: number,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryGroupId: String(queryGroupId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/queries/weeks?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string | number; values?: { id: string; value: number }[] }[];

  const rows: Record<string, unknown>[] = [];
  for (const series of results) {
    const queryId = Number(series.id);
    if (!Number.isFinite(queryId)) {
      logError("syncQueryGroupSov:unexpected_series_id", `queryGroupId=${queryGroupId} id=${series.id}`);
      continue;
    }
    for (const point of series.values ?? []) {
      rows.push({
        project_id: projectId,
        query_group_id: queryGroupId,
        query_id: queryId,
        metric_week: toDateOnly(point.id),
        total_mentions: point.value,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length === 0) {
    log("syncQueryGroupSov:empty", { projectId, queryGroupId });
    return;
  }

  const { error } = await supabase
    .from("bw_query_group_metrics_weekly")
    .upsert(rows, { onConflict: "query_group_id,query_id,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_group_metrics_weekly: ${error.message}`);

  log("syncQueryGroupSov:done", { projectId, queryGroupId, rows: rows.length });
}

// =========================================================================
// Passo 6c — Breakdown diário de volume por plataforma
//
// data/volume/pageTypes/days — "pageTypes" (plural) é a dimensão de chart
// confirmada em chart-dimensions-and-aggregates (distinta do campo de
// mention "pageType", esse sim deprecated). Mesmo shape genérico de
// results[].id/values[] já usado em syncSentimentMetrics/syncQueryGroupSov
// — não peguei um payload de exemplo específico desta combinação, então
// ainda é "inferido pelo padrão geral", mesmo tratamento dado a
// syncQueryGroupSov antes da correção. Roda toda invocação (mesmo throttle
// "diário sempre" das métricas de sentiment).
// =========================================================================

async function syncPlatformMetrics(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/pageTypes/days?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string; values?: { id: string; value: number }[] }[];

  const rows: Record<string, unknown>[] = [];
  for (const series of results) {
    for (const point of series.values ?? []) {
      rows.push({
        project_id: projectId,
        query_id: queryId,
        page_type: String(series.id),
        metric_date: toDateOnly(point.id),
        total_mentions: point.value,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length === 0) {
    log("syncPlatformMetrics:empty", { projectId, queryId });
    return;
  }

  const { error } = await supabase
    .from("bw_query_metrics_daily_by_platform")
    .upsert(rows, { onConflict: "project_id,query_id,page_type,metric_date" });
  if (error) throw new Error(`Erro upsertando bw_query_metrics_daily_by_platform: ${error.message}`);

  log("syncPlatformMetrics:done", { projectId, queryId, rows: rows.length });
}

// =========================================================================
// Passo 6d — Temas (data/topics) — mecanismo nativo da Brandwatch mais
// próximo de "clusters temáticos com sentimento/volume/trending" (ver
// investigação sobre "Iris" no plano desta leva — não há uma Iris API
// separada; isto é o que a Consumer Research API realmente oferece pra
// tematização automática). Throttle semanal (mesmo isGrainStale usado por
// weeks/months, mas aqui reaproveitado contra bw_query_topics).
// Resposta usa a chave "topics" (não "results", diferente dos outros
// endpoints de chart) — confirmado contra developers.brandwatch.com/docs/
// data-topics.
// =========================================================================

async function syncTopicsData(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    extract: "words,phrases,hashtags,entities,people,places,organisations",
    metrics: "volume,percentageVolume,sentiment,trending",
    limit: "50",
  });
  if (categoryId) params.set("category", String(categoryId));

  const json = await callBrandwatch(`/projects/${projectId}/data/topics?${params.toString()}`, token);
  const topics = (json.topics ?? []) as any[];

  const metricWeek = toDateOnly(new Date().toISOString());
  const rows = topics
    .map((t) => {
      const sentiment = t.sentiment ?? {};
      return {
        project_id: projectId,
        query_id: queryId,
        category_id: categoryId,
        topic_type: String(t.type ?? "unknown"),
        label: String(t.label ?? t.id ?? ""),
        volume: t.volume ?? 0,
        percentage_volume: t.percentageVolume ?? null,
        sentiment_positive: sentiment.positive ?? 0,
        sentiment_neutral: sentiment.neutral ?? 0,
        sentiment_negative: sentiment.negative ?? 0,
        trending: t.trending ?? null,
        metric_week: metricWeek,
        synced_at: new Date().toISOString(),
      };
    })
    .filter((r) => r.label.length > 0);

  if (rows.length === 0) {
    log("syncTopicsData:empty", { projectId, queryId, categoryId });
    return;
  }

  const { error } = await supabase
    .from("bw_query_topics")
    .upsert(rows, { onConflict: "project_id,query_id,category_id_key,topic_type,label,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_topics: ${error.message}`);

  log("syncTopicsData:done", { projectId, queryId, categoryId, rows: rows.length });
}

async function isTopicsStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  maxAgeMs: number,
): Promise<boolean> {
  let query = supabase
    .from("bw_query_topics")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1);
  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_topics: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

// =========================================================================
// Passo 6e — Ranking de autores (data/volume/topauthors/queries) — endpoint
// nativo de "Top Authors" (skill brandwatch-api recomendava calcular isso
// localmente por SQL sobre mentions, mas esse endpoint existe e é melhor:
// não sofre o mesmo sampling das mentions individuais sincronizadas, e já
// vem com reach/impact/sentimento/engajamento por plataforma agregados
// pela própria Brandwatch). Throttle semanal, mesmo padrão de
// bw_query_topics. Envelope confirmado: results[].data.{authorName,
// authorGender, authorVolume, reachEstimate, impact, sentiment, twitter*/
// facebook*/reddit* fields} — via developers.brandwatch.com/docs/
// top-authors.
// =========================================================================

async function syncTopAuthors(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    limit: "100",
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/topauthors/queries?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string; name?: string; data?: Record<string, any> }[];

  const metricWeek = toDateOnly(new Date().toISOString());
  const rows = results
    .map((r) => {
      const d = r.data ?? {};
      const sentiment = d.sentiment ?? {};
      const author = String(d.authorName ?? r.name ?? r.id ?? "");
      return {
        project_id: projectId,
        query_id: queryId,
        author,
        volume: d.authorVolume ?? d.volume ?? 0,
        reach_estimate: d.reachEstimate ?? null,
        impact: d.impact ?? null,
        sentiment_positive: sentiment.positive ?? 0,
        sentiment_neutral: sentiment.neutral ?? 0,
        sentiment_negative: sentiment.negative ?? 0,
        // Guarda o objeto `data` inteiro (twitter*/facebook*/reddit* etc.)
        // — mesmo raciocínio de mentions.engagement, sem coluna por campo.
        platform_stats: d,
        metric_week: metricWeek,
        synced_at: new Date().toISOString(),
      };
    })
    .filter((r) => r.author.length > 0);

  if (rows.length === 0) {
    log("syncTopAuthors:empty", { projectId, queryId });
    return;
  }

  const { error } = await supabase
    .from("bw_query_top_authors")
    .upsert(rows, { onConflict: "project_id,query_id,author,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_top_authors: ${error.message}`);

  log("syncTopAuthors:done", { projectId, queryId, rows: rows.length });
}

async function isTopAuthorsStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  maxAgeMs: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("bw_query_top_authors")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_top_authors: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

// =========================================================================
// Handler principal
// =========================================================================

Deno.serve(async (_req: Request) => {
  const invocationStartedAt = Date.now();
  log("invocation:start");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Passo 0: semeadura (idempotente, roda toda invocação).
  try {
    await ensureBootstrapSeed(supabase);
  } catch (err) {
    logError("invocation:bootstrap_seed_failed", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Passo 1: resolver o próximo par (project_id, query_id) pendente.
  const { data: cursor, error: cursorError } = await supabase
    .from("sync_cursors")
    .select("id, project_id, query_id, last_added_cursor, last_synced_at, backfill_completed_at")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  if (cursorError) {
    logError("invocation:sync_cursors_query_failed", cursorError.message);
    return new Response(JSON.stringify({ ok: false, error: cursorError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!cursor) {
    log("invocation:no_pending_pair");
    return new Response(JSON.stringify({ ok: true, message: "nenhum par pendente" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { project_id: projectId, query_id: queryId } = cursor as { project_id: number; query_id: number };
  log("invocation:next_pair", { projectId, queryId, lastSyncedAt: cursor.last_synced_at });

  // Passo 2: resolver o access token. TODO (ver CLAUDE.md): ainda minta um
  // token novo por invocação — cache via Vault/token_expires_at fica para a
  // próxima leva, antes de agendar via pg_cron de verdade.
  let brandwatchToken: BrandwatchToken;
  try {
    brandwatchToken = await mintBrandwatchAccessToken();
  } catch (err) {
    logError("invocation:mint_token_failed", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
  const token = brandwatchToken.accessToken;

  const now = new Date();
  // Correção 2026-07-10 (pedido do usuário: "Data início 01/01/2026 até a
  // data de hj" para as métricas, não só mentions): as chamadas de
  // data/volume/{...} devolvem todos os buckets do range pedido numa única
  // chamada (não uma por dia/semana) — usar o range completo configurado
  // em vez de só os últimos 7 dias é o mesmo custo de rate limit, só que
  // cobrindo o histórico inteiro em vez de uma janela que nunca alcançava
  // Jan-Jun/26.
  const metricsStartDate = getMentionsStartDate();

  try {
    // Resolve organization_id (necessário pro bootstrap de metadata e pro
    // upsert de mentions) via bw_projects — já existe nesse ponto, criado
    // pelo passo 0.
    const { data: projectRow, error: projectRowError } = await supabase
      .from("bw_projects")
      .select("organization_id")
      .eq("id", projectId)
      .single();
    if (projectRowError) throw new Error(`Erro lendo organization_id de bw_projects: ${projectRowError.message}`);
    const organizationId = projectRow.organization_id as string;

    // Passo 3: bootstrap de metadata (condicional).
    if (await needsMetadataRefresh(supabase, projectId)) {
      await refreshMetadata(supabase, token, projectId, organizationId);
    } else {
      log("invocation:metadata_fresh", { projectId });
    }

    // Passo 4: polling de mentions — pagina dentro da mesma invocação até
    // alcançar o presente ou esgotar o orçamento de páginas, em vez de
    // avançar só uma página por invocação (correção 2026-07-10, pedido do
    // usuário: "a tabela de menções só conta pouco mais de 100 menções, o
    // que não condiz com a realidade" — com invocações manuais/espaçadas,
    // uma página por invocação levaria muito tempo pra cobrir um
    // trimestre de histórico). `sourceType=new` só entra quando o walk já
    // alcançou o presente pelo menos uma vez antes (ver
    // resolveMentionsSinceAdded) — antes disso, sempre queremos backfill.
    const { sinceAdded: initialSinceAdded, useSourceTypeNew } = await resolveMentionsSinceAdded(supabase, queryId, {
      last_added_cursor: cursor.last_added_cursor as string | null,
      backfill_completed_at: cursor.backfill_completed_at as string | null,
    });
    let sinceAdded = initialSinceAdded;

    let mentionsCount = 0;
    let maxAdded: string | null = null;
    let mentionsPagesFetched = 0;
    let reachedNow = false;
    let stoppedByTimeBudget = false;
    while (mentionsPagesFetched < MAX_MENTIONS_PAGES_PER_INVOCATION) {
      // Segunda rede de segurança (além do limite de páginas): para
      // voluntariamente antes de estourar o timeout/CPU do runtime, em vez
      // de deixar o Supabase matar a invocação à força (o que puxaria um
      // HTTP 546 WORKER_RESOURCE_LIMIT e pularia a atualização de
      // sync_cursors, já que um kill do isolate não é capturável pelo
      // try/catch do handler).
      if (Date.now() - invocationStartedAt > MENTIONS_LOOP_BUDGET_MS) {
        stoppedByTimeBudget = true;
        break;
      }
      const page = await fetchMentions(projectId, queryId, token, sinceAdded, useSourceTypeNew);
      const upserted = await upsertMentions(supabase, organizationId, projectId, queryId, page);
      mentionsCount += upserted.count;
      mentionsPagesFetched++;
      if (upserted.maxAdded) {
        maxAdded = upserted.maxAdded;
        sinceAdded = new Date(upserted.maxAdded);
      }
      log("invocation:mentions_page", { projectId, queryId, page: mentionsPagesFetched, count: upserted.count });
      if (page.length < MENTIONS_PAGE_SIZE) {
        reachedNow = true;
        break; // alcançou o presente
      }
    }
    log("invocation:mentions_synced", {
      projectId,
      queryId,
      mentionsCount,
      pagesFetched: mentionsPagesFetched,
      reachedNow,
      stoppedByTimeBudget,
    });

    // Passo 5: métricas diárias — sempre roda, query inteira (category=null)
    // + cada Category vinculada a alguma Narrativa deste projeto.
    const narrativeCategoryIds = await fetchNarrativeCategoryIds(supabase, projectId);
    const categoryTargets: (number | null)[] = [null, ...narrativeCategoryIds];

    for (const categoryId of categoryTargets) {
      await syncSentimentMetrics(supabase, token, "days", projectId, queryId, categoryId, metricsStartDate, now);
    }

    // Passo 6c: breakdown de plataforma — sempre roda, mesmo throttle do
    // diário (query inteira, sem quebra por Narrativa).
    await syncPlatformMetrics(supabase, token, projectId, queryId, metricsStartDate, now);

    // Passo 6: semanal/mensal — throttle por frescor (evita gastar rate
    // limit em dado que muda bem mais devagar que a cada 20-30s).
    for (const categoryId of categoryTargets) {
      if (await isGrainStale(supabase, "weeks", projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
        await syncSentimentMetrics(supabase, token, "weeks", projectId, queryId, categoryId, metricsStartDate, now);
      }
      if (await isGrainStale(supabase, "months", projectId, queryId, categoryId, 30 * 24 * 60 * 60 * 1000)) {
        await syncSentimentMetrics(supabase, token, "months", projectId, queryId, categoryId, metricsStartDate, now);
      }
      // Passo 6d: temas (data/topics) — mesmo throttle semanal, por
      // categoryTarget (query inteira + cada Narrativa).
      if (await isTopicsStale(supabase, projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
        await syncTopicsData(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      }
    }

    // Passo 6e: ranking de autores — mesmo throttle semanal, só no nível de
    // Query inteira (o endpoint não filtra por Category).
    if (await isTopAuthorsStale(supabase, projectId, queryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncTopAuthors(supabase, token, projectId, queryId, metricsStartDate, now);
    }

    // Passo 6b: SOV de Query Group, se a query pertence a algum grupo.
    const { data: queryGroups, error: queryGroupsError } = await supabase
      .from("bw_query_groups")
      .select("id")
      .eq("project_id", projectId)
      .contains("query_ids", [queryId]);
    if (queryGroupsError) throw new Error(`Erro lendo bw_query_groups: ${queryGroupsError.message}`);

    for (const group of queryGroups ?? []) {
      const queryGroupId = (group as { id: number }).id;
      if (await isQueryGroupSovStale(supabase, queryGroupId, 7 * 24 * 60 * 60 * 1000)) {
        await syncQueryGroupSov(supabase, token, projectId, queryGroupId, metricsStartDate, now);
      }
    }

    // Passo 7: fechar o ciclo. backfill_completed_at só é setado na
    // primeira vez que o walk alcança o presente, e nunca mais é limpo
    // depois disso (mesmo padrão de "flag que só liga uma vez").
    const { error: updateCursorError } = await supabase
      .from("sync_cursors")
      .update({
        last_added_cursor: maxAdded ?? cursor.last_added_cursor,
        last_synced_at: new Date().toISOString(),
        status: "idle",
        last_error: null,
        ...(reachedNow && !cursor.backfill_completed_at
          ? { backfill_completed_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", cursor.id);
    if (updateCursorError) throw new Error(`Erro atualizando sync_cursors: ${updateCursorError.message}`);

    await supabase.from("sync_log").insert({
      project_id: projectId,
      query_id: queryId,
      status: "success",
      rows_processed: mentionsCount,
    });

    log("invocation:done", { durationMs: Date.now() - invocationStartedAt, projectId, queryId, mentionsCount });

    return new Response(
      JSON.stringify({ ok: true, projectId, queryId, mentionsCount, tokenExpiresAt: brandwatchToken.expiresAt.toISOString() }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("invocation:failed", err);

    // Falha isolada por par — marca erro no cursor, mas não derruba a fila
    // (a próxima invocação pega outro par ou tenta este de novo).
    await supabase
      .from("sync_cursors")
      .update({ status: "error", last_error: message })
      .eq("id", cursor.id);
    await supabase.from("sync_log").insert({
      project_id: projectId,
      query_id: queryId,
      status: "error",
      error_message: message,
    });

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
