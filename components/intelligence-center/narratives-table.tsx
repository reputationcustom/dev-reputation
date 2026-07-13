"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { NarrativeRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { SentimentBadge, RiskBadge, VelocityIndicator, ScoreBar } from "./score-badges";

type SortKey = "title" | "sov_pct" | "velocity_score" | "net_sentiment" | "momentum_score" | "risk_score";

// Tooltips por coluna (pedido do usuário 2026-07-13) — mesmo padrão/
// componente já usado nos 5 KPIs da Visão Geral (metric-card.tsx). Como
// esta tabela é reusada por Visão Geral/Narrativas/Plataformas/Pautas
// (ver comentário abaixo), as definições explicam a coluna também. "Narrativa"
// e "Ação" ficam sem tooltip — autoexplicativas.
const COLUMNS: { key: SortKey; label: string; tooltip?: string }[] = [
  { key: "title", label: "Narrativa" },
  {
    key: "sov_pct",
    label: "SOV",
    tooltip: "Share of Voice — participação desta Narrativa no total de menções da Query em que ela está.",
  },
  {
    key: "velocity_score",
    label: "Velocidade",
    tooltip:
      "Ritmo de crescimento recente (hoje vs. ontem) — mostra se a Narrativa está ganhando ou perdendo força rapidamente, independente do período selecionado no topo da página.",
  },
  {
    key: "net_sentiment",
    label: "Sentimento",
    tooltip: "Resumo do tom das menções desta Narrativa: predominantemente positivo, neutro ou negativo.",
  },
  {
    key: "momentum_score",
    label: "Momentum",
    tooltip:
      "Força atual da Narrativa (volume, engajamento, autores e alcance), comparando o período selecionado com o período anterior de mesma duração.",
  },
  {
    key: "risk_score",
    label: "Risco",
    tooltip: "Nível de risco reputacional, calculado a partir do sentimento, alcance e Momentum/Velocidade da Narrativa.",
  },
];

// Tabela interativa de Narrativas — 7 colunas (Narrativa/SOV/Velocidade/
// Sentimento/Momentum/Risco/Ação), reusada por Visão Geral, Narrativas
// (lista completa) e Pautas Eleitorais (intelligence-center/executive-overview.md,
// "Tabela interativa de Narrativas"; narratives-exploration.md: "mesma
// tabela... sem duplicar regra"). Ordenação default do backend (risk_score
// desc, depois total_mentions desc) — clique no cabeçalho troca a
// ordenação (mesma spec: "podendo o usuário ordenar por outras opções").
export function NarrativesTable({
  rows,
  emptyMessage = "Nenhuma Narrativa em monitoramento.",
  onRowClick,
  selectedId,
}: {
  rows: NarrativeRow[];
  emptyMessage?: string;
  onRowClick?: (row: NarrativeRow) => void;
  selectedId?: string | null;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * factor;
      }
      return (Number(av) - Number(bv)) * factor;
    });
  }, [rows, sort]);

  function handleSort(key: SortKey) {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "desc" };
      return { key, direction: current.direction === "desc" ? "asc" : "desc" };
    });
  }

  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-tertiary">
            {COLUMNS.map((column) => (
              <th key={column.key} className="px-4 py-3 font-bold">
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleSort(column.key)}
                    className="flex items-center gap-1 hover:text-text-primary"
                  >
                    {column.label}
                    {sort?.key === column.key && <span aria-hidden>{sort.direction === "desc" ? "↓" : "↑"}</span>}
                  </button>
                  {column.tooltip && (
                    <Tooltip text={column.tooltip} position="bottom">
                      <span
                        tabIndex={0}
                        aria-label={`O que é ${column.label}`}
                        className="flex h-3.5 w-3.5 flex-shrink-0 cursor-help items-center justify-center rounded-full border border-text-tertiary text-[9px] font-bold normal-case text-text-tertiary outline-none focus-visible:border-accent-blue focus-visible:text-accent-blue"
                      >
                        ?
                      </span>
                    </Tooltip>
                  )}
                </span>
              </th>
            ))}
            <th className="px-4 py-3 font-bold">Ação</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-border-subtle-2 last:border-0 ${
                onRowClick ? "cursor-pointer hover:bg-bg-page" : ""
              } ${selectedId === row.id ? "bg-accent-blue-bg" : ""}`}
            >
              <td className="px-4 py-3 font-medium text-text-primary">
                <Link
                  href={`/narratives/${row.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hover:text-accent-blue hover:underline"
                >
                  {row.title}
                </Link>
              </td>
              {/* 0 tratado como "—", igual a null (overview.md, "Premissas de visualização de dados", regra 5) */}
              <td className="px-4 py-3 text-text-secondary">
                {row.sov_pct === null || row.sov_pct === 0 ? "—" : `${row.sov_pct}%`}
              </td>
              <td className="px-4 py-3">
                <VelocityIndicator score={row.velocity_score} label={row.velocity_label} />
              </td>
              <td className="px-4 py-3">
                <SentimentBadge value={row.net_sentiment} label={row.sentiment_label} />
              </td>
              <td className="px-4 py-3">
                <ScoreBar score={row.momentum_score} />
              </td>
              <td className="px-4 py-3">
                <RiskBadge score={row.risk_score} label={row.risk_label} />
              </td>
              <td className="px-4 py-3">
                <Link href={`/narratives/${row.id}`} className="text-sm font-medium text-accent-blue hover:underline">
                  Ver
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
