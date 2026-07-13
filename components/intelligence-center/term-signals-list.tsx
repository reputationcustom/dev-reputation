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

function TermChip({ signal }: { signal: TermSignal }) {
  return (
    <span
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
  );
}

// "Drivers positivos" / "Drivers negativos" (2 caixas separadas, pedido do
// usuário 2026-07-17, espelhando o mockup original) — mesmo dado de
// TermSignalsList (get_term_signals), só filtrado por sentiment_associated
// e dividido em 2 listas em vez de uma nuvem única. Termos neutros não
// aparecem em nenhuma das duas caixas (mockup só mostra positivo/negativo
// pra "drivers").
export function SentimentDriversPanel({ signals }: { signals: TermSignal[] }) {
  const positive = signals.filter((s) => s.sentiment_associated === "positive");
  const negative = signals.filter((s) => s.sentiment_associated === "negative");

  if (positive.length === 0 && negative.length === 0) {
    return <EmptyState message="Nenhum driver de sentimento neste período." />;
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase text-text-tertiary">Drivers positivos</span>
        {positive.length === 0 ? (
          <span className="text-sm text-text-tertiary">Nenhum driver positivo neste período.</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {positive.slice(0, 10).map((signal) => (
              <TermChip key={signal.term} signal={signal} />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase text-text-tertiary">Drivers negativos</span>
        {negative.length === 0 ? (
          <span className="text-sm text-text-tertiary">Nenhum driver negativo neste período.</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {negative.slice(0, 10).map((signal) => (
              <TermChip key={signal.term} signal={signal} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
