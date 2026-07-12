"use client";

import { ErrorMessage } from "@/components/ui/error-message";
import { BACKEND_ERROR_MESSAGE } from "@/lib/errors";

// Boundary de erro do App Router (.dev/specs — regra global "Falha de
// comunicação com o backend"): captura qualquer exceção não tratada de um
// Server Component (ex: `error` de uma query Supabase que foi propagado via
// throw em vez de ignorado) em qualquer rota abaixo da raiz sem um
// error.tsx mais específico, e mostra uma mensagem amigável + "Tentar
// novamente" em vez de deixar a tela quebrada/em branco.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-page px-4">
      <div className="w-full max-w-md">
        <ErrorMessage message={BACKEND_ERROR_MESSAGE} onRetry={reset} />
      </div>
    </main>
  );
}
