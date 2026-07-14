"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { NarrativeRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { SentimentBadge, RiskBadge, TrendArrow, ScoreBar } from "./score-badges";

type SortKey = "title" | "sov_pct" | "trend_score" | "net_sentiment" | "momentum_score" | "risk_score";

// Tooltips por coluna (pedido do usuário 2026-07-13) — mesmo padrão/
// componente já usado nos 5 KPIs da Visão Geral (metric-card.tsx). Como
// esta tabela é reusada por Visão Geral/Narrativas/Plataformas/Pautas
// (ver comentário abaixo), as definições explicam a coluna também.
// "Narrativa" fica sem tooltip — autoexplicativa.
const COLUMNS: { key: SortKey; label: string; tooltip?: string }[] = [
  { key: "title", label: "Narrativa" },
  {
    key: "sov_pct",
    label: "SOV",
    tooltip: "Share of Voice — participação desta Narrativa no total de menções da Query em que ela está.",
  },
  {
    key: "trend_score",
    label: "Tendência",
    tooltip:
      "Tendência estatística dos últimos 14 dias (regressão sobre o volume diário de menções) — mostra se a Narrativa tende a aumentar, diminuir ou se manter estável, independente do período selecionado no topo da página.",
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
    tooltip: "Nível de risco reputacional, calculado a partir do sentimento, alcance e Momentum/Tendência da Narrativa.",
  },
];

