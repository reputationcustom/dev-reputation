"use client";

import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

// Ordenação por qualquer coluna, padrão para toda tabela do sistema
// (CLAUDE.md, Regras transversais de UX #11) — extraído do padrão já usado
// por NarrativesTable (components/intelligence-center/narratives-table.tsx,
// desde 2026-08-08) pra virar um hook/componente compartilhado, em vez de
// cada tabela nova reimplementar o mesmo `useState`/`.sort()`/botão de
// cabeçalho do zero. `getValue` decide o valor comparável por coluna — nulo/
// indefinido sempre vai pro fim, independente da direção (mesma regra já
// usada em NarrativesTable), string compara via `localeCompare('pt-BR')`,
// número via subtração.
export function useSortableRows<T, K extends string>(
  rows: T[],
  getValue: (row: T, key: K) => string | number | null | undefined,
  initialSort: SortState<K> | null = null,
) {
  const [sort, setSort] = useState<SortState<K> | null>(initialSort);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = getValue(a, sort.key);
      const bv = getValue(b, sort.key);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv), "pt-BR") * factor;
      }
      return (Number(av) - Number(bv)) * factor;
    });
  }, [rows, sort, getValue]);

  // Primeiro clique numa coluna nova ordena desc (maior/mais recente
  // primeiro) — mesma convenção já fixada em NarrativesTable; clique de
  // novo na mesma coluna alterna asc/desc.
  function toggleSort(key: K) {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "desc" };
      return { key, direction: current.direction === "desc" ? "asc" : "desc" };
    });
  }

  return { sort, sortedRows, toggleSort };
}

// Cabeçalho de coluna clicável — mesmo markup/classes de NarrativesTable
// (botão com hover + seta ↓/↑ só na coluna ativa), reusado por qualquer
// tabela nova. `label` pode ser um nó (ex: um rótulo + Tooltip de "?"), não
// só texto simples.
export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: {
  label: React.ReactNode;
  sortKey: K;
  sort: SortState<K> | null;
  onSort: (key: K) => void;
  className?: string;
}) {
  return (
    <th className={`px-4 py-3 font-bold ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 hover:text-text-primary"
      >
        {label}
        {sort?.key === sortKey && <span aria-hidden>{sort.direction === "desc" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}
