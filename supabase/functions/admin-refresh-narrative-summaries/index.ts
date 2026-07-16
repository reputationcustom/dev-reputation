// supabase/functions/admin-refresh-narrative-summaries/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md
// — sem import relativo de `_shared/`) — pedido do usuário: "permita que
// eu consiga executar a atualização do resumo executivo... por algo
// disponível na sessão do administrador." Força `narratives.description`
// a ser (re)gerado AGORA para toda Narrativa ativa de uma organização,
// ignorando a janela de staleness que `narrative-summary-composer` (o
// job de `pg_cron`, a cada 30min) sempre respeita — ver
// `foundation/narratives.md`, "Resumo executivo (produtor)".
//
// Duplica a lógica de composição de `narrative-summary-composer/index.ts`
// (mesmo SYSTEM_PROMPT/modelo/truncamento — Princípio técnico 5, mesma
// duplicação já aceita entre esse arquivo e `aggregated-metrics-service.ts`)
// — a única diferença real é a origem da lista de Narrativas
// (`narrative_summary_due_ids(p_organization_id, p_force=true)`, migration
// `20260809060000`, ignora as 4 condições de staleness de sempre) e o
// gate de autenticação (admin-only, mesmo padrão Bearer JWT →
// `supabaseAdmin.auth.getUser(token)` → checar `user_profiles.is_admin`
// já usado por todo `admin-*`) — diferente de `narrative-summary-composer`,
// que só o `pg_cron` chama (`verify_jwt = false`, sem CORS), esta function
// é chamada pelo browser autenticado, então precisa do gate de admin e de
// CORS.
//
// Roda de forma síncrona (não `scheduleBackground`) — é uma ação explícita
// do admin, disposto a esperar, mesmo padrão já usado por
// `compose-narrative-synthesis`. `MAX_BATCH_SIZE` limita o número de
// chamadas de IA sequenciais numa única invocação (evita estourar o tempo
// de resposta da Edge Function em organizações com muitas Narrativas) —
// se sobrar Narrativa "due" além do batch, o admin só clica de novo (mesmo
// padrão de "clique de novo pra continuar" já aceito em outras partes do
// produto, ex. backfill de mentions).

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

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

const MAX_BATCH_SIZE = 50;
const SUMMARY_MODEL = Deno.env.get("NARRATIVE_SUMMARY_MODEL") ?? "claude-haiku-4-5";
const SUMMARY_MAX_CHARS = 500;

// ✅ 2026-07-14 — user report: "as mensagens ainda aparecem cortadas no
// frontend". Mesma correção duplicada em narrative-summary-composer/
// aggregated-metrics-service.ts (Princípio técnico 5) — um
// `text.slice(0, N)` cru cortava no meio de palavra/frase quando o modelo
// respondia um pouco mais longo que o limite pedido no prompt. Prefere a
// última pontuação de fim de frase dentro do limite e, na ausência de
// uma, o último espaço — nunca corta no meio de uma palavra.
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

// Mesmo SYSTEM_PROMPT de narrative-summary-composer/index.ts, verbatim —
// manter os 2 em sincronia manualmente se um mudar (Princípio técnico 5).
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

// finops/data-model.md — mesmo registro de uso real de IA já duplicado em
// narrative-summary-composer/aggregated-metrics-service.ts/
// event-radar-agent-orchestrator (Princípio técnico 5).
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
  params: { model: string; inputTokens: number; outputTokens: number; organizationId: string; referenceId?: string | null },
): Promise<void> {
  const costUsd = computeAiCostUsd(params.model, params.inputTokens, params.outputTokens);
  const { error } = await supabase.from("ai_usage_log").insert({
    source: "narrative_summary_composer",
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: costUsd,
    organization_id: params.organizationId,
    reference_id: params.referenceId ?? null,
  });
  if (error) console.error("[ai-usage] recordAiUsage insert failed", error);
}

interface DueNarrative {
  narrative_id: string;
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
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    if (!organizationId) return jsonResponse({ error: "organization_id obrigatório." }, 400);

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      console.error("[admin-refresh-narrative-summaries] ANTHROPIC_API_KEY não configurada");
      return jsonResponse({ error: "Não foi possível gerar os resumos agora. Tente novamente." }, 500);
    }
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    const { data, error: dueError } = await supabaseAdmin.rpc("narrative_summary_due_ids", {
      p_batch_size: MAX_BATCH_SIZE,
      p_organization_id: organizationId,
      p_force: true,
    });
    if (dueError) {
      console.error("[admin-refresh-narrative-summaries] narrative_summary_due_ids failed", dueError);
      return jsonResponse({ error: "Não foi possível listar as Narrativas desta organização." }, 500);
    }
    const due = (data ?? []) as DueNarrative[];

    if (due.length === 0) {
      return jsonResponse({ ok: true, processed: 0, updated: 0 });
    }

    let processed = 0;
    let updated = 0;

    for (const { narrative_id: narrativeId } of due) {
      processed++;
      try {
        const { data: payload, error: payloadError } = await supabaseAdmin.rpc(
          "narrative_summary_build_payload",
          { p_narrative_id: narrativeId },
        );
        if (payloadError || !payload) {
          console.error("[admin-refresh-narrative-summaries] payload_failed", narrativeId, payloadError);
          continue;
        }

        const response = await anthropic.messages.create({
          model: SUMMARY_MODEL,
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Componha o resumo executivo desta Narrativa a partir dos dados a seguir:\n\n${JSON.stringify(payload)}`,
            },
          ],
        });

        await recordAiUsage(supabaseAdmin, {
          model: SUMMARY_MODEL,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          organizationId,
          referenceId: narrativeId,
        });

        if (response.stop_reason === "refusal") {
          console.error("[admin-refresh-narrative-summaries] refusal", narrativeId);
          continue;
        }

        const textBlock = response.content.find((block) => block.type === "text");
        if (!textBlock || textBlock.type !== "text") continue;

        const summary = truncateAtSentence(textBlock.text.trim(), SUMMARY_MAX_CHARS);
        if (!summary) continue;

        const { error: updateError } = await supabaseAdmin
          .from("narratives")
          .update({ description: summary, description_generated_at: new Date().toISOString() })
          .eq("id", narrativeId);
        if (updateError) {
          console.error("[admin-refresh-narrative-summaries] update_failed", narrativeId, updateError);
          continue;
        }
        updated++;
      } catch (err) {
        console.error("[admin-refresh-narrative-summaries] unexpected_error", narrativeId, err);
      }
    }

    return jsonResponse({ ok: true, processed, updated, hasMore: due.length === MAX_BATCH_SIZE });
  } catch (err) {
    console.error("[admin-refresh-narrative-summaries] unhandled error", err);
    return jsonResponse({ error: "Não foi possível atualizar os resumos agora. Tente novamente." }, 500);
  }
});
