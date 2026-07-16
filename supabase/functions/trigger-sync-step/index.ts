// supabase/functions/trigger-sync-step/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — módulo
// `sync-console` (.dev/specs/sync-console/manual-step-execution.md).
// Admin-only. Valida a requisição e faz uma chamada server-to-server para
// a própria bw-sync com `{ manualStep: {...} }` — o navegador nunca chama
// bw-sync diretamente (mesmo invariante já documentado em
// supabase/config.toml, "bw-sync é acionada só por pg_cron... nunca pelo
// frontend"). O Bearer token do admin autenticado aqui é repassado para a
// chamada a bw-sync, que valida esse MESMO token de novo (defesa em
// profundidade — ver comentário em bw-sync/index.ts no branch
// `manualStep`, já que bw-sync roda com verify_jwt=false).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mesma lista/ordem de supabase/functions/bw-sync/index.ts (SYNC_STEPS) —
// duplicada aqui por Princípio técnico 5. Nunca confia só na validação
// client-side do <select> (Princípio técnico 2). ✅ Reordenada (2026-07-16)
// junto com a cópia canônica — a ordem em si é irrelevante pra esta
// validação (`.includes`), mantida em sincronia só por consistência entre
// as 4 cópias deste array no projeto.
const SYNC_STEPS = [
  "metadata",
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
  "mentions",
  "full_text_enrichment",
  "sov",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse({ error: "Não autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const secretKey =
      Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, secretKey);

    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) return jsonResponse({ error: "Não autenticado." }, 401);

    const { data: callerProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("is_admin")
      .eq("id", caller.id)
      .single();

    if (!callerProfile?.is_admin) {
      return jsonResponse({ error: "Acesso restrito a administradores." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const projectId = Number(body.projectId);
    const queryId = Number(body.queryId);
    const step = body.step;

    if (!Number.isFinite(projectId) || !Number.isFinite(queryId)) {
      return jsonResponse({ error: "Par Projeto/Query inválido." }, 400);
    }
    if (typeof step !== "string" || !(SYNC_STEPS as readonly string[]).includes(step)) {
      return jsonResponse({ error: "Fase inválida." }, 400);
    }

    const { data: pair, error: pairError } = await supabaseAdmin
      .from("sync_cursors")
      .select("id")
      .eq("project_id", projectId)
      .eq("query_id", queryId)
      .maybeSingle();
    if (pairError) throw pairError;
    if (!pair) return jsonResponse({ error: "Par Projeto/Query não encontrado." }, 400);

    const bwSyncUrl = `${supabaseUrl}/functions/v1/bw-sync`;
    const bwSyncResponse = await fetch(bwSyncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        manualStep: { projectId, queryId, step, triggeredByUserId: caller.id },
      }),
    });

    const result = await bwSyncResponse
      .json()
      .catch(() => ({ ok: false, error: "Resposta inválida do pipeline de sincronização." }));

    return jsonResponse(result, bwSyncResponse.ok ? 200 : bwSyncResponse.status);
  } catch (err) {
    console.error("[trigger-sync-step] handler failed", err);
    return jsonResponse({ error: "Não foi possível executar a fase. Tente novamente." }, 500);
  }
});
