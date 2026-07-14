"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { PlatformParticipationBars } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { TopicSentimentList } from "@/components/intelligence-center/term-signals-list";
import { EmptyState } from "@/components/ui/empty-state";

// Análise por Plataforma (`/platforms`, intelligence-center/platform-analysis.md).
// ⚠️ Gaps desta versão (sem function SQL correspondente, ver _pending.md):
// evolução do volume por plataforma ao longo do tempo, engajamento médio
// por publicação, autores únicos por plataforma (o dado existe em
// `bw_query_metrics_daily_by_platform`, mas `BreakdownItem` não expõe
// esses 2 campos — só label/value/pct — sem function/envelope novo pra
// isso ainda), velocidade de propagação por plataforma e conteúdos de
// destaque (mentions individuais). "Sentimento por plataforma" não se
// repete aqui — já é o próprio widget da página de Sentimento; esta
// página usa a mesma breakdown só que como "Participação por plataforma"
// (protótipo original), sem o score de sentimento.
// ✅ **Movidos para `/authors` (2026-07-25)**, pedido do usuário: "Perfis
// relevantes" e "X Themes" (Hashtags/Most Mentioned X Posters/Top
// Stories/Top Emojis) — são sobre autores, não sobre plataformas. Ver
// `app/(intelligence-center)/(analytics)/authors/page.tsx` (nova página,
// `get-page-authors`). A tabela "Narrativas" (lista geral, sem quebra por
// plataforma) também foi removida desta página pelo mesmo pedido — já
// existe em `/narratives`/`/overview`, sem valor incremental aqui.
// `PAGE_BLOCKS.platforms` encolheu de volta pra só `['breakdowns',
// 'trends', 'narrative_text']` — sem mais consumidor de `narratives`/
// `authors`/`x_insights` nesta página, manter esses blocos seria uma
// chamada RPC sem uso em todo carregamento.
export default function PlatformsPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-platforms");
  const platformBreakdown = envelope?.breakdowns.find((b) => b.type === "platform");

  return (
    <>
      <PageHeaderBar title="Análise por Plataforma" subtitle="Onde a conversa está acontecendo." />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <WidgetCard title="Participação por plataforma" status={status} onRetry={retry}>
            <PlatformParticipationBars breakdown={platformBreakdown} emptyMessage="Nenhum dado de plataforma ainda." />
          </WidgetCard>
          <WidgetCard title="Evolução do volume" status={status} onRetry={retry}>
            <TrendLineChart trend={envelope?.trends[0]} emptyMessage="Nenhum dado de evolução por plataforma ainda." />
          </WidgetCard>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <WidgetCard title="Engajamento médio por publicação" status={status} onRetry={retry}>
            <EmptyState message="Ainda não implementado — sem bloco de engajamento médio por plataforma no envelope atual (ver _pending.md)." />
          </WidgetCard>
          <WidgetCard title="Autores únicos por plataforma" status={status} onRetry={retry}>
            <EmptyState message="Ainda não implementado — sem bloco de autores únicos por plataforma no envelope atual (ver _pending.md)." />
          </WidgetCard>
        </div>

        <WidgetCard title="Velocidade de propagação por canal" status={status} onRetry={retry}>
          <EmptyState message="Ainda não implementado — sem function de comparação entre períodos por plataforma (ver _pending.md)." />
        </WidgetCard>

        <WidgetCard title="Conteúdos de destaque" status={status} onRetry={retry}>
          <EmptyState message="Lista de mentions em destaque ainda não implementada — sem bloco correspondente no envelope atual." />
        </WidgetCard>

        {/* ✅ Adicionado 2026-07-14 (pedido do usuário: "em todas as
            páginas é importante existir os principais tópicos positivos e
            negativos"), unificado no mesmo frame na mesma data (pedido
            seguinte: "no mesmo frente mudando apenas a cor"). */}
        <WidgetCard title="Principais tópicos positivos e negativos" status={status} onRetry={retry}>
          <TopicSentimentList signals={envelope?.term_signals ?? []} />
        </WidgetCard>

        <WidgetCard title="Insights" status={status} onRetry={retry}>
          <NarrativeTextPanel text={envelope?.narrative_text ?? null} page="platforms" onGenerated={retry} />
        </WidgetCard>
      </div>
    </>
  );
}
