import type { MetricCard as MetricCardData } from "@reputation/shared-types";

function formatValue(value: number, unit?: string): string {
  if (unit === "score") return value.toFixed(1);
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

// Card de KPI (bloco `metrics` do envelope) — Visão Geral/Relatórios (ver
// block-mapping-per-page.md). Delta/tendência já vêm calculados do backend
// (get_metrics_cards), o card só renderiza.
export function MetricCard({ metric }: { metric: MetricCardData }) {
  const trendColor =
    metric.trend === "up" ? "text-sentiment-positive" : metric.trend === "down" ? "text-sentiment-negative" : "text-text-tertiary";
  const trendIcon = metric.trend === "up" ? "↑" : metric.trend === "down" ? "↓" : "→";

  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">{metric.label}</p>
      <p className="mt-2 text-2xl font-bold text-text-primary">{formatValue(metric.value, metric.unit)}</p>
      {metric.delta_pct !== null && metric.delta_pct !== undefined && (
        <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${trendColor}`}>
          <span aria-hidden>{trendIcon}</span>
          {Math.abs(metric.delta_pct)}% vs. período anterior
        </p>
      )}
    </div>
  );
}
