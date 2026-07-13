"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { SentimentDriversPanel } from "@/components/intelligence-center/term-signals-list";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { EmptyState } from "@/components/ui/empty-state";

// Análise de Sentimento (`/sentiment`, intelligence-center/sentiment-analysis.md).
// ✅ "Sentimento por Narrativa" resolvido em 2026-07-17 — breakdown type
// 'narrative' (get_narrative_sentiment_breakdown), split completo
// positivo/neutro/negativo por Narrativa-folha, ver sql-aggregation.md.
// ⚠️ "Menções que mais influenciaram o sentimento" continua fora desta
// versão — não existe bloco de "mentions em destaque" no contrato do
// envelope ainda (ver _pending.md #19).
export default function SentimentPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-sentiment");

  return (
    <>
      <PageHeaderBar title="Análise de Sentimento" subtitle="Distribuição, evolução e drivers do sentimento." />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <WidgetCard title="Distribuição geral" status={status} onRetry={retry}>
            <BreakdownPanel
              breakdown={envelope?.breakdowns.find((b) => b.type === "sentiment")}
              emptyMessage="Nenhum dado de sentimento ainda."
            />
          </WidgetCard>
          <div className="md:col-span-2 lg:col-span-2">
            <WidgetCard title="Evolução temporal do sentimento" status={status} onRetry={retry}>
              <TrendLineChart trend={envelope?.trends[0]} emptyMessage="Nenhum dado de evolução ainda." />
            </WidgetCard>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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

        <WidgetCard title="Sentimento por narrativa" status={status} onRetry={retry}>
          <BreakdownPanel
            breakdown={envelope?.breakdowns.find((b) => b.type === "narrative")}
            emptyMessage="Nenhuma Narrativa em monitoramento ainda."
          />
        </WidgetCard>

        <WidgetCard title="Sentimento por localização" status={status} onRetry={retry}>
          <EmptyState message="Ainda não implementado — sem function de agregação por região (ver _pending.md)." />
        </WidgetCard>

        <WidgetCard title="Drivers de sentimento" status={status} onRetry={retry}>
          <SentimentDriversPanel signals={envelope?.term_signals ?? []} />
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
