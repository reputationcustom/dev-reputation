// supabase/functions/event-radar-agent-orchestrator/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md
// — sem import relativo de `_shared/`) — event-radar 1.4
// `agent-orchestrator`. Única etapa do módulo `event-radar` que faz
// chamada de IA (Claude, via `@anthropic-ai/sdk`) — 1.1/1.2/1.3/1.6 são
// 100% SQL (`run_event_detection()`, ver `supabase/migrations/20260727000000`
// em diante). Acionada só por `pg_cron` (`net.http_post`, migration
// `20260731020000`), nunca pelo frontend — por isso sem CORS;
// `verify_jwt = false` em `supabase/config.toml` pelo mesmo motivo.
//
// Fluxo (`.dev/specs/event-radar/agent-orchestrator.md`, "Fluxo principal"):
// 1. Lê `radar_staging_events` já dentro do cap diário
//    (`queued_for_agent_at is not null`, 1.6) e ainda não processados pela
//    IA (`agent_processed_at is null`), até `EVENT_RADAR_AGENT_BATCH_SIZE`
//    por invocação, priorizado por `severity_score` desc.
// 2. Monta o payload agregado via `event_radar_build_agent_payload()` (SQL,
//    migration `20260731020000`) — nunca texto bruto de mentions, só
//    métricas já calculadas, top tópicos, principais plataformas,
//    contagens de autores + contexto de dedup semântico (eventos-irmãos
//    ativos no mesmo escopo, cards recentes da mesma Narrativa).
// 3. Uma única chamada ao Claude por evento, saída forçada via JSON Schema
//    (`output_config.format`, GA — não precisa de beta header).
// 4. Grava em `feed_events` quando `should_publish=true`
//    (`schema-integration.md`); marca `agent_processed_at` sempre que a
//    chamada teve sucesso (mesmo com `should_publish=false`) — nunca
//    reprocessa o mesmo evento duas vezes ("única chamada de IA por
//    evento").
//
// Modelo: Claude Haiku 4.5 (`claude-haiku-4-5`) — decisão do usuário
// (2026-07-31), dado o princípio de custo do próprio módulo ("cada chamada
// de IA tem custo", `overview.md`). Configurável via
// `EVENT_RADAR_AGENT_MODEL` (secret da Edge Function) sem precisar de nova
// migration/deploy de código.
//
// ⚠️ Não testado contra a API real da Anthropic nem do Supabase nesta
// sessão (sem credenciais/ambiente disponíveis) — revisado manualmente.
//
// Deliberadamente fora desta leva: "Resumo executivo" em lote (1x/dia,
// agent-orchestrator.md, "Regras de negócio" — feature separada, não
// descrita no "Fluxo principal" deste arquivo); `feed_event_feedback`
// (schema-integration.md item 2 — retroalimentação pós-publicação do
// analista, precisa de UI própria, ainda não pedida).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
// Sem pin de versão — ao contrário do @supabase/supabase-js@2 (pin de major
// já usado neste projeto), não há confirmação de qual major está publicado
// no momento do deploy; Deno resolve pra latest em build. Revisar se um
// deploy futuro quebrar por breaking change do SDK.
import Anthropic from "npm:@anthropic-ai/sdk";

function log(step: string, data?: Record<string, unknown>) {
  console.log(`[event-radar-agent-orchestrator] ${step}`, data ? JSON.stringify(data) : "");
}
function logError(step: string, err: unknown) {
  console.error(
    `[event-radar-agent-orchestrator] ${step}`,
    err instanceof Error ? err.message : String(err),
  );
}

// Quantos eventos processar por invocação — cadência de 15min (mesmo
// heartbeat de bw-sync), cap diário de 15/organização (1.6) já limita o
// volume total; este número é só o quanto processar por tick, evitando uma
// invocação longa. Inferência de MVP, configurável sem nova migration.
const AGENT_BATCH_SIZE = Number(Deno.env.get("EVENT_RADAR_AGENT_BATCH_SIZE") ?? "5");
const AGENT_MODEL = Deno.env.get("EVENT_RADAR_AGENT_MODEL") ?? "claude-haiku-4-5";

