"use client";

import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { ENTITY_TYPE_HEX, ENTITY_TYPE_LABEL, ENTITY_TYPE_ORDER, type EntityType } from "./author-color";

// "Por tipo de Entidade" — guia "Por Entidade" (redesenho em 2 guias,
// .dev/specs/intelligence-center/authors-and-influencers.md, 2026-08-08).
// Pedido do usuário: "incluindo não só partido, mas imprensa, e outras
// organizações que pode existir na tabela entities" — esta é a
// visualização que responde isso diretamente (entities.type, não só
// entities.partido). Ordem fixa (ENTITY_TYPE_ORDER), não por valor, mesma
// convenção de ideologia — os 7 valores do enum são sempre os mesmos, uma
// ordem estável ajuda a comparar entre recargas.

const numberFormat = new Intl.NumberFormat("pt-BR", { notation: "compact" });

function sumByType(authors: AuthorRow[]): Record<EntityType, number> {
  const sums = Object.fromEntries(ENTITY_TYPE_ORDER.map((t) => [t, 0])) as Record<EntityType, number>;
  for (const author of authors) {
    if (author.entity_type && (ENTITY_TYPE_ORDER as readonly string[]).includes(author.entity_type)) {
      sums[author.entity_type as EntityType] += author.reach;
    }
  }
  return sums;
}

export function AuthorEntityTypeBreakdown({
  authors,
  activeTypes,
  onToggleType,
}: {
  authors: AuthorRow[];
  activeTypes: Set<string>;
  onToggleType: (type: EntityType) => void;
}) {
  const sums = sumByType(authors);
  const entries = ENTITY_TYPE_ORDER.map((type) => [type, sums[type]] as const).filter(([, value]) => value > 0);

  if (entries.length === 0) {
    return <EmptyState message="Nenhuma Entidade vinculada no filtro atual." />;
  }

  const max = Math.max(1, ...entries.map(([, value]) => value));

  return (
    <div className="flex flex-col gap-2.5">
      {entries.map(([type, value]) => {
        const pct = (value / max) * 100;
        const isActive = activeTypes.size === 0 || activeTypes.has(type);
        return (
          <div key={type} className="grid grid-cols-[130px_1fr_52px] items-center gap-2 text-xs">
            <span className="truncate text-right text-text-secondary">{ENTITY_TYPE_LABEL[type]}</span>
            <button
              type="button"
              onClick={() => onToggleType(type)}
              className="h-5 overflow-hidden rounded bg-bg-page text-left"
              aria-label={`Filtrar por ${ENTITY_TYPE_LABEL[type]}`}
            >
              <div
                className="h-full rounded transition-[width]"
                style={{ width: `${Math.max(2, pct)}%`, backgroundColor: ENTITY_TYPE_HEX[type], opacity: isActive ? 1 : 0.35 }}
              />
            </button>
            <span className="text-right text-text-secondary">{numberFormat.format(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
