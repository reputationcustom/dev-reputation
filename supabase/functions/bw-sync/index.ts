// supabase/functions/bw-sync/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Acionada por pg_cron a cada 15min (um
// "heartbeat" barato, fixo — ver migration `20260711020000`), mas só faz
// trabalho de verdade (mint de token + chamadas à Brandwatch) quando algum
// par (project_id, query_id) está "devido": sync_cursors.last_synced_at mais
// antigo que BW_SYNC_INTERVAL_HOURS (secret da própria função, default `3`
// — pedido do usuário 2026-07-11: "a cada 3 horas... capturar o cenário
// atual", configurável e fácil de mudar via variável de ambiente, sem
// precisar de nova migration). Ver getSyncIntervalHours() e o gate no topo
// do handler abaixo, e sync-brandwatch.md passo 0.5b.
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

// Correção 2026-07-10/11 (relatado pelo usuário: HTTP 429 em cascata,
// "acho que o código violou alguma regra da brandwatch"). Duas causas
// possíveis somadas: (a) duas invocações concorrentes disputando o mesmo
// orçamento de 30 chamadas/10min (ver bw_sync_lock, migration
// `20260711000000`); (b) uma única invocação, sozinha, já perto ou acima
// de 30 chamadas — o número de passos cresceu bastante (mentions paginado
// + diário + reach/engagement + plataforma + semanal/mensal + temas + top
// autores × categoryTargets + SOV). `brandwatchCallCount` é reiniciado no
// topo de cada invocação (nunca reaproveitado entre invocações, mesmo em
// warm start do isolate Deno) e incrementado a cada tentativa real de
// request (inclusive as que tomam 429, já que essas também consomem o
// orçamento do Client). `BRANDWATCH_CALL_BUDGET` deixa margem sob 30 pro
// mint de token (que não passa por callBrandwatch()) e pra não flertar
// com o teto.
let brandwatchCallCount = 0;
const BRANDWATCH_CALL_BUDGET = 25;

// Correção 2026-07-16 (ver migration 20260716020000): janela real do rate
// limit da Brandwatch (30 chamadas/10min por Client, brandwatch-setup.md
// §1) — usado como backoff persistido em bw_sync_lock.rate_limited_until
// quando callBrandwatch() esgota as 3 tentativas locais em 429, pra
// próximas invocações não repetirem a mesma chamada fadada a falhar.
const BRANDWATCH_RATE_LIMIT_BACKOFF_SECONDS = 600;

function hasBrandwatchCallBudget(): boolean {
  return brandwatchCallCount < BRANDWATCH_CALL_BUDGET;
}

