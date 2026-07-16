"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Organization {
  id: string;
  name: string;
}

type LoadState = "loading" | "error" | "loaded";

// Organizações do usuário logado (CLAUDE.md, "Multi-tenancy": um usuário
// pode pertencer a 1+ organizações). Usado pelo seletor de organização do
// header global (intelligence-center/executive-overview.md, "Header") —
// RLS (organization_members_select_own) já garante que só vêm organizações
// das quais o usuário é membro, sem filtro explícito aqui.
export function useOrganizations() {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; organizations: Organization[] }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("organization_members")
        .select("organizations(id, name)");

      if (cancelled) return;

      if (error || !data) {
        setState({ status: "error" });
        return;
      }

      const organizations = data
        .map((row) => row.organizations as unknown as Organization | null)
        .filter((org): org is Organization => org != null)
        .sort((a, b) => a.name.localeCompare(b.name));

      setState({ status: "loaded", organizations });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return {
    status: state.status satisfies LoadState,
    organizations: state.status === "loaded" ? state.organizations : [],
    retry,
  };
}
