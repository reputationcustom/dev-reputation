"use client";

import { useState } from "react";
import type { NarrativeRow } from "@reputation/shared-types";
import { NarrativeCard } from "./narrative-card";
import { EmptyState } from "@/components/ui/empty-state";

// Agrupamento por categoria da grade de cards de Narrativa — pedido do
// usuário 2026-07-25: "os cards que ficam abaixo devem ser organizados
// pela categoria... raia ou outro componente que achar mais apropriado
// para facilitar o agrupamento e localização da narrativa."
//
// Uma "raia" por Category-pai (`narrative.category_label`, get_narratives_table,
// migration 20260725050000) — cabeçalho com o nome da categoria + contagem,
// seguido da mesma grade responsiva de `NarrativeCard` já usada antes deste
// agrupamento (sem raia de rolagem horizontal: este produto não usa esse
// padrão de interação em nenhum outro lugar, e uma grade que quebra linha
// continua 100% escaneável sem exigir arrastar/rolar pra o lado — mais
// alinhado ao objetivo de "localização" do pedido do que uma raia estilo
// Kanban). Categorias ordenadas alfabeticamente (pt-BR) — o objetivo aqui é
// achar uma Narrativa rápido, não priorizar por risco (a tabela acima já
// cobre priorização); dentro de cada categoria, a ordem original (risco
// desc, já vinda de `get_narratives_table`) é preservada.
//
// ✅ Estender/recolher por raia (2026-07-25, pedido do usuário): cada
// cabeçalho de categoria é um botão que alterna a visibilidade da grade
// daquela categoria — mesmo padrão visual (▲/▼) já usado pelo botão
// "Filtros" de `page-header-bar.tsx`, não um ícone novo. Todas as
// categorias começam expandidas (nenhum estado persistido entre
// navegações — mesmo padrão de `filtrosOpen` em `page-header-bar.tsx`,
// que também reseta ao montar).
function groupByCategory(rows: NarrativeRow[]): Array<{ category: string; rows: NarrativeRow[] }> {
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

// ✅ Oculta Narrativas com SOV zerado/nulo (pedido do usuário, 2026-08-08:
// "na visualização por cards, ocultar os cards que tiverem 0 menções,
// assim como já é feito com a tabela") — mesmo critério de
// `NarrativesTable` (`sov_pct !== null && sov_pct !== 0`): uma Narrativa
// sem nenhuma menção no período selecionado não tem SOV nenhum a mostrar,
// então o card só confundia (0%/"—" sem contexto).
function hasMentions(row: NarrativeRow): boolean {
  return row.sov_pct !== null && row.sov_pct !== 0;
}

export function NarrativeCategoryLanes({ rows }: { rows: NarrativeRow[] }) {
  const groups = groupByCategory(rows.filter(hasMentions));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(category: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  // Todas as Narrativas do período selecionado ficaram sem menção nenhuma
  // (ex: período "Diário" muito curto) — `rows.length > 0` na página
  // (narratives/page.tsx) só garante que existem Narrativas cadastradas,
  // não que alguma tenha menção neste período específico.
  if (groups.length === 0) {
    return <EmptyState message="Nenhuma Narrativa com menções neste período." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ category, rows: groupRows }) => {
        const isExpanded = !collapsed.has(category);
        const panelId = `narrative-lane-${category.replace(/\s+/g, "-")}`;

        return (
          <div key={category} className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => toggle(category)}
              aria-expanded={isExpanded}
              aria-controls={panelId}
              className="flex w-full items-center gap-2 border-b border-border-subtle pb-2 text-left hover:opacity-80"
            >
              <h3 className="font-bold text-text-primary">{category}</h3>
              <span className="rounded-full bg-bg-page px-2 py-0.5 text-xs font-semibold text-text-secondary">
                {groupRows.length}
              </span>
              <span className="ml-auto text-xs text-text-tertiary">{isExpanded ? "▲" : "▼"}</span>
            </button>

            {isExpanded && (
              <div id={panelId} className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                {groupRows.map((row) => (
                  <NarrativeCard key={row.id} narrative={row} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
