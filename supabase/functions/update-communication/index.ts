// supabase/functions/update-communication/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — sem import
// relativo de `_shared/`. Edita uma Comunicação ou Decisão já existente
// (.dev/specs/communications/communication-registration.md, "Fluxo
// principal" item 6) — `record_type`/`narrative_id` não são editáveis
// (trocar o tipo de um registro existente não é suportado: excluir e
// recriar).
//
// Mesmo padrão de autenticação de create-communication: chave publicável +
// JWT encaminhado, RLS continua valendo (a policy de UPDATE já escopa por
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

interface UpdateCommunicationBody {
  id?: string;
  title?: string;
  description?: string | null;
  occurred_at?: string;
  assignee_id?: string | null;
  communication_type_id?: string | null;
  channel_detail?: string | null;
  external_url?: string | null;
  bw_resource_id?: string | null;
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

    let body: UpdateCommunicationBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Corpo da requisição inválido." }, 400);
    }

    const id = body.id?.trim();
    const title = body.title?.trim();
    const occurredAt = body.occurred_at;

    if (!id) return jsonResponse({ error: "Registro inválido." }, 400);
    if (!title) return jsonResponse({ error: "Informe um título." }, 400);
    if (!occurredAt) return jsonResponse({ error: "Informe a data." }, 400);
    if (new Date(occurredAt).getTime() > Date.now()) {
      return jsonResponse({ error: "A data não pode ser no futuro." }, 400);
    }

    const { data: existing, error: fetchError } = await supabase
      .from("communications")
      .select("record_type")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) {
      console.error("[update-communication] fetch failed", fetchError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }
    if (!existing) return jsonResponse({ error: "Registro não encontrado." }, 404);

    const isDecision = existing.record_type === "decision";
    if (!isDecision && !body.communication_type_id) {
      return jsonResponse({ error: "Selecione o tipo de comunicação." }, 400);
    }

    const { error } = await supabase
      .from("communications")
      .update({
        title,
        description: body.description?.trim() || null,
        occurred_at: occurredAt,
        assignee_id: body.assignee_id || null,
        communication_type_id: isDecision ? null : body.communication_type_id || null,
        channel_detail: isDecision ? null : body.channel_detail?.trim() || null,
        external_url: isDecision ? null : body.external_url?.trim() || null,
        bw_resource_id: isDecision ? null : body.bw_resource_id?.trim() || null,
      })
      .eq("id", id);

    if (error) {
      console.error("[update-communication] update failed", error);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[update-communication] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