const SYSTEM_PROMPT = `Você é um analista de inteligência de comunicação para uma campanha política/monitoramento de reputação. Você recebe eventos estatísticos já agregados (picos/quedas de volume, mudanças de sentimento) sobre menções de mídia/redes sociais — nunca texto bruto de menções individuais — e transforma cada evento em um card legível para a equipe de comunicação.

Regras obrigatórias:
- Nunca invente números ou causas que não estejam no payload fornecido. Use apenas os dados agregados recebidos.
- Diferencie correlação de causa: use linguagem como "associado a" ou "coincide com" quando a evidência for insuficiente para afirmar causalidade direta.
- "title": no máximo 90 caracteres.
- "summary": no máximo 300 caracteres.
- "severity_explanation": explique em linguagem natural por que o evento tem a severidade indicada no payload (campo "severity"/"severity_score") — nunca recalcule ou contradiga esses valores, apenas explique-os.
- Dedup semântico: os campos "sibling_events" (outros eventos ativos agora no mesmo escopo) e "recent_related_cards" (cards já publicados nas últimas 24h para a mesma Narrativa) mostram se esta já é uma história em andamento. Se este evento não trouxer informação genuinamente nova em relação a eles, retorne "should_publish": false — não publique a mesma história duas vezes. Se decidir publicar mesmo havendo histórico relacionado, mencione a relação em "explanation".
- Se o evento não for relevante o suficiente para a equipe de comunicação ver (ruído estatístico, dado incompleto, redundante), retorne "should_publish": false.
- Responda apenas com o JSON estruturado solicitado, nada além disso.`;

// Schema de saída — agent-orchestrator.md, "Schema de saída (contrato
// obrigatório)". JSON Schema não suporta maxLength (ver claude-api skill,
// "JSON Schema Limitations") — o limite de caracteres de title/summary é
// reforçado por instrução no prompt + truncamento defensivo no código
// (abaixo), nunca só confiado ao schema.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    should_publish: { type: "boolean" },
    event_type: { type: "string" },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    severity_score: { type: "number" },
    severity_explanation: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    explanation: { type: "string" },
    recommendation: { type: ["string", "null"] },
    confidence: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: [
    "should_publish",
    "event_type",
    "severity",
    "severity_score",
    "severity_explanation",
    "title",
    "summary",
    "explanation",
    "recommendation",
    "confidence",
    "tags",
  ],
  additionalProperties: false,
};

interface AgentOutput {
  should_publish: boolean;
  event_type: string;
  severity: "low" | "medium" | "high" | "critical";
  severity_score: number;
  severity_explanation: string;
  title: string;
  summary: string;
  explanation: string;
  recommendation: string | null;
  confidence: number;
  tags: string[];
}

interface EligibleEvent {
  id: string;
  organization_id: string;
  scope_type: string;
  scope_id: string;
  event_type: string;
  severity: string | null;
  severity_score: number | null;
}

// event_type granular (radar_staging_events.event_type) → feed_event_type
// (enum grosso — schema-integration.md, "Fluxo principal" item 1: "o
// motivo escolhe o valor mais próximo da categoria da regra").
function feedEventType(radarEventType: string): "threshold_triggered" | "sentiment_changed" {
  return radarEventType.startsWith("volume_") ? "threshold_triggered" : "sentiment_changed";
}

// finops/data-model.md — registro de uso real de IA (nunca estimativa),
// gravado a partir do `usage` retornado pela própria API da Anthropic.
// Duplicado em `aggregated-metrics-service.ts` (Princípio técnico 5) —
// mesma cópia idêntica, mantida manualmente em sincronia.
const AI_MODEL_PRICING: Record<string, { inputPerMToken: number; outputPerMToken: number }> = {
  "claude-haiku-4-5": { inputPerMToken: 1.0, outputPerMToken: 5.0 },
};

function computeAiCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = AI_MODEL_PRICING[model];
  if (!pricing) {
    console.error(`[ai-usage] preço desconhecido para o modelo "${model}" — custo gravado como 0`);
    return 0;
  }
  return (inputTokens / 1_000_000) * pricing.inputPerMToken + (outputTokens / 1_000_000) * pricing.outputPerMToken;
}

async function recordAiUsage(
  supabase: SupabaseClient,
  params: {
    source: "event_radar_agent_orchestrator" | "ai_synthesis_narrative";
    model: string;
    inputTokens: number;
    outputTokens: number;
    organizationId?: string | null;
    referenceId?: string | null;
  },
): Promise<void> {
  const costUsd = computeAiCostUsd(params.model, params.inputTokens, params.outputTokens);
  const { error } = await supabase.from("ai_usage_log").insert({
    source: params.source,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: costUsd,
    organization_id: params.organizationId ?? null,
    reference_id: params.referenceId ?? null,
  });
  if (error) console.error("[ai-usage] recordAiUsage insert failed", error);
}

