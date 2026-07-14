// supabase/functions/narrative-summary-composer/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md
// — sem import relativo de `_shared/`) — produtor de
// `narratives.description` ("Resumo executivo" do card/detalhe de
// Narrativa, ver `foundation/narratives.md` e
// `intelligence-center/narratives-exploration.md`, "Resumo executivo").
// Achado real desta sessão (2026-07-14): o campo estava reservado desde a
// primeira migration (`20260707000000`) mas nunca teve um produtor — toda
// Narrativa mostrava o fallback "Resumo automático ainda não disponível
// para esta Narrativa." indefinidamente.
//
// Diferente de `event-radar-agent-orchestrator` (evento → card, uma
// chamada de IA por evento, saída estruturada via JSON Schema), aqui a
// saída é só um parágrafo (mesmo padrão de
// `aggregated-metrics-service.ts`'s `composeLayer1NarrativeText`, Camada 1
// de `ai-synthesis.md`) — texto livre, nunca dado estruturado, porque o
// resultado é lido diretamente como `narratives.description`.
//
// Fluxo:
// 1. `narrative_summary_due_ids()` (SQL, migration `20260804010000`) —
//    Narrativas nunca resumidas, com resumo > 7 dias, ou com evento
//    novo do radar/Comunicação-Decisão desde o último resumo. Até
//    `NARRATIVE_SUMMARY_BATCH_SIZE` por invocação.
// 2. `narrative_summary_build_payload(id)` (SQL) — scores via
//    `get_narratives_table` (mesma fonte que a tabela/cards já mostram) +
//    eventos recentes do radar + Comunicações/Decisões recentes + (desde
//    2026-08-06, migration `20260806000000`) `sample_mentions`: até 8
//    mentions reais da Narrativa (`narrative_matched_mentions()`, mesma
//    janela de 30 dias dos scores, texto = coalesce(full_text, snippet)
//    truncado, ranqueadas por reach_estimate). Reverte, só pra este
//    produtor, a decisão original "nunca texto bruto de mentions" — pedido
//    explícito do usuário pra IA explicar do que a Narrativa trata e o que
//    está acontecendo nela, não só os scores. Uso é qualitativo (contexto
//    de conteúdo), nunca estatístico — ver regra correspondente no
//    SYSTEM_PROMPT abaixo e o comentário da function no banco.
// 3. Uma chamada ao Claude por Narrativa, texto livre, guardado por
//    truncamento defensivo (nunca só confiado ao prompt). Tom da
//    composição segue a skill `humanizer-pt-br` (instalada 2026-08-06,
//    `.agents/skills/humanizer-pt-br/` — pedido explícito do usuário),
//    reforçada como instrução direta no SYSTEM_PROMPT (mesmo padrão já
//    usado por `event-radar-agent-orchestrator`/Camada 1 de
//    `ai-synthesis.md`, já que a skill em si é um guia interativo de
//    edição, não um trecho de prompt colável na API da Anthropic).
// 4. `update narratives set description = ..., description_generated_at =
//    now()` — só em caso de sucesso (falha na composição não escreve
//    nada, mesmo tratamento de `composeAndPersistLayer1`).
//
// Modelo: Claude Haiku 4.5 (`claude-haiku-4-5`) — mesma decisão de custo já
// tomada para `event-radar-agent-orchestrator` (2026-07-31) e para a
// Camada 1 de `ai-synthesis.md` ("não analisa dados, só reescreve/conecta
// texto que já existe" — a mesma lógica se aplica aqui, com a diferença de
// que a fonte aqui é dado agregado estruturado, não resumos já prontos).
// Configurável via `NARRATIVE_SUMMARY_MODEL` (secret próprio da Edge
// Function, não reaproveita `AI_SYNTHESIS_MODEL`/`EVENT_RADAR_AGENT_MODEL`
// — mesmo padrão de secret dedicado por job já usado pelos outros dois).
//
// Acionada só por `pg_cron` (`net.http_post`, migration `20260804010000`),
// nunca pelo frontend — por isso sem CORS; `verify_jwt = false` em
// `supabase/config.toml` pelo mesmo motivo (ver bw-sync/
// event-radar-agent-orchestrator acima).
//
// ⚠️ Não testado contra a API real da Anthropic nem do Supabase nesta
// sessão (sem credenciais/ambiente disponíveis) — revisado manualmente.

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

