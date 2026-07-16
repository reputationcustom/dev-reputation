// supabase/functions/create-communication/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Registra uma Comunicação ou Decisão
// (.dev/specs/communications/communication-registration.md), vinculada a
// uma Narrativa.
//
// Client com chave publicável + JWT do usuário encaminhado (não a chave
// secreta) — mesmo padrão de exceção de
// aggregated-metrics/edge-functions-per-page.md: RLS continua valendo (o
// INSERT só passa se `communications_set_organization` derivar um
// organization_id que o usuário integra, via auth_organization_ids()); a
// Edge Function existe para validar campos e traduzir erro em mensagem
// amigável, não para bypassar isolamento multi-tenant.

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

interface CreateCommunicationBody {
  narrative_id?: string;
  record_type?: string;
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

    let body: CreateCommunicationBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Corpo da requisição inválido." }, 400);
    }

    const narrativeId = body.narrative_id?.trim();
    const title = body.title?.trim();
    const occurredAt = body.occurred_at;
    const recordType = body.record_type;

    if (!narrativeId) return jsonResponse({ error: "Selecione uma Narrativa." }, 400);
    if (!title) return jsonResponse({ error: "Informe um título." }, 400);
    if (!occurredAt) return jsonResponse({ error: "Informe a data." }, 400);
    if (recordType !== "communication" && recordType !== "decision") {
      return jsonResponse({ error: "Tipo de registro inválido." }, 400);
    }
    if (new Date(occurredAt).getTime() > Date.now()) {
      return jsonResponse({ error: "A data não pode ser no futuro." }, 400);
    }
    if (recordType === "communication" && !body.communication_type_id) {
      return jsonResponse({ error: "Selecione o tipo de comunicação." }, 400);
    }

    // Defesa em profundidade além do CHECK constraint do banco (ver
    // data-model.md): campos exclusivos de Comunicação nunca são gravados
    // numa Decisão, mesmo que o client envie algo.
    const isDecision = recordType === "decision";

    const { data, error } = await supabase
      .from("communications")
      .insert({
        narrative_id: narrativeId,
        record_type: recordType,
        title,
        description: body.description?.trim() || null,
        occurred_at: occurredAt,
        assignee_id: body.assignee_id || null,
        created_by: userData.user.id,
        communication_type_id: isDecision ? null : body.communication_type_id || null,
        channel_detail: isDecision ? null : body.channel_detail?.trim() || null,
        external_url: isDecision ? null : body.external_url?.trim() || null,
        bw_resource_id: isDecision ? null : body.bw_resource_id?.trim() || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[create-communication] insert failed", error);
      if (error.code === "42501") {
        return jsonResponse({ error: "Você não tem acesso a esta Narrativa." }, 403);
      }
      return jsonResponse({ error: "Não foi possível registrar. Tente novamente." }, 500);
    }

    return jsonResponse({ success: true, id: data.id });
  } catch (err) {
    console.error("[create-communication] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
