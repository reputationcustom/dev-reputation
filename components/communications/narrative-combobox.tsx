"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NarrativeOption } from "@/hooks/use-narratives-list";

// Combobox com busca (communications/communication-registration.md,
// "Interface (UI)") — primeiro campo do produto com filtro por texto.
// Filtro client-side sobre a lista já carregada (sem chamada nova por
// tecla digitada) — justificado pelo pedido do usuário de "facilitar ao
// máximo": digitar pra filtrar é bem mais rápido que rolar uma lista longa
// de Narrativas.
export function NarrativeCombobox({
  narratives,
  value,
  onChange,
  disabled,
  placeholder = "Buscar Narrativa…",
}: {
  narratives: NarrativeOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = narratives.find((n) => n.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selected?.title ?? "");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(selected?.title ?? "");
  }, [selected?.title]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery(selected?.title ?? "");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, selected?.title]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return narratives;
    return narratives.filter((n) => n.title.toLowerCase().includes(q));
  }, [narratives, query]);

  function selectNarrative(option: NarrativeOption) {
    onChange(option.id);
    setQuery(option.title);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[highlightIndex];
      if (option) selectNarrative(option);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(selected?.title ?? "");
    }
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlightIndex(0);
        }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls="narrative-combobox-list"
        className="w-full rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
      />
      {open && !disabled && (
        <ul
          id="narrative-combobox-list"
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border-default bg-bg-card py-1 shadow-lg"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-text-tertiary">Nenhuma Narrativa encontrada.</li>
          )}
          {filtered.map((option, index) => (
            <li key={option.id} role="option" aria-selected={option.id === value}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectNarrative(option)}
                className={`block w-full truncate px-3 py-2 text-left text-sm ${
                  index === highlightIndex ? "bg-bg-page text-text-primary" : "text-text-primary"
                } ${option.id === value ? "font-semibold" : ""}`}
              >
                {option.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
