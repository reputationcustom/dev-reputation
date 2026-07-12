// supabase/functions/admin-update-user-organizations/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Implementa o passo 9 do fluxo
// principal de .dev/specs/auth/user-management.md: calcula o diff entre as
// organizações atuais do usuário e as selecionadas no modal — organizações
// marcadas que não existiam viram INSERT em organization_members,
// organizações desmarcadas que existiam viram DELETE. Nunca substitui a
// tabela inteira às cegas (evita um DELETE+INSERT bruto que perderia
// created_at de vínculos não alterados).
//
// Exige que o chamador seja um admin (user_profiles.is_admin = true) —
// checado no início do handler, antes de qualquer escrita.

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
    const organizationIds: string[] = Array.isArray(body.organization_ids)
      ? body.organization_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];

    if (!userId) return jsonResponse({ error: "user_id obrigatório." }, 400);
    if (organizationIds.length === 0) {
      return jsonResponse({ error: "Selecione ao menos uma organização." }, 400);
    }

    const { data: currentMembers, error: currentError } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId);
    if (currentError) throw currentError;

    const currentIds = new Set((currentMembers ?? []).map((m) => m.organization_id));
    const nextIds = new Set(organizationIds);

    const toInsert = organizationIds.filter((id) => !currentIds.has(id));
    const toDelete = [...currentIds].filter((id) => !nextIds.has(id));

    if (toInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin.from("organization_members").insert(
        toInsert.map((organizationId) => ({ user_id: userId, organization_id: organizationId })),
      );
      if (insertError) throw insertError;
    }

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from("organization_members")
        .delete()
        .eq("user_id", userId)
        .in("organization_id", toDelete);
      if (deleteError) throw deleteError;
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[admin-update-user-organizations] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
