// supabase/functions/get-narrative-communication-timeline/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — sem import
// relativo de `_shared/`. Alimenta /communications/[narrativeId]
// (.dev/specs/communications/narrative-impact-tracking.md) e o resumo
// "Comunicações e Decisões" do detalhe de Narrativa.
//
// Mesmo padrão de autenticação de get-page-narratives
// (aggregated-metrics/edge-functions-per-page.md): chave publicável + JWT
// encaminhado, RLS continua valendo; valida organization_members antes de
// chamar a function SQL (defesa em profundidade, não o único gate).

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

interface RequestBody {
  organization_id?: string;
  narrative_id?: string;
  window_days?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Não autenticado." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "Não autenticado." }, 401);

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Corpo da requisição inválido." }, 400);
    }

    const organizationId = body.organization_id;
    const narrativeId = body.narrative_id;
    if (!organizationId) return jsonResponse({ error: "organization_id é obrigatório." }, 400);
    if (!narrativeId) return jsonResponse({ error: "narrative_id é obrigatório." }, 400);

    const windowDays = [3, 7, 14].includes(body.window_days ?? 7) ? body.window_days ?? 7 : 7;

    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (membershipError) {
      console.error("[get-narrative-communication-timeline] membership check failed", membershipError);
      return jsonResponse({ error: "Não foi possível validar acesso à organização." }, 503);
    }
    if (!membership) {
      return jsonResponse({ error: "Você não tem acesso a esta organização." }, 403);
    }

    const { data, error } = await supabase.rpc("get_narrative_communication_timeline", {
      p_narrative_id: narrativeId,
      p_organization_id: organizationId,
      p_window_days: windowDays,
    });

    if (error) {
      console.error("[get-narrative-communication-timeline] rpc failed", error);
      return jsonResponse({ error: "Não foi possível carregar o acompanhamento." }, 503);
    }

    return jsonResponse({ items: data ?? [], window_days: windowDays });
  } catch (err) {
    console.error("[get-narrative-communication-timeline] unhandled error", err);
    return jsonResponse({ error: "Não foi possível carregar os dados." }, 503);
  }
});
