"use client";

import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { authorColorHex, authorInitials, dominantSentiment, SENTIMENT_HEX } from "./author-color";

// "Detratores" / "Impulsionadores" — guia "Visão Geral" (redesenho em 2
// guias, .dev/specs/intelligence-center/authors-and-influencers.md,
// 2026-08-08). Reaproveita o mesmo `dominantSentiment` já usado no resto da
// página — só autores dentro do recorte enriquecido de sentimento (top ~10
// por volume, ver AuthorRow.sentiment_*) aparecem aqui; os demais não têm
// como ser classificados como detrator/impulsionador sem inventar um dado.
// Ordenado por alcance (o mesmo critério de relevância já usado pelo
// ranking principal), até 6 por lado.

const MAX_ITEMS = 6;
const numberFormat = new Intl.NumberFormat("pt-BR", { notation: "compact" });

function AuthorMiniList({
  title,
  authors,
  accentHex,
  onSelectAuthor,
  emptyMessage,
}: {
  title: string;
  authors: AuthorRow[];
  accentHex: string;
  onSelectAuthor?: (author: AuthorRow) => void;
  emptyMessage: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase text-text-tertiary">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accentHex }} aria-hidden />
        {title}
      </h4>
      {authors.length === 0 ? (
        <p className="py-2 text-xs italic text-text-tertiary">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {authors.map((author) => (
            <li key={author.name}>
              <button
                type="button"
                onClick={() => onSelectAuthor?.(author)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-bg-page"
              >
                <span
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: authorColorHex(author, "sentimento") }}
                  aria-hidden
                >
                  {authorInitials(author.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">{author.name}</span>
                  <span className="block truncate text-xs text-text-tertiary">
                    {author.entity_cargo ?? author.entity_partido ?? "—"}
                  </span>
                </span>
                <span className="flex-shrink-0 text-right text-xs text-text-secondary">
                  <span className="block font-medium text-text-primary">{numberFormat.format(author.reach)}</span>
                  <span className="block">alcance</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AuthorDetractorsBoosters({
  authors,
  onSelectAuthor,
}: {
  authors: AuthorRow[];
  onSelectAuthor?: (author: AuthorRow) => void;
}) {
  const withSentiment = authors.filter((a) => dominantSentiment(a) !== null);

  if (withSentiment.length === 0) {
    return <EmptyState message="Nenhum autor com sentimento classificado no filtro atual (fora do recorte de autores enriquecidos)." />;
  }

  const detractors = withSentiment
    .filter((a) => dominantSentiment(a) === "negative")
    .sort((a, b) => b.reach - a.reach)
    .slice(0, MAX_ITEMS);
  const boosters = withSentiment
    .filter((a) => dominantSentiment(a) === "positive")
    .sort((a, b) => b.reach - a.reach)
    .slice(0, MAX_ITEMS);

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <AuthorMiniList
        title="Detratores"
        authors={detractors}
        accentHex={SENTIMENT_HEX.negative}
        onSelectAuthor={onSelectAuthor}
        emptyMessage="Nenhum autor predominantemente negativo no filtro atual."
      />
      <AuthorMiniList
        title="Impulsionadores"
        authors={boosters}
        accentHex={SENTIMENT_HEX.positive}
        onSelectAuthor={onSelectAuthor}
        emptyMessage="Nenhum autor predominantemente positivo no filtro atual."
      />
    </div>
  );
}
