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
// mantém organização visível por consistência de navegação (mesmo padrão
// de communications/page.tsx).
//
// ✅ Seletor de período escondido nesta página (2026-07-14, pedido
// explícito do usuário) — `hidePeriodSelector`, PageHeaderBar. O "Resumo
// executivo" (2ª aba) é janela fixa de 72h desde 2026-07-16
// (`ui_meta.radar_summary_text`), igual à "Lista" — o período do header
// nunca afeta nada nesta página, então esconder o controle aqui é
// puramente para não sugerir um efeito que não existe. Esta página busca
// o mesmo envelope de `get-page-overview` (não existe `get-page-radar`)
// só pra ler esse campo — o período em si continua existindo no contexto
// global (herdado da última seleção feita em outra página), só o controle
// de troca não aparece nesta.
export default function RadarPage() {
  const { envelope } = usePageEnvelope("get-page-overview");

  return (
    <>
      <PageHeaderBar
        title="Radar de Eventos"
        subtitle={`Feed do que o motor de detecção identificou nas últimas ${RECENT_HIGHLIGHTS_HOURS} horas.`}
        hidePeriodSelector
      />
      <div className="p-8">
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <RecentEventsPanel
            radarSummaryText={
              envelope?.ui_meta && typeof envelope.ui_meta.radar_summary_text === "string"
                ? envelope.ui_meta.radar_summary_text
                : null
            }
          />
        </div>
      </div>
    </>
  );
}
