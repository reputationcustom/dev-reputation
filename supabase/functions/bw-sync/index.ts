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
// synced_at > 24h). Busca project/queries/query-groups/categories reais.
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

  log("refreshMetadata:done", {
    projectId,
    queriesCount: queries.length,
    queryGroupsCount: queryGroups.length,
    categoriesCount: categoryRows.length,
  });
}

// =========================================================================
// Passo 4 — Polling de mentions
// =========================================================================

async function fetchMentions(
  projectId: number,
  queryId: number,
  token: string,
  lastAddedCursor: string | null,
): Promise<any[]> {
  const params = new URLSearchParams({
    queryId: String(queryId),
    pageSize: "100",
    orderBy: "added",
    orderDirection: "desc",
    // Obrigatório pela API mesmo no polling ("This method requires a start
    // date") — ver getMentionsStartDate(). endDate = agora, sempre.
    startDate: formatBrandwatchDate(getMentionsStartDate()),
    endDate: formatBrandwatchDate(new Date()),
  });

  if (lastAddedCursor) {
    const bufferedSince = new Date(new Date(lastAddedCursor).getTime() - 5 * 60 * 1000);
    params.set("sinceAdded", formatBrandwatchDate(bufferedSince));
    params.set("sourceType", "new");
  } else {
    params.set("page", "0");
  }

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
// ⚠️ Formato de `results` inferido da descrição em references/
// data-retrieval-charts.md ("Um Query Group... gera diretamente o breakdown
// de share of voice por semana") — não confirmado contra um payload real.
// Assumido: cada item de `results` representa uma Query dentro do grupo
// (`id` = queryId), com `values[]` = {id: semana, value: volume}. Revisar
// se os dados vierem diferentes do esperado (ver logs [bw-sync]).
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

  const json = await callBrandwatch(`/projects/${projectId}/data/volume/queryGroups/weeks?${params.toString()}`, token);
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
    .select("id, project_id, query_id, last_added_cursor, last_synced_at")
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
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

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

    // Passo 4: polling de mentions.
    const mentions = await fetchMentions(projectId, queryId, token, cursor.last_added_cursor as string | null);
    const { count: mentionsCount, maxAdded } = await upsertMentions(supabase, organizationId, projectId, queryId, mentions);
    log("invocation:mentions_synced", { projectId, queryId, mentionsCount });

    // Passo 5: métricas diárias — sempre roda, query inteira (category=null)
    // + cada Category vinculada a alguma Narrativa deste projeto.
    const narrativeCategoryIds = await fetchNarrativeCategoryIds(supabase, projectId);
    const categoryTargets: (number | null)[] = [null, ...narrativeCategoryIds];

    for (const categoryId of categoryTargets) {
      await syncSentimentMetrics(supabase, token, "days", projectId, queryId, categoryId, sevenDaysAgo, now);
    }

    // Passo 6: semanal/mensal — throttle por frescor (evita gastar rate
    // limit em dado que muda bem mais devagar que a cada 20-30s).
    for (const categoryId of categoryTargets) {
      if (await isGrainStale(supabase, "weeks", projectId, queryId, categoryId, 7 * 24 * 60 * 60 * 1000)) {
        await syncSentimentMetrics(supabase, token, "weeks", projectId, queryId, categoryId, sevenDaysAgo, now);
      }
      if (await isGrainStale(supabase, "months", projectId, queryId, categoryId, 30 * 24 * 60 * 60 * 1000)) {
        await syncSentimentMetrics(supabase, token, "months", projectId, queryId, categoryId, sevenDaysAgo, now);
      }
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
        await syncQueryGroupSov(supabase, token, projectId, queryGroupId, sevenDaysAgo, now);
      }
    }

    // Passo 7: fechar o ciclo.
    const { error: updateCursorError } = await supabase
      .from("sync_cursors")
      .update({
        last_added_cursor: maxAdded ?? cursor.last_added_cursor,
        last_synced_at: new Date().toISOString(),
        status: "idle",
        last_error: null,
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
