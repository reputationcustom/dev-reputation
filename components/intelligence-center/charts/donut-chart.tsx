"use client";

import { useState } from "react";

export interface DonutChartItem {
  label: string;
  value: number;
  pct: number;
  color: string;
}

const SIZE = 160;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Gráfico de rosca (SVG, sem dependência nova — mesma filosofia de
// trend-line-chart.tsx) para distribuições de até ~5 categorias
// percentuais (intelligence-center/overview.md, "Premissas de
// visualização de dados", regra 4). Rótulos sempre visíveis na legenda
// (regra 1) + tooltip ao passar o mouse num segmento ou item da legenda
// (regra 2) — mostrado no centro do anel, que já é espaço livre.
export function DonutChart({ items }: { items: DonutChartItem[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = items.reduce((sum, item) => sum + item.value, 0);

  let offset = 0;
  const segments = items.map((item) => {
    const dash = (item.pct / 100) * CIRCUMFERENCE;
    const segment = { item, dash, dashOffset: -offset };
    offset += dash;
    return segment;
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Distribuição percentual">
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#eef0f2" strokeWidth={STROKE} />
            {segments.map(({ item, dash, dashOffset }, index) => (
              <circle
                key={item.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={item.color}
                strokeWidth={hovered === index ? STROKE + 4 : STROKE}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={dashOffset}
                className="cursor-pointer transition-[stroke-width]"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
              >
                <title>
                  {item.label}: {item.pct}% ({new Intl.NumberFormat("pt-BR").format(item.value)})
                </title>
              </circle>
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          {hovered !== null ? (
            <>
              <span className="text-xs text-text-secondary">{items[hovered].label}</span>
              <span className="text-lg font-bold text-text-primary">{items[hovered].pct}%</span>
            </>
          ) : (
            <>
              <span className="text-xs text-text-secondary">Total</span>
              <span className="text-lg font-bold text-text-primary">
                {new Intl.NumberFormat("pt-BR").format(total)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {items.map((item, index) => (
          <div
            key={item.label}
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
            className={`flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors ${
              hovered === index ? "bg-bg-page" : ""
            }`}
          >
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-text-primary">{item.label}</span>
            <span className="ml-auto text-xs text-text-tertiary">
              {new Intl.NumberFormat("pt-BR").format(item.value)}
            </span>
            <span className="w-12 flex-shrink-0 text-right text-sm font-semibold text-text-primary">
              {item.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
