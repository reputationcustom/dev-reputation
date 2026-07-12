import type { Breakdown } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { DonutChart } from "./donut-chart";

const SENTIMENT_COLOR_HEX: Record<string, string> = {
  positive: "#1a9d5c",
  neutral: "#8a8f98",
  negative: "#e0483e",
};

const SENTIMENT_LABEL: Record<string, string> = {
  positive: "Positivo",
  neutral: "Neutro",
  negative: "Negativo",
};

// Distribuição positivo/neutro/negativo (breakdown type='sentiment') — até 5
// valores, sempre percentual puro (`item.pct`), então vira um donut em vez
// de barras (intelligence-center/overview.md, "Premissas de visualização de
// dados", regra 4). Não se aplica a plataforma/pauta (ver ScoreList abaixo)
// — lá o valor é net_sentiment (score, pode ser negativo), não percentual.
function SentimentDonut({ breakdown }: { breakdown: Breakdown }) {
  const items = breakdown.items.map((item) => ({
    label: SENTIMENT_LABEL[item.label] ?? item.label,
    value: item.value,
    pct: item.pct,
    color: SENTIMENT_COLOR_HEX[item.label] ?? "#9aa0ab",
  }));
  return <DonutChart items={items} />;
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
    return <SentimentDonut breakdown={breakdown} />;
  }

  return <ScoreList breakdown={breakdown} />;
}
