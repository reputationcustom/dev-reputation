"use client";

import { useParams } from "next/navigation";
import { NarrativeDetailModal } from "@/components/intelligence-center/narrative-detail-modal";

// Rota interceptadora (`(.)narratives/[id]` — mesmo nível de
// app/(intelligence-center)/(analytics)/, intercepta qualquer navegação
// client-side pra `/narratives/[id]` disparada de dentro de `(analytics)`,
// não só a partir de `/narratives`). Implementa a decisão já registrada em
// intelligence-center/narratives-exploration.md desde 2026-07-12 ("modal
// sobre a lista... via intercepting route"), simplificada pra página cheia
// em 2026-07-15 por volume de trabalho da sessão (_pending.md, gap #16) —
// implementada de fato agora.
export default function InterceptedNarrativeDetailPage() {
  const params = useParams<{ id: string }>();
  return <NarrativeDetailModal narrativeId={params.id} />;
}
