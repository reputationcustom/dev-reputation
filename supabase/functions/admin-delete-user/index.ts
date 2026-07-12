// supabase/functions/admin-delete-user/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Implementa o passo 8 do fluxo
// principal de .dev/specs/auth/user-management.md: exclusão permanente via
// auth.admin.deleteUser (cascade em user_profiles/organization_members,
// ver auth/data-model.md). Bloqueada para o admin principal — a UI já
// oculta a ação nessa linha, e o trigger protect_principal_account_trigger
// bloqueia no banco mesmo por chamada direta à Admin API (o DELETE em
// auth.users cascateia em user_profiles, disparando o BEFORE DELETE) —
// aqui é só uma checagem prévia para devolver uma mensagem amigável em vez
// do erro cru do Postgres.
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
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    if (!userId) return jsonResponse({ error: "user_id obrigatório." }, 400);

    const { data: targetProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("is_principal")
      .eq("id", userId)
      .single();

    if (targetProfile?.is_principal) {
      return jsonResponse({ error: "Não é possível excluir o admin principal." }, 403);
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      if (deleteError.message?.toLowerCase().includes("principal")) {
        return jsonResponse({ error: "Não é possível excluir o admin principal." }, 403);
      }
      throw deleteError;
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[admin-delete-user] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