function log(step: string, data?: Record<string, unknown>) {
  console.log(`[narrative-summary-composer] ${step}`, data ? JSON.stringify(data) : "");
}
function logError(step: string, err: unknown) {
  console.error(
    `[narrative-summary-composer] ${step}`,
    err instanceof Error ? err.message : String(err),
  );
}

// Quantas Narrativas processar por invocação — cadência de 30min (menos
// urgente que o heartbeat de 15min de bw-sync/event-radar, ver comentário
// da migration 20260804010000), evitando uma invocação longa. Inferência
// de MVP, configurável sem nova migration.
const SUMMARY_BATCH_SIZE = Number(Deno.env.get("NARRATIVE_SUMMARY_BATCH_SIZE") ?? "5");
const SUMMARY_MODEL = Deno.env.get("NARRATIVE_SUMMARY_MODEL") ?? "claude-haiku-4-5";
const SUMMARY_MAX_CHARS = 500;

// ✅ 2026-07-14 — user report: "as mensagens ainda aparecem cortadas no
// frontend". Mesma correção duplicada em aggregated-metrics-service.ts/
// admin-refresh-narrative-summaries (Princípio técnico 5) — um
// `text.slice(0, N)` cru cortava no meio de palavra/frase quando o modelo
// respondia um pouco mais longo que o limite pedido no prompt (comum, o
// limite é uma instrução, não uma garantia). Prefere a última pontuação de
// fim de frase dentro do limite e, na ausência de uma, o último espaço —
// nunca corta no meio de uma palavra.
function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const minAcceptable = maxChars * 0.5;
  let lastSentenceEnd = -1;
  for (const terminator of [". ", "! ", "? ", ".\n", "!\n", "?\n"]) {
    lastSentenceEnd = Math.max(lastSentenceEnd, slice.lastIndexOf(terminator));
  }
  if (lastSentenceEnd >= minAcceptable) {
    return slice.slice(0, lastSentenceEnd + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= minAcceptable) {
    return `${slice.slice(0, lastSpace).trim()}…`;
  }
  return `${slice.trim()}…`;
}

const SYSTEM_PROMPT = `Você é um redator de comunicação para uma campanha política/monitoramento de reputação, escrevendo em português do Brasil. Você recebe dados agregados já calculados sobre uma Narrativa (scores de share of voice, sentimento, momentum, tendência e risco, tópicos que puxam sentimento positivo/negativo, eventos recentes e Comunicações/Decisões já registradas) e uma pequena amostra de mentions reais ("sample_mentions") — e escreve um resumo executivo curto para a equipe de comunicação.

Regras obrigatórias:
- Use "sample_mentions" para explicar do que a Narrativa trata e o que está acontecendo nela em termos concretos (fatos, eventos, ângulos específicos que aparecem nas mentions) — não fique só repetindo os scores.
- "sample_mentions" é uma amostra pequena, NÃO estatística: nunca a use para afirmar proporções/percentuais ("a maioria das menções...", "quase todas as publicações..."). Para qualquer número, use exclusivamente os campos de "scores".
- NUNCA invente números, causas ou correlações que não estejam no payload fornecido. Use apenas os dados recebidos.
- Diferencie correlação de causa: use linguagem como "associado a" ou "coincide com" quando a evidência for insuficiente para afirmar causalidade direta.
- Tom (skill humanizer-pt-br): direto e humano, não robótico. Vá direto ao ponto, sem abertura nem frase de efeito, sem "gancho" dramático. Frases curtas; varie o ritmo. Declare os fatos — nunca "sinalize" importância com frases como "desempenha papel fundamental", "reflete uma tendência mais ampla", "representa um marco". Proibido: "além disso", "nesse sentido", "é importante destacar/ressaltar", "cabe salientar", travessão decorativo, atribuição vaga ("especialistas apontam", "observadores notam"), conclusão genérica/otimista ("o cenário é promissor"), gerúndio final pra simular profundidade ("destacando...", "reforçando..."), listas forçadas de exatamente 3 itens.
- 3 a 5 frases no total, no máximo 500 caracteres — seja objetivo e eficiente, não preencha espaço.
- Mencione o sentimento predominante e o nível de risco quando relevantes, mas não repita os números crus (a tela já mostra os números ao lado do texto) — descreva o que eles significam.
- Se "recent_events", "recent_communications" ou "sample_mentions" estiverem vazios, não mencione a ausência deles — apenas descreva o estado atual da Narrativa a partir do que estiver disponível.
- Responda apenas com o parágrafo final, sem títulos, sem marcadores, sem aspas envolvendo o texto.`;

