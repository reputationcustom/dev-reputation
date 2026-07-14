import type { TermSignal } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

// "Termos emergentes" (Pautas Eleitorais) — no protótipo original é uma
// nuvem de palavras (font-weight 700, cor accent-blue, tamanho variável),
// não uma lista de chips. Tamanho derivado de `growth_pct` (única métrica
// de magnitude que `get_term_signals` expõe) — maior crescimento em
// módulo, maior a fonte, mesma ideia do `t.weight` do mock original.
export function TermSignalsList({ signals, emptyMessage = "Nenhum termo emergente neste período." }: { signals: TermSignal[]; emptyMessage?: string }) {
  if (signals.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const items = signals.slice(0, 20);
  const maxAbsGrowth = Math.max(1, ...items.map((s) => Math.abs(s.growth_pct)));

  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-2">
      {items.map((signal) => {
        const size = 11 + (Math.abs(signal.growth_pct) / maxAbsGrowth) * 12;
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
