"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface CommunicationTypeOption {
  id: string;
  code: string;
  label: string;
}

type LoadState = "loading" | "error" | "loaded";

// communication_types (communications/data-model.md) — tabela global de
// referência (não escopada por organização), leitura direta permitida a
// qualquer usuário autenticado. Só os tipos ativos, na ordem de exibição
// (`position`) já definida pela tabela.
export function useCommunicationTypes() {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; types: CommunicationTypeOption[] }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("communication_types")
        .select("id, code, label")
        .eq("is_active", true)
        .order("position");

      if (cancelled) return;
      if (error || !data) {
        setState({ status: "error" });
        return;
      }
      setState({ status: "loaded", types: data });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return {
    status: state.status satisfies LoadState,
    types: state.status === "loaded" ? state.types : [],
    retry,
  };
}
