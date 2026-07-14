"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { EnvelopePeriod } from "@reputation/shared-types";
import { useOrganizations, type Organization } from "@/hooks/use-organizations";
import { useUserProfile } from "@/hooks/use-user-profile";
import { getLastNDaysRange } from "@/lib/date/format";
import { callFunction } from "@/lib/supabase/call-function";

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
  defaultOrganizationId: string | null;
  isSettingDefaultOrganization: boolean;
  setCurrentOrganizationAsDefault: () => Promise<void>;
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
// (evita duplicar a mesma lógica 5 vezes). Período continua sem
// persistência entre reloads (volta para "Semanal" a cada carregamento —
// sem pedido explícito de persistir período). A organização ativa, porém,
// persiste via `user_profiles.default_organization_id` (pedido do usuário,
// 2026-07-22) — ver `setCurrentOrganizationAsDefault` abaixo: ao carregar,
// prefere a organização marcada como padrão (se o usuário ainda for membro
// dela) antes de cair de volta para a primeira organização retornada.
export function IntelligenceCenterProvider({ children }: { children: React.ReactNode }) {
  const { status: organizationsStatus, organizations, retry: retryOrganizations } = useOrganizations();
  const {
    timezone,
    defaultOrganizationId,
    status: userProfileStatus,
    retry: retryUserProfile,
  } = useUserProfile();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isSettingDefaultOrganization, setIsSettingDefaultOrganization] = useState(false);
  const [periodMode, setPeriodModeState] = useState<PeriodMode>("weekly");
  const [customRange, setCustomRange] = useState<CustomRange>(() => {
    const range = getLastNDaysRange(PERIOD_MODE_DAYS.weekly);
    return { start: range.start, end: range.end };
  });

  // `useOrganizations()` e `useUserProfile()` são 2 fetches independentes —
  // sem o gate em `userProfileStatus !== "loading"`, um reload completo
  // (Ctrl+R) tinha uma condição de corrida real: se a lista de organizações
  // resolvesse antes do perfil (comum, é a query mais simples das duas),
  // este efeito rodava com `defaultOrganizationId` ainda no fallback
  // (`null`, perfil não carregou de verdade ainda), travava em
  // `organizations[0]` via `!organizationId`, e nunca mais reavaliava
  // quando o `defaultOrganizationId` real chegava um instante depois — a
  // organização padrão salva parecia nunca ser respeitada num reload frio.
  // Aguardar o perfil sair de "loading" (carregado OU erro — erro degrada
  // pro mesmo fallback de antes, `organizations[0]`) fecha a corrida.
  useEffect(() => {
    if (
      organizationsStatus === "loaded" &&
      organizations.length > 0 &&
      !organizationId &&
      userProfileStatus !== "loading"
    ) {
      const preferred = defaultOrganizationId
        ? organizations.find((org) => org.id === defaultOrganizationId)
        : undefined;
      setOrganizationId((preferred ?? organizations[0]).id);
    }
  }, [organizationsStatus, organizations, organizationId, defaultOrganizationId, userProfileStatus]);

  // Chamada pelo seletor do header (page-header-bar.tsx) — grava a
  // organização atualmente ativa como padrão via
  // update-my-default-organization (valida server-side que o usuário é
  // membro dela, Princípio 2). `retryUserProfile()` refaz o fetch de
  // `user_profiles` pra refletir o novo `defaultOrganizationId` sem exigir
  // reload da página.
  const setCurrentOrganizationAsDefault = useCallback(async () => {
    if (!organizationId) return;
    setIsSettingDefaultOrganization(true);
    try {
      await callFunction("update-my-default-organization", { organizationId });
      retryUserProfile();
    } finally {
      setIsSettingDefaultOrganization(false);
    }
  }, [organizationId, retryUserProfile]);

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

  // `mode` viaja junto no envelope.period (ai-synthesis.md, Camada 1) —
  // é o que permite o backend saber se deve compor a síntese em IA
  // automaticamente (daily/weekly/monthly) ou só sob pedido explícito do
  // usuário (custom, via botão "Analisar com IA" em NarrativeTextPanel).
  const period = useMemo<EnvelopePeriod>(() => {
    if (periodMode === "custom") {
      return {
        start: customRange.start,
        end: customRange.end,
        granularity: "day",
        comparison: "previous_period",
        mode: "custom",
      };
    }
    const range = getLastNDaysRange(PERIOD_MODE_DAYS[periodMode], timezone);
    return { start: range.start, end: range.end, granularity: "day", comparison: "previous_period", mode: periodMode };
  }, [periodMode, customRange, timezone]);

  const value: HeaderContextValue = {
    organizations,
    organizationsStatus,
    retryOrganizations,
    organizationId,
    setOrganizationId,
    defaultOrganizationId,
    isSettingDefaultOrganization,
    setCurrentOrganizationAsDefault,
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
