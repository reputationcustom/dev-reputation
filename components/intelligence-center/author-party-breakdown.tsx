"use client";

import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { partidoColor } from "./author-color";

// "Top partidos por alcance" — .dev/specs/intelligence-center/
// authors-and-influencers.md, "Redesenho interativo". Diferente do gráfico
// de ideologia (ordem fixa esquerda→direita), partido não tem uma ordem
// natural — aqui a ordem é por valor (soma de reach desc), até 8 partidos.
// Clique numa barra substitui a seleção de Partido da toolbar (um autor
// pertence a 1 partido só, não soma como os chips de ideologia).

const numberFormat = new Intl.NumberFormat("pt-BR", { notation: "compact" });
const MAX_PARTIES = 8;

export function AuthorPartyBreakdown({
  authors,
  onSelectPartido,
}: {
  authors: AuthorRow[];
  onSelectPartido: (partido: string) => void;
}) {
  const sums = new Map<string, number>();
  for (const author of authors) {
    if (author.entity_partido) {
      sums.set(author.entity_partido, (sums.get(author.entity_partido) ?? 0) + author.reach);
    }
  }
  const entries = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_PARTIES);

  if (entries.length === 0) {
    return <EmptyState message="Nenhum autor vinculado a um partido no filtro atual." />;
  }

  const max = entries[0][1];

  return (
    <div className="flex flex-col gap-2.5">
      {entries.map(([partido, reach]) => {
        const pct = (reach / max) * 100;
        return (
          <div key={partido} className="grid grid-cols-[80px_1fr_52px] items-center gap-2 text-xs">
            <span className="truncate text-right font-medium text-text-secondary">{partido}</span>
            <button
              type="button"
              onClick={() => onSelectPartido(partido)}
              className="h-5 overflow-hidden rounded bg-bg-page text-left"
              aria-label={`Filtrar por ${partido}`}
            >
              <div className="h-full rounded" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: partidoColor(partido) ?? "#9aa0ab" }} />
            </button>
            <span className="text-right text-text-secondary">{numberFormat.format(reach)}</span>
          </div>
        );
      })}
    </div>
  );
}
