"use client";

import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

// "Envolvimento em narrativas" — guia "Visão Geral" (redesenho em 2 guias,
// .dev/specs/intelligence-center/authors-and-influencers.md, 2026-08-08).
// Deriva 100% client-side de AuthorRow.narrative_labels (já buscado pelo
// envelope, sem chamada de rede nova) — um autor pode ter mais de um label,
// então a barra soma quantos autores DISTINTOS citam cada Narrativa/pauta,
// não uma soma de menções (isso já é coberto pela própria tabela de
// Narrativas). Clique numa barra filtra a lista de autores da guia por
// aquele label (single-select — mesmo autor pode aparecer em mais de uma
// barra, mas só 1 filtro ativo por vez, igual ao filtro de Partido).

const MAX_LABELS = 8;

export function AuthorNarrativeInvolvement({
  authors,
  activeLabel,
  onSelectLabel,
}: {
  authors: AuthorRow[];
  activeLabel: string;
  onSelectLabel: (label: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const author of authors) {
    for (const label of author.narrative_labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_LABELS);

  if (entries.length === 0) {
    return <EmptyState message="Nenhum autor associado a uma Narrativa/pauta no filtro atual." />;
  }

  const max = entries[0][1];

  return (
    <div className="flex flex-col gap-2.5">
      {entries.map(([label, count]) => {
        const pct = (count / max) * 100;
        const isActive = activeLabel === label;
        return (
          <div key={label} className="grid grid-cols-[1fr_1fr_70px] items-center gap-2 text-xs">
            <span className="truncate text-right text-text-secondary">{label}</span>
            <button
              type="button"
              onClick={() => onSelectLabel(isActive ? "" : label)}
              className="h-5 overflow-hidden rounded bg-bg-page text-left"
              aria-label={`Filtrar por ${label}`}
            >
              <div
                className="h-full rounded bg-accent-blue transition-[width]"
                style={{ width: `${Math.max(2, pct)}%`, opacity: activeLabel === "" || isActive ? 1 : 0.35 }}
              />
            </button>
            <span className="text-right text-text-secondary">{count} autor{count === 1 ? "" : "es"}</span>
          </div>
        );
      })}
    </div>
  );
}