interface DueNarrative {
  narrative_id: string;
}

// finops/data-model.md — registro de uso real de IA (nunca estimativa),
// gravado a partir do `usage` retornado pela própria API da Anthropic.
// Duplicado em cada Edge Function que chama Claude (Princípio técnico 5) —
// `event-radar-agent-orchestrator/index.ts` e `aggregated-metrics-service.ts`
// têm suas próprias cópias idênticas. Achado real (2026-08-05): esta
// function nunca tinha esse registro, apesar de já existir e chamar a
// Anthropic desde 2026-07-14 — o painel /admin/finops (criado depois,
// 2026-08-05) só instrumentou os outros dois pontos de chamada, deixando
// o custo desta function (a única das três sem gate condicional de dado —
// roda a cada 30min processando toda Narrativa "due") de fora do painel.
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
  supabase: ReturnType<typeof createClient>,
  params: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    referenceId?: string | null;
  },
): Promise<void> {
  const costUsd = computeAiCostUsd(params.model, params.inputTokens, params.outputTokens);
  const { error } = await supabase.from("ai_usage_log").insert({
    source: "narrative_summary_composer",
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: costUsd,
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

  let due: DueNarrative[];
  try {
    const { data, error } = await supabase.rpc("narrative_summary_due_ids", {
      p_batch_size: SUMMARY_BATCH_SIZE,
    });
    if (error) throw error;
    due = (data ?? []) as DueNarrative[];
  } catch (err) {
    logError("invocation:fetch_due_failed", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (due.length === 0) {
    log("invocation:no_due_narratives");
    return new Response(JSON.stringify({ ok: true, processed: 0, updated: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let updated = 0;

  for (const { narrative_id: narrativeId } of due) {
    try {
      const { data: payload, error: payloadError } = await supabase.rpc(
        "narrative_summary_build_payload",
        { p_narrative_id: narrativeId },
      );
      if (payloadError || !payload) {
        // Sem payload (Narrativa some entre a listagem e aqui, por
        // exemplo) — não é um erro de composição, só nada a fazer agora;
        // reavaliada na próxima invocação via narrative_summary_due_ids.
        logError("narrative:payload_failed", {
          narrativeId,
          error: payloadError?.message ?? "payload nulo",
        });
        continue;
      }

      const response = await anthropic.messages.create({
        model: SUMMARY_MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Componha o resumo executivo desta Narrativa a partir dos dados a seguir:\n\n${
              JSON.stringify(payload)
            }`,
          },
        ],
      });

      // finops/data-model.md — grava o uso real (billado pela Anthropic
      // independente do que acontece depois: refusal, parse, update etc.)
      await recordAiUsage(supabase, {
        model: SUMMARY_MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        referenceId: narrativeId,
      });

      if (response.stop_reason === "refusal") {
        logError("narrative:refusal", { narrativeId, stopReason: response.stop_reason });
        continue;
      }

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        logError("narrative:no_text_block", { narrativeId, stopReason: response.stop_reason });
        continue;
      }

      const summary = truncateAtSentence(textBlock.text.trim(), SUMMARY_MAX_CHARS);
      if (!summary) {
        logError("narrative:empty_summary", { narrativeId });
        continue;
      }

      const { error: updateError } = await supabase
        .from("narratives")
        .update({ description: summary, description_generated_at: new Date().toISOString() })
        .eq("id", narrativeId);
      if (updateError) {
        // A IA já rodou (custo pago) mas a gravação falhou — não marca
        // sucesso; narrative_summary_due_ids() reavalia esta Narrativa na
        // próxima invocação (description_generated_at continua null/velho),
        // aceitando o custo de uma nova chamada em troca de nunca perder
        // silenciosamente um resumo já composto.
        logError("narrative:update_failed", { narrativeId, error: updateError.message });
        continue;
      }
      updated++;
      processed++;
    } catch (err) {
      logError("narrative:unexpected_error", {
        narrativeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log("invocation:done", { processed, updated, due: due.length });
  return new Response(JSON.stringify({ ok: true, processed, updated }), {
    headers: { "Content-Type": "application/json" },
  });
});
