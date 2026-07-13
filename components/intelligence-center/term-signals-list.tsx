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

const DRIVER_COLOR: Record<string, string> = {
  positive: "bg-sentiment-positive-bg text-sentiment-positive",
  negative: "bg-sentiment-negative-bg text-sentiment-negative",
};

function DriverChip({ signal }: { signal: TermSignal }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ${
        DRIVER_COLOR[signal.sentiment_associated] ?? "bg-bg-page text-text-secondary"
      }`}
    >
      {signal.term}
    </span>
  );
}

// "Drivers positivos" / "Drivers negativos" — 2 caixas separadas
// (`WidgetCard`s próprios na página, ver sentiment/page.tsx), espelhando
// exatamente o protótipo original (2 cards lado a lado, cada um com seu
// próprio título, pills preenchidas — `background:#eafaf1 color:#1a9d5c`
// pro positivo, `#fdecea`/`#e0483e` pro negativo — não bordas com texto
// colorido). Mesmo dado de `get_term_signals`, só filtrado por
// `sentiment_associated`. Termos neutros não aparecem em nenhuma das duas
// (o protótipo só mostra positivo/negativo pra "drivers").
export function PositiveDriversList({ signals }: { signals: TermSignal[] }) {
  const positive = signals.filter((s) => s.sentiment_associated === "positive");
  if (positive.length === 0) {
    return <EmptyState message="Nenhum driver positivo neste período." />;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {positive.slice(0, 10).map((signal) => (
        <DriverChip key={signal.term} signal={signal} />
      ))}
    </div>
  );
}

export function NegativeDriversList({ signals }: { signals: TermSignal[] }) {
  const negative = signals.filter((s) => s.sentiment_associated === "negative");
  if (negative.length === 0) {
    return <EmptyState message="Nenhum driver negativo neste período." />;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {negative.slice(0, 10).map((signal) => (
        <DriverChip key={signal.term} signal={signal} />
      ))}
    </div>
  );
}