function groupByCategoryLabel(rows: NarrativeRow[]): Array<{ category: string; rows: NarrativeRow[] }> {
  const groups = new Map<string, NarrativeRow[]>();
  for (const row of rows) {
    const key = row.category_label || "Sem categoria";
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return Array.from(groups.entries())
    .map(([category, categoryRows]) => ({ category, rows: categoryRows }))
    .sort((a, b) => a.category.localeCompare(b.category, "pt-BR"));
}

// Tabela interativa de Narrativas — 6 colunas (Narrativa/SOV/Tendência/
// Sentimento/Momentum/Risco), reusada por Visão Geral, Narrativas (lista
// completa) e Pautas Eleitorais (intelligence-center/executive-overview.md,
// "Tabela interativa de Narrativas"; narratives-exploration.md: "mesma
// tabela... sem duplicar regra"). ✅ Ordenação default por SOV desc (pedido
// do usuário, 2026-08-08 — antes vinha crua do backend, risk_score desc) —
// clique no cabeçalho troca a ordenação (mesma spec: "podendo o usuário
// ordenar por outras opções"). ✅ Linhas com SOV zerado/nulo são ocultadas
// (mesmo pedido) — uma Narrativa sem menção nenhuma no período selecionado
// (comum ao trocar pra um período mais curto, ex: "Diário") não tem SOV
// nenhum a mostrar.
// ✅ **Coluna "Ação" removida (2026-07-14)** — pedido do usuário: "não está
// sendo usual, pois ao clicar no nome abre o modal e na linha destaca o
// card". O título (`Link` na própria célula "Narrativa") já navega/abre o
// modal de detalhe; a coluna extra só duplicava essa mesma ação.
export function NarrativesTable({
  rows,
  emptyMessage = "Nenhuma Narrativa em monitoramento.",
  onRowClick,
  selectedId,
  groupByCategory = false,
}: {
  rows: NarrativeRow[];
  emptyMessage?: string;
  onRowClick?: (row: NarrativeRow) => void;
  selectedId?: string | null;
  // ✅ Adicionado 2026-07-14 (pedido do usuário: "tabela dinâmica...
  // agrupando categoria e subcategoria ou apenas subcategoria como está
  // hoje") — quando `true`, agrupa as linhas por `category_label` (mesma
  // lógica de agrupamento já usada por `NarrativeCategoryLanes`), com um
  // cabeçalho de grupo expansível/recolhível por categoria. `false`
  // (default) preserva o comportamento original: lista plana de
  // Subcategorias, sem agrupamento.
  groupByCategory?: boolean;
}) {
  // Default: ordenado por SOV desc (pedido do usuário, 2026-08-08) — antes
  // não tinha sort inicial (null), a ordem vinha crua do backend
  // (get_narratives_table, `order by risk_score desc`).
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" } | null>({ key: "sov_pct", direction: "desc" });
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // ✅ Oculta Narrativas com SOV zerado/nulo (pedido do usuário, 2026-08-08:
  // "No mensal aparece uma narrativa, mas quando mudo para o diário tem
  // menos narrativas... algumas zeradas pq não foram citadas no dia") — uma
  // Narrativa sem nenhuma menção no período selecionado não tem SOV nenhum a
  // mostrar, então a linha só confundia (0%/"—" sem contexto). Mesmo
  // tratamento de "0 é o mesmo que ausência de dado" já usado na célula de
  // SOV logo abaixo (renderRow) e em ScoreList (charts/breakdown-panel.tsx).
  const visibleRows = useMemo(() => rows.filter((row) => row.sov_pct !== null && row.sov_pct !== 0), [rows]);

  const sortedRows = useMemo(() => {
    if (!sort) return visibleRows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...visibleRows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * factor;
      }
      return (Number(av) - Number(bv)) * factor;
    });
  }, [visibleRows, sort]);

  const groups = useMemo(
    () => (groupByCategory ? groupByCategoryLabel(sortedRows) : null),
    [groupByCategory, sortedRows],
  );

  function handleSort(key: SortKey) {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "desc" };
      return { key, direction: current.direction === "desc" ? "asc" : "desc" };
    });
  }

  function toggleCategory(category: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  if (visibleRows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  // ✅ Indentação da Subcategoria sob o cabeçalho da Categoria (pedido do
  // usuário, 2026-07-14: "dê uma identação para a subcategoria quando a
  // visualização for categoria e subcategoria... está tudo muito juntinho")
  // — só aplicada quando `groupByCategory` está ativo (`indent = true`);
  // a lista plana (sem agrupamento) mantém o padding original.
  function renderRow(row: NarrativeRow, indent = false) {
    return (
      <tr
        key={row.id}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        className={`border-b border-border-subtle-2 last:border-0 ${
          onRowClick ? "cursor-pointer hover:bg-bg-page" : ""
        } ${selectedId === row.id ? "bg-accent-blue-bg" : ""}`}
      >
        <td className={`py-3 font-medium text-text-primary ${indent ? "pl-8 pr-4" : "px-4"}`}>
          <Link
            href={`/narratives/${row.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent-blue hover:underline"
          >
            {row.title}
          </Link>
        </td>
        {/* sov_pct nunca é null/0 aqui — visibleRows já filtra essas linhas antes de chegar em renderRow */}
        <td className="px-4 py-3 text-text-secondary">{row.sov_pct}%</td>
        <td className="px-4 py-3">
          <TrendArrow score={row.trend_score} label={row.trend_label} />
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
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs font-bold uppercase tracking-wide text-text-primary">
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
          </tr>
        </thead>
        <tbody>
          {groups
            ? groups.map(({ category, rows: groupRows }) => {
                const isExpanded = !collapsedCategories.has(category);
                return (
                  <Fragment key={category}>
                    <tr className="border-b border-border-subtle bg-bg-page">
                      <td colSpan={COLUMNS.length} className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => toggleCategory(category)}
                          aria-expanded={isExpanded}
                          className="flex w-full items-center gap-2 text-left hover:opacity-80"
                        >
                          <span className="font-bold text-text-primary">{category}</span>
                          <span className="rounded-full bg-bg-card px-2 py-0.5 text-xs font-semibold text-text-secondary">
                            {groupRows.length}
                          </span>
                          <span className="ml-auto text-xs text-text-tertiary" aria-hidden>
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {isExpanded && groupRows.map((row) => renderRow(row, true))}
                  </Fragment>
                );
              })
            : sortedRows.map((row) => renderRow(row))}
        </tbody>
      </table>
    </div>
  );
}
