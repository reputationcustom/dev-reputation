// supabase/functions/bw-sync/index.ts
//
// Esqueleto autossuficiente (Princípio técnico 5, .dev/specs/_index.md) —
// sem import relativo de `_shared/` (não suportado em produção pelo Supabase
// SaaS). Acionada por pg_cron a cada ~20-30s (nunca pelo frontend, por isso
// sem CORS — ver Princípio técnico 5, ressalva de funções só-cron).
//
// Fluxo completo esperado (.dev/specs/foundation/sync-brandwatch.md) — cada
// TODO abaixo é uma leva futura de implementação, não implementado ainda:
//   0. Semear sync_cursors na primeira execução — ver ensureBootstrapSeed()
//      abaixo (implementada). sync_cursors nasce vazia e nada mais a
//      populava (o passo 3 de bootstrap completo, via projects/summary, é
//      TODO) — sem isto o sync nunca começa. MVP de Client único: usa
//      BRANDWATCH_PROJECT_ID/BRANDWATCH_QUERY_IDS (secrets da função) em vez
//      de descobrir automaticamente todos os projects/queries da conta.
//   1. Resolver o próximo par (project_id, query_id) pendente em
//      sync_cursors (round-robin, last_synced_at mais antigo primeiro).
//   2. Resolver o access token da Brandwatch — ver mintBrandwatchAccessToken()
//      abaixo (implementada) e a ressalva de cache logo depois (não
//      implementada ainda).
//   3. Bootstrap de metadata (primeira sync daquele par ou refresh > 24h):
//      queries/summary, query-groups, rulecategories, GET /metrics — upsert
//      em bw_queries/bw_query_groups/bw_categories (bw_projects/bw_queries já
//      têm uma linha placeholder do passo 0; este passo preenche os campos
//      reais).
//   4. Polling de mentions: sinceAdded = sync_cursors.last_added_cursor menos
//      buffer de 5min, orderBy=added&orderDirection=desc — upsert em
//      mentions via idx_mentions_natural_key.
//   5. data/volume/sentiment/days por Category ativa vinculada a alguma
//      Narrativa — upsert em bw_query_metrics_daily.
//   6. Atualizar sync_cursors (last_added_cursor, last_synced_at,
//      status='idle') e inserir linha em sync_log (status='success',
//      rows_processed).
//   7. HTTP 429: backoff (retry-after ou janela/limite), até 3 tentativas;
//      se esgotar, sync_cursors.status='error' + last_error, sync_log
//      status='error' — sem derrubar a fila inteira (cada par falha isolado).
//
// Referência de client HTTP com fila serial + backoff: skill
// `brandwatch-api`, scripts/brandwatch-client.ts — adaptar (copiar, não
// importar) para dentro desta função quando a lógica acima for implementada.

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Logs estruturados (prefixo fixo [bw-sync]) para aparecer nos logs da Edge
// Function no Dashboard do Supabase — único jeito de debugar esta função
// hoje, já que não há UI/sync_log ainda escrevendo o resultado de cada
// passo (sync_log só é gravado no TODO passo 6). NUNCA logar
// password/access_token — só metadados (tamanho, expiração, ids).
function log(step: string, data?: Record<string, unknown>) {
  console.log(`[bw-sync] ${step}`, data ? JSON.stringify(data) : "");
}
function logError(step: string, err: unknown) {
  console.error(`[bw-sync] ${step}`, err instanceof Error ? err.message : String(err));
}

// client_id=brandwatch-api-client é um literal fixo da Brandwatch (o mesmo
// para qualquer integrador, documentado publicamente) — não é segredo, por
// isso hardcoded aqui em vez de env var.
const BRANDWATCH_OAUTH_URL = "https://api.brandwatch.com/oauth/token";
const BRANDWATCH_OAUTH_CLIENT_ID = "brandwatch-api-client";

interface BrandwatchToken {
  accessToken: string;
  expiresAt: Date;
}