async function callBrandwatch(path: string, token: string): Promise<any> {
  const url = `${BRANDWATCH_BASE_URL}${path}`;

  for (let attempt = 0; attempt <= 3; attempt++) {
    brandwatchCallCount++;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 429) {
      if (attempt === 3) {
        // Tipado como BrandwatchApiError (status 429), não Error genérico —
        // deixa runSyncInvocation() distinguir "esgotou retry por rate
        // limit" de qualquer outra falha e acionar mark_bw_rate_limited()
        // (ver migration 20260716020000, correção 2026-07-16).
        throw new BrandwatchApiError(429, `Brandwatch rate limit excedido após 3 tentativas em ${path}`);
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

// Intervalo de negócio entre capturas completas do "cenário atual" —
// parametrizável via secret (BW_SYNC_INTERVAL_HOURS), default 3h. Não é a
// frequência do pg_cron (fixa em 15min, só um heartbeat barato que decide se
// há trabalho a fazer) — é o que efetivamente determina se um par
// (project_id, query_id) está "devido" pra nova sincronização. Trocar esse
// secret muda o comportamento na próxima invocação, sem precisar de nova
// migration. Piso efetivo = a cadência do heartbeat (15min) — um valor menor
// que isso não faz a sincronização rodar mais rápido que a cada 15min.
function getSyncIntervalHours(): number {
  const raw = Deno.env.get("BW_SYNC_INTERVAL_HOURS");
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    logError("getSyncIntervalHours:invalid", `BW_SYNC_INTERVAL_HOURS="${raw}" inválido, usando default 3`);
  }
  return 3;
}

// Janela móvel (dias) usada pelas chamadas de métricas (data/volume/...,
// topics, top-authors, SOV etc.) depois que o backfill histórico de um par
// já terminou (sync_cursors.backfill_completed_at != null) — parametrizável
// via secret (BW_METRICS_INCREMENTAL_WINDOW_DAYS), default 30. Correção
// 2026-07-19 (pedido do usuário: já existe base de dados histórica, não faz
// sentido pedir sempre `data/volume/...` desde `BRANDWATCH_MENTIONS_START_DATE`
// — ver `getMetricsStartDate()` abaixo pelo racional completo).
function getMetricsIncrementalWindowDays(): number {
  const raw = Deno.env.get("BW_METRICS_INCREMENTAL_WINDOW_DAYS");
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    logError(
      "getMetricsIncrementalWindowDays:invalid",
      `BW_METRICS_INCREMENTAL_WINDOW_DAYS="${raw}" inválido, usando default 30`,
    );
  }
  return 30;
}

// Data de início a usar nas chamadas de métricas de um par nesta invocação.
// Enquanto o backfill histórico de mentions daquele par ainda não terminou
// (`backfill_completed_at` null), mantém o range completo desde
// `getMentionsStartDate()` — as tabelas de agregado (diário/semanal/mensal/
// topics/top-authors/SOV/...) ainda precisam ser populadas com o histórico
// inteiro ao longo dos ciclos, mesma razão da correção 2026-07-10 (ver
// CLAUDE.md, "Metrics date range bug"). Uma vez que o par já tem base
// histórica capturada, alargar o range pra sempre-desde-janeiro em toda
// invocação deixa de fazer sentido — essas chamadas de chart devolvem todos
// os buckets do range pedido numa única chamada, então um par "maduro"
// estava reprocessando e re-upsertando meses de linhas já corretas em
// toda invocação, só pra capturar o(s) bucket(s) mais recente(s). Depois do
// backfill, usa uma janela móvel curta (`now() - N dias`, mesmo padrão já
// usado por `runHourlyMetricsStep`/`HOURLY_METRICS_WINDOW_MS`) — grande o
// bastante pra reabsorver correções/atraso de indexação da Brandwatch em
// dados recentes, pequena o bastante pra não recobrir o histórico inteiro.
// Trade-off aceito: uma correção da Brandwatch a um período **fora** dessa
// janela (mais antigo que N dias) deixa de ser capturada — histórico já
// sincronizado passa a ser efetivamente definitivo. Nenhum consumidor deste
// projeto depende de correções tardias tão antigas hoje.
function getMetricsStartDate(backfillCompletedAt: string | null): Date {
  if (!backfillCompletedAt) return getMentionsStartDate();
  const windowMs = getMetricsIncrementalWindowDays() * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - windowMs);
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
  // bw_categories força um refresh mesmo dentro da janela de staleness — é
  // autocorretivo: para de forçar assim que categorias existirem de
  // verdade, sem precisar de intervenção manual/env var.
  const { count: categoriesCount, error: categoriesError } = await supabase
    .from("bw_categories")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (categoriesError) throw new Error(`Erro checando bw_categories: ${categoriesError.message}`);
  if (!categoriesCount) return true;

  // Correção 2026-07-10, mesmo dia (relatado pelo usuário: "em categorias,
  // não está refletindo as categorias existentes na brandwatch" — o
  // projeto ainda está em configuração ativa na Brandwatch, então esperar
  // 24h pra qualquer Category nova/editada aparecer era tempo demais).
  // Reduzido de 24h pra 1h — ainda barato de rate limit (no máximo ~4
  // chamadas extras/hora por Project, bem dentro do orçamento de 30/10min)
  // e reflete mudanças de configuração muito mais rápido. Não deleta
  // Categories que sumiram da Brandwatch (só adiciona/atualiza) — deletar
  // é arriscado aqui, já que bw_query_metrics_daily/bw_query_topics/
  // bw_query_top_authors têm FK `on delete cascade` pra bw_categories (uma
  // Category removida da Brandwatch apagaria o histórico de métricas
  // dela) e `narratives.bw_category_id` não tem `on delete cascade`
  // nenhum (deletar quebraria com violação de FK se a Category já virou
  // Narrativa). Se uma Category for removida/renomeada na Brandwatch, a
  // linha antiga fica órfã em bw_categories até uma limpeza manual — mais
  // seguro que apagar dado histórico às cegas.
  const syncedAt = new Date(data.synced_at as string).getTime();
  return Date.now() - syncedAt > 60 * 60 * 1000;
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
      // Corrige divergência de escopo do SOV por Narrativa (2026-07-11,
      // pedido do usuário — validado contra
      // developers.brandwatch.com/docs/retrieving-categories: o payload já
      // inclui `queryIds`, sem chamada nova). Sem isto,
      // fetchNarrativeCategoryIds() devolvia TODAS as Narrativas do
      // Project pra QUALQUER Query sincronizada — se o Project tem mais de
      // uma Query (vários candidatos, como no export de dashboard
      // validado), cada Query gastava orçamento filtrando por Categories
      // de candidatos alheios, e refresh_narrative_metrics() podia juntar
      // linhas de bw_query_metrics_daily de Queries erradas pra mesma
      // Narrativa.
      query_ids: category.queryIds ?? [],
      status: "active",
      synced_at: new Date().toISOString(),
    });
    for (const child of category.children ?? []) {
      categoryRows.push({
        id: child.id,
        project_id: projectId,
        parent_id: category.id,
        name: child.name,
        matching_type: category.matchingType ?? null,
        query_ids: child.queryIds ?? category.queryIds ?? [],
        status: "active",
        synced_at: new Date().toISOString(),
      });
    }
  }
  if (categoryRows.length > 0) {
    const { error } = await supabase.from("bw_categories").upsert(categoryRows, { onConflict: "id" });
    if (error) throw new Error(`Erro atualizando bw_categories: ${error.message}`);
  }

  // Pedido do usuário (2026-07-16): Category/Subcategory que suma do
  // /rulecategories atual (renomeada/excluída na Brandwatch) nunca é
  // deletada localmente (preserva FK/histórico de bw_query_metrics_daily
  // etc., ver migration 20260716010000), mas passa pra status='inactive' —
  // "não mais será utilizada no sistema". Reativação é automática: se ela
  // reaparecer num sync futuro, o upsert acima já grava status:'active' de
  // novo. `.not("id", "in", ...)` com lista vazia vira `not.in.()`, que o
  // PostgREST não aceita — usa um id inalcançável (0, bigint nunca usado
  // por Category real) como placeholder nesse caso, marcando tudo inativo.
  const returnedCategoryIds = categoryRows.map((c) => c.id as number);
  const knownIdsList = returnedCategoryIds.length > 0 ? returnedCategoryIds.join(",") : "0";
  const { error: deactivateError } = await supabase
    .from("bw_categories")
    .update({ status: "inactive" })
    .eq("project_id", projectId)
    .eq("status", "active")
    .not("id", "in", `(${knownIdsList})`);
  if (deactivateError) {
    throw new Error(`Erro desativando bw_categories removidas da Brandwatch: ${deactivateError.message}`);
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
// ✅ Ampliação 2026-07-12 (pedido do usuário, resolvendo a ⚠️ DECISÃO
// PENDENTE de intelligence-center/electoral-themes.md): "Subcategorias
// devem virar narrativas. Uma categoria pode agrupar diversas
// subcategorias que também são narrativas." Antes, só Categories de topo
// (`parent_id is null`) viravam `narratives` — Subcategories ficavam só
// pra curadoria manual. Agora todas as Categories (topo e Subcategory)
// recebem uma Narrativa automaticamente; a hierarquia Pauta→Narrativa
// continua 100% derivável via `bw_categories.parent_id` (sem coluna nova
// em `narratives` — ver electoral-themes.md, "Pauta" = Narrativa cuja
// Category tem `parent_id is null`, Narrativa-filha = Category com
// `parent_id` apontando pra ela).
// ✅ Alteração 2026-07-20 (pedido do usuário: "O nome da narrativa será
// composto por 'categoria - subcategoria'"). Motivo: desde a mesma sessão,
// Overview e a aba Narrativas passaram a listar Category (Pauta) e
// Subcategory juntas na mesma tabela plana (ver
// narrativesScopeForPage() em aggregated-metrics-service.ts, p_scope
// agora null pras duas páginas) — um título de Subcategory sozinho (ex.
// "Vacinação") fica ambíguo sem saber a qual Pauta ele pertence quando
// visto ao lado de outras Pautas/Subcategories na mesma lista. Category de
// topo continua só com o próprio nome (não tem pai pra compor).
function buildNarrativeTitle(
  category: Record<string, unknown>,
  categoryRows: Record<string, unknown>[],
): string {
  const parentId = category.parent_id as number | null;
  const name = category.name as string;
  if (parentId === null) return name;
  const parent = categoryRows.find((c) => (c.id as number) === parentId);
  const parentName = (parent?.name as string | undefined) ?? null;
  return parentName ? `${parentName} - ${name}` : name;
}

async function ensureNarrativesFromCategories(
  supabase: SupabaseClient,
  organizationId: string,
  categoryRows: Record<string, unknown>[],
): Promise<number> {
  if (categoryRows.length === 0) return 0;

  const categoryIds = categoryRows.map((c) => c.id as number);
  const { data: existing, error: existingError } = await supabase
    .from("narratives")
    .select("bw_category_id")
    .eq("organization_id", organizationId)
    .in("bw_category_id", categoryIds);
  if (existingError) throw new Error(`Erro lendo narratives existentes: ${existingError.message}`);

  const existingCategoryIds = new Set((existing ?? []).map((n) => (n as { bw_category_id: number }).bw_category_id));
  const missing = categoryRows.filter((c) => !existingCategoryIds.has(c.id as number));
  if (missing.length === 0) return 0;

  const { error: insertError } = await supabase.from("narratives").insert(
    missing.map((c) => ({
      organization_id: organizationId,
      bw_category_id: c.id,
      title: buildNarrativeTitle(c, categoryRows),
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

// Corrigido 2026-07-11 (pedido do usuário: SOV = menções da Narrativa /
// total de menções — precisa que "total" seja o total da MESMA Query, não
// de todo o Project). Antes, devolvia toda Narrativa do Project pra
// qualquer Query — se o Project tem múltiplas Queries (vários candidatos,
// confirmado no export de dashboard já validado), cada Query gastava
// categoryTargets/orçamento em Categories de candidatos alheios. Agora
// filtra por `bw_categories.query_ids` conter o `queryId` corrente
// (`queryIds` já vem no payload de `rulecategories`, sem chamada nova —
// ver refreshMetadata()).
async function fetchNarrativeCategoryIds(supabase: SupabaseClient, projectId: number, queryId: number): Promise<number[]> {
  // status='active' (2026-07-16): não gasta orçamento de rate limit
  // sincronizando novo dado pra Categories que já sumiram do
  // /rulecategories da Brandwatch — ver refreshMetadata() e migration
  // 20260716010000.
  const { data: categories, error: categoriesError } = await supabase
    .from("bw_categories")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "active")
    .contains("query_ids", [queryId]);
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
  } else {
    const { error } = await supabase
      .from("bw_query_group_metrics_weekly")
      .upsert(rows, { onConflict: "query_group_id,query_id,metric_week" });
    if (error) throw new Error(`Erro upsertando bw_query_group_metrics_weekly: ${error.message}`);
    log("syncQueryGroupSov:done", { projectId, queryGroupId, rows: rows.length });
  }

  // Ampliação 2026-07-11 (validação contra export real de dashboard
  // Brandwatch — "Reach Over Time" comparando candidatos dentro do mesmo
  // Query Group): mesma dimensão `queries`, trocando o agregado por
  // `reachEstimate` — upsert parcial (só essa coluna) na mesma linha.
  const reachJson = await callBrandwatch(`/projects/${projectId}/data/reachEstimate/queries/weeks?${params.toString()}`, token);
  const reachResults = (reachJson.results ?? []) as { id: string | number; values?: { id: string; value: number }[] }[];

  const reachRows: Record<string, unknown>[] = [];
  for (const series of reachResults) {
    const queryId = Number(series.id);
    if (!Number.isFinite(queryId)) {
      logError("syncQueryGroupSov:unexpected_reach_series_id", `queryGroupId=${queryGroupId} id=${series.id}`);
      continue;
    }
    for (const point of series.values ?? []) {
      reachRows.push({
        project_id: projectId,
        query_group_id: queryGroupId,
        query_id: queryId,
        metric_week: toDateOnly(point.id),
        reach_estimate: point.value,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (reachRows.length === 0) {
    log("syncQueryGroupSov:reach_empty", { projectId, queryGroupId });
    return;
  }

  const { error: reachError } = await supabase
    .from("bw_query_group_metrics_weekly")
    .upsert(reachRows, { onConflict: "query_group_id,query_id,metric_week" });
  if (reachError) throw new Error(`Erro upsertando bw_query_group_metrics_weekly (reach): ${reachError.message}`);

  log("syncQueryGroupSov:reach_done", { projectId, queryGroupId, rows: reachRows.length });
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
  categoryId: number | null,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });
  // Ampliação 2026-07-11 (pedido do usuário: "importante que tenhamos
  // share of voice por plataforma... por narrativa") — categoryId opcional
  // permite reusar esta mesma função pra breakdown por Narrativa, não só
  // da Query inteira. Mesmo filtro `category=<id>` já comprovado em
  // syncSentimentMetrics/syncTopAuthors/etc.
  if (categoryId) params.set("category", String(categoryId));

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/pageTypes/days?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string; values?: { id: string; value: number }[] }[];

  const rows: Record<string, unknown>[] = [];
  for (const series of results) {
    for (const point of series.values ?? []) {
      rows.push({
        project_id: projectId,
        query_id: queryId,
        category_id: categoryId,
        page_type: String(series.id),
        metric_date: toDateOnly(point.id),
        total_mentions: point.value,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length === 0) {
    log("syncPlatformMetrics:empty", { projectId, queryId, categoryId });
    return;
  }

  // Defensivo (mesma correção de "ON CONFLICT DO UPDATE" já aplicada em
  // syncTopicsData()/syncTopAuthors()/etc.) — nunca observado neste
  // endpoint especificamente, mas mesma classe de risco.
  const uniqueRows = dedupeByKey(rows, (r) => `${String(r.page_type)}::${String(r.metric_date)}`);
  if (uniqueRows.length !== rows.length) {
    log("syncPlatformMetrics:duplicates_removed", {
      projectId, queryId, categoryId, removed: rows.length - uniqueRows.length,
    });
  }

  const { error } = await supabase
    .from("bw_query_metrics_daily_by_platform")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,page_type,metric_date" });
  if (error) throw new Error(`Erro upsertando bw_query_metrics_daily_by_platform: ${error.message}`);

  log("syncPlatformMetrics:done", { projectId, queryId, categoryId, rows: uniqueRows.length });
}

// =========================================================================
// Autores únicos/engajamento/sentimento líquido por plataforma (2026-07-12,
// pedido do usuário: "já estamos trazendo da brandwatch, se não tiver,
// reveja as especificações... garantir que tenhamos essa informação no
// supabase via api da brandwatch"). Mesmo endpoint de chart, mesma
// dimensão `pageTypes` já usada por syncPlatformMetrics — só troca o
// aggregate (`volume` → `authors`/`engagementScore`/`netSentiment`).
// `netSentiment` devolve um score único por plataforma/dia, não o split
// positivo/neutro/negativo (não há combinação de 3 dimensões
// sentiment+pageTypes+days documentada) — ver nota em data-model.md.
// Roda toda invocação (fase daily_metrics, sem throttle) só para
// category_id is null: cardinalidade de `pageTypes` é pequena (dezenas),
// mesmo porte já aceito pras 2 chamadas de `categories` (reach/engagement)
// que também rodam toda invocação — diferente do incidente de CPU
// corrigido em 20260711030000, que veio de milhares de linhas.
// =========================================================================

async function syncPlatformAggregate(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  aggregate: "authors" | "engagementScore" | "netSentiment",
  column: "unique_authors" | "engagement_score" | "net_sentiment",
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/${aggregate}/pageTypes/days?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string; values?: { id: string; value: number }[] }[];

  const rows: Record<string, unknown>[] = [];
  for (const series of results) {
    for (const point of series.values ?? []) {
      rows.push({
        project_id: projectId,
        query_id: queryId,
        category_id: null,
        page_type: String(series.id),
        metric_date: toDateOnly(point.id),
        [column]: point.value,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length === 0) {
    log("syncPlatformAggregate:empty", { projectId, queryId, aggregate });
    return;
  }

  const uniqueRows = dedupeByKey(rows, (r) => `${String(r.page_type)}::${String(r.metric_date)}`);

  // Upsert parcial (só a coluna do aggregate corrente) — mesmo raciocínio
  // de syncCategoryDailyAggregate(), nunca zera total_mentions/outras
  // colunas já sincronizadas por outra chamada pra mesma linha.
  const { error } = await supabase
    .from("bw_query_metrics_daily_by_platform")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,page_type,metric_date" });
  if (error) throw new Error(`Erro upsertando bw_query_metrics_daily_by_platform (${column}): ${error.message}`);

  log("syncPlatformAggregate:done", { projectId, queryId, aggregate, rows: uniqueRows.length });
}

// =========================================================================
// Correção 2026-07-10 (pedido do usuário: "as menções trazidas na
// integração são apenas amostras... reach/engajamento/influência do autor
// precisam ser buscados diferentemente"): reach_estimate/engagement_score
// por Narrativa deixam de ser soma local sobre `mentions` (amostrada em
// Queries de alto volume) e passam a vir de `data/{aggregate}/categories/
// {grain}` — a dimensão `categories` (confirmada em
// chart-dimensions-and-aggregates) devolve o breakdown de TODAS as
// Categories numa única chamada, mesmo mecanismo não-amostrado que já
// alimenta `bw_query_metrics_daily.total_mentions`/sentimento. ⚠️ Não
// confirmado um payload de exemplo específico com aggregate=reachEstimate/
// engagementScore + dimension=categories (só a validade genérica da
// combinação aggregate×dimension) — mesmo tratamento de risco já dado a
// `syncPlatformMetrics` acima. Roda toda invocação (mesmo throttle
// "diário sempre"), 1 chamada por aggregate — 2 chamadas totais cobrindo
// todas as Narrativas, não 1 por Narrativa.
// =========================================================================

async function syncCategoryDailyAggregate(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  aggregate: "reachEstimate" | "engagementScore" | "authors" | "impressions" | "netSentiment",
  column: "reach_estimate" | "engagement_score" | "unique_authors" | "impressions" | "net_sentiment",
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/${aggregate}/categories/days?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string | number; values?: { id: string; value: number }[] }[];

  // A dimensão `categories` pode incluir IDs fora do universo já cacheado
  // em bw_categories (ex: Categories fora do escopo de `rulecategories`,
  // ou dessincronizadas desde o último refresh de metadata) — sem esse
  // filtro, o upsert quebra com violação de FK
  // (bw_query_metrics_daily.category_id → bw_categories.id). Buscar os IDs
  // conhecidos e descartar (com log) qualquer categoria fora desse
  // conjunto, em vez de derrubar a invocação inteira.
  const { data: knownCategories, error: knownCategoriesError } = await supabase
    .from("bw_categories")
    .select("id")
    .eq("project_id", projectId);
  if (knownCategoriesError) {
    throw new Error(`Erro lendo bw_categories para validação de FK: ${knownCategoriesError.message}`);
  }
  const knownCategoryIds = new Set((knownCategories ?? []).map((c: any) => c.id as number));

  const rows: Record<string, unknown>[] = [];
  const skippedCategoryIds = new Set<number>();
  for (const series of results) {
    const categoryId = Number(series.id);
    if (!Number.isFinite(categoryId)) {
      // Pode incluir um item pra mentions sem nenhuma Category — não temos
      // onde guardar isso em bw_query_metrics_daily (category_id sempre se
      // refere a uma Category real), então pula em vez de quebrar.
      continue;
    }
    if (!knownCategoryIds.has(categoryId)) {
      skippedCategoryIds.add(categoryId);
      continue;
    }
    for (const point of series.values ?? []) {
      rows.push({
        project_id: projectId,
        query_id: queryId,
        category_id: categoryId,
        metric_date: toDateOnly(point.id),
        [column]: point.value,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (skippedCategoryIds.size > 0) {
    log("syncCategoryDailyAggregate:unknown_categories_skipped", {
      projectId, queryId, aggregate, categoryIds: Array.from(skippedCategoryIds),
    });
  }

  if (rows.length === 0) {
    log("syncCategoryDailyAggregate:empty", { projectId, queryId, aggregate });
    return;
  }

  // Upsert parcial — só as colunas presentes no payload são atualizadas em
  // caso de conflito (PostgREST gera "on conflict ... do update set" só
  // pras colunas enviadas), então isso nunca zera total_mentions/sentiment
  // já sincronizados por syncSentimentMetrics pro mesmo
  // (project_id, query_id, category_id, metric_date).
  //
  // Corrigido 2026-07-11 (parte da correção de "CPU Time exceeded" em
  // produção): a dimensão `categories` cobre todas as Categories × todo o
  // histórico numa resposta só (~4825 linhas observadas em produção) — um
  // único `.upsert()` com todas as linhas de uma vez serializa um corpo de
  // requisição gigante numa só passada síncrona. Chunka em lotes de 1000
  // (mesmo tamanho de página já usado pra mentions) — mesmo total de
  // trabalho, mas espalhado em várias chamadas menores em vez de um pico
  // só de CPU.
  for (const chunk of chunkArray(rows, 1000)) {
    const { error } = await supabase
      .from("bw_query_metrics_daily")
      .upsert(chunk, { onConflict: "project_id,query_id,category_id_key,metric_date" });
    if (error) throw new Error(`Erro upsertando bw_query_metrics_daily (${column}): ${error.message}`);
  }

  log("syncCategoryDailyAggregate:done", { projectId, queryId, aggregate, rows: rows.length });
}

// =========================================================================
// Corrige bug encontrado 2026-07-12 (revisão de spec, ao adicionar
// unique_authors): syncCategoryDailyAggregate() acima só cobre a dimensão
// `categories`, que por natureza nunca inclui uma linha "Query inteira" —
// ou seja, bw_query_metrics_daily.reach_estimate/engagement_score nunca
// foram populados para category_id is null desde que essas colunas
// existem (20260710040000). total_mentions/sentimento não sofrem disso
// porque syncSentimentMetrics() já trata category=null omitindo o filtro
// `category` da chamada. Usa a dimensão `queries` (mesmo padrão já
// confirmado em syncQueryGroupSov(), data/volume/queries/weeks?
// queryGroupId=X) em vez de um chart de 1 dimensão só
// (data/{aggregate}/days), cujo formato de resposta não está documentado/
// confirmado neste projeto — com um único queryId, `results` tem no
// máximo 1 série, mas soma por segurança caso a Brandwatch devolva mais de
// uma. Mesma função cobre reachEstimate/engagementScore (correção do gap)
// e authors (unique_authors, captura nova).
// =========================================================================

async function syncQueryDailyAggregate(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  aggregate: "reachEstimate" | "engagementScore" | "authors" | "impressions" | "netSentiment",
  column: "reach_estimate" | "engagement_score" | "unique_authors" | "impressions" | "net_sentiment",
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/${aggregate}/queries/days?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string | number; values?: { id: string; value: number }[] }[];

  // netSentiment é um score já normalizado (-100..100), não uma contagem —
  // diferente de reach/engagement/authors/impressions, somar séries
  // duplicadas do mesmo dia distorceria o valor. Na prática há no máximo 1
  // série (um queryId só), mas usa média em vez de soma por segurança, sem
  // mudar o comportamento das demais métricas (que continuam somando).
  const isScoreAggregate = aggregate === "netSentiment";
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const series of results) {
    for (const point of series.values ?? []) {
      const date = toDateOnly(point.id);
      sums.set(date, (sums.get(date) ?? 0) + point.value);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
  }
  const byDate = new Map<string, number>();
  for (const [date, sum] of sums.entries()) {
    byDate.set(date, isScoreAggregate ? sum / (counts.get(date) ?? 1) : sum);
  }

  if (byDate.size === 0) {
    log("syncQueryDailyAggregate:empty", { projectId, queryId, aggregate });
    return;
  }

  const rows = Array.from(byDate.entries()).map(([metric_date, value]) => ({
    project_id: projectId,
    query_id: queryId,
    category_id: null,
    metric_date,
    [column]: value,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("bw_query_metrics_daily")
    .upsert(rows, { onConflict: "project_id,query_id,category_id_key,metric_date" });
  if (error) throw new Error(`Erro upsertando bw_query_metrics_daily (${column}, query inteira): ${error.message}`);

  log("syncQueryDailyAggregate:done", { projectId, queryId, aggregate, rows: rows.length });
}

// Corrige "ON CONFLICT DO UPDATE command cannot affect row a second time"
// (erro real de produção em syncTopAuthors — Brandwatch devolveu o mesmo
// autor mais de uma vez na mesma resposta de data/volume/topauthors/queries):
// um único INSERT ... ON CONFLICT não consegue aplicar DO UPDATE duas vezes
// na mesma linha dentro da mesma instrução, então qualquer duplicata na
// chave de conflito derruba o upsert inteiro. Deduplica antes do upsert,
// mantendo a primeira ocorrência — os endpoints de chart da Brandwatch
// devolvem `results`/`topics` ordenados por volume/relevância, então a
// primeira ocorrência é a mais significativa. Reusado também em
// syncTopicsData() abaixo, mesma classe de risco (label duplicado dentro do
// mesmo topic_type).
function dedupeByKey<T>(rows: T[], keyFn: (row: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

// Parte da correção de "CPU Time exceeded" (2026-07-11) — quebra upserts
// grandes (ex: reach/engagement via dimensão `categories`, ~4825 linhas
// observadas em produção numa resposta só) em lotes menores, em vez de
// serializar um corpo de requisição gigante numa única chamada síncrona.
function chunkArray<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
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

  const uniqueRows = dedupeByKey(rows, (r) => `${r.topic_type}::${r.label}`);
  if (uniqueRows.length !== rows.length) {
    log("syncTopicsData:duplicates_removed", {
      projectId,
      queryId,
      categoryId,
      removed: rows.length - uniqueRows.length,
    });
  }

  const { error } = await supabase
    .from("bw_query_topics")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,topic_type,label,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_topics: ${error.message}`);

  // Correção 2026-07-11 (pedido do usuário: "retire os cálculos locais
  // baseados em mentions... se não tem na Brandwatch, não faça cálculo
  // local... isso deve ser premissa"): engagement/reach por tópico
  // (adicionado em 20260710060000) estimava isso cruzando
  // `insights_hashtag` contra `mentions` — que é amostrada. Removido
  // (migration `20260711010000`); `data/topics` genuinamente não expõe
  // reach/engajamento como métrica, e a premissa agora é: se a Brandwatch
  // não tem, a gente não estima.

  log("syncTopicsData:done", { projectId, queryId, categoryId, rows: rows.length });
}

// =========================================================================
// "Topics" legado (2026-07-12, achado de auditoria pedida pelo usuário
// contra developers.brandwatch.com/docs/topics vs. /docs/data-topics):
// `data/volume/topics/queries` é um endpoint DIFERENTE do `data/topics`
// (extract=/metrics=) que syncTopicsData() acima já chama — uma revisão de
// spec anterior (2026-07-11) tinha planejado `daily_series`/
// `page_type_breakdown` como se viessem do mesmo payload do endpoint novo,
// mas esses campos (`days`/`pageType`) só existem na resposta do endpoint
// LEGADO. Corrigido: chamada própria, armazenada nas mesmas linhas de
// `bw_query_topics` com `topic_type = 'legacy_mixed'` (a Brandwatch não
// deixa escolher `extract` nesse endpoint — devolve uma mistura de tipos
// de tópico já rankeados por `burst`, daí não reusar os topic_type de
// `words`/`phrases`/etc.). `burst` é uma métrica de tendência própria
// desse endpoint, em escala diferente de `trending` (do endpoint novo) —
// nunca comparar os dois diretamente.
// =========================================================================

async function syncLegacyTopicsData(
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
    orderBy: "burst",
    limit: "50",
  });
  if (categoryId) params.set("category", String(categoryId));

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/topics/queries?${params.toString()}`, token);
  const topics = (json.topics ?? []) as any[];

  const metricWeek = toDateOnly(new Date().toISOString());
  const rows = topics
    .map((t) => {
      const sentiment = t.sentiment ?? {};
      return {
        project_id: projectId,
        query_id: queryId,
        category_id: categoryId,
        topic_type: "legacy_mixed",
        label: String(t.label ?? t.id ?? ""),
        volume: t.volume ?? 0,
        percentage_volume: null,
        sentiment_positive: sentiment.positive ?? 0,
        sentiment_neutral: sentiment.neutral ?? 0,
        sentiment_negative: sentiment.negative ?? 0,
        trending: null,
        daily_series: t.days ?? null,
        page_type_breakdown: t.pageType ?? null,
        burst: t.burst ?? null,
        metric_week: metricWeek,
        synced_at: new Date().toISOString(),
      };
    })
    .filter((r) => r.label.length > 0);

  if (rows.length === 0) {
    log("syncLegacyTopicsData:empty", { projectId, queryId, categoryId });
    return;
  }

  const uniqueRows = dedupeByKey(rows, (r) => `${r.topic_type}::${r.label}`);
  if (uniqueRows.length !== rows.length) {
    log("syncLegacyTopicsData:duplicates_removed", {
      projectId, queryId, categoryId, removed: rows.length - uniqueRows.length,
    });
  }

  const { error } = await supabase
    .from("bw_query_topics")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,topic_type,label,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_topics (legacy_mixed): ${error.message}`);

  log("syncLegacyTopicsData:done", { projectId, queryId, categoryId, rows: uniqueRows.length });
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
//
// Correção 2026-07-10 (pedido do usuário: "influência do autor" também
// precisa ser buscada por Narrativa, não amostrada): ganha `categoryId`
// opcional, passado como filtro `category=<id>` — mesma convenção usada em
// `data/volume/sentiment/days&category=<id>` (já comprovada em produção).
// ⚠️ Não confirmado um exemplo específico do filtro `category` combinado
// com este endpoint (`data/volume/topauthors/queries`), mas `filters.md`
// da skill descreve filtros como aplicáveis a "qualquer chamada de
// Mentions ou Data Retrieval (charts)" — mesma categoria de risco já
// assumida em `syncPlatformMetrics`/`syncCategoryDailyAggregate` acima.
//
// Correção 2026-07-10, mesmo dia (pedido do usuário: "capturar todos os
// top autores que tiverem mais de 100000 seguidores"): `limit` sobe de
// `100` pro máximo documentado (`1000`) — a Brandwatch ordena Top Authors
// por volume/relevância, não por seguidores, então aumentar o limite é o
// único jeito de melhorar a chance de cobrir autores de altíssimo alcance
// mas baixo volume na Query; não há garantia de cobertura de "todos" além
// do teto do endpoint. `followers` (de `twitterFollowers` — único campo de
// seguidores confirmado no envelope deste endpoint; Facebook/Reddit não
// têm campo de seguidores documentado aqui) e `is_influential`
// (`followers >= 100000`, coluna gerada) viram colunas de
// `bw_query_top_authors` (migration `20260710050000`).
// =========================================================================

async function syncTopAuthors(
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
    limit: "1000",
  });
  if (categoryId) params.set("category", String(categoryId));

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
        category_id: categoryId,
        author,
        volume: d.authorVolume ?? d.volume ?? 0,
        reach_estimate: d.reachEstimate ?? null,
        impact: d.impact ?? null,
        followers: d.twitterFollowers ?? null,
        // Validação 2026-07-11 contra export real de dashboard Brandwatch
        // ("Government Verification"/"Business Verification", "Estados"/
        // "Cidades" dos autores) — campos já presentes neste payload
        // (confirmado contra developers.brandwatch.com/docs/top-tweeters),
        // sem chamada nova. Nunca inclui `impressions` aqui — essa coluna é
        // exclusiva da fase `author_enrichment` (upsert parcial, ver
        // runAuthorEnrichmentStep()), incluí-la aqui zeraria o valor já
        // enriquecido a cada refresh semanal deste passo.
        tweets: d.twitterTweets ?? null,
        retweets: d.twitterRetweets ?? null,
        account_type: d.authorAccountType ?? null,
        country_code: d.countryCode ?? null,
        country_name: d.countryName ?? null,
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
    log("syncTopAuthors:empty", { projectId, queryId, categoryId });
    return;
  }

  // ⚠️ Corrigido 2026-07-11 (erro real de produção: "ON CONFLICT DO UPDATE
  // command cannot affect row a second time" — a Brandwatch devolveu o
  // mesmo autor mais de uma vez na mesma resposta de
  // data/volume/topauthors/queries). Ver dedupeByKey() acima.
  const uniqueRows = dedupeByKey(rows, (r) => r.author);
  if (uniqueRows.length !== rows.length) {
    log("syncTopAuthors:duplicates_removed", {
      projectId,
      queryId,
      categoryId,
      removed: rows.length - uniqueRows.length,
    });
  }

  const { error } = await supabase
    .from("bw_query_top_authors")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,author,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_top_authors: ${error.message}`);

  log("syncTopAuthors:done", { projectId, queryId, categoryId, rows: uniqueRows.length });
}

async function isTopAuthorsStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  maxAgeMs: number,
): Promise<boolean> {
  let query = supabase
    .from("bw_query_top_authors")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1);
  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_top_authors: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

// =========================================================================
// Passo 6.7 — Enriquecimento por autor: impressões e temas (2026-07-11,
// pedido do usuário: "impressões por autor e temas por autor. Incluir no
// MVP e garantir que temos informações suficientes"). Ver data-model.md
// §5 (bw_query_top_authors.impressions, bw_query_author_topics) e
// sync-brandwatch.md passo 6.7 pro racional completo — resumindo: `author`
// é um filtro documentado (available-filters.md) válido em chamadas de
// Data Retrieval, e `impressions` é um agregado de chart oficial
// confirmado (chart-dimensions-and-aggregates.md, mesma tabela que já
// confirmou reachEstimate/engagementScore) — combinar os dois dá dado
// oficial não amostrado filtrado por autor, sem violar a premissa de
// nunca agregar localmente sobre `mentions`.
// =========================================================================

async function syncAuthorImpressions(
  projectId: number,
  queryId: number,
  author: string,
  token: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    author,
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  // Mesmo padrão de dimensão `queries` já usado em syncQueryGroupSov()
  // (data/volume/queries/weeks?queryGroupId=X), só trocando o agregado
  // (impressions) e o filtro de escopo (author em vez de queryGroupId).
  // ⚠️ Não confirmado com um payload de exemplo específico combinando
  // impressions/queries/author — mesma categoria de risco já aceita pras
  // demais combinações de filtro análogas neste projeto.
  const json = await callBrandwatch(`/projects/${projectId}/data/impressions/queries/days?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string | number; values?: { id: string; value: number }[] }[];

  let total = 0;
  for (const series of results) {
    for (const point of series.values ?? []) {
      total += point.value ?? 0;
    }
  }
  log("syncAuthorImpressions:done", { projectId, queryId, author, total });
  return total;
}

async function syncAuthorTopics(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  author: string,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    author,
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    extract: "words,phrases,hashtags,entities,people,places,organisations",
    metrics: "volume,percentageVolume,sentiment,trending",
    limit: "50",
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/topics?${params.toString()}`, token);
  const topics = (json.topics ?? []) as any[];

  const metricWeek = toDateOnly(new Date().toISOString());
  const rows = topics
    .map((t) => {
      const sentiment = t.sentiment ?? {};
      return {
        project_id: projectId,
        query_id: queryId,
        author,
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
    log("syncAuthorTopics:empty", { projectId, queryId, author });
    return;
  }

  // Mesma correção de "ON CONFLICT DO UPDATE" já aplicada em
  // syncTopicsData()/syncTopAuthors() — a Brandwatch pode devolver o
  // mesmo tema mais de uma vez na mesma resposta.
  const uniqueRows = dedupeByKey(rows, (r) => `${r.topic_type}::${r.label}`);
  if (uniqueRows.length !== rows.length) {
    log("syncAuthorTopics:duplicates_removed", {
      projectId, queryId, author, removed: rows.length - uniqueRows.length,
    });
  }

  const { error } = await supabase
    .from("bw_query_author_topics")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,author,topic_type,label,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_author_topics: ${error.message}`);

  log("syncAuthorTopics:done", { projectId, queryId, author, rows: uniqueRows.length });
}

// =========================================================================
// Salvaguarda de orçamento compartilhada por x_insights/demographics —
// ambos são específicos de X em parte ou no todo, então checam se a Query
// tem presença relevante em X antes de gastar chamadas à toa. Reusa
// bw_query_metrics_daily_by_platform (passo 6.3, já sincronizado toda
// invocação) — sem chamada nova só pra essa checagem. Nível Query inteira
// (essa tabela não quebra por Category), não por categoryTarget.
// =========================================================================

async function queryHasTwitterVolume(supabase: SupabaseClient, projectId: number, queryId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("bw_query_metrics_daily_by_platform")
    .select("total_mentions")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .eq("page_type", "twitter")
    .gt("total_mentions", 0)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Erro checando volume de X em bw_query_metrics_daily_by_platform: ${error.message}`);
  return !!data;
}

// =========================================================================
// Passo 6.4b — X (Twitter) Insights (2026-07-11, priorizado depois de
// validar contra um export real de dashboard Brandwatch — "X Themes": Top
// Stories/Hashtags/Posters/Emojis). 4 endpoints confirmados em
// developers.brandwatch.com/docs/twitter-insights, agregados oficiais não
// amostrados específicos de X. Ver data-model.md §5/sync-brandwatch.md
// passo 6.4b pro racional completo.
// =========================================================================

const X_INSIGHT_ENDPOINTS: { type: "hashtag" | "emoticon" | "url" | "mentioned_author"; path: string }[] = [
  { type: "hashtag", path: "hashtags" },
  { type: "emoticon", path: "emoticons" },
  { type: "url", path: "urls" },
  { type: "mentioned_author", path: "mentionedauthors" },
];

async function syncXInsights(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const metricWeek = toDateOnly(new Date().toISOString());

  for (const { type, path } of X_INSIGHT_ENDPOINTS) {
    const params = new URLSearchParams({
      queryId: String(queryId),
      startDate: formatBrandwatchDate(startDate),
      endDate: formatBrandwatchDate(endDate),
    });
    if (categoryId) params.set("category", String(categoryId));

    const json = await callBrandwatch(`/projects/${projectId}/data/${path}?${params.toString()}`, token);
    const results = (json.results ?? []) as Record<string, any>[];

    const rows = results
      .map((r) => {
        const sentiment = r.sentiment ?? {};
        return {
          project_id: projectId,
          query_id: queryId,
          category_id: categoryId,
          insight_type: type,
          name: String(r.name ?? ""),
          label: r.label ?? null,
          volume: r.volume ?? 0,
          tweets: r.tweets ?? null,
          retweets: r.retweets ?? null,
          impressions: r.impressions ?? null,
          reach_estimate: r.reachEstimate ?? null,
          sentiment_positive: sentiment.positive ?? 0,
          sentiment_neutral: sentiment.neutral ?? 0,
          sentiment_negative: sentiment.negative ?? 0,
          metric_week: metricWeek,
          synced_at: new Date().toISOString(),
        };
      })
      .filter((r) => r.name.length > 0);

    if (rows.length === 0) {
      log("syncXInsights:empty", { projectId, queryId, categoryId, type });
      continue;
    }

    // Mesma correção de "ON CONFLICT DO UPDATE" já aplicada em
    // syncTopicsData()/syncTopAuthors()/syncAuthorTopics().
    const uniqueRows = dedupeByKey(rows, (r) => r.name);
    if (uniqueRows.length !== rows.length) {
      log("syncXInsights:duplicates_removed", {
        projectId, queryId, categoryId, type, removed: rows.length - uniqueRows.length,
      });
    }

    const { error } = await supabase
      .from("bw_query_x_insights")
      .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,insight_type,name,metric_week" });
    if (error) throw new Error(`Erro upsertando bw_query_x_insights (${type}): ${error.message}`);

    log("syncXInsights:done", { projectId, queryId, categoryId, type, rows: uniqueRows.length });
  }
}

async function isXInsightsStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  maxAgeMs: number,
): Promise<boolean> {
  let query = supabase
    .from("bw_query_x_insights")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1);
  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_x_insights: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

async function runXInsightsStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  if (!(await queryHasTwitterVolume(supabase, projectId, queryId))) {
    log("runXInsightsStep:no_twitter_volume", { projectId, queryId });
    return { didWork: false };
  }
  for (const categoryId of categoryTargets) {
    if (!hasBrandwatchCallBudget()) break;
    if (await isXInsightsStale(supabase, projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncXInsights(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      return { didWork: true };
    }
  }
  return { didWork: false };
}

// =========================================================================
// Passo 6.8 — Ranking de sites/domínios (2026-07-11, gap identificado
// validando o modelo de dados contra um export real de dashboard
// Brandwatch — "Top Site", distinto de "Top Authors": rankeia domínios,
// não contas de redes sociais). data/volume/topsites/queries (doc
// top-sites), mesmo padrão de syncTopAuthors().
// =========================================================================

async function syncTopSites(
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
    limit: "1000",
  });
  if (categoryId) params.set("category", String(categoryId));

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/topsites/queries?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string; name?: string; data?: Record<string, any> }[];

  const metricWeek = toDateOnly(new Date().toISOString());
  const rows = results
    .map((r) => {
      const d = r.data ?? {};
      const sentiment = d.sentiment ?? {};
      const domain = String(d.domain ?? r.name ?? r.id ?? "");
      return {
        project_id: projectId,
        query_id: queryId,
        category_id: categoryId,
        domain,
        volume: d.volume ?? 0,
        monthly_visitors: d.monthlyVisitors ?? null,
        reach_estimate: d.reachEstimate ?? null,
        impact: d.impact ?? null,
        author_name: d.authorName ?? null,
        account_type: d.authorAccountType ?? null,
        country_code: d.countryCode ?? null,
        country_name: d.countryName ?? null,
        sentiment_positive: sentiment.positive ?? 0,
        sentiment_neutral: sentiment.neutral ?? 0,
        sentiment_negative: sentiment.negative ?? 0,
        platform_stats: d,
        metric_week: metricWeek,
        synced_at: new Date().toISOString(),
      };
    })
    .filter((r) => r.domain.length > 0);

  if (rows.length === 0) {
    log("syncTopSites:empty", { projectId, queryId, categoryId });
    return;
  }

  const uniqueRows = dedupeByKey(rows, (r) => r.domain);
  if (uniqueRows.length !== rows.length) {
    log("syncTopSites:duplicates_removed", {
      projectId, queryId, categoryId, removed: rows.length - uniqueRows.length,
    });
  }

  const { error } = await supabase
    .from("bw_query_top_sites")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,domain,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_top_sites: ${error.message}`);

  log("syncTopSites:done", { projectId, queryId, categoryId, rows: uniqueRows.length });
}

async function isTopSitesStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  maxAgeMs: number,
): Promise<boolean> {
  let query = supabase
    .from("bw_query_top_sites")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1);
  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_top_sites: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

async function runTopSitesStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  for (const categoryId of categoryTargets) {
    if (!hasBrandwatchCallBudget()) break;
    if (await isTopSitesStale(supabase, projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncTopSites(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      return { didWork: true };
    }
  }
  return { didWork: false };
}

// =========================================================================
// Top Shared Sites (2026-07-12, achado de auditoria pedida pelo usuário
// contra developers.brandwatch.com/docs/top-shared-sites): `data/sharedsites`
// é distinto de `data/volume/topsites/queries` (Top Sites, acima) — mede
// domínios mais COMPARTILHADOS/linkados dentro do conteúdo das mentions
// ("breakdown of the top sites hosting the most link shares within your
// query topic"), não domínios de onde as mentions em si vêm. Payload
// simples (mesma família de bw_query_x_insights), sem envelope `data`/
// `values` como Top Sites/Top Authors/Top Tweeters.
// =========================================================================

async function syncTopSharedSites(
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
  });
  if (categoryId) params.set("category", String(categoryId));

  const json = await callBrandwatch(`/projects/${projectId}/data/sharedsites?${params.toString()}`, token);
  const results = (json.results ?? []) as Record<string, any>[];

  const metricWeek = toDateOnly(new Date().toISOString());
  const rows = results
    .map((r) => ({
      project_id: projectId,
      query_id: queryId,
      category_id: categoryId,
      domain: String(r.name ?? ""),
      label: r.label ?? null,
      volume: r.volume ?? 0,
      tweets: r.tweets ?? null,
      retweets: r.retweets ?? null,
      impressions: r.impressions ?? null,
      metric_week: metricWeek,
      synced_at: new Date().toISOString(),
    }))
    .filter((r) => r.domain.length > 0);

  if (rows.length === 0) {
    log("syncTopSharedSites:empty", { projectId, queryId, categoryId });
    return;
  }

  const uniqueRows = dedupeByKey(rows, (r) => r.domain);
  if (uniqueRows.length !== rows.length) {
    log("syncTopSharedSites:duplicates_removed", {
      projectId, queryId, categoryId, removed: rows.length - uniqueRows.length,
    });
  }

  const { error } = await supabase
    .from("bw_query_top_shared_sites")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,domain,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_top_shared_sites: ${error.message}`);

  log("syncTopSharedSites:done", { projectId, queryId, categoryId, rows: uniqueRows.length });
}

async function isTopSharedSitesStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  maxAgeMs: number,
): Promise<boolean> {
  let query = supabase
    .from("bw_query_top_shared_sites")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1);
  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_top_shared_sites: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

async function runTopSharedSitesStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  for (const categoryId of categoryTargets) {
    if (!hasBrandwatchCallBudget()) break;
    if (await isTopSharedSitesStale(supabase, projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncTopSharedSites(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      return { didWork: true };
    }
  }
  return { didWork: false };
}

// =========================================================================
// Passo 6.6 — Demografia (2026-07-11, priorizado depois de validar contra
// um export real de dashboard Brandwatch — "X Demographics": gender split
// + trend diário, top interests, top professions, top countries). 8
// dimensões confirmadas em chart-dimensions-and-aggregates — 4 restritas a
// X/Twitter, 4 de localização sem restrição de plataforma documentada.
// Escopo inicial: só nível de Query inteira, sem quebra por Narrativa.
// =========================================================================

// `sentiment` (2026-07-12): só os 4 dimension_type de localização ganham
// net_sentiment (pedido do usuário — "Sentimento por localização" da spec
// intelligence-center/sentiment-analysis.md) — os 4 específicos de X não
// foram pedidos pra sentimento, sem custo de chamada extra pra eles.
const DEMOGRAPHIC_DIMENSIONS: { type: string; path: string; xOnly: boolean; sentiment: boolean }[] = [
  { type: "gender", path: "gender", xOnly: true, sentiment: false },
  { type: "account_type", path: "accountTypes", xOnly: true, sentiment: false },
  { type: "interest", path: "interest", xOnly: true, sentiment: false },
  { type: "profession", path: "profession", xOnly: true, sentiment: false },
  { type: "country", path: "countries", xOnly: false, sentiment: true },
  { type: "continent", path: "continents", xOnly: false, sentiment: true },
  { type: "city", path: "cities", xOnly: false, sentiment: true },
  { type: "region", path: "regions", xOnly: false, sentiment: true },
];

async function syncDemographicDimension(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  dimensionType: string,
  dimensionPath: string,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/${dimensionPath}/days?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string; values?: { id: string; value: number }[] }[];

  const rows: Record<string, unknown>[] = [];
  for (const bucket of results) {
    const value = String(bucket.id ?? "");
    if (!value) continue;
    for (const point of bucket.values ?? []) {
      rows.push({
        project_id: projectId,
        query_id: queryId,
        dimension_type: dimensionType,
        value,
        metric_date: toDateOnly(point.id),
        total_mentions: point.value ?? 0,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length === 0) {
    log("syncDemographicDimension:empty", { projectId, queryId, dimensionType });
    return;
  }

  // Mesma correção de chunking já aplicada em syncCategoryDailyAggregate()
  // — dimensões com muitos buckets (ex: cities) × todo o histórico podem
  // gerar bastante linhas numa resposta só.
  for (const chunk of chunkArray(rows, 1000)) {
    const { error } = await supabase
      .from("bw_query_demographics_daily")
      .upsert(chunk, { onConflict: "project_id,query_id,dimension_type,value,metric_date" });
    if (error) throw new Error(`Erro upsertando bw_query_demographics_daily (${dimensionType}): ${error.message}`);
  }

  log("syncDemographicDimension:done", { projectId, queryId, dimensionType, rows: rows.length });
}

// Sentimento líquido por localização (2026-07-12) — mesma limitação de
// score único (não split positivo/neutro/negativo) já registrada pra
// bw_query_metrics_daily_by_platform.net_sentiment, mesmo motivo (sem
// combinação de 3 dimensões sentiment+{dimensão}+days documentada). Upsert
// parcial (só net_sentiment), nunca zera total_mentions já sincronizado
// por syncDemographicDimension() pra mesma linha.
async function syncDemographicNetSentiment(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  dimensionType: string,
  dimensionPath: string,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/netSentiment/${dimensionPath}/days?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string; values?: { id: string; value: number }[] }[];

  const rows: Record<string, unknown>[] = [];
  for (const bucket of results) {
    const value = String(bucket.id ?? "");
    if (!value) continue;
    for (const point of bucket.values ?? []) {
      rows.push({
        project_id: projectId,
        query_id: queryId,
        dimension_type: dimensionType,
        value,
        metric_date: toDateOnly(point.id),
        net_sentiment: point.value,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length === 0) {
    log("syncDemographicNetSentiment:empty", { projectId, queryId, dimensionType });
    return;
  }

  for (const chunk of chunkArray(rows, 1000)) {
    const { error } = await supabase
      .from("bw_query_demographics_daily")
      .upsert(chunk, { onConflict: "project_id,query_id,dimension_type,value,metric_date" });
    if (error) throw new Error(`Erro upsertando bw_query_demographics_daily (net_sentiment, ${dimensionType}): ${error.message}`);
  }

  log("syncDemographicNetSentiment:done", { projectId, queryId, dimensionType, rows: rows.length });
}

async function isDemographicDimensionStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  dimensionType: string,
  maxAgeMs: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("bw_query_demographics_daily")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .eq("dimension_type", dimensionType)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_demographics_daily: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

async function runDemographicsStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  const hasTwitter = await queryHasTwitterVolume(supabase, projectId, queryId);
  for (const { type, path, xOnly, sentiment } of DEMOGRAPHIC_DIMENSIONS) {
    if (xOnly && !hasTwitter) continue;
    if (!hasBrandwatchCallBudget()) break;
    if (await isDemographicDimensionStale(supabase, projectId, queryId, type, 7 * 24 * 60 * 60 * 1000)) {
      await syncDemographicDimension(supabase, token, projectId, queryId, type, path, metricsStartDate, now);
      if (sentiment && hasBrandwatchCallBudget()) {
        await syncDemographicNetSentiment(supabase, token, projectId, queryId, type, path, metricsStartDate, now);
      }
      return { didWork: true };
    }
  }
  return { didWork: false };
}

// =========================================================================
// Handler principal
// =========================================================================

Deno.serve(async (_req: Request) => {
  const invocationStartedAt = Date.now();
  // Nunca reaproveitado entre invocações — mesmo se o isolate Deno for
  // reciclado (warm start), o contador precisa começar do zero a cada
  // request, senão o orçamento pareceria esgotado pra sempre depois da
  // primeira invocação.
  brandwatchCallCount = 0;
  log("invocation:start");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Passo 0: semeadura (idempotente — upserts `on conflict do nothing`, sem
  // chamada à Brandwatch). Roda antes do gate de intervalo abaixo, sem lock,
  // porque decide se há par pendente pra sequer avaliar: sem isto, a
  // primeira invocação (sync_cursors ainda vazia) nunca teria par nenhum pra
  // considerar "devido".
  try {
    await ensureBootstrapSeed(supabase);
  } catch (err) {
    logError("invocation:bootstrap_seed_failed", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Passo 0.5b: gate de intervalo (pedido do usuário 2026-07-11 — ver
  // getSyncIntervalHours() acima). pg_cron dispara este handler a cada
  // 15min (heartbeat fixo, migration `20260711020000`), mas só vale a pena
  // mintar token/chamar a Brandwatch se algum par estiver "devido" — sem
  // isto, cada heartbeat de 15min mintaria um token à toa mesmo sem nada
  // pra sincronizar. Checagem barata (1 SELECT), sem lock, antes de
  // qualquer chamada à Brandwatch.
  const intervalHours = getSyncIntervalHours();
  const dueCutoffIso = new Date(Date.now() - intervalHours * 3_600_000).toISOString();
  const { count: duePairsCount, error: dueCheckError } = await supabase
    .from("sync_cursors")
    .select("id", { count: "exact", head: true })
    .or(`last_synced_at.is.null,last_synced_at.lt.${dueCutoffIso}`);
  if (dueCheckError) {
    logError("invocation:due_check_failed", dueCheckError.message);
    return new Response(JSON.stringify({ ok: false, error: dueCheckError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!duePairsCount) {
    log("invocation:no_pair_due", { intervalHours, dueCutoffIso });
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_pair_due" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Passo 0.5c: gate de rate limit (correção 2026-07-16 — ver migration
  // `20260716020000` e CLAUDE.md "bw-sync rate limit cross-invocation
  // backoff"). Checagem barata (1 SELECT), antes de mintar token ou
  // reivindicar o lock — se uma invocação recente já esgotou retry num 429,
  // não vale a pena nem tentar: o teto de 30 chamadas/10min é por Client,
  // não por par, então qualquer chamada nova provavelmente toma 429 de novo
  // até a janela real liberar.
  const { data: lockRow, error: lockRowError } = await supabase
    .from("bw_sync_lock")
    .select("rate_limited_until")
    .eq("id", true)
    .maybeSingle();
  if (lockRowError) {
    logError("invocation:rate_limit_check_failed", lockRowError.message);
    // Não bloqueia a invocação por uma falha nesta leitura de otimização —
    // só significa que o gate abaixo não vai pegar um backoff ativo desta
    // vez; o pior caso é repetir o 429 e regravar o mesmo backoff.
  } else if (lockRow?.rate_limited_until && new Date(lockRow.rate_limited_until as string) > new Date()) {
    log("invocation:rate_limited_skip", { rateLimitedUntil: lockRow.rate_limited_until });
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "brandwatch_rate_limited", rateLimitedUntil: lockRow.rate_limited_until }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Correção 2026-07-10/11 (relatado pelo usuário: HTTP 429 em cascata —
  // logs mostraram duas chamadas diferentes, para endpoints diferentes,
  // levando 429 de forma intercalada, sinal de duas invocações rodando ao
  // mesmo tempo e disputando o mesmo orçamento de 30 chamadas/10min do
  // Client). Reivindica um lock (migration `20260711000000`) antes de
  // qualquer chamada à Brandwatch — se outra invocação já estiver ativa,
  // esta encerra imediatamente sem tentar nada, em vez de competir pelo
  // mesmo orçamento. Lock expira sozinho em 5min mesmo sem release
  // explícito (auto-cura se uma invocação morrer no meio do caminho).
  const { data: lockAcquired, error: lockError } = await supabase.rpc("try_acquire_bw_sync_lock", {
    p_duration_seconds: 300,
  });
  if (lockError) {
    logError("invocation:lock_check_failed", lockError.message);
    return new Response(JSON.stringify({ ok: false, error: lockError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!lockAcquired) {
    log("invocation:lock_busy", { hint: "outra invocação de bw-sync já está em andamento — encerrando sem chamar a Brandwatch" });
    return new Response(JSON.stringify({ ok: true, message: "outra invocação já está em andamento" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    return await runSyncInvocation(supabase, invocationStartedAt);
  } finally {
    const { error: releaseError } = await supabase.rpc("release_bw_sync_lock");
    if (releaseError) logError("invocation:lock_release_failed", releaseError.message);
  }
});

// =========================================================================
// Execução em fases — corrige "CPU Time exceeded" em produção (2026-07-11):
// uma única invocação encadeava mentions + sentimento diário + reach/
// engagement (uma resposta com 4825 linhas) + plataforma + semanal/mensal +
// temas + top authors (até 1000 linhas × categoryTarget) + SOV, processando
// dezenas de milhares de objetos JSON sincronamente. Cada invocação agora
// executa só UMA fase de `SYNC_STEPS` para o par escolhido, e avança
// `sync_cursors.next_step` pra próxima — o heartbeat de 15min empurra o
// ciclo adiante ao longo de várias invocações. Como o estado vive inteiro
// no Postgres (nunca em memória do isolate), uma invocação manual (clique
// no Dashboard, usado bastante em teste) se comporta exatamente como um
// tick do heartbeat: lê `next_step`, roda essa fase, grava o próximo passo.
// O ciclo só fecha (rearma o gate de BW_SYNC_INTERVAL_HOURS via
// `last_synced_at`) quando a última fase (`sov`) termina.
// =========================================================================

const SYNC_STEPS = [
  "metadata",
  "mentions",
  "daily_metrics",
  "hourly_metrics",
  "weekly_monthly",
  "topics",
  "platform_by_narrative",
  "x_insights",
  "top_authors",
  "top_tweeters",
  "author_enrichment",
  "top_sites",
  "top_shared_sites",
  "demographics",
  "full_text_enrichment",
  "sov",
] as const;
type SyncStep = typeof SYNC_STEPS[number];

function nextSyncStep(step: SyncStep): { next: SyncStep; cycleComplete: boolean } {
  const idx = SYNC_STEPS.indexOf(step);
  const isLast = idx === SYNC_STEPS.length - 1;
  return { next: SYNC_STEPS[isLast ? 0 : idx + 1], cycleComplete: isLast };
}

interface StepResult {
  // true = esta fase fez trabalho real (chamou a Brandwatch) — é o ponto
  // onde a invocação para, pra limitar o CPU gasto por invocação. false =
  // não havia nada "stale" pra fazer nesta fase — barato, a invocação
  // continua direto pra próxima fase (não é isso que causa o estouro de
  // CPU, só checagens de frescor no Postgres).
  didWork: boolean;
  mentionsCount?: number;
  lastAddedCursor?: string | null;
  backfillCompletedAt?: string | null;
}

async function runMetadataStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  organizationId: string,
): Promise<StepResult> {
  if (await needsMetadataRefresh(supabase, projectId)) {
    await refreshMetadata(supabase, token, projectId, organizationId);
    return { didWork: true };
  }
  log("invocation:metadata_fresh", { projectId });
  return { didWork: false };
}

async function runMentionsStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  organizationId: string,
  cursor: { last_added_cursor: string | null; backfill_completed_at: string | null },
  invocationStartedAt: number,
): Promise<StepResult> {
  // Pagina dentro da mesma invocação até alcançar o presente ou esgotar o
  // orçamento de páginas/tempo — mesmo padrão já existente, só extraído
  // pra fase própria. `sourceType=new` só entra quando o walk já alcançou
  // o presente pelo menos uma vez antes (ver resolveMentionsSinceAdded).
  const { sinceAdded: initialSinceAdded, useSourceTypeNew } = await resolveMentionsSinceAdded(supabase, queryId, cursor);
  let sinceAdded = initialSinceAdded;

  let mentionsCount = 0;
  let maxAdded: string | null = null;
  let pagesFetched = 0;
  let reachedNow = false;
  let stoppedByTimeBudget = false;
  while (pagesFetched < MAX_MENTIONS_PAGES_PER_INVOCATION) {
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
    if (!hasBrandwatchCallBudget()) {
      log("invocation:mentions_stopped_by_call_budget", { projectId, queryId, brandwatchCallCount });
      break;
    }
    const page = await fetchMentions(projectId, queryId, token, sinceAdded, useSourceTypeNew);
    const upserted = await upsertMentions(supabase, organizationId, projectId, queryId, page);
    mentionsCount += upserted.count;
    pagesFetched++;
    if (upserted.maxAdded) {
      maxAdded = upserted.maxAdded;
      sinceAdded = new Date(upserted.maxAdded);
    }
    log("invocation:mentions_page", { projectId, queryId, page: pagesFetched, count: upserted.count });
    if (page.length < MENTIONS_PAGE_SIZE) {
      reachedNow = true;
      break; // alcançou o presente
    }
  }
  log("invocation:mentions_synced", {
    projectId,
    queryId,
    mentionsCount,
    pagesFetched,
    reachedNow,
    stoppedByTimeBudget,
  });

  return {
    didWork: true,
    mentionsCount,
    lastAddedCursor: maxAdded ?? cursor.last_added_cursor,
    // backfill_completed_at só é setado na primeira vez que o walk alcança
    // o presente, e nunca mais é limpo depois disso (mesmo padrão de "flag
    // que só liga uma vez").
    backfillCompletedAt: reachedNow && !cursor.backfill_completed_at
      ? new Date().toISOString()
      : cursor.backfill_completed_at,
  };
}

async function runDailyMetricsStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  // ⚠️ Correção 2026-07-13 (bug de produção real: "callBrandwatch:429" em
  // netSentiment/queries/days, 3 tentativas esgotadas, invocação inteira
  // falhando) — esta fase nunca teve nenhum `hasBrandwatchCallBudget()`,
  // diferente de toda outra fase (weekly_monthly/topics/top_authors/etc.).
  // Ela sempre fez 1 chamada de sentimento POR categoryTarget (query
  // inteira + cada Narrativa) mais 10 chamadas fixas de agregado
  // (reachEstimate/engagementScore/authors/impressions/netSentiment ×
  // categories+queries) mais 4 de plataforma — com Narrativas suficientes
  // (ou mesmo sem nenhuma, já são 14 chamadas fixas em toda invocação),
  // essa soma sozinha pode ultrapassar o teto real da Brandwatch (30
  // chamadas/10min), quanto mais somada a outras invocações recentes na
  // mesma janela. Cada chamada agora é guardada por
  // `hasBrandwatchCallBudget()`, interrompendo a fase assim que o
  // orçamento acaba — o que ficar sem fazer aqui é retomado no próximo
  // ciclo completo desta mesma fase (idempotente, sem perda de dado, só
  // atraso).
  //
  // Sempre roda (não é throttled) — query inteira (category=null) + cada
  // Category vinculada a alguma Narrativa deste projeto.
  for (const categoryId of categoryTargets) {
    if (!hasBrandwatchCallBudget()) return { didWork: true };
    await syncSentimentMetrics(supabase, token, "days", projectId, queryId, categoryId, metricsStartDate, now);
  }
  // ✅ Reordenado 2026-07-20 (pedido do usuário: "revise se os valores de
  // sentimento por narrativa estão corretos, no Frontend está tudo
  // neutro"). Achado: net_sentiment por Narrativa (dimensão `categories`)
  // e por Query inteira (dimensão `queries`) eram as ÚLTIMAS das 10
  // chamadas fixas de agregado desta fase (depois de reachEstimate/
  // engagementScore/authors/impressions × categories+queries) — em
  // qualquer invocação com Narrativas suficientes pro budget de 25 chamadas
  // se esgotar antes de chegar nelas (loop de sentimento acima já consome 1
  // chamada por categoryTarget), `narrative_metrics.net_sentiment` nunca
  // sincronizava pra essas Narrativas, e `public.narratives_overview.
  // sentiment_bucket` caía pro fallback local (ver migration
  // 20260720000000) com muito mais frequência do que deveria — sintoma
  // batendo com o relatado ("está tudo neutro"). As duas chamadas de
  // netSentiment agora rodam logo após o loop de sentimento, antes de
  // qualquer outro agregado (reach/engajamento/autores/impressões), pra
  // sobreviver ao corte de orçamento com prioridade sobre métricas menos
  // centrais a este indicador.
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncCategoryDailyAggregate(
    supabase, token, projectId, queryId, "netSentiment", "net_sentiment", metricsStartDate, now,
  );
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncQueryDailyAggregate(
    supabase, token, projectId, queryId, "netSentiment", "net_sentiment", metricsStartDate, now,
  );
  // Reach/engajamento/autores únicos por Narrativa não amostrados: 3
  // chamadas cobrindo TODAS as Categories de uma vez (dimensão
  // `categories`) — é aqui que a resposta de ~4825 linhas observada no
  // crash de produção é processada; isolar esta fase das demais é o que
  // reduz o pico de CPU por invocação.
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncCategoryDailyAggregate(
    supabase, token, projectId, queryId, "reachEstimate", "reach_estimate", metricsStartDate, now,
  );
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncCategoryDailyAggregate(
    supabase, token, projectId, queryId, "engagementScore", "engagement_score", metricsStartDate, now,
  );
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncCategoryDailyAggregate(
    supabase, token, projectId, queryId, "authors", "unique_authors", metricsStartDate, now,
  );
  // Auditoria 2026-07-12 (pedido do usuário: conferir todo aggregate de
  // chart-dimensions-and-aggregates contra o que já é capturado):
  // `impressions` já era buscado por autor (author_enrichment,
  // syncAuthorImpressions) e por mention individual (X), mas nunca no
  // nível de Narrativa/Query inteira — mesmo agregado, mesma dimensão
  // `categories` já usada por reach/engagement/authors acima.
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncCategoryDailyAggregate(
    supabase, token, projectId, queryId, "impressions", "impressions", metricsStartDate, now,
  );
  // Corrige gap 2026-07-12: reach_estimate/engagement_score nunca tinham
  // sido populados para category_id is null (dimensão `categories` nunca
  // inclui a Query inteira) — mesma correção cobre a captura nova de
  // unique_authors/impressions pra essa mesma linha.
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncQueryDailyAggregate(
    supabase, token, projectId, queryId, "reachEstimate", "reach_estimate", metricsStartDate, now,
  );
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncQueryDailyAggregate(
    supabase, token, projectId, queryId, "engagementScore", "engagement_score", metricsStartDate, now,
  );
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncQueryDailyAggregate(
    supabase, token, projectId, queryId, "authors", "unique_authors", metricsStartDate, now,
  );
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncQueryDailyAggregate(
    supabase, token, projectId, queryId, "impressions", "impressions", metricsStartDate, now,
  );
  // Breakdown de plataforma — sempre roda, query inteira (sem quebra por
  // Narrativa).
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncPlatformMetrics(supabase, token, projectId, queryId, null, metricsStartDate, now);
  // Autores únicos/engajamento/sentimento líquido por plataforma (query
  // inteira) — ver nota em syncPlatformAggregate() acima.
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncPlatformAggregate(
    supabase, token, projectId, queryId, "authors", "unique_authors", metricsStartDate, now,
  );
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncPlatformAggregate(
    supabase, token, projectId, queryId, "engagementScore", "engagement_score", metricsStartDate, now,
  );
  if (!hasBrandwatchCallBudget()) return { didWork: true };
  await syncPlatformAggregate(
    supabase, token, projectId, queryId, "netSentiment", "net_sentiment", metricsStartDate, now,
  );
  return { didWork: true };
}

// =========================================================================
// Passo 6.3e — grão horário (event-radar / Velocidade), especificado
// 2026-07-13 (.dev/specs/_pending.md, gap técnico #2 de foundation).
// Restrito a uma janela móvel de 30 dias (não histórico/BI como
// bw_query_metrics_daily — ver prune_bw_query_metrics_hourly(), migration
// `20260713040000`) e roda em TODA invocação (sem throttle de frescor — o
// valor de existir é estar sempre atualizado). Orçamento: 3 chamadas fixas
// (não escala com o número de categoryTargets): volume/sentiment da Query
// inteira + netSentiment via dimensão `categories` (todas as Narrativas
// numa chamada só, mesmo padrão de syncCategoryDailyAggregate) +
// netSentiment da Query inteira.
// =========================================================================

const HOURLY_METRICS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function toHourTimestamp(isoString: string): string {
  const d = new Date(isoString);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

interface HourlySentimentPoint {
  hour: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
}

function pivotHourlySentimentChart(
  json: { results?: { id: string; values?: { id: string; value: number }[] }[] },
): HourlySentimentPoint[] {
  const byHour = new Map<string, HourlySentimentPoint>();
  for (const bucket of json.results ?? []) {
    for (const point of bucket.values ?? []) {
      const hourKey = toHourTimestamp(point.id);
      const entry = byHour.get(hourKey) ?? { hour: hourKey, total: 0, positive: 0, neutral: 0, negative: 0 };
      if (bucket.id === "positive") entry.positive = point.value;
      else if (bucket.id === "negative") entry.negative = point.value;
      else if (bucket.id === "neutral") entry.neutral = point.value;
      entry.total = entry.positive + entry.neutral + entry.negative;
      byHour.set(hourKey, entry);
    }
  }
  return Array.from(byHour.values());
}

async function syncHourlySentimentMetrics(
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

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/sentiment/hours?${params.toString()}`, token);
  const points = pivotHourlySentimentChart(json);

  if (points.length === 0) {
    log("syncHourlySentimentMetrics:empty", { projectId, queryId });
    return;
  }

  const rows = points.map((p) => ({
    project_id: projectId,
    query_id: queryId,
    category_id: null,
    metric_hour: p.hour,
    total_mentions: p.total,
    sentiment_positive: p.positive,
    sentiment_neutral: p.neutral,
    sentiment_negative: p.negative,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("bw_query_metrics_hourly")
    .upsert(rows, { onConflict: "project_id,query_id,category_id_key,metric_hour" });
  if (error) throw new Error(`Erro upsertando bw_query_metrics_hourly: ${error.message}`);
  log("syncHourlySentimentMetrics:done", { projectId, queryId, rows: rows.length });
}

// Mesma validação de FK contra bw_categories já usada em
// syncCategoryDailyAggregate() — a dimensão `categories` pode devolver IDs
// fora do universo cacheado.
async function syncHourlyNetSentiment(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  dimension: "categories" | "queries",
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    startDate: formatBrandwatchDate(startDate),
    endDate: formatBrandwatchDate(endDate),
    timezone: TIMEZONE,
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/netSentiment/${dimension}/hours?${params.toString()}`, token);
  const results = (json.results ?? []) as { id: string | number; values?: { id: string; value: number }[] }[];

  let knownCategoryIds: Set<number> | null = null;
  if (dimension === "categories") {
    const { data: knownCategories, error: knownCategoriesError } = await supabase
      .from("bw_categories")
      .select("id")
      .eq("project_id", projectId);
    if (knownCategoriesError) throw new Error(`Erro lendo bw_categories para validação de FK: ${knownCategoriesError.message}`);
    knownCategoryIds = new Set((knownCategories ?? []).map((c: any) => c.id as number));
  }

  const rows: Record<string, unknown>[] = [];
  const skippedCategoryIds = new Set<number>();
  for (const series of results) {
    let categoryId: number | null = null;
    if (dimension === "categories") {
      categoryId = Number(series.id);
      if (!Number.isFinite(categoryId)) continue;
      if (!knownCategoryIds!.has(categoryId)) {
        skippedCategoryIds.add(categoryId);
        continue;
      }
    }
    for (const point of series.values ?? []) {
      rows.push({
        project_id: projectId,
        query_id: queryId,
        category_id: categoryId,
        metric_hour: toHourTimestamp(point.id),
        net_sentiment: point.value,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (skippedCategoryIds.size > 0) {
    log("syncHourlyNetSentiment:unknown_categories_skipped", {
      projectId, queryId, dimension, categoryIds: Array.from(skippedCategoryIds),
    });
  }

  if (rows.length === 0) {
    log("syncHourlyNetSentiment:empty", { projectId, queryId, dimension });
    return;
  }

  for (const chunk of chunkArray(rows, 1000)) {
    const { error } = await supabase
      .from("bw_query_metrics_hourly")
      .upsert(chunk, { onConflict: "project_id,query_id,category_id_key,metric_hour" });
    if (error) throw new Error(`Erro upsertando bw_query_metrics_hourly (net_sentiment, ${dimension}): ${error.message}`);
  }

  log("syncHourlyNetSentiment:done", { projectId, queryId, dimension, rows: rows.length });
}

async function runHourlyMetricsStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  now: Date,
): Promise<StepResult> {
  const windowStart = new Date(now.getTime() - HOURLY_METRICS_WINDOW_MS);
  await syncHourlySentimentMetrics(supabase, token, projectId, queryId, windowStart, now);
  await syncHourlyNetSentiment(supabase, token, projectId, queryId, "categories", windowStart, now);
  await syncHourlyNetSentiment(supabase, token, projectId, queryId, "queries", windowStart, now);
  return { didWork: true };
}

// =========================================================================
// Busca seletiva de full_text (.dev/specs/_pending.md, gap técnico #3 de
// foundation; foundation/data-model.md §3, "full_text deixa de ser sempre
// null"). Não substitui a decisão original (full_text=null como default no
// polling de mentions, ver upsertMentions() — buscar pra toda mention
// dobraria as chamadas de todo poll); complementa com uma busca dirigida,
// só para mentions já sincronizadas localmente, já vinculadas a uma
// Narrativa (bw_category_id) e de fonte não redigida — top-N (por
// reach_estimate) por Narrativa/dia, bounded por Narrativa×dia (não por
// mention). Roda no máximo uma Narrativa/dia por invocação (mesmo padrão
// "para no primeiro que precisar de trabalho" de weekly_monthly/topics).
//
// ⚠️ Fontes excluídas (X/Reddit/LinkedIn/Online News — mesma lista de
// `data-restrictions-compliance.md`, texto ausente/truncado nessas 4) usam
// valores de `content_source` inferidos da mesma convenção já usada em
// `contentSource`/`pageType` (ex.: "twitter", "news") — "reddit"/"linkedin"
// especificamente não têm um payload real confirmando a string exata.
// Mentions com `content_source` ainda null (sincronizadas antes da
// migration `20260710010000`) são tratadas como elegíveis por padrão (não
// sabemos que são de fonte redigida, então não excluímos preventivamente).
// Revisar contra logs [bw-sync] reais após o deploy.
// =========================================================================

const FULL_TEXT_ENRICHMENT_TOP_N = 8;
const FULL_TEXT_RESTRICTED_SOURCES = ["twitter", "reddit", "linkedin", "news"];
const FULL_TEXT_SOURCE_FILTER = `content_source.is.null,content_source.not.in.(${FULL_TEXT_RESTRICTED_SOURCES.join(",")})`;

async function findPendingFullTextDay(
  supabase: SupabaseClient,
  queryId: number,
  categoryId: number,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("mentions")
    .select("mention_date")
    .eq("query_id", queryId)
    .contains("category_ids", [categoryId])
    .is("full_text", null)
    .or(FULL_TEXT_SOURCE_FILTER)
    .order("mention_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Erro checando full_text pendente: ${error.message}`);
  return (data?.mention_date as string | undefined) ?? null;
}

async function enrichFullTextForNarrativeDay(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryId: number,
  day: string,
): Promise<number> {
  const { data: candidates, error: candidatesError } = await supabase
    .from("mentions")
    .select("resource_id")
    .eq("query_id", queryId)
    .eq("mention_date", day)
    .contains("category_ids", [categoryId])
    .is("full_text", null)
    .or(FULL_TEXT_SOURCE_FILTER)
    .order("reach_estimate", { ascending: false, nullsFirst: false })
    .limit(FULL_TEXT_ENRICHMENT_TOP_N);

  if (candidatesError) throw new Error(`Erro lendo candidatos de full_text: ${candidatesError.message}`);
  const resourceIds = new Set((candidates ?? []).map((m: any) => String(m.resource_id)));
  if (resourceIds.size === 0) {
    log("enrichFullTextForNarrativeDay:no_candidates", { projectId, queryId, categoryId, day });
    return 0;
  }

  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    queryId: String(queryId),
    category: String(categoryId),
    startDate: formatBrandwatchDate(dayStart),
    endDate: formatBrandwatchDate(dayEnd),
    pageSize: "1000",
    orderBy: "date",
    orderDirection: "desc",
  });

  const json = await callBrandwatch(`/projects/${projectId}/data/mentions/fulltext?${params.toString()}`, token);
  const results = (json.results ?? []) as any[];

  let updated = 0;
  for (const m of results) {
    const resourceId = String(m.resourceId);
    if (!resourceIds.has(resourceId)) continue;
    const fullText = m.fullText ?? null;
    if (!fullText) continue;
    const { error: updateError } = await supabase
      .from("mentions")
      .update({ full_text: fullText })
      .eq("query_id", queryId)
      .eq("resource_id", resourceId)
      .eq("mention_date", day);
    if (updateError) throw new Error(`Erro atualizando full_text: ${updateError.message}`);
    updated++;
  }

  log("enrichFullTextForNarrativeDay:done", {
    projectId, queryId, categoryId, day, candidates: resourceIds.size, updated,
  });
  return updated;
}

async function runFullTextEnrichmentStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
): Promise<StepResult> {
  const narrativeCategoryIds = categoryTargets.filter((c): c is number => c !== null);
  for (const categoryId of narrativeCategoryIds) {
    if (!hasBrandwatchCallBudget()) break;
    const pendingDay = await findPendingFullTextDay(supabase, queryId, categoryId);
    if (!pendingDay) continue;
    await enrichFullTextForNarrativeDay(supabase, token, projectId, queryId, categoryId, pendingDay);
    return { didWork: true };
  }
  return { didWork: false };
}

async function runWeeklyMonthlyStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  // Throttle por frescor (7 dias/30 dias) — para no primeiro categoryTarget
  // que precisar de trabalho real, em vez de percorrer todos numa só
  // invocação (o que reintroduziria o mesmo estouro de CPU que esta fase
  // existe pra evitar). categoryTargets restantes continuam "stale" e são
  // retomados numa invocação futura desta mesma fase, sem lógica extra.
  for (const categoryId of categoryTargets) {
    if (!hasBrandwatchCallBudget()) break;
    let didWork = false;
    if (await isGrainStale(supabase, "weeks", projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncSentimentMetrics(supabase, token, "weeks", projectId, queryId, categoryId, metricsStartDate, now);
      didWork = true;
    }
    if (await isGrainStale(supabase, "months", projectId, queryId, categoryId, 30 * 24 * 60 * 60 * 1000)) {
      await syncSentimentMetrics(supabase, token, "months", projectId, queryId, categoryId, metricsStartDate, now);
      didWork = true;
    }
    if (didWork) return { didWork: true };
  }
  return { didWork: false };
}

async function runTopicsStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  for (const categoryId of categoryTargets) {
    if (!hasBrandwatchCallBudget()) break;
    if (await isTopicsStale(supabase, projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncTopicsData(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      // Mesmo categoryId, mesma janela de frescor de bw_query_topics —
      // captura complementar do endpoint legado (ver syncLegacyTopicsData()
      // acima), não uma fase própria.
      if (hasBrandwatchCallBudget()) {
        await syncLegacyTopicsData(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      }
      return { didWork: true };
    }
  }
  return { didWork: false };
}

// =========================================================================
// Passo 6.3c — Breakdown de plataforma por Narrativa (2026-07-11, pedido
// do usuário: "importante que tenhamos share of voice por plataforma...
// por narrativa"). Reusa syncPlatformMetrics() (mesmo endpoint do passo
// 6.3, `data/volume/pageTypes/days`, agora com `category=<id>`) — fase
// própria e throttled (não faz parte de daily_metrics, que roda toda
// invocação sem quebra por categoryTarget) pra não reintroduzir o risco de
// CPU corrigido na "Execução em fases": só o breakdown da Query inteira
// (category=null) roda toda invocação; o breakdown por Narrativa segue o
// mesmo padrão semanal de weekly_monthly/topics/top_authors.
// =========================================================================

async function isPlatformByNarrativeStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  maxAgeMs: number,
): Promise<boolean> {
  let query = supabase
    .from("bw_query_metrics_daily_by_platform")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1);
  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_metrics_daily_by_platform: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

async function runPlatformByNarrativeStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  // category=null (Query inteira) já é coberto todo ciclo por
  // daily_metrics — esta fase só cuida do breakdown por Narrativa.
  const narrativeCategoryTargets = categoryTargets.filter((c) => c !== null);
  for (const categoryId of narrativeCategoryTargets) {
    if (!hasBrandwatchCallBudget()) break;
    if (await isPlatformByNarrativeStale(supabase, projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncPlatformMetrics(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      return { didWork: true };
    }
  }
  return { didWork: false };
}

async function runTopAuthorsStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  for (const categoryId of categoryTargets) {
    if (!hasBrandwatchCallBudget()) break;
    if (await isTopAuthorsStale(supabase, projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncTopAuthors(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      return { didWork: true };
    }
  }
  return { didWork: false };
}

// =========================================================================
// Passo 6f — Top Tweeters (2026-07-12, pedido do usuário: "termine
// integração do top-tweeters... considere esses dois endpoints como
// informações distintas, porém igualmente importantes" — auditoria direta
// contra developers.brandwatch.com/docs/top-tweeters confirmou que
// `data/volume/toptweeters/queries` é um endpoint PRÓPRIO, não o mesmo
// `data/volume/topauthors/queries` já sincronizado acima com dois nomes de
// doc, como uma leitura anterior (resumo curado da skill `brandwatch-api`)
// tinha assumido. `topauthors` rankeia por volume entre todas as
// plataformas da Query; `toptweeters` rankeia especificamente autores de
// X — cobertura complementar, não substituta, daí a tabela própria em vez
// de reaproveitar bw_query_top_authors (mesmo autor pode ranquear
// diferente nos dois universos). Mesmo shape de payload de
// `syncTopAuthors()` (mesmo formato `results[].data{...}`).
// =========================================================================

async function syncTopTweeters(
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
    limit: "1000",
  });
  if (categoryId) params.set("category", String(categoryId));

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/toptweeters/queries?${params.toString()}`, token);
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
        category_id: categoryId,
        author,
        volume: d.authorVolume ?? d.volume ?? 0,
        reach_estimate: d.reachEstimate ?? null,
        impact: d.impact ?? null,
        followers: d.twitterFollowers ?? null,
        tweets: d.twitterTweets ?? null,
        retweets: d.twitterRetweets ?? null,
        account_type: d.authorAccountType ?? null,
        country_code: d.countryCode ?? null,
        country_name: d.countryName ?? null,
        sentiment_positive: sentiment.positive ?? 0,
        sentiment_neutral: sentiment.neutral ?? 0,
        sentiment_negative: sentiment.negative ?? 0,
        platform_stats: d,
        metric_week: metricWeek,
        synced_at: new Date().toISOString(),
      };
    })
    .filter((r) => r.author.length > 0);

  if (rows.length === 0) {
    log("syncTopTweeters:empty", { projectId, queryId, categoryId });
    return;
  }

  // Mesma correção de "ON CONFLICT DO UPDATE" já aplicada em syncTopAuthors()
  // — mesma classe de risco (o endpoint pode devolver o mesmo autor 2x).
  const uniqueRows = dedupeByKey(rows, (r) => r.author);
  if (uniqueRows.length !== rows.length) {
    log("syncTopTweeters:duplicates_removed", {
      projectId, queryId, categoryId, removed: rows.length - uniqueRows.length,
    });
  }

  const { error } = await supabase
    .from("bw_query_top_tweeters")
    .upsert(uniqueRows, { onConflict: "project_id,query_id,category_id_key,author,metric_week" });
  if (error) throw new Error(`Erro upsertando bw_query_top_tweeters: ${error.message}`);

  log("syncTopTweeters:done", { projectId, queryId, categoryId, rows: uniqueRows.length });
}

async function isTopTweetersStale(
  supabase: SupabaseClient,
  projectId: number,
  queryId: number,
  categoryId: number | null,
  maxAgeMs: number,
): Promise<boolean> {
  let query = supabase
    .from("bw_query_top_tweeters")
    .select("synced_at")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .order("synced_at", { ascending: false })
    .limit(1);
  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro checando frescor de bw_query_top_tweeters: ${error.message}`);
  if (!data) return true;

  return Date.now() - new Date(data.synced_at as string).getTime() > maxAgeMs;
}

async function runTopTweetersStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  categoryTargets: (number | null)[],
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  for (const categoryId of categoryTargets) {
    if (!hasBrandwatchCallBudget()) break;
    if (await isTopTweetersStale(supabase, projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
      await syncTopTweeters(supabase, token, projectId, queryId, categoryId, metricsStartDate, now);
      return { didWork: true };
    }
  }
  return { didWork: false };
}

async function runAuthorEnrichmentStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  // Escopo inicial: só os top 10 autores por volume da Query inteira
  // (category_id is null), não todo autor já visto nem quebra por
  // Narrativa — salvaguarda de orçamento (2 chamadas extras por autor
  // enriquecido). Ver data-model.md §5.
  const metricWeek = toDateOnly(now.toISOString());
  const { data: candidates, error: candidatesError } = await supabase
    .from("bw_query_top_authors")
    .select("author, impressions")
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .is("category_id", null)
    .eq("metric_week", metricWeek)
    .order("volume", { ascending: false })
    .limit(10);
  if (candidatesError) {
    throw new Error(`Erro lendo bw_query_top_authors pra enriquecimento: ${candidatesError.message}`);
  }

  const pending = (candidates ?? []).find((c) => c.impressions === null);
  if (!pending) {
    log("runAuthorEnrichmentStep:all_enriched", { projectId, queryId, candidates: candidates?.length ?? 0 });
    return { didWork: false };
  }
  if (!hasBrandwatchCallBudget()) return { didWork: false };

  const author = pending.author as string;
  const impressions = await syncAuthorImpressions(projectId, queryId, author, token, metricsStartDate, now);
  const { error: updateError } = await supabase
    .from("bw_query_top_authors")
    .update({ impressions })
    .eq("project_id", projectId)
    .eq("query_id", queryId)
    .is("category_id", null)
    .eq("author", author)
    .eq("metric_week", metricWeek);
  if (updateError) throw new Error(`Erro atualizando bw_query_top_authors.impressions: ${updateError.message}`);

  await syncAuthorTopics(supabase, token, projectId, queryId, author, metricsStartDate, now);

  return { didWork: true };
}

async function runSovStep(
  supabase: SupabaseClient,
  token: string,
  projectId: number,
  queryId: number,
  metricsStartDate: Date,
  now: Date,
): Promise<StepResult> {
  const { data: queryGroups, error: queryGroupsError } = await supabase
    .from("bw_query_groups")
    .select("id")
    .eq("project_id", projectId)
    .contains("query_ids", [queryId]);
  if (queryGroupsError) throw new Error(`Erro lendo bw_query_groups: ${queryGroupsError.message}`);

  for (const group of queryGroups ?? []) {
    if (!hasBrandwatchCallBudget()) break;
    const queryGroupId = (group as { id: number }).id;
    if (await isQueryGroupSovStale(supabase, queryGroupId, 7 * 24 * 60 * 60 * 1000)) {
      await syncQueryGroupSov(supabase, token, projectId, queryGroupId, metricsStartDate, now);
      return { didWork: true };
    }
  }
  return { didWork: false };
}

async function runSyncInvocation(supabase: SupabaseClient, invocationStartedAt: number): Promise<Response> {
  // Passo 1: resolver o próximo par (project_id, query_id) "devido" — mesmo
  // corte de BW_SYNC_INTERVAL_HOURS já checado no gate barato do handler
  // principal (recalculado aqui porque, entre o gate e este ponto, o
  // conjunto de pares devidos não muda dentro da mesma invocação — mas o
  // filtro precisa estar presente aqui também, senão o round-robin voltaria
  // a pegar qualquer par pelo simples critério de "mais antigo", ignorando
  // o intervalo de negócio). Um par "em ciclo" (next_step != 'metadata')
  // continua com `last_synced_at` antigo até o ciclo fechar, então
  // naturalmente permanece o mais "devido" e é escolhido de novo antes de
  // qualquer par que acabou de vencer o intervalo — o ciclo em andamento
  // termina antes de outro começar.
  const intervalHours = getSyncIntervalHours();
  const dueCutoffIso = new Date(Date.now() - intervalHours * 3_600_000).toISOString();
  const { data: cursor, error: cursorError } = await supabase
    .from("sync_cursors")
    .select("id, project_id, query_id, last_added_cursor, last_synced_at, backfill_completed_at, next_step")
    .or(`last_synced_at.is.null,last_synced_at.lt.${dueCutoffIso}`)
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
  const rawStep = (cursor as { next_step?: string | null }).next_step;
  const startStep: SyncStep = (SYNC_STEPS as readonly string[]).includes(rawStep ?? "")
    ? (rawStep as SyncStep)
    : "metadata";
  log("invocation:next_pair", { projectId, queryId, lastSyncedAt: cursor.last_synced_at, step: startStep });

  // Passo 2: resolver o access token. TODO (ver CLAUDE.md): ainda minta um
  // token novo por invocação em vez de reusar o cache em
  // `brandwatch_credentials.access_token_secret_ref`/`token_expires_at` —
  // deixou de ser bloqueante para agendar via pg_cron (2026-07-11): o gate
  // de intervalo acima faz o mint só acontecer quando algum par está devido
  // (a cada BW_SYNC_INTERVAL_HOURS por par, não a cada heartbeat de 15min),
  // o que é irrelevante para o orçamento de 30 chamadas/10min. Cache do
  // token continua valendo a pena implementar (evita 1 chamada por par
  // devido), só não é mais pré-requisito.
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
  // Correção 2026-07-19: ver `getMetricsStartDate()` pelo racional completo
  // — range completo (`BRANDWATCH_MENTIONS_START_DATE`) só enquanto o
  // backfill de mentions do par ainda não terminou; depois disso, janela
  // móvel incremental (`BW_METRICS_INCREMENTAL_WINDOW_DAYS`, default 30d).
  const metricsStartDate = getMetricsStartDate(cursor.backfill_completed_at as string | null);

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

    const narrativeCategoryIds = await fetchNarrativeCategoryIds(supabase, projectId, queryId);
    const categoryTargets: (number | null)[] = [null, ...narrativeCategoryIds];
    const cursorMentionsMeta = {
      last_added_cursor: cursor.last_added_cursor as string | null,
      backfill_completed_at: cursor.backfill_completed_at as string | null,
    };

    // Passo 3: dispatcher de fases. Uma invocação avança por quantas fases
    // não tiverem trabalho real a fazer (checagem de frescor é barata —
    // não é isso que estoura CPU), mas para assim que uma fase fizer
    // alguma chamada à Brandwatch. Limite de iterações = número de fases,
    // então mesmo um ciclo inteiro sem trabalho nenhum termina sozinho.
    let currentStep: SyncStep = startStep;
    let mentionsCount = 0;
    for (let i = 0; i < SYNC_STEPS.length; i++) {
      log("invocation:step_start", { projectId, queryId, step: currentStep });

      let result: StepResult;
      switch (currentStep) {
        case "metadata":
          result = await runMetadataStep(supabase, token, projectId, organizationId);
          break;
        case "mentions":
          result = await runMentionsStep(
            supabase, token, projectId, queryId, organizationId, cursorMentionsMeta, invocationStartedAt,
          );
          break;
        case "daily_metrics":
          result = await runDailyMetricsStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "hourly_metrics":
          result = await runHourlyMetricsStep(supabase, token, projectId, queryId, now);
          break;
        case "weekly_monthly":
          result = await runWeeklyMonthlyStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "topics":
          result = await runTopicsStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "platform_by_narrative":
          result = await runPlatformByNarrativeStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "x_insights":
          result = await runXInsightsStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "top_authors":
          result = await runTopAuthorsStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "top_tweeters":
          result = await runTopTweetersStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "author_enrichment":
          result = await runAuthorEnrichmentStep(supabase, token, projectId, queryId, metricsStartDate, now);
          break;
        case "top_sites":
          result = await runTopSitesStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "top_shared_sites":
          result = await runTopSharedSitesStep(supabase, token, projectId, queryId, categoryTargets, metricsStartDate, now);
          break;
        case "demographics":
          result = await runDemographicsStep(supabase, token, projectId, queryId, metricsStartDate, now);
          break;
        case "full_text_enrichment":
          result = await runFullTextEnrichmentStep(supabase, token, projectId, queryId, categoryTargets);
          break;
        case "sov":
          result = await runSovStep(supabase, token, projectId, queryId, metricsStartDate, now);
          break;
        default:
          // Inalcançável (SYNC_STEPS é exaustivo) — só pra satisfazer o
          // compilador quanto à atribuição definida de `result`.
          throw new Error(`Fase desconhecida: ${currentStep}`);
      }

      const { next, cycleComplete } = nextSyncStep(currentStep);
      const cursorUpdate: Record<string, unknown> = { next_step: next, status: "idle", last_error: null };
      if (result.lastAddedCursor !== undefined) cursorUpdate.last_added_cursor = result.lastAddedCursor;
      if (result.backfillCompletedAt !== undefined) cursorUpdate.backfill_completed_at = result.backfillCompletedAt;
      // last_synced_at só avança quando o ciclo inteiro (todas as 7 fases)
      // fecha — é isso que rearma o gate de BW_SYNC_INTERVAL_HOURS. Antes
      // disso, o par continua "devido" e será escolhido de novo no próximo
      // heartbeat (ou clique manual) pra continuar de onde parou.
      if (cycleComplete) cursorUpdate.last_synced_at = new Date().toISOString();

      const { error: updateCursorError } = await supabase.from("sync_cursors").update(cursorUpdate).eq("id", cursor.id);
      if (updateCursorError) throw new Error(`Erro atualizando sync_cursors: ${updateCursorError.message}`);

      if (result.mentionsCount) mentionsCount += result.mentionsCount;

      await supabase.from("sync_log").insert({
        project_id: projectId,
        query_id: queryId,
        status: "success",
        rows_processed: result.mentionsCount ?? 0,
      });

      log("invocation:step_done", {
        projectId, queryId, step: currentStep, didWork: result.didWork, nextStep: next, cycleComplete,
      });

      if (result.didWork || cycleComplete) break;
      currentStep = next;
    }

    log("invocation:done", { durationMs: Date.now() - invocationStartedAt, projectId, queryId, mentionsCount });

    return new Response(
      JSON.stringify({
        ok: true, projectId, queryId, mentionsCount, step: currentStep,
        tokenExpiresAt: brandwatchToken.expiresAt.toISOString(),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("invocation:failed", err);

    // Correção 2026-07-16: um 429 com retry esgotado significa que o
    // orçamento REAL da Brandwatch (30 chamadas/10min por Client) está
    // saturado — não só o orçamento local desta invocação
    // (hasBrandwatchCallBudget()), que não tem memória de invocações
    // anteriores. Grava um backoff em bw_sync_lock pra que a PRÓXIMA
    // invocação (deste par ou de qualquer outro — o teto é por Client, não
    // por par) sequer tente chamar a Brandwatch antes da janela real
    // liberar, em vez de repetir o mesmo 429 a cada heartbeat de 15min.
    if (err instanceof BrandwatchApiError && err.status === 429) {
      const { error: rateLimitError } = await supabase.rpc("mark_bw_rate_limited", {
        p_seconds: BRANDWATCH_RATE_LIMIT_BACKOFF_SECONDS,
      });
      if (rateLimitError) {
        logError("invocation:mark_rate_limited_failed", rateLimitError.message);
      } else {
        log("invocation:rate_limited", { backoffSeconds: BRANDWATCH_RATE_LIMIT_BACKOFF_SECONDS });
      }
    }

    // Falha isolada por par — marca erro no cursor, mas não derruba a fila
    // (a próxima invocação pega outro par ou tenta este de novo). Não
    // avança next_step nem last_synced_at — a mesma fase é retentada.
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
}
