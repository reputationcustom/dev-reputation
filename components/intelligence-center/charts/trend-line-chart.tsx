"use client";

import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { Trend, TrendPoint } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateOnly, formatHourOnly } from "@/lib/date/format";
import { useUserProfile } from "@/hooks/use-user-profile";

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

// Largura usada só até o primeiro layout medir o container de verdade (ver
// useLayoutEffect abaixo) — depois disso, `width` sempre reflete o
// container real, nunca este valor.
const DEFAULT_WIDTH = 640;
const HEIGHT = 220;
const PADDING_LEFT = 42;
const PADDING_RIGHT = 12;
const PADDING_TOP = 14;
const PADDING_BOTTOM = 26;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const Y_TICK_COUNT = 4;
const MAX_X_LABELS = 6;
// Um pouco menor que o texto do resto da página (legenda/tooltip usam
// text-xs, 12px) — eixo é informação de apoio, não deve competir com título/
// legenda pela atenção do leitor (skill de dataviz: "texto recessivo").
const AXIS_FONT_SIZE = 10;

function plotWidth(width: number): number {
  return width - PADDING_LEFT - PADDING_RIGHT;
}

function xForIndex(index: number, length: number, width: number): number {
  const stepX = length > 1 ? plotWidth(width) / (length - 1) : 0;
  return PADDING_LEFT + index * stepX;
}

function yForValue(value: number, maxValue: number): number {
  return PADDING_TOP + PLOT_HEIGHT - (maxValue > 0 ? (value / maxValue) * PLOT_HEIGHT : 0);
}

