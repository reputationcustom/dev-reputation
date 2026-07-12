// supabase/functions/admin-revoke-user-access/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Implementa os passos 6/7 do fluxo
// principal de .dev/specs/auth/user-management.md: revogar/restaurar
// acesso via auth.admin.updateUserById (ban_duration '876000h' ~100 anos —
// efetivamente indefinido, sem "unban" nativo com duração menor — ou
// 'none' para restaurar).
//
// ⚠️ Nota da spec ("Regras de negócio"): banir não é bloqueado pelo trigger
// de banco (protect_principal_account_trigger só cobre user_profiles, não
// auth.users.banned_until) — a spec deixa como ⚠️ DECISÃO PENDENTE se essa
// checagem deveria ser obrigatória aqui. Implementada como defesa em
// profundidade (recomendação da própria spec, custo baixo): bloqueia
// revogar acesso do admin principal mesmo que a UI (que já oculta a ação
// nessa linha) seja contornada.
//
// Exige que o chamador seja um admin (user_profiles.is_admin = true) —
// checado no início do handler, antes de qualquer chamada à Admin API.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BAN_DURATION = "876000h";

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
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const revoke = body.revoke === true;

    if (!userId) return jsonResponse({ error: "user_id obrigatório." }, 400);

    if (revoke) {
      const { data: targetProfile } = await supabaseAdmin
        .from("user_profiles")
        .select("is_principal")
        .eq("id", userId)
        .single();

      if (targetProfile?.is_principal) {
        return jsonResponse(
          { error: "Não é possível revogar o acesso do admin principal." },
          403,
        );
      }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: revoke ? BAN_DURATION : "none",
    });
    if (updateError) throw updateError;

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[admin-revoke-user-access] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
