"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/ui/error-message";
import { formatDateOnly } from "@/lib/date/format";
import { PERIOD_MODE_OPTIONS, useIntelligenceCenterHeader } from "./header-context";

// Header global (2 seletores — organização ativa e período — ver
// intelligence-center/executive-overview.md, "Header"). Especificado uma
// única vez, reusado pelas 5 páginas via IntelligenceCenterProvider — sem
// seletor de Query (pedido explícito do usuário, ver mesma spec).
export function PageHeaderBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const {
    organizations,
    organizationsStatus,
    retryOrganizations,
    organizationId,
    setOrganizationId,
    periodMode,
    setPeriodMode,
    customRange,
    setCustomRange,
  } = useIntelligenceCenterHeader();

  return (
    <div className="flex flex-col gap-4 border-b border-border-default bg-bg-card px-8 py-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {organizationsStatus === "error" && (
            <ErrorMessage message="Não foi possível carregar suas organizações." onRetry={retryOrganizations} />
          )}

          {organizationsStatus === "loaded" && organizations.length > 1 && (
            <select
              value={organizationId ?? ""}
              onChange={(event) => setOrganizationId(event.target.value)}
              className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex rounded-md border border-border-default p-0.5">
            {PERIOD_MODE_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => setPeriodMode(option.mode)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  periodMode === option.mode
                    ? "bg-accent-blue text-white"
                    : "text-text-secondary hover:bg-bg-page"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {periodMode === "custom" && (
            <CustomRangePicker range={customRange} onChange={setCustomRange} />
          )}
        </div>
      </div>
    </div>
  );
}

// Popover com 2 campos de data — abre preenchido com o intervalo atual
// (nunca vazio, ver header-context.tsx). "Aplicar" só confirma se
// start <= end, senão mantém o popover aberto com o erro inline (mesmo
// padrão de validação client-side do resto do produto, CLAUDE.md "Regras
// transversais de UX" #4).
function CustomRangePicker({
  range,
  onChange,
}: {
  range: { start: string; end: string };
  onChange: (range: { start: string; end: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(range);
    setError(null);
  }, [open, range]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleApply() {
    if (draft.start > draft.end) {
      setError("A data inicial precisa ser anterior à data final.");
      return;
    }
    onChange(draft);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="rounded-md border border-border-default px-3 py-2 text-sm font-medium text-text-primary hover:bg-bg-page"
      >
        {formatDateOnly(range.start)} – {formatDateOnly(range.end)}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border-default bg-bg-card p-4 shadow-lg">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Data inicial
              <input
                type="date"
                value={draft.start}
                max={draft.end}
                onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))}
                className="rounded-md border border-border-default px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Data final
              <input
                type="date"
                value={draft.end}
                min={draft.start}
                onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))}
                className="rounded-md border border-border-default px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue"
              />
            </label>
            {error && <p className="text-xs text-[#e0483e]">{error}</p>}
            <button
              type="button"
              onClick={handleApply}
              className="mt-1 rounded-md bg-accent-blue px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
