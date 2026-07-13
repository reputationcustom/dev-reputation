"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { NarrativeDetailContent } from "@/components/intelligence-center/narrative-detail-content";

// Casca do modal de Detalhe de Narrativa — usada só pela rota
// interceptadora (`@modal/(.)narratives/[id]/page.tsx`). Não reusa
// `components/ui/modal.tsx` de propósito: aquele componente é pra diálogos
// pequenos (confirmação, `max-w-md`), e este conteúdo (gráficos, tabelas,
// grafo de disseminação) precisa de bem mais espaço/rolagem própria.
// Fechar = `router.back()` (volta pra URL anterior no histórico, ex:
// `/narratives` ou `/overview` — de onde quer que o link tenha sido
// clicado), tanto pelo X quanto pelo clique fora do painel quanto por Esc —
// mesmo padrão recomendado pela documentação do Next.js pra este exato
// tipo de rota interceptadora.
export function NarrativeDetailModal({ narrativeId }: { narrativeId: string }) {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") router.back();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={() => router.back()}
    >
      <div
        className="relative w-full max-w-5xl rounded-xl bg-bg-page shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Fechar"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-bg-card text-text-tertiary shadow hover:text-text-primary"
        >
          ✕
        </button>
        <NarrativeDetailContent narrativeId={narrativeId} isModal />
      </div>
    </div>
  );
}
