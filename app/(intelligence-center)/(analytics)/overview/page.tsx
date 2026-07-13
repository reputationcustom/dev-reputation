"use client";

import type { NarrativeRow } from "@reputation/shared-types";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { MetricCard, SentimentMetricCard } from "@/components/intelligence-center/metric-card";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { NarrativeCard } from "@/components/intelligence-center/narrative-card";
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
          {/* Pedido do usuário 2026-07-21: "Sentimento geral" já aparece na
              grade de KPI (SentimentMetricCard, mesma página) — o frame ao
              lado do gráfico duplicava exatamente o mesmo dado (breakdown
              type='sentiment'), então esse espaço passa a ser "O que os
              gráficos mostram?" (protótipo original, movido daqui de baixo
              — não há mais uma cópia separada dele na página). Mesmo
              `narrative_text` de sempre, só reposicionado. */}
          <WidgetCard title="O que os gráficos mostram?" status={status} onRetry={retry}>
            <NarrativeTextPanel text={envelope?.narrative_text ?? null} />
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

        <WidgetCard title="Insights" status={status} onRetry={retry}>
          <HighlightsPanel highlights={envelope?.highlights ?? []} />
        </WidgetCard>

        {/* "Top 3 Narrativas por Menções" (protótipo original `topThreeCards`)
            — renomeado 2026-07-25 (pedido do usuário) de "Top 3 Narrativas"
            pra deixar explícito o critério de ordenação; o título anterior
            era ambíguo (o card já não mostrava SOV como métrica isolada de
            destaque) — o critério agora é literalmente o que o título diz:
            as 3 Narrativas com mais `total_mentions` no período, não mais
            `sov_pct` (SOV pondera pela Query, então uma Narrativa pequena
            numa Query pequena podia superar uma Narrativa com muito mais
            menções absolutas — não é isso que "por Menções" comunica).
            ✅ Simplificado 2026-07-21: o split positivo/neutro/negativo já
            vem direto em NarrativeRow.sentiment_positive_pct/neutral_pct/
            negative_pct (get_narratives_table, migration 20260721010000) —
            não precisa mais casar por título com a breakdown type='narrative'
            separada (frágil: dependia de NarrativeRow.title === Breakdown.label).
            Mesmo NarrativeCard reusado pela lista de Narrativas (pedido do
            usuário: todo card de Narrativa segue o mesmo layout). */}
        <WidgetCard title="Top 3 Narrativas por Menções" status={status} onRetry={retry}>
          <TopThreeNarrativeCards narratives={envelope?.narratives ?? []} />
        </WidgetCard>
      </div>
    </>
  );
}

function TopThreeNarrativeCards({ narratives }: { narratives: NarrativeRow[] }) {
  const top3 = [...narratives].sort((a, b) => b.total_mentions - a.total_mentions).slice(0, 3);

  if (top3.length === 0) {
    return <EmptyState message="Nenhuma Narrativa em monitoramento ainda." />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {top3.map((narrative) => (
        <NarrativeCard key={narrative.id} narrative={narrative} />
      ))}
    </div>
  );
}
