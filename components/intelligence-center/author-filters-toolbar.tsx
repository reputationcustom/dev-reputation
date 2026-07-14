"use client";

import type { AuthorRow } from "@reputation/shared-types";
import { IDEOLOGY_LABEL, IDEOLOGY_ORDER, IDEOLOGY_HEX, type ColorByMode, type Ideology } from "./author-color";

export interface AuthorFiltersState {
  search: string;
  partido: string;
  sentiment: "" | "positive" | "neutral" | "negative";
  onlyLinked: boolean;
  ideologies: Set<string>;
  colorBy: ColorByMode;
}

export const EMPTY_AUTHOR_FILTERS: AuthorFiltersState = {
  search: "",
  partido: "",
  sentiment: "",
  onlyLinked: false,
  ideologies: new Set(),
  colorBy: "ideologia",
};

// Toolbar de filtros + "Colorir por" — .dev/specs/intelligence-center/
// authors-and-influencers.md, "Redesenho interativo". Toda a filtragem é
// client-side (ver "Regras de negócio" da spec) — nenhum campo aqui dispara
// uma nova chamada de rede, só recalcula sobre `envelope.authors` já
// carregado.
export function AuthorFiltersToolbar({
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border-default bg-bg-card p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase text-text-tertiary">Colorir por</span>
          <div className="flex overflow-hidden rounded-full border border-border-default">
            {(["ideologia", "partido", "sentimento"] as const).map((mode, index) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ ...filters, colorBy: mode })}
                className={`px-3 py-1.5 text-xs font-medium ${index > 0 ? "border-l border-border-default" : ""} ${
                  filters.colorBy === mode ? "bg-accent-blue text-white" : "bg-bg-card text-text-secondary hover:bg-bg-page"
                }`}
              >
                {mode === "ideologia" ? "Ideologia" : mode === "partido" ? "Partido" : "Sentimento"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-w-[160px] flex-1 flex-col gap-1">
          <label className="text-[11px] font-bold uppercase text-text-tertiary" htmlFor="author-search">
            Buscar
          </label>
          <input
            id="author-search"
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Nome do autor..."
            className="rounded-md border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-primary"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase text-text-tertiary" htmlFor="author-partido">
            Partido
          </label>
          <select
            id="author-partido"
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
          <label className="text-[11px] font-bold uppercase text-text-tertiary" htmlFor="author-sentiment">
            Sentimento dominante
          </label>
          <select
            id="author-sentiment"
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

        <label className="flex items-center gap-2 pb-1.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={filters.onlyLinked}
            onChange={(e) => onChange({ ...filters, onlyLinked: e.target.checked })}
          />
          Só vinculados a Entidades
        </label>

        <button
          type="button"
          onClick={() => onChange(EMPTY_AUTHOR_FILTERS)}
          className="ml-auto rounded-md border border-border-default px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-page"
        >
          Limpar filtros
        </button>
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
