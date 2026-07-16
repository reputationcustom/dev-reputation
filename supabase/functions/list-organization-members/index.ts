// supabase/functions/list-organization-members/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — sem import
// relativo de `_shared/`. Achado real ao implementar o módulo
// `communications`: `user_profiles` só tem policy de SELECT pra própria
// linha (`user_profiles_select_own`, auth/data-model.md) e
// `organization_members` só pra própria associação
// (`organization_members_select_own`, foundation) — nenhum membro de
// organização consegue, via client direto, ver nome de outro colega da
// mesma organização. Isso bloqueava popular o select "Responsável" do
// formulário de Comunicação/Decisão e resolver
// `assignee_id`/`created_by` → nome na listagem/timeline.
//
// Diferente de admin-list-users (que lista TODOS os usuários da
// plataforma, `is_admin`-only): esta function é para qualquer membro da
// organização, escopada só aos membros da MESMA organização — não é uma
// ação administrativa, é o mesmo tipo de necessidade que já motivou
// `admin-list-users` combinar 3 tabelas numa resposta só, só que para um
// público bem mais amplo (qualquer membro, nunca toda a plataforma).
//
// Usa a chave secreta (bypassa RLS) porque a informação que precisa ler
// (nome de OUTROS membros da mesma organização) está, por design, fora do
// alcance de RLS para um usuário comum — a validação real é a checagem
// manual de `organization_members` abaixo, não a chave em si.

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
    const secretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, secretKey);

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonResponse({ error: "Não autenticado." }, 401);

    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    if (!organizationId) return jsonResponse({ error: "organizationId é obrigatório." }, 400);

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("organization_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (membershipError) {
      console.error("[list-organization-members] membership check failed", membershipError);
      return jsonResponse({ error: "Não foi possível carregar. Tente novamente." }, 500);
    }
    if (!membership) return jsonResponse({ error: "Você não tem acesso a esta organização." }, 403);

    const { data: members, error: membersError } = await supabaseAdmin
      .from("organization_members")
      .select("user_id, user_profiles(id, full_name)")
      .eq("organization_id", organizationId);

    if (membersError) {
      console.error("[list-organization-members] members query failed", membersError);
      return jsonResponse({ error: "Não foi possível carregar. Tente novamente." }, 500);
    }

    const users = (members ?? [])
      .map((row) => row.user_profiles as unknown as { id: string; full_name: string | null } | null)
      .filter((profile): profile is { id: string; full_name: string | null } => profile != null)
      .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));

    return jsonResponse({ members: users });
  } catch (err) {
    console.error("[list-organization-members] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
