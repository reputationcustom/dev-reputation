"use client";

import { useCallback, useEffect, useState } from "react";
import { callFunction } from "@/lib/supabase/call-function";
import type { CommunicationTimelineItem } from "@/components/communications/types";

type LoadState = "loading" | "error" | "loaded";

// Linha do tempo de impacto de uma Narrativa (communications/narrative-impact-tracking.md)
// — via Edge Function `get-narrative-communication-timeline` (cálculo real,
// reaproveita get_narratives_table/get_communication_impact, não uma
// leitura simples de tabela).
export function useNarrativeCommunicationTimeline(
  organizationId: string | null,
  narrativeId: string | null,
  windowDays: 3 | 7 | 14 = 7,
) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; items: CommunicationTimelineItem[] }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!organizationId || !narrativeId) return;
    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      try {
        const result = await callFunction<{ items: CommunicationTimelineItem[] }>(
          "get-narrative-communication-timeline",
          { organization_id: organizationId, narrative_id: narrativeId, window_days: windowDays },
        );
        if (!cancelled) setState({ status: "loaded", items: result.items });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, narrativeId, windowDays, attempt]);

  return {
    status: state.status satisfies LoadState,
    items: state.status === "loaded" ? state.items : [],
    retry,
  };
}
