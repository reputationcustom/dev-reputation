"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_TIMEZONE } from "@/lib/date/format";

export interface UserProfile {
  fullName: string | null;
  isAdmin: boolean;
  isPrincipal: boolean;
  timezone: string;
  defaultOrganizationId: string | null;
}

type LoadState = "loading" | "error" | "loaded";

const FALLBACK_PROFILE: UserProfile = {
  fullName: null,
  isAdmin: false,
  isPrincipal: false,
  timezone: DEFAULT_TIMEZONE,
  defaultOrganizationId: null,
};

// Hook global de perfil do usuário logado (CLAUDE.md, "Fuso horário do
// usuário": `const { timezone } = useUserProfile()`). Segue o padrão de 3
// estados obrigatório pra fetch de carregamento inicial (CLAUDE.md, "Falha
// de comunicação com o backend") — `status` deixa quem precisa saber se o
// perfil já carregou de verdade (ex: /perfil, antes de deixar editar);
// componentes que só querem o fuso pra formatar uma data podem usar
// `timezone` direto, com fallback pro padrão (America/Sao_Paulo) enquanto
// carrega/se falhar — degrada bem sem travar a tela em nenhum dos casos.
export function useUserProfile() {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "loaded"; profile: UserProfile }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    async function load() {
      const supabase = createClient();

      // Filtro explícito por `id`, não só a RLS — `user_profiles_select_own`
      // era estritamente "só a própria linha", mas passou a devolver mais de
      // uma linha (RLS ampliada por algum motivo fora deste hook, ex.
      // visibilidade de admin sobre outros membros da organização), e
      // `.maybeSingle()` sem `.eq('id', ...)` trata ">1 linha" como erro
      // (PGRST116) mesmo com HTTP 200 — "meu perfil" nunca deveria depender
      // implicitamente da RLS ser estreita o bastante pra isso.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!user) {
        setState({ status: "error" });
        return;
      }

      const { data, error } = await supabase
        .from("user_profiles")
        .select("full_name, is_admin, is_principal, timezone, default_organization_id")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setState({ status: "error" });
        return;
      }

      setState({
        status: "loaded",
        profile: {
          fullName: data.full_name,
          isAdmin: data.is_admin,
          isPrincipal: data.is_principal,
          timezone: data.timezone ?? DEFAULT_TIMEZONE,
          defaultOrganizationId: data.default_organization_id,
        },
      });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const profile = state.status === "loaded" ? state.profile : FALLBACK_PROFILE;

  return {
    ...profile,
    status: state.status satisfies LoadState,
    retry,
  };
}
