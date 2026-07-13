"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { PlatformParticipationBars } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { XInsightsPanel } from "@/components/intelligence-center/x-insights-panel";
import { NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { EmptyState } from "@/components/ui/empty-state";

// Análise por Plataforma (`/platforms`, intelligence-center/platform-analysis.md).
// ⚠️ Gaps desta versão (sem function SQL correspondente, ver _pending.md):
// evolução do volume por plataforma ao longo do tempo, engajamento médio
// por publicação, autores únicos por plataforma (o dado existe em
// `bw_query_metrics_daily_by_platform`, mas `BreakdownItem` não expõe
// esses 2 campos — só label/value/pct — sem function/envelope novo pra
// isso ainda), velocidade de propagação por plataforma, narrativas
// dominantes ESPECIFICAMENTE por plataforma (a tabela abaixo mostra a
// mesma lista geral de Narrativas, não quebrada por plataforma) e
// conteúdos de destaque (mentions individuais). "Sentimento por
// plataforma" não se repete aqui — já é o próprio widget da página de
// Sentimento; esta página usa a mesma breakdown só que como
// "Participação por plataforma" (protótipo original), sem o score de
// sentimento.
// ✅ "X Themes" (Top Hashtags/Most Mentioned X Posters/Top Stories/Top
// Emojis) implementado 2026-07-18 — bloco `x_insights`, ver
// sql-aggregation.md/get_x_insights e platform-analysis.md.
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

        <WidgetCard title="Perfis relevantes" status={status} onRetry={retry}>
          <AuthorsList authors={envelope?.authors ?? []} />
        </WidgetCard>

        <WidgetCard title="X Themes (Hashtags, Posters, Stories, Emojis)" status={status} onRetry={retry}>
          <XInsightsPanel items={envelope?.x_insights ?? []} />
        </WidgetCard>

        <WidgetCard title="Conteúdos de destaque" status={status} onRetry={retry}>
          <EmptyState message="Lista de mentions em destaque ainda não implementada — sem bloco correspondente no envelope atual." />
        </WidgetCard>

        <WidgetCard title="Narrativas" status={status} onRetry={retry}>
          <p className="mb-3 text-xs text-text-tertiary">
            Lista geral de Narrativas — quebra específica por plataforma dominante ainda não
            implementada.
          </p>
          <NarrativesTable rows={envelope?.narratives ?? []} />
        </WidgetCard>

        <WidgetCard title="Insights" status={status} onRetry={retry}>
          <NarrativeTextPanel text={envelope?.narrative_text ?? null} />
        </WidgetCard>
      </div>
    </>
  );
}
