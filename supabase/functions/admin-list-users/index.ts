// supabase/functions/admin-list-users/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Chamada pelo frontend de
// /admin/users (.dev/specs/auth/user-management.md) para popular a tabela
// de usuários da plataforma numa resposta só (auth.admin.listUsers() +
// user_profiles + organization_members/organizations), evitando 3 chamadas
// separadas do client.
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

    const { data: listResult, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000,
    });
    if (listError) throw listError;

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, is_admin, is_principal");
    if (profilesError) throw profilesError;

    const { data: organizations, error: organizationsError } = await supabaseAdmin
      .from("organizations")
      .select("id, name")
      .order("name");
    if (organizationsError) throw organizationsError;

    const { data: members, error: membersError } = await supabaseAdmin
      .from("organization_members")
      .select("user_id, organization_id");
    if (membersError) throw membersError;

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const organizationById = new Map((organizations ?? []).map((o) => [o.id, o]));
    const organizationsByUser = new Map<string, { id: string; name: string }[]>();
    for (const member of members ?? []) {
      const organization = organizationById.get(member.organization_id);
      if (!organization) continue;
      const list = organizationsByUser.get(member.user_id) ?? [];
      list.push(organization);
      organizationsByUser.set(member.user_id, list);
    }

    const now = Date.now();
    const users = listResult.users.map((authUser) => {
      const profile = profileById.get(authUser.id);
      const bannedUntilRaw = (authUser as { banned_until?: string | null }).banned_until;
      const bannedUntil = bannedUntilRaw ? new Date(bannedUntilRaw).getTime() : null;
      return {
        id: authUser.id,
        email: authUser.email ?? "",
        full_name: profile?.full_name ?? null,
        is_admin: profile?.is_admin ?? false,
        is_principal: profile?.is_principal ?? false,
        banned: bannedUntil !== null && !Number.isNaN(bannedUntil) && bannedUntil > now,
        organizations: organizationsByUser.get(authUser.id) ?? [],
      };
    });

    return jsonResponse({ users, organizations: organizations ?? [] });
  } catch (err) {
    console.error("[admin-list-users] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
