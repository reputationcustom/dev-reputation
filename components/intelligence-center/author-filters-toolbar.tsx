"use client";

import type { AuthorRow } from "@reputation/shared-types";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_ORDER, ENTITY_TYPE_HEX, IDEOLOGY_LABEL, IDEOLOGY_ORDER, IDEOLOGY_HEX, type EntityType, type Ideology } from "./author-color";

// Estado de filtro compartilhado pelas 2 guias (redesenho em 2 guias,
// .dev/specs/intelligence-center/authors-and-influencers.md, 2026-08-08) —
// cada campo só é lido/alterado pela guia a que pertence:
// `search`/`sentiment` (as 2 guias), `narrativeLabel` (só "Visão Geral"),
// `entityTypes`/`partido`/`ideologies` (só "Por Entidade"). Um objeto só
// evita duplicar a lógica de reset/estado entre as 2 guias.
//
// ✅ `colorBy` removido (2026-08-09, pedido do usuário: "retire a opção
// Colorir por, pois os filtros rápidos logo abaixo faz mais sentido") — a
// guia "Por Entidade" sempre colore por tipo de Entidade agora (fixo, ver
// page.tsx), os chips de Tipo/Ideologia abaixo já cumprem o papel de
// destacar uma dimensão.
export interface AuthorFiltersState {
  search: string;
  sentiment: "" | "positive" | "neutral" | "negative";
  narrativeLabel: string;
  entityTypes: Set<string>;
  partido: string;
  ideologies: Set<string>;
}

export const EMPTY_AUTHOR_FILTERS: AuthorFiltersState = {
  search: "",
  sentiment: "",
  narrativeLabel: "",
  entityTypes: new Set(),
  partido: "",
  ideologies: new Set(),
};

// Toolbar da guia "Visão Geral" — só busca + sentimento (ideologia/partido/
// tipo de Entidade não fazem sentido aqui, são o assunto da outra guia). O
// filtro de Narrativa/pauta é setado clicando numa barra de
// AuthorNarrativeInvolvement, não por um campo aqui — quando ativo, aparece
// como um chip removível pra ficar descobrível.
export function AuthorGeneralFiltersToolbar({
  filters,
  onChange,
}: {
  filters: AuthorFiltersState;
  onChange: (next: AuthorFiltersState) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border-default bg-bg-card p-4">
      <div className="flex min-w-[160px] flex-1 flex-col gap-1">
        <label className="text-[11px] font-bold uppercase text-text-tertiary" htmlFor="author-general-search">
          Buscar
        </label>
        <input
          id="author-general-search"
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Nome do autor ou da Entity..."
          className="rounded-md border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-primary"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-bold uppercase text-text-tertiary" htmlFor="author-general-sentiment">
          Sentimento dominante
        </label>
        <select
          id="author-general-sentiment"
          value={filters.sentiment}
          onChange={(e) => onChange({ ...filters, sentiment: e.target.value as AuthorFiltersState["sentiment"] })}
          className="rounded-md border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-primary"
        >
          <option value="">Todos</option>
          <option value="positive">Positivo</option>
          <option value="neutral">Neutro</option>
          <option value="negative">Negativo</option>
        </select>
      </div>

      {filters.narrativeLabel && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-blue-bg px-3 py-1.5 text-xs font-medium text-accent-blue">
          Narrativa: {filters.narrativeLabel}
          <button type="button" onClick={() => onChange({ ...filters, narrativeLabel: "" })} aria-label="Remover filtro de narrativa">
            ✕
          </button>
        </span>
      )}

      <button
        type="button"
        onClick={() => onChange(EMPTY_AUTHOR_FILTERS)}
        className="ml-auto rounded-md border border-border-default px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-page"
      >
        Limpar filtros
      </button>
    </div>
  );
}

// Toolbar da guia "Por Entidade" — todo autor considerado aqui já está
// vinculado a uma Entity (filtro implícito de onlyLinked, aplicado pela
// página antes de chegar aqui) — os controles giram em torno de COMO
// segmentar essas Entities: tipo (pessoa/partido/veículo de imprensa/
// instituição/empresa/movimento/outro), partido e ideologia.
export function AuthorEntityFiltersToolbar({
  authors,
  filters,
  onChange,
}: {
  authors: AuthorRow[];
  filters: AuthorFiltersState;
  onChange: (next: AuthorFiltersState) => void;
}) {
  const partidos = [...new Set(authors.map((a) => a.entity_partido).filter((p): p is string => Boolean(p)))].sort();

  function toggleIdeology(ideology: Ideology) {
    const next = new Set(filters.ideologies);
    if (next.has(ideology)) next.delete(ideology);
    else next.add(ideology);
    onChange({ ...filters, ideologies: next });
  }

  function toggleEntityType(type: EntityType) {
    const next = new Set(filters.entityTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange({ ...filters, entityTypes: next });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border-default bg-bg-card p-4">
        <div className="flex min-w-[160px] flex-1 flex-col gap-1">
          <label className="text-[11px] font-bold uppercase text-text-tertiary" htmlFor="author-entity-search">
            Buscar
          </label>
          <input
            id="author-entity-search"
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Nome do autor ou da Entity (ex: Revista Fórum)..."
            className="rounded-md border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-primary"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase text-text-tertiary" htmlFor="author-entity-partido">
            Partido
          </label>
          <select
            id="author-entity-partido"
            value={filters.partido}
            onChange={(e) => onChange({ ...filters, partido: e.target.value })}
            className="rounded-md border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-primary"
          >
            <option value="">Todos</option>
            {partidos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase text-text-tertiary" htmlFor="author-entity-sentiment">
            Sentimento dominante
          </label>
          <select
            id="author-entity-sentiment"
            value={filters.sentiment}
            onChange={(e) => onChange({ ...filters, sentiment: e.target.value as AuthorFiltersState["sentiment"] })}
            className="rounded-md border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-primary"
          >
            <option value="">Todos</option>
            <option value="positive">Positivo</option>
            <option value="neutral">Neutro</option>
            <option value="negative">Negativo</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => onChange(EMPTY_AUTHOR_FILTERS)}
          className="ml-auto rounded-md border border-border-default px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-page"
        >
          Limpar filtros
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase text-text-tertiary">Tipo de Entidade:</span>
        {ENTITY_TYPE_ORDER.map((type) => {
          const active = filters.entityTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleEntityType(type)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active ? "border-transparent text-white" : "border-border-default text-text-secondary hover:bg-bg-page"
              }`}
              style={active ? { backgroundColor: ENTITY_TYPE_HEX[type] } : undefined}
            >
              {ENTITY_TYPE_LABEL[type]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase text-text-tertiary">Ideologia:</span>
        {IDEOLOGY_ORDER.map((ideology) => {
          const active = filters.ideologies.has(ideology);
          return (
            <button
              key={ideology}
              type="button"
              onClick={() => toggleIdeology(ideology)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active ? "border-transparent text-white" : "border-border-default text-text-secondary hover:bg-bg-page"
              }`}
              style={active ? { backgroundColor: IDEOLOGY_HEX[ideology] } : undefined}
            >
              {IDEOLOGY_LABEL[ideology]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
