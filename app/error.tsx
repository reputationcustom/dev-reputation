"use client";

import { useEffect } from "react";
import { ErrorMessage } from "@/components/ui/error-message";
import { BACKEND_ERROR_MESSAGE } from "@/lib/errors";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-error";

// Boundary de erro do App Router (.dev/specs — regra global "Falha de
// comunicação com o backend"): captura qualquer exceção não tratada de um
// Server Component (ex: `error` de uma query Supabase que foi propagado via
// throw em vez de ignorado) em qualquer rota abaixo da raiz sem um
// error.tsx mais específico, e mostra uma mensagem amigável + "Tentar
// novamente" em vez de deixar a tela quebrada/em branco.
//
// ChunkLoadError (deploy no Hostinger sobrescreve _next/static/chunks/ e uma
// aba já aberta referencia um hash antigo, ver lib/chunk-error.ts) recebe
// tratamento à parte: reload automático (uma única vez por sessão) em vez da
// mensagem genérica de erro de backend, que seria enganosa aqui.
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  const isChunkError = isChunkLoadError(error);

  useEffect(() => {
    if (isChunkError) {
      reloadOnceForChunkError();
    }
  }, [isChunkError]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-page px-4">
      <div className="w-full max-w-md">
        <ErrorMessage
          message={
            isChunkError
              ? "Uma nova versão do sistema foi publicada. Atualizando…"
              : BACKEND_ERROR_MESSAGE
          }
          onRetry={reset}
        />
      </div>
    </main>
  );
}
