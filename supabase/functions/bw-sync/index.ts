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
//   2. Resolver o access token da Brandwatch via
//      brandwatch_credentials.access_token_secret_ref (Supabase Vault).
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

  // TODO passos 2-7: resolver credencial, chamar a Brandwatch, fazer upsert,
  // atualizar sync_cursors/sync_log. Esqueleto retorna sem processar.
  return new Response(
    JSON.stringify({ ok: true, message: "esqueleto — lógica de sync ainda não implementada", nextCursor }),
    { headers: { "Content-Type": "application/json" } },
  );
});
