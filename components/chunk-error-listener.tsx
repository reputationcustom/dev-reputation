"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-error";

// Cobre falhas de import() dinâmico durante navegação/prefetch do router
// (unhandledrejection) — essas nunca chegam a app/error.tsx, que só captura
// erros de render. Ver lib/chunk-error.ts para o porquê do reload.
export function ChunkErrorListener() {
  useEffect(() => {
    function handleRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadError(event.reason)) {
        reloadOnceForChunkError();
      }
    }
    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
  }, []);

  return null;
}
