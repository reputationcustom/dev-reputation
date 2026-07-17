// supabase/functions/update-my-profile/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Quinta escrita self-service em
// `user_profiles` (depois de `update-my-timezone`/`update-my-default-organization`/
// `update-my-refresh-button-preference` — ver `.dev/specs/auth/data-model.md`)
// — o próprio usuário editando seu nome/telefone/avatar. Sempre restrito à
// própria linha (`id = auth.getUser(token).id`), nunca um user_id recebido
// no body.
//
// Cada um dos 3 campos é opcional e independente — só é validado/gravado
// quando a chave correspondente está presente no body (permite salvar só
// nome, só telefone, ou os dois juntos; o upload de avatar em si acontece
// direto do client pro bucket `avatars` via supabase-js, este endpoint só
// persiste a `avatar_url` resultante em `user_profiles`).

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

const MAX_FULL_NAME_LENGTH = 200;
const MAX_AVATAR_URL_LENGTH = 2048;
// Loose validation — dígitos, espaço, +()- , 8 a 20 caracteres. Nunca
// exige um formato regional específico (o produto atende campanhas em
// todo o Brasil, sem padronizar DDI/DDD aqui).
const PHONE_PATTERN = /^[0-9+()\-\s]{8,20}$/;

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
    const updates: Record<string, string | null> = {};

    if (Object.prototype.hasOwnProperty.call(body, "full_name")) {
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      if (!fullName) {
        return jsonResponse({ error: "Nome não pode ficar vazio." }, 400);
      }
      if (fullName.length > MAX_FULL_NAME_LENGTH) {
        return jsonResponse({ error: "Nome muito longo." }, 400);
      }
      updates.full_name = fullName;
    }

    if (Object.prototype.hasOwnProperty.call(body, "phone")) {
      const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
      if (!rawPhone) {
        updates.phone = null;
      } else if (!PHONE_PATTERN.test(rawPhone)) {
        return jsonResponse({ error: "Telefone inválido." }, 400);
      } else {
        updates.phone = rawPhone;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "avatar_url")) {
      const rawAvatarUrl = typeof body.avatar_url === "string" ? body.avatar_url.trim() : "";
      if (!rawAvatarUrl) {
        updates.avatar_url = null;
      } else if (!/^https?:\/\//i.test(rawAvatarUrl) || rawAvatarUrl.length > MAX_AVATAR_URL_LENGTH) {
        return jsonResponse({ error: "Avatar inválido." }, 400);
      } else {
        updates.avatar_url = rawAvatarUrl;
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "Nenhum campo para atualizar." }, 400);
    }

    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update(updates)
      .eq("id", user.id);

    if (updateError) {
      // Nunca devolver updateError.message bruto ao cliente (CLAUDE.md,
      // "Edge Function error handling").
      console.error("[update-my-profile] update failed", updateError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    return jsonResponse({ success: true, ...updates });
  } catch (err) {
    console.error("[update-my-profile] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
