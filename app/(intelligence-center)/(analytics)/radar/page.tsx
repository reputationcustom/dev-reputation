"use client";

import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { RecentEventsPanel } from "@/components/intelligence-center/recent-events-panel";
import { RECENT_HIGHLIGHTS_HOURS } from "@/hooks/use-recent-highlights";
import { usePageEnvelope } from "@/hooks/use-page-envelope";

// Radar de Eventos (`/radar`, event-radar/frontend-highlights-feed.md) —
// destino próprio no menu para o mesmo feed fixo de 72h que já existe como
// widget em /overview (pedido do usuário, 2026-08-02: "nessa página nova
// será possível acompanhar o que ocorreu nas últimas 72h, quais foram as
// tendências... basicamente o feed do que foi identificado"). Reaproveita
// o mesmo componente (RecentEventsPanel) e a mesma janela fixa pra "Lista"
// — não é uma segunda fonte de dado, é o mesmo feed em dois lugares
// (resumo rápido na Visão Geral, destino dedicado aqui). PageHeaderBar
// mantém organização/período visíveis por consistência de navegação
// (mesmo padrão de communications/page.tsx); o seletor de período segue
// sem efeito sobre "Lista" (sempre 72h fixo), mas ✅ 2026-07-14 passou a
// afetar o "Resumo executivo" (2ª aba do toggle): esta página busca o
// mesmo envelope de `get-page-overview` (não existe `get-page-radar` —
// `/radar` não tem blocos próprios além do feed de eventos) só pra ler
// `narrative_text`, período-escopado pelo header — mesmo texto que
// aparece em "O que os gráficos mostram?" na Visão Geral, já que é
// literalmente o mesmo registro (mesma organização/período/página).
export default function RadarPage() {
  const { envelope, retry } = usePageEnvelope("get-page-overview");

  return (
    <>
      <PageHeaderBar
        title="Radar de Eventos"
        subtitle={`Feed do que o motor de detecção identificou nas últimas ${RECENT_HIGHLIGHTS_HOURS} horas.`}
      />
      <div className="p-8">
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <RecentEventsPanel narrativeText={envelope?.narrative_text ?? null} page="overview" onGenerated={retry} />
        </div>
      </div>
    </>
  );
}
