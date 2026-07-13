// supabase/functions/delete-communication/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — sem import
// relativo de `_shared/`. Exclui uma Comunicação ou Decisão
// (.dev/specs/communications/communication-registration.md, "Fluxo
// principal" item 7) — exclusão é permitida mesmo com impacto já calculado
// em algum lugar (é só um registro histórico); a confirmação explícita
// fica no frontend (ConfirmDialog), não aqui.
//
// Mesmo padrão de autenticação de create-communication: chave publicável +
// JWT encaminhado, RLS continua valendo (a policy de DELETE já escopa por
// organização).

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
    if (!authHeader) return jsonResponse({ error: "Não autenticado." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "Não autenticado." }, 401);

    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return jsonResponse({ error: "Registro inválido." }, 400);

    const { error } = await supabase.from("communications").delete().eq("id", id);

    if (error) {
      console.error("[delete-communication] delete failed", error);
      return jsonResponse({ error: "Não foi possível excluir. Tente novamente." }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[delete-communication] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
