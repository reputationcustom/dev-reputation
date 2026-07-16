"use client";

import { useParams } from "next/navigation";
import { NarrativeDetailContent } from "@/components/intelligence-center/narrative-detail-content";

// Detalhe de Narrativa (`/narratives/[id]`,
// intelligence-center/narratives-exploration.md). Renderizada quando a URL
// é acessada diretamente (link compartilhado, recarregar a página) — nesse
// caso não há interceptação, então esta é a página "de verdade" que o
// Next.js serve. Navegação client-side a partir de qualquer página dentro
// de `(analytics)` é interceptada pelo modal
// (`@modal/(.)narratives/[id]/page.tsx`) em vez desta página — ambas
// reusam o mesmo `NarrativeDetailContent`, só o "chrome" ao redor muda.
export default function NarrativeDetailPage() {
  const params = useParams<{ id: string }>();
  return <NarrativeDetailContent narrativeId={params.id} />;
}
