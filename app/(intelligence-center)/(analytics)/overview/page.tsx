"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { MetricCard } from "@/components/intelligence-center/metric-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";

// Visão Geral (`/overview`, intelligence-center/executive-overview.md) —
// página de entrada pós-login. Consome o envelope de get-page-overview
// (edge-functions-per-page.md) via usePageEnvelope; nenhum cálculo
// acontece aqui (Princípio técnico 2), só renderização do que o backend
// já devolve pronto.
export default function OverviewPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-overview");

  return (
    <>
      <PageHeaderBar title="Visão Geral" subtitle="O que está acontecendo agora, de relance." />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {status === "loading" &&
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-xl bg-border-subtle-2" />
            ))}
          {status === "loaded" &&
            envelope!.metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)}
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="md:col-span-2 lg:col-span-2">
            <WidgetCard title="Volume e sentimento ao longo do tempo" status={status} onRetry={retry}>
              <TrendLineChart
                trend={envelope?.trends[0]}
                emptyMessage="Nenhum dado sincronizado ainda para este período."
              />
            </WidgetCard>
          </div>
          <WidgetCard title="Sentimento geral" status={status} onRetry={retry}>
            <BreakdownPanel
              breakdown={envelope?.breakdowns.find((b) => b.type === "sentiment")}
              emptyMessage="Nenhum dado de sentimento ainda."
            />
          </WidgetCard>
        </div>

        <WidgetCard title="Insights" status={status} onRetry={retry}>
          <div className="flex flex-col gap-4">
            <NarrativeTextPanel text={envelope?.narrative_text ?? null} />
            <HighlightsPanel highlights={envelope?.highlights ?? []} />
          </div>
        </WidgetCard>

        <WidgetCard title="Narrativas" status={status} onRetry={retry}>
          <NarrativesTable rows={(envelope?.narratives ?? []).slice(0, 10)} />
        </WidgetCard>
      </div>
    </>
  );
}
