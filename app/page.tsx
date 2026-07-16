"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Renderiza vazio e só redireciona no client, depois do HTML já ter
// respondido 200 — "/" é a rota de health check da Hostinger (ver
// CLAUDE.md, "Deploy (Hostinger) — regras globais"), nunca pode fazer
// redirect no servidor.
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        router.replace(session ? "/overview" : "/login");
      })
      .catch((error) => {
        // Falha de comunicação com o Supabase (rede/timeout) — sem este
        // catch, a promise rejeitada nunca chama router.replace() e a
        // página fica em branco para sempre (ver CLAUDE.md, "Falha de
        // comunicação com o Supabase no middleware", 2026-07-16).
        console.error("[HomePage] getSession failed", error);
        router.replace("/backend-unavailable");
      });
  }, [router]);

  return null;
}
