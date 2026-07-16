"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface NarrativeOption {
  id: string;
  title: string;
}

type LoadState = "loading" | "error" | "loaded";

interface BwCategoryEmbed {
  status: string;
  parent_id: number | null;
}

interface NarrativeRow {
  id: string;
  title: string;
  bw_categories: BwCategoryEmbed | BwCategoryEmbed[] | null;
}

// Lista simples de Narrativas (id/título) para o `NarrativeCombobox`
// (communications/communication-registration.md) — mesma granularidade
// "folha" (Subcategory ativa) usada em toda a UI do produto
// (narrativesScopeForPage, aggregated-metrics-service.ts), replicada aqui
// via join direto porque esta é uma leitura simples fora do envelope de
// página (RLS já escopa `narratives`/`bw_categories` por organização).
export function useNarrativesList(organizationId: string | null) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; narratives: NarrativeOption[] }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("narratives")
        .select("id, title, bw_categories!inner(status, parent_id)")
        .eq("organization_id", organizationId)
        .eq("bw_categories.status", "active")
        .not("bw_categories.parent_id", "is", null)
        .order("title");

      if (cancelled) return;

      if (error || !data) {
        setState({ status: "error" });
        return;
      }

      const narratives = (data as unknown as NarrativeRow[]).map((row) => ({ id: row.id, title: row.title }));
      setState({ status: "loaded", narratives });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, attempt]);

  return {
    status: state.status satisfies LoadState,
    narratives: state.status === "loaded" ? state.narratives : [],
    retry,
  };
}
