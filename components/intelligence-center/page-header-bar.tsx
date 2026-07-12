"use client";

import { ErrorMessage } from "@/components/ui/error-message";
import { PERIOD_OPTIONS, useIntelligenceCenterHeader } from "./header-context";

// Header global (2 seletores — organização ativa e período — ver
// intelligence-center/executive-overview.md, "Header"). Especificado uma
// única vez, reusado pelas 5 páginas via IntelligenceCenterProvider — sem
// seletor de Query (pedido explícito do usuário, ver mesma spec).
export function PageHeaderBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { organizations, organizationsStatus, retryOrganizations, organizationId, setOrganizationId, periodDays, setPeriodDays } =
    useIntelligenceCenterHeader();

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
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                onClick={() => setPeriodDays(option.days)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  periodDays === option.days
                    ? "bg-accent-blue text-white"
                    : "text-text-secondary hover:bg-bg-page"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
