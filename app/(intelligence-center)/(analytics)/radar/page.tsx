"use client";

import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { RecentEventsPanel } from "@/components/intelligence-center/recent-events-panel";
import { RECENT_HIGHLIGHTS_HOURS } from "@/hooks/use-recent-highlights";

// Radar de Eventos (`/radar`, event-radar/frontend-highlights-feed.md) —
// destino próprio no menu para o mesmo feed fixo de 72h que já existe como
// widget em /overview (pedido do usuário, 2026-08-02: "nessa página nova
// será possível acompanhar o que ocorreu nas últimas 72h, quais foram as
// tendências... basicamente o feed do que foi identificado"). Reaproveita
// o mesmo componente (RecentEventsPanel) e a mesma janela fixa — não é uma
// segunda fonte de dado, é o mesmo feed em dois lugares (resumo rápido na
// Visão Geral, destino dedicado aqui). PageHeaderBar mantém organização/
// período visíveis por consistência de navegação (mesmo padrão de
// communications/page.tsx), mas o seletor de período não afeta esta
// página — a janela é sempre fixa, nunca o período do header.
export default function RadarPage() {
  return (
    <>
      <PageHeaderBar
        title="Radar de Eventos"
        subtitle={`Feed do que o motor de detecção identificou nas últimas ${RECENT_HIGHLIGHTS_HOURS} horas.`}
      />
      <div className="p-8">
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <RecentEventsPanel />
        </div>
      </div>
    </>
  );
}
