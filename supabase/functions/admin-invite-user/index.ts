// supabase/functions/admin-invite-user/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Implementa o passo 4 do fluxo
// principal de .dev/specs/auth/user-management.md: convite de um novo
// usuário (sem auto-cadastro no MVP). Cria a conta em auth.users **sem
// senha** via inviteUserByEmail (o usuário define a própria senha ao
// aceitar, reaproveitando o mecanismo de token de recovery de
// password-recovery.md), cria o user_profiles correspondente e as linhas
// de organization_members das organizações selecionadas.
//
// Exige que o chamador seja um admin (user_profiles.is_admin = true) —
// checado no início do handler, antes de qualquer chamada à Admin API.

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

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const fullName =
      typeof body.full_name === "string" && body.full_name.trim() ? body.full_name.trim() : null;
    const isAdmin = body.is_admin === true;
    const organizationIds: string[] = Array.isArray(body.organization_ids)
      ? body.organization_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];

    if (!email) return jsonResponse({ error: "E-mail obrigatório." }, 400);
    if (organizationIds.length === 0) {
      return jsonResponse({ error: "Selecione ao menos uma organização." }, 400);
    }

    const siteUrl = Deno.env.get("SITE_URL");

    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      siteUrl ? { redirectTo: `${siteUrl}/reset-password` } : undefined,
    );

    if (inviteError) {
      const message = inviteError.message?.toLowerCase() ?? "";
      if (message.includes("already") && message.includes("registered")) {
        return jsonResponse({ error: "Este e-mail já está cadastrado." }, 409);
      }
      throw inviteError;
    }

    const newUserId = invited.user.id;

    const { error: profileError } = await supabaseAdmin.from("user_profiles").insert({
      id: newUserId,
      full_name: fullName,
      is_admin: isAdmin,
    });
    if (profileError) throw profileError;

    const { error: membersError } = await supabaseAdmin.from("organization_members").insert(
      organizationIds.map((organizationId) => ({
        user_id: newUserId,
        organization_id: organizationId,
      })),
    );
    if (membersError) throw membersError;

    return jsonResponse({ success: true, user_id: newUserId });
  } catch (err) {
    console.error("[admin-invite-user] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
