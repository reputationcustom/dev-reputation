"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const RECENT_HIGHLIGHTS_HOURS = 72;
export const RECENT_HIGHLIGHTS_LIMIT = 10;

export interface RecentHighlight {
  id: string;
  event_type: string;
  severity: string | null;
  severity_score: number | null;
  title: string;
  summary: string;
  explanation: string;
  recommendation: string | null;
  confidence: number | null;
  tags: string[];
  related_narrative_id: string | null;
  related_entity_id: string | null;
  created_at: string;
  closed_at: string | null;
}

type LoadState = "loading" | "error" | "loaded";

// Widget "Radar de Eventos" (event-radar/frontend-highlights-feed.md) —
// janela fixa de 72h, independente do período selecionado no header (por
// isso não é buscado via usePageEnvelope/get-page-overview, que é
// escopado pelo período da página). Chama get_recent_highlights direto
// via supabase-js (RLS de feed_events já escopa por organização) — mesmo
// padrão de use-narratives-list.ts/use-communication-types.ts, sem Edge
// Function nova.
export function useRecentHighlights(organizationId: string | null) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; highlights: RecentHighlight[] }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_recent_highlights", {
        p_organization_id: organizationId,
        p_hours: RECENT_HIGHLIGHTS_HOURS,
        p_limit: RECENT_HIGHLIGHTS_LIMIT,
      });

      if (cancelled) return;

      if (error) {
        setState({ status: "error" });
        return;
      }

      setState({ status: "loaded", highlights: (data ?? []) as RecentHighlight[] });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, attempt]);

  return {
    status: state.status satisfies LoadState,
    highlights: state.status === "loaded" ? state.highlights : [],
    retry,
  };
}
