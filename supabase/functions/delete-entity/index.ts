// supabase/functions/delete-entity/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — .dev/specs/entities/
// entity-registration.md, passo 9. DELETE definitivo em `entities`;
// `entity_accounts`/`entity_tags` são removidas via `on delete cascade`
// (ver data-model.md), nenhum delete explícito necessário aqui. Mesmo
// padrão de auth (chave secreta + Bearer token) de create-entity/update-entity.

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
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonResponse({ error: "Entidade não informada." }, 400);

    const { error } = await supabaseAdmin.from("entities").delete().eq("id", id);
    if (error) {
      console.error("[delete-entity] delete failed", error);
      return jsonResponse({ error: "Não foi possível excluir. Tente novamente." }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[delete-entity] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
