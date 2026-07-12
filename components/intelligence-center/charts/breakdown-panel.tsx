import type { Breakdown } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

const SENTIMENT_BAR_COLOR: Record<string, string> = {
  positive: "bg-sentiment-positive",
  neutral: "bg-sentiment-neutral",
  negative: "bg-sentiment-negative",
};

const SENTIMENT_BAR_LABEL: Record<string, string> = {
  positive: "Positivo",
  neutral: "Neutro",
  negative: "Negativo",
};

// Distribuição positivo/neutro/negativo (breakdown type='sentiment') — barras
// horizontais proporcionais ao `pct` que o envelope já traz calculado.
function SentimentBars({ breakdown }: { breakdown: Breakdown }) {
  return (
    <div className="flex flex-col gap-2">
      {breakdown.items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-16 flex-shrink-0 text-xs text-text-secondary">
            {SENTIMENT_BAR_LABEL[item.label] ?? item.label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border-subtle-2">
            <div
              className={`h-full ${SENTIMENT_BAR_COLOR[item.label] ?? "bg-text-tertiary"}`}
              style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }}
            />
          </div>
          <span className="w-12 flex-shrink-0 text-right text-xs text-text-secondary">{item.pct}%</span>
        </div>
      ))}
    </div>
  );
}

// Breakdowns de type='platform'/'theme' — o `value` aqui é net_sentiment
// (score -100..100, não uma contagem/percentual), ver sql-aggregation.md
// ("get_platform_breakdown"/"get_theme_breakdown"). Renderizado
// deliberadamente distinto das barras de sentimento acima (CLAUDE.md:
// "net_sentiment... precisa renderizar visualmente distinto") — aqui como
// lista com o score e a participação (`pct`) lado a lado, não uma barra
// proporcional (o score pode ser negativo, não faz sentido como largura de
// barra 0-100%).
function ScoreList({ breakdown }: { breakdown: Breakdown }) {
  return (
    <div className="flex flex-col divide-y divide-border-subtle-2">
      {breakdown.items.map((item) => (
        <div key={item.label} className="flex items-center justify-between py-2 text-sm">
          <span className="text-text-primary">{item.label}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">{item.pct}% das menções</span>
            <span
              className={`font-semibold ${
                item.value > 0 ? "text-sentiment-positive" : item.value < 0 ? "text-sentiment-negative" : "text-sentiment-neutral"
              }`}
            >
              {item.value > 0 ? "+" : ""}
              {item.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BreakdownPanel({ breakdown, emptyMessage }: { breakdown: Breakdown | undefined; emptyMessage: string }) {
  if (!breakdown || breakdown.items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  if (breakdown.type === "sentiment") {
    return <SentimentBars breakdown={breakdown} />;
  }

  return <ScoreList breakdown={breakdown} />;
}
