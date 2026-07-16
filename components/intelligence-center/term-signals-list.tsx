import type { TermSignal, TopicSortMode } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

// "Termos emergentes" (Pautas Eleitorais) — no protótipo original é uma
// nuvem de palavras (font-weight 700, cor accent-blue, tamanho variável),
// não uma lista de chips. Tamanho derivado da métrica de magnitude que
// corresponde à perspectiva ativa (`sizeBy`, ✅ 2026-08-09, migration
// 20260809130000): `growth_pct` (crescimento, default — mesmo default do
// backend) ou `volume` (menções absolutas) — maior magnitude, maior a
// fonte, mesma ideia do `t.weight` do mock original. `sizeBy` só decide a
// visualização; o CONJUNTO de termos já vem pré-ranqueado pelo backend
// segundo a mesma perspectiva (`get_term_signals`'s `p_topic_sort`, ver
// `usePageEnvelope({ topicSort })` nos 2 consumidores desta lista).
export function TermSignalsList({
  signals,
  sizeBy = "trending",
  emptyMessage = "Nenhum termo emergente neste período.",
}: {
  signals: TermSignal[];
  sizeBy?: TopicSortMode;
  emptyMessage?: string;
}) {
  if (signals.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const items = signals.slice(0, 20);
  const magnitude = (signal: TermSignal) =>
    sizeBy === "volume" ? Math.abs(signal.volume ?? 0) : Math.abs(signal.growth_pct);
  const maxMagnitude = Math.max(1, ...items.map(magnitude));

  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-2">
      {items.map((signal) => {
        const size = 11 + (magnitude(signal) / maxMagnitude) * 12;
        return (
          <span key={signal.term} className="font-bold text-accent-blue" style={{ fontSize: `${size}px` }}>
            {signal.term}
          </span>
        );
      })}
    </div>
  );
}

const SENTIMENT_CHIP_COLOR: Record<string, string> = {
  positive: "bg-sentiment-positive-bg text-sentiment-positive",
  neutral: "bg-sentiment-neutral-bg text-sentiment-neutral",
  negative: "bg-sentiment-negative-bg text-sentiment-negative",
};

function SentimentChip({ signal }: { signal: TermSignal }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ${
        SENTIMENT_CHIP_COLOR[signal.sentiment_associated] ?? "bg-bg-page text-text-secondary"
      }`}
    >
      {signal.term}
    </span>
  );
}

// ✅ Unificado 2026-07-14 (pedido do usuário: "Principais tópicos positivos
// e negativos estarem no mesmo frame mudando apenas a cor") — antes eram 2
// componentes/`WidgetCard`s separados (PositiveDriversList/NegativeDriversList,
// espelhando o protótipo original de 2 cards lado a lado); agora é uma única
// lista de pills, mesma cor que já existia por sentimento
// (`bg-sentiment-*-bg`/`text-sentiment-*`), só que dentro do mesmo frame —
// inclui a faixa neutra (antes descartada, "termos neutros não aparecem em
// nenhuma das duas") já que o pedido do usuário cita "vermelho, verde ou
// neutro" como as 3 cores esperadas. Mesmo dado de `get_term_signals`, só
// reagrupado por `sentiment_associated`.
export function TopicSentimentList({
  signals,
  emptyMessage = "Nenhum tópico relevante neste período.",
}: {
  signals: TermSignal[];
  emptyMessage?: string;
}) {
  const positive = signals.filter((s) => s.sentiment_associated === "positive").slice(0, 8);
  const neutral = signals.filter((s) => s.sentiment_associated === "neutral").slice(0, 4);
  const negative = signals.filter((s) => s.sentiment_associated === "negative").slice(0, 8);
  const items = [...positive, ...neutral, ...negative];

  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((signal) => (
        <SentimentChip key={`${signal.sentiment_associated}-${signal.term}`} signal={signal} />
      ))}
    </div>
  );
}