function buildPath(series: TrendPoint[], maxValue: number, width: number): string {
  if (series.length === 0) return "";
  return series
    .map((point, index) => {
      const x = xForIndex(index, series.length, width);
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
// sem lotar o eixo quando a série tem muitos pontos (ex: 24h no modo
// "Diário", 30 dias no modo "Mensal", ver header-context.tsx).
function xLabelIndexes(pointCount: number): number[] {
  if (pointCount <= 1) return [0];
  const step = Math.max(1, Math.ceil((pointCount - 1) / (MAX_X_LABELS - 1)));
  const indexes: number[] = [];
  for (let i = 0; i < pointCount; i += step) indexes.push(i);
  if (indexes[indexes.length - 1] !== pointCount - 1) indexes.push(pointCount - 1);
  return indexes;
}

// `get_volume_trend` devolve datas puras ("2026-07-19", 10 caracteres) nos
// grãos day/week/month e instantes ISO completos ("2026-07-19T14:00:00Z")
// no grão hour (modo "Diário" do header — ver sql-aggregation.md, migration
// 20260719000000) — o comprimento da string já diferencia os dois casos
// sem precisar de um campo de grão explícito no envelope.
function isHourlyPoint(date: string): boolean {
  return date.length > 10;
}

function formatAxisLabel(date: string, timezone: string): string {
  return isHourlyPoint(date) ? formatHourOnly(date, timezone) : formatDateOnly(date).slice(0, 5);
}

// Gráfico de série temporal (SVG, sem dependência nova) — suporta múltiplas
// linhas via `series_by_group` (ex: total/positivo/neutro/negativo do
// volume+sentimento, ver aggregated-metrics/standard-json-envelope.md).
// Eixos com rótulo + tooltip ao passar o mouse (intelligence-center/overview.md,
// "Premissas de visualização de dados", regras 1 e 2).
//
// `viewBox` acompanha a largura real do container (medida via
// ResizeObserver), não um valor fixo — antes, um viewBox de largura fixa
// (640) sendo esticado por CSS (`w-full`) num card mais largo escalava
// junto o texto dos eixos, fazendo os rótulos renderizarem maiores que a
// legenda/título da página em telas largas (achado do usuário, 2026-07-19).
// Com 1 unidade de viewBox = 1px real, `fontSize` sempre renderiza no
// tamanho literal declarado, em qualquer largura de card.
export function TrendLineChart({ trend, emptyMessage }: { trend: Trend | undefined; emptyMessage: string }) {
  const { timezone } = useUserProfile();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setWidth(measured);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    const relativeX = ((event.clientX - rect.left) / rect.width) * width;
    const stepX = pointCount > 1 ? plotWidth(width) / (pointCount - 1) : 0;
    const rawIndex = stepX > 0 ? Math.round((relativeX - PADDING_LEFT) / stepX) : 0;
    setHoverIndex(Math.min(Math.max(rawIndex, 0), pointCount - 1));
  }

  return (
    <div ref={containerRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${HEIGHT}`}
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
              <line x1={PADDING_LEFT} x2={width - PADDING_RIGHT} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1} />
              <text x={PADDING_LEFT - 6} y={y + 3} textAnchor="end" fontSize={AXIS_FONT_SIZE} fill="#9aa0ab">
                {new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(tick)}
              </text>
            </g>
          );
        })}

        {xLabelIndexes(pointCount).map((index) => (
          <text
            key={index}
            x={xForIndex(index, pointCount, width)}
            y={HEIGHT - 8}
            textAnchor="middle"
            fontSize={AXIS_FONT_SIZE}
            fill="#9aa0ab"
          >
            {formatAxisLabel(dates[index], timezone)}
          </text>
        ))}

        {hoverIndex !== null && (
          <line
            x1={xForIndex(hoverIndex, pointCount, width)}
            x2={xForIndex(hoverIndex, pointCount, width)}
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
            d={buildPath(group.series, maxValue, width)}
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
                cx={xForIndex(hoverIndex, pointCount, width)}
                cy={yForValue(point.value, maxValue)}
                r={4}
                fill={GROUP_COLORS[group.group] ?? "#9aa0ab"}
                stroke="#ffffff"
                strokeWidth={2}
              />
            );
          })}

        {/* Rótulo do valor direto no ponto, ao passar o mouse — pedido
            explícito e repetido do usuário (2026-07-12 e novamente
            2026-07-13: "para que o usuário veja os valores das linhas ao
            mover o mouse sobre o gráfico"). Uma revisão anterior (2026-07-19)
            tinha removido este rótulo em favor de só mostrar o valor no
            painel abaixo do gráfico, citando a diretriz genérica de "não
            duplicar o mesmo número" — mas overview.md, "Premissas de
            visualização de dados" regra 1, já pede rótulo "nos
            pontos/segmentos" literalmente, e o usuário confirmou 2x que
            quer o valor visível no próprio gráfico, não só abaixo dele.
            Tratar como definitivo — não remover de novo sem confirmar com o
            usuário primeiro. Tamanho/peso reduzidos (9px/600/halo 2px) pra
            não destoar do resto da página (harmonização 2026-07-12). */}
        {hoverIndex !== null &&
          groups.map((group) => {
            const point = group.series[hoverIndex];
            if (!point) return null;
            const x = xForIndex(hoverIndex, pointCount, width);
            const y = Math.max(yForValue(point.value, maxValue) - 10, PADDING_TOP + 8);
            return (
              <text
                key={`label-${group.group}`}
                x={x}
                y={y}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={GROUP_COLORS[group.group] ?? "#9aa0ab"}
                stroke="#ffffff"
                strokeWidth={2}
                paintOrder="stroke"
              >
                {new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(point.value)}
              </text>
            );
          })}
      </svg>

      {/* Painel com todas as séries do ponto sob o cursor — complementa (não
          substitui) o rótulo no próprio gráfico acima: bom pra comparar
          várias séries de uma vez, o rótulo no ponto é bom pra ver o valor
          sem tirar o olho da linha. */}
      {hoverIndex !== null ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 rounded-md border border-border-default bg-bg-card px-3 py-2 text-xs">
          <span className="font-semibold text-text-primary">
            {isHourlyPoint(dates[hoverIndex]) ? formatHourOnly(dates[hoverIndex], timezone) : formatDateOnly(dates[hoverIndex])}
          </span>
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
