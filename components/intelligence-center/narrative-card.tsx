import Link from "next/link";
import type { NarrativeRow } from "@reputation/shared-types";
import { RiskBadge, MomentumBadge } from "./score-badges";

// Card de Narrativa — pedido do usuário 2026-07-21 (referência visual
// anexada): borda esquerda colorida pelo sentimento (só 3 estados —
// vermelho/verde/neutro, não as 7 faixas finas de SentimentBadge — pedido
// explícito do usuário), SOV + menções em destaque, resumo textual
// (reservado pra IA — ai-synthesis, sprint futura, ver
// foundation/narratives.md "Resumo executivo"), barra de sentimento
// positivo/neutro/negativo e tags (termos/hashtags reais de
// bw_query_topics via get_narratives_table — nunca um marcador de "emoção",
// sem fonte não-amostrada pra isso, ver a migration 20260721010000).
// Reusado por toda tela que lista Narrativas em formato de card (lista de
// Narrativas sem seleção, "Top 3 Narrativas" da Visão Geral) — não
// duplicar este layout por página.
//
// ✅ **2026-07-21, revisão do usuário**: a barra de risco em largura total
// (logo abaixo do título) foi removida — lida sozinha, sem o contexto do
// número/faixa por perto, ela ficava sem sentido claro ("por que uma barra
// amarela?"). No lugar, o Momentum aparece como uma segunda tag ao lado do
// badge de Risco, no cabeçalho — mesmo padrão visual (pill colorida),
// informação equivalente, mais legível.
const SENTIMENT_BORDER: Record<string, string> = {
  very_positive: "border-l-sentiment-positive",
  positive: "border-l-sentiment-positive",
  slightly_positive: "border-l-sentiment-positive",
  neutral: "border-l-sentiment-neutral",
  slightly_negative: "border-l-sentiment-negative",
  negative: "border-l-sentiment-negative",
  very_negative: "border-l-sentiment-negative",
};

function formatMentions(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function NarrativeCard({ narrative }: { narrative: NarrativeRow }) {
  const borderClass = SENTIMENT_BORDER[narrative.sentiment_label] ?? "border-l-sentiment-neutral";

  const hasSentimentSplit =
    narrative.sentiment_positive_pct !== null &&
    narrative.sentiment_neutral_pct !== null &&
    narrative.sentiment_negative_pct !== null;

  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-border-default border-l-4 ${borderClass} bg-bg-card p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-text-primary">{narrative.title}</h3>
          {narrative.risk_label && <RiskBadge score={narrative.risk_score} label={narrative.risk_label} />}
          <MomentumBadge score={narrative.momentum_score} />
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-2xl font-extrabold text-text-primary">
            {narrative.sov_pct === null ? "—" : `${narrative.sov_pct}%`}
          </div>
          <div className="whitespace-nowrap text-xs text-text-tertiary">
            {formatMentions(narrative.total_mentions ?? 0)} menções
          </div>
        </div>
      </div>

      {/* Resumo textual — reservado pra síntese por IA (ai-synthesis, sprint
          futura). Hoje sempre vazio (narratives.description ainda sem
          produtor) — o frontend já lê/exibe o campo pra estar pronto assim
          que essa sprint futura o popular, sem mudança de contrato. */}
      {narrative.summary ? (
        <p className="text-sm text-text-secondary">{narrative.summary}</p>
      ) : (
        <p className="text-sm italic text-text-tertiary">Resumo automático ainda não disponível para esta Narrativa.</p>
      )}

      {hasSentimentSplit && (
        <div className="flex flex-col gap-1.5">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-border-subtle-2">
            <div className="h-full bg-sentiment-positive" style={{ width: `${narrative.sentiment_positive_pct}%` }} />
            <div className="h-full bg-sentiment-neutral" style={{ width: `${narrative.sentiment_neutral_pct}%` }} />
            <div className="h-full bg-sentiment-negative" style={{ width: `${narrative.sentiment_negative_pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-text-secondary">
            <span>
              pos <b className="text-sentiment-positive">{narrative.sentiment_positive_pct}%</b>
            </span>
            <span>
              neu <b className="text-sentiment-neutral">{narrative.sentiment_neutral_pct}%</b>
            </span>
            <span>
              neg <b className="text-sentiment-negative">{narrative.sentiment_negative_pct}%</b>
            </span>
          </div>
        </div>
      )}

      {/* Mapeamento tópico↔Narrativa por polaridade — pedido do usuário
          2026-07-14 ("é importantíssimo esse mapeamento dos tópicos com a
          narrativa para melhorar o entendimento... do usuário final"),
          narrative.positive_topics/negative_topics (get_narratives_table,
          migration 20260805010000). Capado a 3 chips por lado aqui (card
          compacto) — a lista completa (até 5) fica disponível no detalhe
          da Narrativa via os widgets "Drivers positivos/negativos". */}
      {(narrative.positive_topics.length > 0 || narrative.negative_topics.length > 0) && (
        <div className="flex flex-col gap-1.5">
          {narrative.positive_topics.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-text-tertiary">Tópicos +</span>
              {narrative.positive_topics.slice(0, 3).map((topic) => (
                <span
                  key={topic}
                  className="rounded-full bg-sentiment-positive-bg px-2.5 py-1 text-xs font-semibold text-sentiment-positive"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
          {narrative.negative_topics.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-text-tertiary">Tópicos -</span>
              {narrative.negative_topics.slice(0, 3).map((topic) => (
                <span
                  key={topic}
                  className="rounded-full bg-sentiment-negative-bg px-2.5 py-1 text-xs font-semibold text-sentiment-negative"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {narrative.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {narrative.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-bg-page px-2.5 py-1 text-xs font-medium text-text-secondary">
              {tag}
            </span>
          ))}
        </div>
      )}

      <Link href={`/narratives/${narrative.id}`} className="mt-1 text-sm font-semibold text-accent-blue hover:underline">
        Explorar narrativa →
      </Link>
    </div>
  );
}
