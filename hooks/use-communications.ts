"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CommunicationRow, CommunicationRecordType } from "@/components/communications/types";

type LoadState = "loading" | "error" | "loaded";

export interface CommunicationsFilters {
  narrativeId?: string | null;
  recordType?: CommunicationRecordType | null;
  communicationTypeId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

// Listagem de Comunicações e Decisões (communications/communication-registration.md)
// — leitura direta pelo client (sem Edge Function): `communications` tem
// RLS de organização (não "só a própria linha" como user_profiles), então
// um SELECT com join em `narratives`/`communication_types` (ambas também
// legíveis via RLS) já é suficiente. Nomes de responsável/criador são
// resolvidos à parte via `useOrganizationMembers` (RLS bloqueia esse join
// direto — ver list-organization-members).
export function useCommunications(organizationId: string | null, filters: CommunicationsFilters) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; rows: CommunicationRow[] }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      const supabase = createClient();
      let query = supabase
        .from("communications")
        .select(
          "id, narrative_id, record_type, title, description, occurred_at, channel_detail, external_url, bw_resource_id, assignee_id, created_by, communication_type_id, narratives(title), communication_types(label)",
        )
        .eq("organization_id", organizationId)
        .order("occurred_at", { ascending: false });

      if (filters.narrativeId) query = query.eq("narrative_id", filters.narrativeId);
      if (filters.recordType) query = query.eq("record_type", filters.recordType);
      if (filters.communicationTypeId) query = query.eq("communication_type_id", filters.communicationTypeId);
      if (filters.periodStart) query = query.gte("occurred_at", filters.periodStart);
      if (filters.periodEnd) query = query.lte("occurred_at", filters.periodEnd);

      const { data, error } = await query;

      if (cancelled) return;
      if (error || !data) {
        setState({ status: "error" });
        return;
      }
      setState({ status: "loaded", rows: data as unknown as CommunicationRow[] });
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    organizationId,
    filters.narrativeId,
    filters.recordType,
    filters.communicationTypeId,
    filters.periodStart,
    filters.periodEnd,
    attempt,
  ]);

  return {
    status: state.status satisfies LoadState,
    rows: state.status === "loaded" ? state.rows : [],
    retry,
  };
}
