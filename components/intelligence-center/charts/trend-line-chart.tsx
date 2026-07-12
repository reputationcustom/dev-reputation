import type { Trend, TrendPoint } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

const GROUP_COLORS: Record<string, string> = {
  total: "#2f6fed",
  positive: "#1a9d5c",
  neutral: "#8a8f98",
  negative: "#e0483e",
  narrativa: "#2f6fed",
  geral: "#9aa0ab",
};

const GROUP_LABELS: Record<string, string> = {
  total: "Total",
  positive: "Positivo",
  neutral: "Neutro",
  negative: "Negativo",
  narrativa: "Narrativa",
  geral: "Volume geral",
};

const WIDTH = 640;
const HEIGHT = 200;
const PADDING = 24;

function buildPath(series: TrendPoint[], maxValue: number): string {
  if (series.length === 0) return "";
  const stepX = series.length > 1 ? (WIDTH - PADDING * 2) / (series.length - 1) : 0;
  return series
    .map((point, index) => {
      const x = PADDING + index * stepX;
      const y = HEIGHT - PADDING - (maxValue > 0 ? (point.value / maxValue) * (HEIGHT - PADDING * 2) : 0);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

// Gráfico de série temporal simples (SVG, sem dependência nova) — suporta
// múltiplas linhas via `series_by_group` (ex: total/positivo/neutro/
// negativo do volume+sentimento, ver aggregated-metrics/standard-json-envelope.md).
export function TrendLineChart({ trend, emptyMessage }: { trend: Trend | undefined; emptyMessage: string }) {
  const groups = trend?.series_by_group ?? (trend?.series ? [{ group: "total", series: trend.series }] : []);
  const hasData = groups.some((group) => group.series.length > 0);

  if (!trend || !hasData) {
    return <EmptyState message={emptyMessage} />;
  }

  const maxValue = Math.max(1, ...groups.flatMap((group) => group.series.map((point) => point.value)));
  const dates = groups[0]?.series.map((point) => point.date) ?? [];

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label={trend.label}>
        {groups.map((group) => (
          <path
            key={group.group}
            d={buildPath(group.series, maxValue)}
            fill="none"
            stroke={GROUP_COLORS[group.group] ?? "#9aa0ab"}
            strokeWidth={2}
          />
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3">
          {groups.map((group) => (
            <span key={group.group} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: GROUP_COLORS[group.group] ?? "#9aa0ab" }}
              />
              {GROUP_LABELS[group.group] ?? group.group}
            </span>
          ))}
        </div>
        {dates.length > 1 && (
          <span className="text-xs text-text-tertiary">
            {dates[0]} — {dates[dates.length - 1]}
          </span>
        )}
      </div>
    </div>
  );
}