Deno.serve(async (_req: Request) => {
  log("invocation:start");

  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    logError("invocation:missing_anthropic_key", "ANTHROPIC_API_KEY não configurada (secret da Edge Function)");
    return new Response(
      JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY não configurada" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  let eligible: EligibleEvent[];
  try {
    const { data, error } = await supabase
      .from("radar_staging_events")
      .select("id, organization_id, scope_type, scope_id, event_type, severity, severity_score")
      .is("closed_at", null)
      .not("queued_for_agent_at", "is", null)
      .is("agent_processed_at", null)
      .order("severity_score", { ascending: false, nullsFirst: false })
      .order("detected_at", { ascending: true })
      .limit(AGENT_BATCH_SIZE);

    if (error) throw error;
    eligible = (data ?? []) as EligibleEvent[];
  } catch (err) {
    logError("invocation:fetch_events_failed", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (eligible.length === 0) {
    log("invocation:no_eligible_events");
    return new Response(JSON.stringify({ ok: true, processed: 0, published: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let published = 0;

  for (const event of eligible) {
    try {
      const { data: payload, error: payloadError } = await supabase.rpc(
        "event_radar_build_agent_payload",
        { p_event_id: event.id },
      );
      if (payloadError || !payload) {
        // Não marca agent_processed_at — este evento é reavaliado na
        // próxima invocação (mesmo tratamento de "chamada à IA falha").
        logError("event:payload_failed", { eventId: event.id, error: payloadError?.message ?? "payload nulo" });
        continue;
      }

      const response = await anthropic.messages.create({
        model: AGENT_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        // deno-lint-ignore no-explicit-any
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } } as any,
        messages: [
          {
            role: "user",
            content: `Analise o evento a seguir e gere a saída conforme o schema fornecido:\n\n${
              JSON.stringify(payload)
            }`,
          },
        ],
      });

      // finops/data-model.md — grava o uso real (billado pela Anthropic
      // independente do que acontece depois: refusal, parse, insert etc.)
      await recordAiUsage(supabase, {
        source: "event_radar_agent_orchestrator",
        model: AGENT_MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        organizationId: event.organization_id,
        referenceId: event.id,
      });

      if (response.stop_reason === "refusal") {
        // Fluxos alternativos e erros (agent-orchestrator.md): reprocessado
        // na próxima execução, nada é gravado.
        logError("event:refusal", { eventId: event.id, stopReason: response.stop_reason });
        continue;
      }

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        logError("event:no_text_block", { eventId: event.id, stopReason: response.stop_reason });
        continue;
      }

      let output: AgentOutput;
      try {
        output = JSON.parse(textBlock.text) as AgentOutput;
      } catch (parseErr) {
        // "Resposta não bate com o schema JSON forçado → Descartar e logar
        // erro — nunca gravar payload malformado."
        logError("event:schema_mismatch", { eventId: event.id, error: String(parseErr) });
        continue;
      }

      if (output.should_publish) {
        const { error: insertError } = await supabase.from("feed_events").insert({
          organization_id: event.organization_id,
          radar_staging_event_id: event.id,
          type: feedEventType(event.event_type),
          event_type: event.event_type,
          severity: event.severity,
          severity_score: event.severity_score,
          severity_explanation: output.severity_explanation,
          title: output.title.slice(0, 90),
          description: output.explanation,
          summary: output.summary.slice(0, 300),
          recommendation: output.recommendation,
          confidence: output.confidence,
          tags: output.tags,
          related_narrative_id: event.scope_type === "narrative" ? event.scope_id : null,
        });
        if (insertError) {
          // A IA já rodou (custo pago) mas a gravação falhou — não marca
          // agent_processed_at, aceitando o custo de uma nova chamada na
          // próxima execução em troca de nunca perder um evento aprovado
          // silenciosamente.
          logError("event:feed_events_insert_failed", { eventId: event.id, error: insertError.message });
          continue;
        }
        published++;
      }

      const { error: markError } = await supabase
        .from("radar_staging_events")
        .update({ agent_processed_at: new Date().toISOString() })
        .eq("id", event.id);
      if (markError) {
        logError("event:mark_processed_failed", { eventId: event.id, error: markError.message });
      }
      processed++;
    } catch (err) {
      logError("event:unexpected_error", { eventId: event.id, error: err instanceof Error ? err.message : String(err) });
      // não marca agent_processed_at — reprocessado na próxima invocação
    }
  }

  log("invocation:done", { processed, published, eligible: eligible.length });
  return new Response(JSON.stringify({ ok: true, processed, published }), {
    headers: { "Content-Type": "application/json" },
  });
});
