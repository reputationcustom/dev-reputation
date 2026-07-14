"use client";

import { useState } from "react";
import Link from "next/link";
import type { NarrativeRow } from "@reputation/shared-types";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { MetricCard, SentimentMetricCard } from "@/components/intelligence-center/metric-card";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { NarrativeCard } from "@/components/intelligence-center/narrative-card";
import { NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { RecentEventsPanel } from "@/components/intelligence-center/recent-events-panel";
import { TopicSentimentList } from "@/components/intelligence-center/term-signals-list";
import { EmptyState } from "@/components/ui/empty-state";

const TOP_COUNT_OPTIONS = [3, 5, 10] as const;

// Visão Geral (`/overview`, intelligence-center/executive-overview.md) —
// página de entrada pós-login. Consome o envelope de get-page-overview
// (edge-functions-per-page.md) via usePageEnvelope; nenhum cálculo
// acontece aqui (Princípio técnico 2), só renderização do que o backend
// já devolve pronto.
export default function OverviewPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-overview");
  const [topCount, setTopCount] = useState<(typeof TOP_COUNT_OPTIONS)[number]>(3);

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
            <NarrativeTextPanel text={envelope?.narrative_text ?? null} page="overview" onGenerated={retry} />
          </WidgetCard>
        </div>

        {/* ✅ Reestruturado 2026-07-14 (pedido do usuário: "Retirar a tabela
            de Narrativas e subir a parte de Top 3 Narrativas por Menções
            para o lugar da tabela") — a tabela "Narrativas" (lista
            genérica das 10 primeiras) foi removida desta página; a lista
            completa continua acessível em `/narrativas` (link explícito no
            próprio widget abaixo). "Top 3 Narrativas por Menções" ocupa
            agora esta posição, entre o gráfico de tendência e os tópicos
            positivos/negativos. */}
        <WidgetCard
          title={`Top ${topCount} Narrativas por Menções`}
          status={status}
          onRetry={retry}
          headerAction={
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-border-default p-0.5">
                {TOP_COUNT_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setTopCount(count)}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                      topCount === count ? "bg-accent-blue text-white" : "text-text-secondary hover:bg-bg-page"
                    }`}
                  >
                    Top {count}
                  </button>
                ))}
              </div>
              <Link
                href="/narratives"
                className="whitespace-nowrap text-xs font-medium text-accent-blue hover:underline"
              >
                Ver todas as Narrativas →
              </Link>
            </div>
          }
        >
          <TopNarrativeCards narratives={envelope?.narratives ?? []} count={topCount} />
        </WidgetCard>

        {/* ✅ Adicionado 2026-07-14 (pedido do usuário: "em todas as
            páginas é importante existir os principais tópicos positivos e
            negativos"), unificado no mesmo frame 2026-07-14 (mesma sessão,
            pedido seguinte: "no mesmo frente mudando apenas a cor") — mesmo
            dado/componente já usado em /sentiment (get_term_signals, sem
            filtro de Narrativa aqui: cobre a Query inteira da organização,
            mesmo escopo das outras métricas desta página). */}
        <WidgetCard title="Principais tópicos positivos e negativos" status={status} onRetry={retry}>
          <TopicSentimentList signals={envelope?.term_signals ?? []} />
        </WidgetCard>

        {/* event-radar/frontend-highlights-feed.md — a lista ("Lista") tem
            janela FIXA de 72h, independente do período selecionado no
            header (por isso RecentEventsPanel tem seu próprio fetch/estado
            pra `highlights`, não usa o `status`/`retry` do envelope desta
            página pra isso). Substitui o antigo widget "Insights"
            (HighlightsPanel, bloco `highlights` genérico por período) só
            neste lugar — HighlightsPanel continua existindo pra uso futuro
            em outra página. ✅ 2026-07-14: o "Resumo executivo" (2ª aba do
            toggle) já **é** período-escopado — recebe `narrative_text`
            desta mesma página (`envelope.narrative_text`), não a janela
            fixa de 72h. */}
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <h2 className="text-sm font-bold text-text-primary">Radar de Eventos</h2>
          <p className="text-xs text-text-tertiary">Últimas 72 horas</p>
          <div className="mt-4">
            <RecentEventsPanel
              narrativeText={envelope?.narrative_text ?? null}
              page="overview"
              onGenerated={retry}
              defaultView="summary"
            />
          </div>
        </div>
      </div>
    </>
  );
}

// "Top N Narrativas por Menções" (protótipo original `topThreeCards`) —
// renomeado 2026-07-25 (pedido do usuário) de "Top 3 Narrativas" pra deixar
// explícito o critério de ordenação; o critério é literalmente o que o
// título diz: as N Narrativas com mais `total_mentions` no período, não
// `sov_pct` (SOV pondera pela Query, então uma Narrativa pequena numa Query
// pequena podia superar uma Narrativa com muito mais menções absolutas —
// não é isso que "por Menções" comunica). ✅ N passou a ser escolhido pelo
// usuário (3/5/10) em 2026-07-14 — antes fixo em 3. Mesmo NarrativeCard
// reusado pela lista de Narrativas (pedido do usuário: todo card de
// Narrativa segue o mesmo layout).
function TopNarrativeCards({ narratives, count }: { narratives: NarrativeRow[]; count: number }) {
  const top = [...narratives].sort((a, b) => b.total_mentions - a.total_mentions).slice(0, count);

  if (top.length === 0) {
    return <EmptyState message="Nenhuma Narrativa em monitoramento ainda." />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {top.map((narrative) => (
        <NarrativeCard key={narrative.id} narrative={narrative} />
      ))}
    </div>
  );
}
