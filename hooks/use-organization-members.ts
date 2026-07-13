"use client";

import { useCallback, useEffect, useState } from "react";
import { callFunction } from "@/lib/supabase/call-function";

export interface OrganizationMemberOption {
  id: string;
  full_name: string | null;
}

type LoadState = "loading" | "error" | "loaded";

// Membros da organização ativa, via Edge Function `list-organization-members`
// — não dá pra ler isso direto pelo client (user_profiles/organization_members
// só têm policy de SELECT pra própria linha, ver o comentário no topo
// daquela function). Popula o select "Responsável" do formulário de
// Comunicação/Decisão e o lookup de nome usado por
// communications-table.tsx/impact-timeline.tsx.
export function useOrganizationMembers(organizationId: string | null) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; members: OrganizationMemberOption[] }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      try {
        const result = await callFunction<{ members: OrganizationMemberOption[] }>(
          "list-organization-members",
          { organizationId },
        );
        if (!cancelled) setState({ status: "loaded", members: result.members });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, attempt]);

  return {
    status: state.status satisfies LoadState,
    members: state.status === "loaded" ? state.members : [],
    retry,
  };
}
