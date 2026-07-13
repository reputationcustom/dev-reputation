import type { NarrativeRow } from "@reputation/shared-types";
import { NarrativeCard } from "./narrative-card";

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

export function NarrativeCategoryLanes({ rows }: { rows: NarrativeRow[] }) {
  const groups = groupByCategory(rows);

  return (
    <div className="flex flex-col gap-8">
      {groups.map(({ category, rows: groupRows }) => (
        <div key={category} className="flex flex-col gap-4">
          <div className="flex items-center gap-2 border-b border-border-subtle pb-2">
            <h3 className="font-bold text-text-primary">{category}</h3>
            <span className="rounded-full bg-bg-page px-2 py-0.5 text-xs font-semibold text-text-secondary">
              {groupRows.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {groupRows.map((row) => (
              <NarrativeCard key={row.id} narrative={row} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
