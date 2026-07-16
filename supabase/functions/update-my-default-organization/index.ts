// supabase/functions/update-my-default-organization/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Segundo endpoint de escrita
// self-service em user_profiles (o primeiro é update-my-timezone,
// CLAUDE.md "User timezone"): o próprio usuário escolhendo qual das
// organizações a que pertence é a sua organização padrão, selecionável no
// seletor de organização do header (pedido do usuário, 2026-07-22).
// Diferente das 6 Edge Functions `admin-*`, não é uma ação administrativa —
// qualquer usuário autenticado pode chamar, mas sempre restrito à própria
// linha (`id = auth.getUser(token).id`), nunca um user_id recebido no body.
//
// A validação real (Princípio 2 — sem lógica de negócio no frontend) é:
// o organizationId enviado precisa ser uma organização da qual o usuário é
// membro (organization_members), não apenas um uuid bem formado — a lista
// de organizações que o frontend mostra no seletor já vem de uma query
// escopada por RLS, mas essa function não pode confiar cegamente no que o
// cliente manda de volta.

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

    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";

    if (!organizationId) return jsonResponse({ error: "Organização obrigatória." }, 400);

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("organization_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (membershipError) {
      console.error("[update-my-default-organization] membership check failed", membershipError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    if (!membership) {
      return jsonResponse({ error: "Organização inválida." }, 403);
    }

    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({ default_organization_id: organizationId })
      .eq("id", user.id);

    if (updateError) {
      // Nunca devolver updateError.message bruto ao cliente — jargão de
      // schema/Postgres, não faz sentido pro usuário final (CLAUDE.md,
      // "Edge Functions nunca vazam erro técnico ao cliente").
      console.error("[update-my-default-organization] update failed", updateError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    return jsonResponse({ success: true, defaultOrganizationId: organizationId });
  } catch (err) {
    console.error("[update-my-default-organization] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
