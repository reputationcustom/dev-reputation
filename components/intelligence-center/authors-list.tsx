"use client";

import { useMemo, useState } from "react";
import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/ui/pagination";
import {
  authorColorHex,
  authorInitials,
  AUTHOR_ROLE_HEX,
  AUTHOR_ROLE_LABEL,
  authorRole,
  dominantSentiment,
  entitySegment,
  entityTypeLabel,
  formatPlatforms,
  ideologyBadgeClass,
  ideologyLabel,
  SENTIMENT_HEX,
  SENTIMENT_LABEL,
} from "./author-color";

// Ranking de autores (bloco `authors`) — reusado em detalhe de Narrativa
// ("principais disseminadores"), Pautas Eleitorais ("autores e comunidades
// por pauta") e nas 2 guias da página dedicada `/authors` ("Autores e
// Influenciadores"). `risk_level` fica sempre `—` (ver sql-aggregation.md,
// get_authors_ranking — sem fórmula de risco por autor ainda, distinto de
// `entity_influence_level`, ver authors-and-influencers.md).
//
// ✅ Redesenhado 2026-08-01 (interativo/ordenável/paginado), 2026-08-08
// (redesenho em 2 guias) e novamente 2026-08-08 (variant "disseminators" —
// ver `variant` abaixo): a tabela agora tem 4 conjuntos de colunas,
// escolhidos por `variant`, todos sobre o mesmo dado já buscado, nenhum
// re-fetch:
//   - `full` (default, único uso: Pautas Eleitorais) — Autor/Tipo/Menções/
//     Alcance/Engaj./Sentimento. ✅ **Trocado 2026-08-09** (pedido do
//     usuário: "Na tabela Autores e comunidades por pauta substitua a
//     coluna Partido por tipo de entidade... Retire da tabela o campo
//     ideologia") — antes era Autor/Partido/Ideologia/Menções/Alcance/
//     Engaj./Sentimento (7 colunas, daí o nome `full`, mantido por ser o
//     variant default, mesmo não sendo mais literalmente "todas as
//     colunas"). "Tipo" (`entity_type`) só preenche quando o autor tem
//     vínculo real com uma Entity (`entity_accounts`, ver
//     `entities/author-linking.md`) — `—` sem vínculo, nunca inventado.
//   - `general` — guia "Visão Geral" de /authors: sem Partido/Ideologia
//     (assunto da outra guia), foco em menções/alcance/engajamento/
//     sentimento/narrativas.
//   - `entity` — guia "Por Entidade" de /authors: troca Partido por "Tipo"
//     (entities.type — pessoa/partido/veículo de imprensa/instituição/
//     empresa/movimento/outro, ver author-color.ts) antes de Partido/
//     Ideologia, já que esta guia existe justamente pra "não só partido,
//     mas imprensa e outras organizações" (pedido do usuário, 2026-08-08).
//   - `disseminators` — "Formação e propagação — principais disseminadores"
//     do detalhe de Narrativa ("quem move a conversa", pedido do usuário
//     2026-08-08): Autor/Plataforma/Papel na conversa/Seguidores/
//     Publicações/Engajamento. `platforms`/`role` são derivados
//     (`author-color.ts`) de dado já real — `AuthorRow.platforms`
//     (get_authors_ranking, só reporta uma plataforma com sinal de fato
//     presente em `platform_stats`, nunca fabricada) e
//     `entity_type`/sentimento dominante (nunca um cálculo novo de
//     backend). Ordenação padrão por Seguidores (não por Alcance, que esta
//     variante não exibe).
//
// `narrative_labels` (chips soltos abaixo do nome) = a quais
// Narrativas/pautas o autor está associado no escopo atual — só populado
// de verdade na página Pautas Eleitorais (get_authors_ranking com
// p_scope='pautas') ou na guia "Visão Geral" de /authors quando o filtro de
// narrativa está ativo.
//
// Badge de sentimento (positivo/neutro/negativo dominante do autor) só
// aparece quando os 3 campos vêm preenchidos — na prática, só os top 10
// autores por volume da Query inteira (enriquecidos via
// bw_query_author_topics). `null` não é "sem sentimento", é "ainda não
// enriquecido" — o badge simplesmente não aparece, nunca mostra um valor
// inventado.

export type AuthorsListVariant = "full" | "general" | "entity" | "disseminators";

type SortKey =
  | "name"
  | "entity_type"
  | "entity_partido"
  | "entity_ideologia"
  | "mentions"
  | "reach"
  | "engagement"
  | "sentiment"
  | "platforms"
  | "role"
  | "followers";

