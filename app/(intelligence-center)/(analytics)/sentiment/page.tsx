"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { TermSignalsList } from "@/components/intelligence-center/term-signals-list";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { EmptyState } from "@/components/ui/empty-state";

// Análise de Sentimento (`/sentiment`, intelligence-center/sentiment-analysis.md).
// ⚠️ "Sentimento por Narrativa" (barras por Narrativa) e "Menções que mais
// influenciaram o sentimento" ficam fora desta versão — nenhum bloco do
// envelope cobre esses dois pedaços especificamente (block-mapping-per-page.md
// não marca `narratives` para esta página, e não existe bloco de "mentions
// em destaque" no contrato — ver _pending.md, novo gap registrado ao
// implementar).
export default function SentimentPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-sentiment");

  return (
    <>
      <PageHeaderBar title="Análise de Sentimento" subtitle="Distribuição, evolução e drivers do sentimento." />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <WidgetCard title="Distribuição geral" status={status} onRetry={retry}>
            <BreakdownPanel
              breakdown={envelope?.breakdowns.find((b) => b.type === "sentiment")}
              emptyMessage="Nenhum dado de sentimento ainda."
            />
          </WidgetCard>
          <div className="lg:col-span-2">
            <WidgetCard title="Evolução temporal do sentimento" status={status} onRetry={retry}>
              <TrendLineChart trend={envelope?.trends[0]} emptyMessage="Nenhum dado de evolução ainda." />
            </WidgetCard>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <WidgetCard title="Sentimento por plataforma" status={status} onRetry={retry}>
            <BreakdownPanel
              breakdown={envelope?.breakdowns.find((b) => b.type === "platform")}
              emptyMessage="Nenhum dado de plataforma ainda."
            />
          </WidgetCard>
          <WidgetCard title="Sentimento por pauta" status={status} onRetry={retry}>
            <BreakdownPanel
              breakdown={envelope?.breakdowns.find((b) => b.type === "theme")}
              emptyMessage="Nenhuma Pauta em monitoramento ainda."
            />
          </WidgetCard>
        </div>

        <WidgetCard title="Sentimento por localização" status={status} onRetry={retry}>
          <EmptyState message="Ainda não implementado — sem function de agregação por região (ver _pending.md)." />
        </WidgetCard>

        <WidgetCard title="Drivers de sentimento" status={status} onRetry={retry}>
          <TermSignalsList signals={envelope?.term_signals ?? []} />
        </WidgetCard>

        <WidgetCard title="Menções que mais influenciaram o sentimento" status={status} onRetry={retry}>
          <EmptyState message="Lista de menções em destaque ainda não implementada — sem bloco correspondente no envelope atual." />
        </WidgetCard>

        <WidgetCard title="Insights" status={status} onRetry={retry}>
          <div className="flex flex-col gap-4">
            <NarrativeTextPanel text={envelope?.narrative_text ?? null} />
            <HighlightsPanel highlights={envelope?.highlights ?? []} />
          </div>
        </WidgetCard>
      </div>
    </>
  );
}
