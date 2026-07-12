"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { EnvelopePeriod } from "@reputation/shared-types";
import { useOrganizations, type Organization } from "@/hooks/use-organizations";
import { useUserProfile } from "@/hooks/use-user-profile";
import { getLastNDaysRange } from "@/lib/date/format";

// Diário/Semanal/Mensal/Personalizado — substitui o antigo seletor "7/14/30
// dias" (intelligence-center/executive-overview.md, "Header", 2026-07-15,
// a partir do protótipo real). Diário/Semanal/Mensal seguem sendo janelas
// corridas terminando hoje (1/7/30 dias, fuso do usuário); Personalizado
// usa um intervalo `start`/`end` escolhido nos 2 campos de data — o
// envelope já aceita qualquer intervalo (`ctx.period.start`/`end` chegam
// direto nas functions SQL via `p_period_start`/`p_period_end`, ver
// `aggregated-metrics/sql-aggregation.md`), então isso é só um cálculo
// novo no frontend, sem mudança de backend.
export type PeriodMode = "daily" | "weekly" | "monthly" | "custom";

const PERIOD_MODE_DAYS: Record<"daily" | "weekly" | "monthly", number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export const PERIOD_MODE_OPTIONS: { mode: PeriodMode; label: string }[] = [
  { mode: "daily", label: "Diário" },
  { mode: "weekly", label: "Semanal" },
  { mode: "monthly", label: "Mensal" },
  { mode: "custom", label: "Personalizado" },
];

export interface CustomRange {
  start: string;
  end: string;
}

interface HeaderContextValue {
  organizations: Organization[];
  organizationsStatus: "loading" | "error" | "loaded";
  retryOrganizations: () => void;
  organizationId: string | null;
  setOrganizationId: (id: string) => void;
  periodMode: PeriodMode;
  setPeriodMode: (mode: PeriodMode) => void;
  customRange: CustomRange;
  setCustomRange: (range: CustomRange) => void;
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
  const [periodMode, setPeriodModeState] = useState<PeriodMode>("weekly");
  const [customRange, setCustomRange] = useState<CustomRange>(() => {
    const range = getLastNDaysRange(PERIOD_MODE_DAYS.weekly);
    return { start: range.start, end: range.end };
  });

  useEffect(() => {
    if (organizationsStatus === "loaded" && organizations.length > 0 && !organizationId) {
      setOrganizationId(organizations[0].id);
    }
  }, [organizationsStatus, organizations, organizationId]);

  // Abrir "Personalizado" pela primeira vez preenche os 2 campos com o
  // intervalo do preset ativo até então, em vez de começar vazio
  // (intelligence-center/executive-overview.md, "Header").
  function setPeriodMode(mode: PeriodMode) {
    if (mode === "custom" && periodMode !== "custom") {
      const days = PERIOD_MODE_DAYS[periodMode];
      const range = getLastNDaysRange(days, timezone);
      setCustomRange({ start: range.start, end: range.end });
    }
    setPeriodModeState(mode);
  }

  const period = useMemo<EnvelopePeriod>(() => {
    if (periodMode === "custom") {
      return { start: customRange.start, end: customRange.end, granularity: "day", comparison: "previous_period" };
    }
    const range = getLastNDaysRange(PERIOD_MODE_DAYS[periodMode], timezone);
    return { start: range.start, end: range.end, granularity: "day", comparison: "previous_period" };
  }, [periodMode, customRange, timezone]);

  const value: HeaderContextValue = {
    organizations,
    organizationsStatus,
    retryOrganizations,
    organizationId,
    setOrganizationId,
    periodMode,
    setPeriodMode,
    customRange,
    setCustomRange,
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
