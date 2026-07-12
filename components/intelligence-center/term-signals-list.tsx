import type { TermSignal } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "text-sentiment-positive",
  negative: "text-sentiment-negative",
  neutral: "text-sentiment-neutral",
};

// Termos/temas emergentes (bloco `term_signals`) — Sentimento ("drivers de
// sentimento") e Pautas Eleitorais ("termos emergentes").
export function TermSignalsList({ signals, emptyMessage = "Nenhum termo emergente neste período." }: { signals: TermSignal[]; emptyMessage?: string }) {
  if (signals.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {signals.slice(0, 20).map((signal) => (
        <span
          key={signal.term}
          className={`inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1.5 text-sm ${
            SENTIMENT_COLOR[signal.sentiment_associated] ?? "text-text-primary"
          }`}
        >
          {signal.term}
          {signal.growth_pct !== null && (
            <span className="text-xs opacity-70">
              {signal.growth_pct > 0 ? "+" : ""}
              {signal.growth_pct}%
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
