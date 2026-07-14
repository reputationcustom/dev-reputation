// supabase/functions/get-finops-overview/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — módulo `finops`
// (.dev/specs/finops/overview.md). Devolve o painel de custo de IA (uso
// real, ai_usage_log) + projeção de fim de mês + custos extras cadastrados
// (manual_costs). Admin-only, escopo é a plataforma inteira — mesmo padrão
// de auth dos admin-* (Bearer token → supabaseAdmin.auth.getUser(token) →
// checar user_profiles.is_admin), não o padrão de get-page-* (organização
// ativa + JWT encaminhado), já que o custo de IA é da conta da plataforma,
// não de uma organização específica.

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

    const { data, error } = await supabaseAdmin.rpc("get_finops_overview", { p_trend_days: 30 });
    if (error) throw error;

    return jsonResponse(data);
  } catch (err) {
    console.error("[get-finops-overview] handler failed", err);
    return jsonResponse({ error: "Não foi possível carregar o painel de custos." }, 500);
  }
});
