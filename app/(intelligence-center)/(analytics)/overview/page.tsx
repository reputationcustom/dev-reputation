"use client";

import Link from "next/link";
import type { Breakdown, NarrativeRow } from "@reputation/shared-types";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { MetricCard, SentimentMetricCard } from "@/components/intelligence-center/metric-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { ScoreLegend } from "@/components/intelligence-center/score-badges";
import { EmptyState } from "@/components/ui/empty-state";

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
            envelope!.metrics.map((metric) =>
              metric.key === "net_sentiment" ? (
                <SentimentMetricCard
                  key={metric.key}
                  breakdown={envelope!.breakdowns.find((b) => b.type === "sentiment")}
                />
              ) : (
                <MetricCard key={metric.key} metric={metric} />
              ),
            )}
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

        {/* Narrativas acima de Insights (pedido do usuário 2026-07-12) —
            prioriza a tabela acionável antes do painel de insights, que
            hoje sempre renderiza vazio (event-radar/ai-synthesis ainda não
            implementados, ver _pending.md). Legenda logo abaixo da própria
            tabela (pedido do usuário 2026-07-13) — antes ficava solta no
            fim da página, depois do Insights, longe dos badges que ela
            explica. */}
        <WidgetCard title="Narrativas" status={status} onRetry={retry}>
          <div className="flex flex-col gap-4">
            <NarrativesTable rows={(envelope?.narratives ?? []).slice(0, 10)} />
            <div className="border-t border-border-subtle pt-4">
              <ScoreLegend />
            </div>
          </div>
        </WidgetCard>

        {/* "O que os gráficos mostram?" (protótipo original) — mesmo
            `narrative_text` já usado no widget "Insights" abaixo, só numa
            caixa própria logo após os gráficos (posição do protótipo);
            reaproveita o mesmo dado, não duplica lógica nova. */}
        <WidgetCard title="O que os gráficos mostram?" status={status} onRetry={retry}>
          <NarrativeTextPanel text={envelope?.narrative_text ?? null} />
        </WidgetCard>

        <WidgetCard title="Insights" status={status} onRetry={retry}>
          <HighlightsPanel highlights={envelope?.highlights ?? []} />
        </WidgetCard>

        {/* "Top 3 Narrativas" (protótipo original `topThreeCards`) — as 3
            Narrativas de maior SOV, com o split positivo/neutro/negativo
            (reaproveita a breakdown type='narrative', já usada em
            Sentimento — `get_narrative_sentiment_breakdown`, nenhum
            cálculo novo). */}
        <WidgetCard title="Top 3 Narrativas" status={status} onRetry={retry}>
          <TopThreeNarrativeCards
            narratives={envelope?.narratives ?? []}
            sentimentBreakdown={envelope?.breakdowns.find((b) => b.type === "narrative")}
          />
        </WidgetCard>
      </div>
    </>
  );
}

function TopThreeNarrativeCards({
  narratives,
  sentimentBreakdown,
}: {
  narratives: NarrativeRow[];
  sentimentBreakdown: Breakdown | undefined;
}) {
  const top3 = [...narratives].sort((a, b) => b.sov_pct - a.sov_pct).slice(0, 3);

  if (top3.length === 0) {
    return <EmptyState message="Nenhuma Narrativa em monitoramento ainda." />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {top3.map((narrative) => {
        const sentiment = sentimentBreakdown?.items.find((item) => item.label === narrative.title);
        return (
          <div key={narrative.id} className="flex flex-col gap-3 rounded-[10px] border border-border-default bg-bg-card p-4">
            <span className="font-bold text-text-primary">{narrative.title}</span>
            <span className="inline-flex w-fit items-center rounded-md bg-accent-blue-bg px-2 py-0.5 text-xs font-bold text-accent-blue">
              {narrative.sov_pct}% das menções
            </span>
            <div className="flex gap-4">
              <div>
                <div className="text-base font-extrabold text-sentiment-positive">{sentiment?.positive ?? 0}%</div>
                <div className="text-[10.5px] text-text-tertiary">Positivo</div>
              </div>
              <div>
                <div className="text-base font-extrabold text-sentiment-negative">{sentiment?.negative ?? 0}%</div>
                <div className="text-[10.5px] text-text-tertiary">Negativo</div>
              </div>
              <div>
                <div className="text-base font-extrabold text-sentiment-neutral">{sentiment?.neutral ?? 0}%</div>
                <div className="text-[10.5px] text-text-tertiary">Neutro</div>
              </div>
            </div>
            <Link href={`/narratives/${narrative.id}`} className="mt-1 text-sm font-bold text-accent-blue hover:underline">
              Ver detalhes →
            </Link>
          </div>
        );
      })}
    </div>
  );
}