const COLUMNS_BY_VARIANT: Record<AuthorsListVariant, { key: SortKey; label: string; numeric?: boolean }[]> = {
  full: [
    { key: "name", label: "Autor" },
    { key: "entity_type", label: "Tipo" },
    { key: "mentions", label: "Menções", numeric: true },
    { key: "reach", label: "Alcance", numeric: true },
    { key: "engagement", label: "Engaj.", numeric: true },
    { key: "sentiment", label: "Sentimento" },
  ],
  general: [
    { key: "name", label: "Autor" },
    { key: "mentions", label: "Menções", numeric: true },
    { key: "reach", label: "Alcance", numeric: true },
    { key: "engagement", label: "Engaj.", numeric: true },
    { key: "sentiment", label: "Sentimento" },
  ],
  entity: [
    { key: "name", label: "Autor" },
    { key: "entity_type", label: "Tipo" },
    { key: "entity_partido", label: "Partido" },
    { key: "entity_ideologia", label: "Ideologia" },
    { key: "mentions", label: "Menções", numeric: true },
    { key: "reach", label: "Alcance", numeric: true },
    { key: "engagement", label: "Engaj.", numeric: true },
    { key: "sentiment", label: "Sentimento" },
  ],
  disseminators: [
    { key: "name", label: "Autor" },
    { key: "platforms", label: "Plataforma" },
    { key: "role", label: "Papel na conversa" },
    { key: "followers", label: "Seguidores", numeric: true },
    { key: "mentions", label: "Publicações", numeric: true },
    { key: "engagement", label: "Engajamento", numeric: true },
  ],
};

const DEFAULT_SORT_BY_VARIANT: Record<AuthorsListVariant, SortKey> = {
  full: "reach",
  general: "reach",
  entity: "reach",
  disseminators: "followers",
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const decimalFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function sortValue(author: AuthorRow, key: SortKey): string | number {
  if (key === "sentiment") {
    const s = dominantSentiment(author);
    if (!s) return -1;
    return (author.sentiment_positive ?? 0) - (author.sentiment_negative ?? 0);
  }
  if (key === "role") {
    const role = authorRole(author);
    return role ? AUTHOR_ROLE_LABEL[role] : "";
  }
  if (key === "platforms") return formatPlatforms(author.platforms);
  if (key === "followers") return author.followers ?? -1;
  if (key === "entity_type") return entityTypeLabel(author.entity_type) ?? "";
  if (key === "entity_partido") return author.entity_partido ?? "";
  if (key === "entity_ideologia") return author.entity_ideologia ?? "";
  return author[key];
}

export function AuthorsList({
  authors,
  emptyMessage = "Ainda sincronizando autores para este escopo.",
  onSelectAuthor,
  variant = "full",
}: {
  authors: AuthorRow[];
  emptyMessage?: string;
  onSelectAuthor?: (author: AuthorRow) => void;
  variant?: AuthorsListVariant;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(() => ({
    key: DEFAULT_SORT_BY_VARIANT[variant],
    direction: "desc",
  }));
  const [page, setPage] = useState(1);
  const columns = COLUMNS_BY_VARIANT[variant];

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
              {columns.map((column) => (
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
              const role = authorRole(author);
              const subtitle = variant === "general" ? author.entity_cargo : author.entity_cargo ?? entitySegment(author);
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
                        style={{
                          backgroundColor: authorColorHex(
                            author,
                            variant === "entity" || variant === "full"
                              ? "entity_type"
                              : variant === "disseminators"
                                ? "sentimento"
                                : "ideologia",
                          ),
                        }}
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
                        {subtitle && <div className="truncate text-xs text-text-tertiary">{subtitle}</div>}
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
                  {(variant === "entity" || variant === "full") && (
                    <td className="px-4 py-3 text-xs text-text-secondary">{entityTypeLabel(author.entity_type) ?? "—"}</td>
                  )}
                  {variant === "disseminators" && (
                    <td className="px-4 py-3 text-xs text-text-secondary">{formatPlatforms(author.platforms)}</td>
                  )}
                  {variant === "entity" && (
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
                  )}
                  {variant === "entity" && (
                    <td className="px-4 py-3">
                      {ideoBadge ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ideoBadge.bg} ${ideoBadge.text}`}>
                          {ideologyLabel(author.entity_ideologia)}
                        </span>
                      ) : (
                        <span className="text-xs text-text-tertiary">—</span>
                      )}
                    </td>
                  )}
                  {variant === "disseminators" && (
                    <td className="px-4 py-3">
                      {role ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: AUTHOR_ROLE_HEX[role] }}>
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: AUTHOR_ROLE_HEX[role] }} aria-hidden />
                          {AUTHOR_ROLE_LABEL[role]}
                        </span>
                      ) : (
                        <span className="text-xs text-text-tertiary">—</span>
                      )}
                    </td>
                  )}
                  {variant === "disseminators" && (
                    <td className="px-4 py-3 text-right text-text-secondary">
                      {author.followers === null ? "—" : numberFormat.format(author.followers)}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right text-text-secondary">{numberFormat.format(author.mentions)}</td>
                  {variant !== "disseminators" && (
                    <td className="px-4 py-3 text-right text-text-secondary">{numberFormat.format(author.reach)}</td>
                  )}
                  <td className="px-4 py-3 text-right text-text-secondary">{decimalFormat.format(author.engagement)}</td>
                  {variant !== "disseminators" && (
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
                  )}
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
