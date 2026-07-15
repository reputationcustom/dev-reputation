"use client";

import { useCallback, useEffect, useState } from "react";
import type { EnvelopeFilters, PageEnvelope, TopicSortMode } from "@reputation/shared-types";
import { callFunction } from "@/lib/supabase/call-function";
import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";

type LoadState = "loading" | "error" | "loaded";

const EMPTY_FILTERS: EnvelopeFilters = {
  narratives: [],
  themes: [],
  platforms: [],
  sentiment: [],
  region: [],
  author_type: [],
  risk_level: [],
};

// Busca o envelope de uma página (aggregated-metrics/standard-json-envelope.md)
// via a Edge Function get-page-* correspondente (edge-functions-per-page.md)
// — organização/período sempre vêm do header global
// (IntelligenceCenterProvider), nunca escolhidos pela própria página
// (Princípio técnico 2). `narrativeId`/`pautaId` são os únicos parâmetros
// extras que alguma página precisa passar (get-narrative-detail/
// get-page-themes). `topicSort` (✅ 2026-08-09, migration 20260809130000)
// é opcional — só as páginas que renderizam tags/positive_topics/
// negative_topics ou term_signals passam um valor; omitido, o backend
// usa o default 'trending' (mesmo default do lado SQL). Segue o padrão de
// 3 estados obrigatório pra fetch de carregamento inicial (CLAUDE.md,
// "Falha de comunicação com o backend").
export function usePageEnvelope(
  functionName: string,
  options?: { narrativeId?: string; pautaId?: string; topicSort?: TopicSortMode },
) {
  const { organizationId, period } = useIntelligenceCenterHeader();
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; envelope: PageEnvelope }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      try {
        const envelope = await callFunction<PageEnvelope>(functionName, {
          organization_id: organizationId,
          period,
          filters: EMPTY_FILTERS,
          ...(options?.narrativeId ? { narrative_id: options.narrativeId } : {}),
          ...(options?.pautaId ? { pauta_id: options.pautaId } : {}),
          ...(options?.topicSort ? { topic_sort: options.topicSort } : {}),
        });
        if (!cancelled) setState({ status: "loaded", envelope });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    functionName,
    organizationId,
    period.start,
    period.end,
    options?.narrativeId,
    options?.pautaId,
    options?.topicSort,
    attempt,
  ]);

  return {
    status: state.status satisfies LoadState,
    envelope: state.status === "loaded" ? state.envelope : null,
    retry,
  };
}
