"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { EnvelopePeriod } from "@reputation/shared-types";
import { useOrganizations, type Organization } from "@/hooks/use-organizations";
import { useUserProfile } from "@/hooks/use-user-profile";
import { getLastNDaysRange } from "@/lib/date/format";

export type PeriodDays = 7 | 14 | 30;

export const PERIOD_OPTIONS: { days: PeriodDays; label: string }[] = [
  { days: 7, label: "7 dias" },
  { days: 14, label: "14 dias" },
  { days: 30, label: "30 dias" },
];

interface HeaderContextValue {
  organizations: Organization[];
  organizationsStatus: "loading" | "error" | "loaded";
  retryOrganizations: () => void;
  organizationId: string | null;
  setOrganizationId: (id: string) => void;
  periodDays: PeriodDays;
  setPeriodDays: (days: PeriodDays) => void;
  period: EnvelopePeriod;
}

const HeaderContext = createContext<HeaderContextValue | null>(null);

// Header global (intelligence-center/overview.md: "as cinco páginas
// compartilham os mesmos 2 seletores — organização ativa e período").
// Trocar organização/período aqui reescopa os dados de toda a navegação —
// cada página só lê deste contexto, nunca gerencia o próprio seletor
// (evita duplicar a mesma lógica 5 vezes). Sem persistência entre reloads
// nesta primeira versão (volta para a primeira organização/7 dias a cada
// carregamento da aplicação) — suficiente para o Sprint 2, sem pedido
// explícito de persistência ainda.
export function IntelligenceCenterProvider({ children }: { children: React.ReactNode }) {
  const { status: organizationsStatus, organizations, retry: retryOrganizations } = useOrganizations();
  const { timezone } = useUserProfile();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState<PeriodDays>(7);

  useEffect(() => {
    if (organizationsStatus === "loaded" && organizations.length > 0 && !organizationId) {
      setOrganizationId(organizations[0].id);
    }
  }, [organizationsStatus, organizations, organizationId]);

  const period = useMemo<EnvelopePeriod>(() => {
    const range = getLastNDaysRange(periodDays, timezone);
    return { start: range.start, end: range.end, granularity: "day", comparison: "previous_period" };
  }, [periodDays, timezone]);

  const value: HeaderContextValue = {
    organizations,
    organizationsStatus,
    retryOrganizations,
    organizationId,
    setOrganizationId,
    periodDays,
    setPeriodDays,
    period,
  };

  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function useIntelligenceCenterHeader(): HeaderContextValue {
  const ctx = useContext(HeaderContext);
  if (!ctx) {
    throw new Error("useIntelligenceCenterHeader deve ser usado dentro de IntelligenceCenterProvider");
  }
  return ctx;
}
