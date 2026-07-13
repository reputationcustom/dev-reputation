"use client";

import { useRef, useState, type MouseEvent } from "react";
import type { Trend, TrendPoint } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateOnly } from "@/lib/date/format";

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
const HEIGHT = 220;
const PADDING_LEFT = 40;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 24;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const Y_TICK_COUNT = 4;
const MAX_X_LABELS = 6;

function xForIndex(index: number, length: number): number {
  const stepX = length > 1 ? PLOT_WIDTH / (length - 1) : 0;
  return PADDING_LEFT + index * stepX;
}

function yForValue(value: number, maxValue: number): number {
  return PADDING_TOP + PLOT_HEIGHT - (maxValue > 0 ? (value / maxValue) * PLOT_HEIGHT : 0);
}

function buildPath(series: TrendPoint[], maxValue: number): string {
  if (series.length === 0) return "";
  return series
    .map((point, index) => {
      const x = xForIndex(index, series.length);
      const y = yForValue(point.value, maxValue);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function niceYTicks(maxValue: number): number[] {
  if (maxValue <= 0) return [0];
  return Array.from({ length: Y_TICK_COUNT + 1 }, (_, i) => Math.round((maxValue / Y_TICK_COUNT) * i));
}

// Índices do eixo X a rotular — primeiro, último e alguns intermediários,
// sem lotar o eixo quando a série tem muitos pontos (ex: 30 dias no modo
// "Mensal", ver header-context.tsx).
function xLabelIndexes(pointCount: number): number[] {
  if (pointCount <= 1) return [0];
  const step = Math.max(1, Math.ceil((pointCount - 1) / (MAX_X_LABELS - 1)));
  const indexes: number[] = [];
  for (let i = 0; i < pointCount; i += step) indexes.push(i);
  if (indexes[indexes.length - 1] !== pointCount - 1) indexes.push(pointCount - 1);
  return indexes;
}

// Gráfico de série temporal (SVG, sem dependência nova) — suporta múltiplas
// linhas via `series_by_group` (ex: total/positivo/neutro/negativo do
// volume+sentimento, ver aggregated-metrics/standard-json-envelope.md).
// Eixos com rótulo + tooltip ao passar o mouse (intelligence-center/overview.md,
// "Premissas de visualização de dados", regras 1 e 2).
export function TrendLineChart({ trend, emptyMessage }: { trend: Trend | undefined; emptyMessage: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const groups = trend?.series_by_group ?? (trend?.series ? [{ group: "total", series: trend.series }] : []);
  const hasData = groups.some((group) => group.series.length > 0);

  if (!trend || !hasData) {
    return <EmptyState message={emptyMessage} />;
  }

  const maxValue = Math.max(1, ...groups.flatMap((group) => group.series.map((point) => point.value)));
  const dates = groups[0]?.series.map((point) => point.date) ?? [];
  const pointCount = dates.length;
  const ticks = niceYTicks(maxValue);

  function handleMouseMove(event: MouseEvent<SVGSVGElement>) {
    if (pointCount === 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const stepX = pointCount > 1 ? PLOT_WIDTH / (pointCount - 1) : 0;
    const rawIndex = stepX > 0 ? Math.round((relativeX - PADDING_LEFT) / stepX) : 0;
    setHoverIndex(Math.min(Math.max(rawIndex, 0), pointCount - 1));
  }

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full cursor-crosshair"
        role="img"
        aria-label={trend.label}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {ticks.map((tick) => {
          const y = yForValue(tick, maxValue);
          return (
            <g key={tick}>
              <line x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1} />
              <text x={PADDING_LEFT - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#9aa0ab">
                {new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(tick)}
              </text>
            </g>
          );
        })}

        {xLabelIndexes(pointCount).map((index) => (
          <text
            key={index}
            x={xForIndex(index, pointCount)}
            y={HEIGHT - 6}
            textAnchor="middle"
            fontSize={9}
            fill="#9aa0ab"
          >
            {formatDateOnly(dates[index]).slice(0, 5)}
          </text>
        ))}

        {hoverIndex !== null && (
          <line
            x1={xForIndex(hoverIndex, pointCount)}
            x2={xForIndex(hoverIndex, pointCount)}
            y1={PADDING_TOP}
            y2={HEIGHT - PADDING_BOTTOM}
            stroke="#c9cdd3"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {groups.map((group) => (
          <path
            key={group.group}
            d={buildPath(group.series, maxValue)}
            fill="none"
            stroke={GROUP_COLORS[group.group] ?? "#9aa0ab"}
            strokeWidth={2}
          />
        ))}

        {hoverIndex !== null &&
          groups.map((group) => {
            const point = group.series[hoverIndex];
            if (!point) return null;
            return (
              <circle
                key={group.group}
                cx={xForIndex(hoverIndex, pointCount)}
                cy={yForValue(point.value, maxValue)}
                r={3.5}
                fill={GROUP_COLORS[group.group] ?? "#9aa0ab"}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            );
          })}

        {/* Rótulo do valor direto na linha, junto ao ponto — pedido do
            usuário 2026-07-12 (rótulos ao passar o mouse sobre a linha, não
            só no painel abaixo do gráfico). */}
        {hoverIndex !== null &&
          groups.map((group) => {
            const point = group.series[hoverIndex];
            if (!point) return null;
            const x = xForIndex(hoverIndex, pointCount);
            const y = Math.max(yForValue(point.value, maxValue) - 8, PADDING_TOP + 8);
            return (
              <text
                key={`label-${group.group}`}
                x={x}
                y={y}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                fill={GROUP_COLORS[group.group] ?? "#9aa0ab"}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(point.value)}
              </text>
            );
          })}
      </svg>

      {hoverIndex !== null ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 rounded-md border border-border-default bg-bg-card px-3 py-2 text-xs">
          <span className="font-semibold text-text-primary">{formatDateOnly(dates[hoverIndex])}</span>
          {groups.map((group) => {
            const point = group.series[hoverIndex];
            if (!point) return null;
            return (
              <span key={group.group} className="flex items-center gap-1.5 text-text-secondary">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: GROUP_COLORS[group.group] ?? "#9aa0ab" }}
                />
                {GROUP_LABELS[group.group] ?? group.group}:{" "}
                <span className="font-semibold text-text-primary">
                  {new Intl.NumberFormat("pt-BR").format(point.value)}
                </span>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-3">
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
      )}
    </div>
  );
}
