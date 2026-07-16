"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import {
  authorColorHex,
  authorInitials,
  IDEOLOGY_LABEL,
  IDEOLOGY_ORDER,
  IDEOLOGY_HEX,
  MUTED_HEX,
  SENTIMENT_HEX,
  SENTIMENT_LABEL,
  type ColorByMode,
} from "../author-color";

// Dispersão "Alcance × Sentimento" — .dev/specs/intelligence-center/
// authors-and-influencers.md, "Redesenho interativo". Eixo X (alcance) em
// escala logarítmica — alcance tem cauda longa, escala linear esmagaria
// quase todo mundo num canto. Raio do ponto = engajamento normalizado.
// Autor sem sentimento (fora do top ~10 enriquecido) plota em Y=0 marcado
// como "sem dado" no hover — nunca inventa um sentimento neutro medido.
//
// Mesmo padrão de `viewBox` acompanhando a largura real do container (via
// ResizeObserver) já usado em trend-line-chart.tsx — 1 unidade de viewBox
// = 1px real, pra fontSize nunca escalar junto da largura do card (achado
// de 2026-07-19, ver CLAUDE.md).

const DEFAULT_WIDTH = 640;
const HEIGHT = 320;
const PADDING_LEFT = 46;
const PADDING_RIGHT = 16;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 32;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const AXIS_FONT_SIZE = 11;
const MIN_RADIUS = 4;
const MAX_RADIUS = 16;
const Y_TICKS = [-100, -50, 0, 50, 100];

function plotWidth(width: number): number {
  return width - PADDING_LEFT - PADDING_RIGHT;
}

function xForReach(reach: number, minLog: number, maxLog: number, width: number): number {
  const logValue = Math.log10(Math.max(reach, 1));
  const ratio = maxLog > minLog ? (logValue - minLog) / (maxLog - minLog) : 0.5;
  return PADDING_LEFT + ratio * plotWidth(width);
}

function yForSentiment(net: number): number {
  return PADDING_TOP + PLOT_HEIGHT - ((net + 100) / 200) * PLOT_HEIGHT;
}

function legendItems(colorBy: ColorByMode): { label: string; color: string }[] {
  if (colorBy === "partido") return []; // partido é aberto — sem legenda de itens fixos, ver nota abaixo
  if (colorBy === "sentimento") {
    return (["positive", "neutral", "negative"] as const).map((s) => ({ label: SENTIMENT_LABEL[s], color: SENTIMENT_HEX[s] }));
  }
  return IDEOLOGY_ORDER.map((i) => ({ label: IDEOLOGY_LABEL[i], color: IDEOLOGY_HEX[i] }));
}

export function AuthorScatterChart({
  authors,
  colorBy,
  onSelectAuthor,
}: {
  authors: AuthorRow[];
  colorBy: ColorByMode;
  onSelectAuthor?: (author: AuthorRow) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hoverName, setHoverName] = useState<string | null>(null);

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

  if (authors.length === 0) {
    return <EmptyState message="Nenhum autor no filtro atual." />;
  }

  const reaches = authors.map((a) => Math.log10(Math.max(a.reach, 1)));
  const minLog = Math.min(...reaches);
  const maxLog = Math.max(...reaches);
  const maxEngagement = Math.max(1, ...authors.map((a) => a.engagement));
  const hovered = hoverName ? authors.find((a) => a.name === hoverName) ?? null : null;

  function radiusFor(author: AuthorRow): number {
    const ratio = Math.min(1, author.engagement / maxEngagement);
    return MIN_RADIUS + ratio * (MAX_RADIUS - MIN_RADIUS);
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="w-full" role="img" aria-label="Dispersão de alcance por sentimento">
        {Y_TICKS.map((tick) => {
          const y = yForSentiment(tick);
          return (
            <g key={tick}>
              <line
                x1={PADDING_LEFT}
                x2={width - PADDING_RIGHT}
                y1={y}
                y2={y}
                stroke={tick === 0 ? "#c9cdd3" : "#f3f4f6"}
                strokeWidth={1}
              />
              <text x={PADDING_LEFT - 8} y={y + 3} textAnchor="end" fontSize={AXIS_FONT_SIZE} fill="#9aa0ab">
                {tick}
              </text>
            </g>
          );
        })}
        <text x={(PADDING_LEFT + width - PADDING_RIGHT) / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={AXIS_FONT_SIZE} fill="#9aa0ab">
          Alcance (escala logarítmica) →
        </text>
        <text x={12} y={PADDING_TOP + 8} fontSize={AXIS_FONT_SIZE} fill="#9aa0ab">
          Sentimento
        </text>

        {authors.map((author) => {
          const cx = xForReach(author.reach, minLog, maxLog, width);
          const hasSentiment = author.sentiment_positive !== null && author.sentiment_negative !== null;
          const net = hasSentiment ? (author.sentiment_positive ?? 0) - (author.sentiment_negative ?? 0) : 0;
          const cy = yForSentiment(net);
          const isHovered = hoverName === author.name;
          return (
            <circle
              key={author.name}
              cx={cx.toFixed(1)}
              cy={cy.toFixed(1)}
              r={radiusFor(author)}
              fill={authorColorHex(author, colorBy)}
              fillOpacity={author.entity_id ? 0.85 : 0.35}
              stroke="#ffffff"
              strokeWidth={isHovered ? 2 : 1.5}
              className="cursor-pointer transition-[stroke-width]"
              onMouseEnter={() => setHoverName(author.name)}
              onMouseLeave={() => setHoverName((current) => (current === author.name ? null : current))}
              onClick={() => onSelectAuthor?.(author)}
            />
          );
        })}
      </svg>

      <div className="min-h-[52px] rounded-lg border border-border-subtle-2 bg-bg-page px-3 py-2 text-xs text-text-secondary">
        {hovered ? (
          <div className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ backgroundColor: authorColorHex(hovered, colorBy) }}
              aria-hidden
            >
              {authorInitials(hovered.name)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-text-primary">
                {hovered.name}
                {!hovered.entity_id && <span className="ml-1.5 font-normal text-text-tertiary">(sem Entity)</span>}
              </div>
              <div className="truncate">
                {[hovered.entity_cargo, hovered.entity_partido].filter(Boolean).join(" · ") || "—"} · Alcance{" "}
                {new Intl.NumberFormat("pt-BR").format(hovered.reach)} · Engaj.{" "}
                {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(hovered.engagement)}
                {hovered.sentiment_positive !== null &&
                  ` · Sentimento ${(hovered.sentiment_positive - (hovered.sentiment_negative ?? 0)) > 0 ? "+" : ""}${
                    hovered.sentiment_positive - (hovered.sentiment_negative ?? 0)
                  }`}
              </div>
            </div>
          </div>
        ) : (
          "Passe o mouse sobre um ponto para ver os detalhes do autor."
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-secondary">
        {legendItems(colorBy).map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
            {item.label}
          </span>
        ))}
        {colorBy === "partido" && <span className="italic text-text-tertiary">Cor por partido — passe o mouse sobre um ponto para identificar.</span>}
        <span className="inline-flex items-center gap-1.5 text-text-tertiary">
          <span className="h-2.5 w-2.5 rounded-full opacity-35" style={{ backgroundColor: MUTED_HEX }} aria-hidden />
          Sem Entity vinculada
        </span>
      </div>
    </div>
  );
}