// Minta um access token via grant_type=api-password (.dev/specs/foundation/
// brandwatch-setup.md §1 e sync-brandwatch.md — MVP sem token de longa
// duração pré-gerado). BRANDWATCH_USERNAME/BRANDWATCH_PASSWORD/
// BRANDWATCH_PLATFORM_CLIENT_ID são secrets da própria Edge Function
// (Deno.env.get, nunca no frontend — Princípio técnico 1), não colunas de
// brandwatch_credentials neste MVP (assume um único Client Brandwatch).
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
  // evita vazar em logs de URL/proxies (mesma prática do header Authorization
  // vs. query param descrita na skill brandwatch-api, references/authentication.md).
  const response = await fetch(`${BRANDWATCH_OAUTH_URL}?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(password)}`,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // Corpo de erro da Brandwatch não costuma ecoar a senha enviada, só
    // credenciais inválidas/parâmetros — seguro logar, mas mantido enxuto.
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

// Garante que sync_cursors tenha ao menos o par (BRANDWATCH_PROJECT_ID,
// BRANDWATCH_QUERY_IDS) configurado via secret — sem isto, sync_cursors
// nasce vazia e o passo 1 (round-robin) nunca tem o que processar. MVP de
// Client único: não descobre projects/queries automaticamente (isso seria o
// bootstrap completo via projects/summary, TODO passo 3) — as IDs vêm de env
// var porque já são conhecidas manualmente (ver brandwatch-setup.md).
//
// bw_projects/bw_queries exigem organization_id/project_id via FK, então
// este passo também garante linhas placeholder nessas tabelas antes de
// inserir em sync_cursors — o passo 3 (bootstrap de metadata) sobrescreve
// `name`/demais campos reais depois, sem tocar nas linhas já existentes aqui
// além de fazer update.
async function ensureBootstrapSeed(supabase: SupabaseClient): Promise<void> {
  const projectIdRaw = Deno.env.get("BRANDWATCH_PROJECT_ID");
  const queryIdsRaw = Deno.env.get("BRANDWATCH_QUERY_IDS");

  if (!projectIdRaw || !queryIdsRaw) {
    // Sem as duas envs, não há o que semear — segue para o passo 1 normal
    // (que vai simplesmente não achar nenhum par pendente).
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
  // como dona do project_id acima. Se o produto passar a ter mais de uma
  // organização com Brandwatch configurado, este passo precisa de outro
  // critério para decidir de quem é o project_id (hoje é ambíguo de propósito
  // — reflete a mesma simplificação já assumida para as credenciais).
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
      {
        id: projectId,
        organization_id: credentials.organization_id,
        name: "(aguardando bootstrap de metadata)",
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (projectError) {
    logError("ensureBootstrapSeed:bw_projects_error", projectError.message);
    throw new Error(`Erro semeando bw_projects: ${projectError.message}`);
  }

  const { error: queriesError } = await supabase
    .from("bw_queries")
    .upsert(
      queryIds.map((id) => ({
        id,
        project_id: projectId,
        name: "(aguardando bootstrap de metadata)",
      })),
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

Deno.serve(async (_req: Request) => {
  const invocationStartedAt = Date.now();
  log("invocation:start");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // TODO passo 0: só roda de fato quando BRANDWATCH_PROJECT_ID/QUERY_IDS
  // estão configurados; idempotente (ignoreDuplicates) — seguro em toda
  // invocação, não só na primeira.
  try {
    await ensureBootstrapSeed(supabase);
  } catch (err) {
    logError("invocation:bootstrap_seed_failed", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // TODO passo 1: resolver o próximo par (project_id, query_id) pendente.
  const { data: nextCursor, error: cursorError } = await supabase
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

  if (!nextCursor) {
    log("invocation:no_pending_pair");
    return new Response(JSON.stringify({ ok: true, message: "nenhum par pendente" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  log("invocation:next_pair", {
    projectId: nextCursor.project_id,
    queryId: nextCursor.query_id,
    lastSyncedAt: nextCursor.last_synced_at,
  });

  // TODO passo 2 (cache): esta chamada minta um token novo TODA invocação —
  // aceitável para testar mintBrandwatchAccessToken() isoladamente, mas NÃO
  // é rate-limit-safe (cada ~20-30s de pg_cron consumiria boa parte dos 30
  // chamadas/10min só renovando token). Antes de agendar via pg_cron em
  // produção, isto precisa checar brandwatch_credentials.token_expires_at
  // (via organization_id de bw_projects.project_id) e só chamar
  // mintBrandwatchAccessToken() quando o cache estiver ausente/expirado,
  // gravando o resultado de volta (Vault + token_expires_at).
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

  // TODO passos 3-7: bootstrap/polling/upsert usando brandwatchToken.accessToken,
  // atualizar sync_cursors/sync_log. Esqueleto retorna sem processar.
  log("invocation:done", {
    durationMs: Date.now() - invocationStartedAt,
    projectId: nextCursor.project_id,
    queryId: nextCursor.query_id,
    tokenExpiresAt: brandwatchToken.expiresAt.toISOString(),
  });

  return new Response(
    JSON.stringify({
      ok: true,
      message: "esqueleto — token mintado, lógica de sync ainda não implementada",
      nextCursor,
      tokenExpiresAt: brandwatchToken.expiresAt.toISOString(),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
