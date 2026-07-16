// supabase/functions/get-sync-console-history/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — módulo
// `sync-console` (.dev/specs/sync-console/pipeline-monitoring.md,
// "Histórico de execuções"). Histórico PAGINADO e completo de execuções do
// pipeline bw-sync (automáticas e manuais), com quantos registros cada uma
// sincronizou — pedido do usuário: "verificar todas as execuções que
// ocorreram e quantos registros foram sincronizados em cada etapa". Nunca
// capado a uma janela fixa — literalmente todo sync_log já registrado,
// filtrável por par (project_id/query_id) ou combinado ("todos os
// pares"). Admin-only, mesmo padrão de auth de get-sync-console-status.

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

// Mesmo default já usado em components/ui/pagination.tsx (DEFAULT_PAGE_SIZE)
// no resto do produto — regra transversal #6.
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

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
    const page = Number.isInteger(body.page) && body.page > 0 ? (body.page as number) : 1;
    const pageSize =
      Number.isInteger(body.pageSize) && body.pageSize > 0 && body.pageSize <= MAX_PAGE_SIZE
        ? (body.pageSize as number)
        : DEFAULT_PAGE_SIZE;
    const projectId = typeof body.projectId === "number" ? body.projectId : null;
    const queryId = typeof body.queryId === "number" ? body.queryId : null;

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Escopado a 1 par: usa o índice novo (project_id, query_id,
    // created_at desc), migration 20260809140000. Sem filtro ("todos os
    // pares"): usa o índice já existente idx_sync_log_created_at
    // (foundation) — nenhum índice novo necessário pra esse caso.
    let query = supabaseAdmin
      .from("sync_log")
      .select(
        "id, project_id, query_id, step, status, rows_processed, duration_ms, stop_reason, trigger_source, triggered_by_user_id, error_message, created_at, bw_projects(name), bw_queries(name)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (projectId !== null) query = query.eq("project_id", projectId);
    if (queryId !== null) query = query.eq("query_id", queryId);

    const { data, error, count } = await query;
    if (error) throw error;

    // Resolve nome de quem disparou uma execução manual — left join direto
    // em user_profiles (a chave secreta já bypassa RLS; este recurso é
    // admin-only/global, não escopado por organização, então não precisa
    // de uma function auxiliar tipo list-organization-members).
    const userIds = Array.from(
      new Set(
        (data ?? [])
          .map((r: any) => r.triggered_by_user_id)
          .filter((id: unknown): id is string => typeof id === "string"),
      ),
    );
    let namesByUserId: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("user_profiles")
        .select("id, full_name")
        .in("id", userIds);
      namesByUserId = Object.fromEntries(
        (profiles ?? []).map((p: any) => [p.id as string, (p.full_name as string | null) ?? null]),
      );
    }

    const items = (data ?? []).map((r: any) => ({
      id: r.id as string,
      projectId: r.project_id as number,
      queryId: r.query_id as number,
      projectName: (r.bw_projects?.name as string | undefined) ?? null,
      queryName: (r.bw_queries?.name as string | undefined) ?? null,
      step: (r.step as string | null) ?? null,
      status: r.status as string,
      rowsProcessed: (r.rows_processed as number | null) ?? 0,
      durationMs: (r.duration_ms as number | null) ?? null,
      stopReason: (r.stop_reason as string | null) ?? null,
      triggerSource: (r.trigger_source as string | null) ?? "cron",
      triggeredByUserName: r.triggered_by_user_id ? namesByUserId[r.triggered_by_user_id as string] ?? null : null,
      errorMessage: (r.error_message as string | null) ?? null,
      createdAt: r.created_at as string,
    }));

    return jsonResponse({ items, totalCount: count ?? 0, page, pageSize });
  } catch (err) {
    console.error("[get-sync-console-history] handler failed", err);
    return jsonResponse({ error: "Não foi possível carregar o histórico de execuções." }, 500);
  }
});
