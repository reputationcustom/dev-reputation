// supabase/functions/get-sync-console-status/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — módulo `sync-console` (.dev/specs/sync-console/data-model.md). Só
// leitura, só o estado ATUAL de cada par (project_id, query_id) do
// pipeline bw-sync — sem histórico embutido (ver get-sync-console-history
// para "todas as execuções que ocorreram"). Admin-only, mesmo padrão de
// auth dos admin-*/finops (Bearer token → supabaseAdmin.auth.getUser(token)
// → checar user_profiles.is_admin), não o padrão de get-page-* (organização
// ativa + JWT encaminhado) — este é um recurso admin-only da plataforma,
// não escopado por organização.

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
// duplicada aqui por Princípio técnico 5 (nunca importar entre funções).
// Devolvida na resposta pra o frontend não precisar manter uma terceira
// cópia hardcoded.
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

// Mesma leitura/default que bw-sync/index.ts (getSyncIntervalHours()) —
// duplicada aqui por Princípio técnico 5.
function getSyncIntervalHours(): number {
  const raw = Deno.env.get("BW_SYNC_INTERVAL_HOURS");
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 3;
}

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

    const [{ data: cursors, error: cursorsError }, { data: lockRow, error: lockError }] = await Promise.all([
      supabaseAdmin
        .from("sync_cursors")
        .select(
          "project_id, query_id, next_step, last_synced_at, status, last_error, bw_projects(name), bw_queries(name)",
        )
        .order("last_synced_at", { ascending: true, nullsFirst: true }),
      supabaseAdmin
        .from("bw_sync_lock")
        .select("locked_until, rate_limited_until, last_rate_limit_used, last_rate_limit_observed_at")
        .eq("id", true)
        .maybeSingle(),
    ]);

    if (cursorsError) throw cursorsError;
    if (lockError) throw lockError;

    const syncIntervalHours = getSyncIntervalHours();
    const intervalMs = syncIntervalHours * 3_600_000;
    const nowMs = Date.now();

    const pairs = (cursors ?? []).map((c: any) => {
      const lastSyncedAt = (c.last_synced_at as string | null) ?? null;
      let nextDueAt: string | null = null;
      let dueNow = true;
      if (lastSyncedAt) {
        const dueAtMs = new Date(lastSyncedAt).getTime() + intervalMs;
        dueNow = dueAtMs <= nowMs;
        nextDueAt = dueNow ? null : new Date(dueAtMs).toISOString();
      }
      return {
        projectId: c.project_id as number,
        queryId: c.query_id as number,
        projectName: (c.bw_projects?.name as string | undefined) ?? null,
        queryName: (c.bw_queries?.name as string | undefined) ?? null,
        currentStep: c.next_step as string,
        lastSyncedAt,
        nextDueAt,
        dueNow,
        status: c.status as string,
        lastError: (c.last_error as string | null) ?? null,
      };
    });

    const now = new Date();
    const rateLimitedUntil = (lockRow?.rate_limited_until as string | null) ?? null;
    const rateLimited = Boolean(rateLimitedUntil && new Date(rateLimitedUntil) > now);
    const lockedUntil = (lockRow?.locked_until as string | null) ?? null;
    const locked = Boolean(lockedUntil && new Date(lockedUntil) > now);

    return jsonResponse({
      pairs,
      globalState: {
        locked,
        lockedUntil,
        rateLimited,
        rateLimitedUntil,
        lastRateLimitUsed: (lockRow?.last_rate_limit_used as number | null) ?? null,
        lastRateLimitObservedAt: (lockRow?.last_rate_limit_observed_at as string | null) ?? null,
      },
      syncIntervalHours,
      syncSteps: SYNC_STEPS,
    });
  } catch (err) {
    console.error("[get-sync-console-status] handler failed", err);
    return jsonResponse({ error: "Não foi possível carregar o status do pipeline." }, 500);
  }
});
