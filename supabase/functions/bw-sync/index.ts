// supabase/functions/bw-sync/index.ts
//
// Esqueleto autossuficiente (Princípio técnico 5, .dev/specs/_index.md) —
// sem import relativo de `_shared/` (não suportado em produção pelo Supabase
// SaaS). Acionada por pg_cron a cada ~20-30s (nunca pelo frontend, por isso
// sem CORS — ver Princípio técnico 5, ressalva de funções só-cron).
//
// Fluxo completo esperado (.dev/specs/foundation/sync-brandwatch.md) — cada
// TODO abaixo é uma leva futura de implementação, não implementado ainda:
//   1. Resolver o próximo par (project_id, query_id) pendente em
//      sync_cursors (round-robin, last_synced_at mais antigo primeiro).
//   2. Resolver o access token da Brandwatch — ver mintBrandwatchAccessToken()
//      abaixo (implementada) e a ressalva de cache logo depois (não
//      implementada ainda).
//   3. Bootstrap (primeira sync ou refresh > 24h): projects/summary,
//      queries/summary, query-groups, rulecategories, GET /metrics — upsert
//      em bw_projects/bw_queries/bw_query_groups/bw_categories.
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
    throw new Error(`Brandwatch OAuth error ${response.status}: ${body}`);
  }

  const json = await response.json() as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  };
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // TODO passo 1: resolver o próximo par (project_id, query_id) pendente.
  const { data: nextCursor, error: cursorError } = await supabase
    .from("sync_cursors")
    .select("id, project_id, query_id, last_added_cursor, last_synced_at")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  if (cursorError) {
    return new Response(JSON.stringify({ ok: false, error: cursorError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!nextCursor) {
    return new Response(JSON.stringify({ ok: true, message: "nenhum par pendente" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

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
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // TODO passos 3-7: bootstrap/polling/upsert usando brandwatchToken.accessToken,
  // atualizar sync_cursors/sync_log. Esqueleto retorna sem processar.
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
