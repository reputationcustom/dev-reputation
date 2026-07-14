// supabase/functions/update-my-refresh-button-preference/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Terceiro endpoint de escrita
// self-service em user_profiles (depois de update-my-timezone e
// update-my-default-organization): o próprio usuário admin ligando/
// desligando a visibilidade do botão "Atualizar resumo executivo"
// (NarrativeTextPanel, ai-synthesis Camada 2) fora do período
// personalizado — pedido do usuário, 2026-07-14: "em apresentação de
// produto o ideal é não aparecer, porém em desenvolvimento ou em testes é
// importante aparecer."
//
// Diferente de update-my-timezone/update-my-default-organization (abertos
// a qualquer usuário autenticado), esta preferência só tem efeito visível
// pra quem já vê o botão em primeiro lugar — restrita a `is_admin`, mesmo
// gate que já controla a visibilidade do botão no frontend
// (NarrativeTextPanel's `canManuallyRefresh`).

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
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonResponse({ error: "Não autenticado." }, 401);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[update-my-refresh-button-preference] profile lookup failed", profileError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    if (!profile?.is_admin) {
      return jsonResponse({ error: "Apenas administradores podem alterar esta preferência." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    if (typeof body.show !== "boolean") {
      return jsonResponse({ error: "Parâmetro 'show' obrigatório." }, 400);
    }

    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({ show_ai_refresh_button: body.show })
      .eq("id", user.id);

    if (updateError) {
      // Nunca devolver updateError.message bruto ao cliente — jargão de
      // schema/Postgres, não faz sentido pro usuário final (CLAUDE.md,
      // "Edge Functions nunca vazam erro técnico ao cliente").
      console.error("[update-my-refresh-button-preference] update failed", updateError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    return jsonResponse({ success: true, show: body.show });
  } catch (err) {
    console.error("[update-my-refresh-button-preference] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
