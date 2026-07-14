"use client";

import { useMemo, useState } from "react";
import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/ui/pagination";
import {
  authorColorHex,
  authorInitials,
  dominantSentiment,
  ideologyBadgeClass,
  ideologyLabel,
  SENTIMENT_HEX,
  SENTIMENT_LABEL,
} from "./author-color";

// Ranking de autores (bloco `authors`) — reusado em detalhe de Narrativa
// ("principais disseminadores"), Pautas Eleitorais ("autores e comunidades
// por pauta") e na página dedicada `/authors` ("Autores e Influenciadores").
// `risk_level` fica sempre `—` (ver sql-aggregation.md, get_authors_ranking
// — sem fórmula de risco por autor ainda, distinto de `entity_influence_level`,
// ver authors-and-influencers.md).
//
// ✅ Redesenhado 2026-08-01 (.dev/specs/intelligence-center/authors-and-influencers.md,
// "Redesenho interativo") — evolui de lista estática cortada em 15 linhas
// pra tabela ordenável/paginada com colunas Partido/Ideologia/Menções
// (`entity_*`, ver entities/author-linking.md). `onSelectAuthor` é opcional
// — as 2 páginas mais simples (Pautas, detalhe de Narrativa) continuam sem
// passar essa prop e a tabela funciona igual, só sem abrir painel de
// detalhe ao clicar na linha.
//
// `narrative_labels` (chips soltos abaixo do nome) = a quais
// Narrativas/pautas o autor está associado no escopo atual — só populado
// de verdade na página Pautas Eleitorais (get_authors_ranking com
// p_scope='pautas').
//
// Badge de sentimento (positivo/neutro/negativo dominante do autor) só
// aparece quando os 3 campos vêm preenchidos — na prática, só os top 10
// autores por volume da Query inteira (enriquecidos via
// bw_query_author_topics). `null` não é "sem sentimento", é "ainda não
// enriquecido" — o badge simplesmente não aparece, nunca mostra um valor
// inventado.

type SortKey = "name" | "entity_partido" | "entity_ideologia" | "mentions" | "reach" | "engagement" | "sentiment";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Autor" },
  { key: "entity_partido", label: "Partido" },
  { key: "entity_ideologia", label: "Ideologia" },
  { key: "mentions", label: "Menções", numeric: true },
  { key: "reach", label: "Alcance", numeric: true },
  { key: "engagement", label: "Engaj.", numeric: true },
  { key: "sentiment", label: "Sentimento" },
];

const numberFormat = new Intl.NumberFormat("pt-BR");
const decimalFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function sortValue(author: AuthorRow, key: SortKey): string | number {
  if (key === "sentiment") {
    const s = dominantSentiment(author);
    if (!s) return -1;
    return (author.sentiment_positive ?? 0) - (author.sentiment_negative ?? 0);
  }
  if (key === "entity_partido") return author.entity_partido ?? "";
  if (key === "entity_ideologia") return author.entity_ideologia ?? "";
  return author[key];
}

export function AuthorsList({
  authors,
  emptyMessage = "Ainda sincronizando autores para este escopo.",
  onSelectAuthor,
}: {
  authors: AuthorRow[];
  emptyMessage?: string;
  onSelectAuthor?: (author: AuthorRow) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "reach", direction: "desc" });
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...authors].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * factor;
      }
      return (Number(av) - Number(bv)) * factor;
    });
  }, [authors, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = sorted.slice((currentPage - 1) * DEFAULT_PAGE_SIZE, currentPage * DEFAULT_PAGE_SIZE);

  if (authors.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  function handleSort(key: SortKey) {
    setSort((current) => (current.key !== key ? { key, direction: "desc" } : { key, direction: current.direction === "desc" ? "asc" : "desc" }));
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-xs font-bold uppercase tracking-wide text-text-primary">
              {COLUMNS.map((column) => (
                <th key={column.key} className={`px-4 py-3 font-bold ${column.numeric ? "text-right" : ""}`}>
                  <button
                    type="button"
                    onClick={() => handleSort(column.key)}
                    className={`flex items-center gap-1 hover:text-text-primary ${column.numeric ? "ml-auto" : ""}`}
                  >
                    {column.label}
                    {sort.key === column.key && <span aria-hidden>{sort.direction === "desc" ? "↓" : "↑"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.map((author) => {
              const sentiment = dominantSentiment(author);
              const ideoBadge = ideologyBadgeClass(author.entity_ideologia);
              return (
                <tr
                  key={author.name}
                  onClick={onSelectAuthor ? () => onSelectAuthor(author) : undefined}
                  className={`border-b border-border-subtle-2 last:border-0 ${onSelectAuthor ? "cursor-pointer hover:bg-bg-page" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: authorColorHex(author, "ideologia") }}
                        aria-hidden
                      >
                        {authorInitials(author.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-text-primary">{author.name}</span>
                          {author.is_influential && (
                            <span className="flex-shrink-0 rounded-full bg-accent-blue-bg px-2 py-0.5 text-xs font-medium text-accent-blue">
                              Influente
                            </span>
                          )}
                        </div>
                        {author.entity_cargo && <div className="truncate text-xs text-text-tertiary">{author.entity_cargo}</div>}
                        {author.narrative_labels.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {author.narrative_labels.map((label) => (
                              <span key={label} className="rounded-full bg-bg-page px-2 py-0.5 text-xs text-text-secondary">
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {author.entity_partido ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: authorColorHex(author, "partido") }}
                          aria-hidden
                        />
                        {author.entity_partido}
                      </span>
                    ) : (
                      <span className="text-xs text-text-tertiary">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {ideoBadge ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ideoBadge.bg} ${ideoBadge.text}`}>
                        {ideologyLabel(author.entity_ideologia)}
                      </span>
                    ) : (
                      <span className="text-xs text-text-tertiary">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">{numberFormat.format(author.mentions)}</td>
                  <td className="px-4 py-3 text-right text-text-secondary">{numberFormat.format(author.reach)}</td>
                  <td className="px-4 py-3 text-right text-text-secondary">{decimalFormat.format(author.engagement)}</td>
                  <td className="px-4 py-3">
                    {sentiment ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: SENTIMENT_HEX[sentiment] }}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SENTIMENT_HEX[sentiment] }} aria-hidden />
                        {SENTIMENT_LABEL[sentiment]}
                      </span>
                    ) : (
                      <span className="text-xs text-text-tertiary">sem dado</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
