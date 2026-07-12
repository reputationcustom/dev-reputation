// supabase/functions/update-my-timezone/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Único endpoint de escrita
// self-service em user_profiles (CLAUDE.md, "Fuso horário do usuário",
// campo timezone em /perfil): o próprio usuário atualizando o seu fuso
// horário de exibição. Diferente das 6 Edge Functions `admin-*`, não é uma
// ação administrativa — qualquer usuário autenticado pode chamar, mas
// sempre restrito à própria linha (`id = auth.getUser(token).id`), nunca
// um user_id recebido no body.
//
// Validação de fuso horário via Intl.supportedValuesOf('timeZone') (ICU
// embutido no runtime do Deno) em vez de uma consulta a pg_timezone_names —
// essa view do catálogo do Postgres não é alcançável via PostgREST (só
// schemas em db.schemas: public/graphql_public), então validar no runtime
// da própria function evita um RPC só para isso.

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
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";

    if (!timezone) return jsonResponse({ error: "Fuso horário obrigatório." }, 400);

    // @ts-expect-error — Intl.supportedValuesOf existe no runtime Deno
    // (ICU), mas pode não estar nos tipos do lib.dom/lib.es usados aqui.
    const validTimezones: string[] = Intl.supportedValuesOf("timeZone");
    if (!validTimezones.includes(timezone)) {
      return jsonResponse({ error: "Fuso horário inválido." }, 400);
    }

    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({ timezone })
      .eq("id", user.id);

    if (updateError) {
      // Nunca devolver updateError.message bruto ao cliente — jargão de
      // schema/Postgres, não faz sentido pro usuário final (CLAUDE.md,
      // "Edge Functions nunca vazam erro técnico ao cliente").
      console.error("[update-my-timezone] update failed", updateError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    return jsonResponse({ success: true, timezone });
  } catch (err) {
    console.error("[update-my-timezone] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
