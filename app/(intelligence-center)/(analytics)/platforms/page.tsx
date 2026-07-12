"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { EmptyState } from "@/components/ui/empty-state";

// Análise por Plataforma (`/platforms`, intelligence-center/platform-analysis.md).
// ⚠️ Gaps desta versão (sem function SQL correspondente, ver _pending.md):
// evolução do volume por plataforma ao longo do tempo, velocidade de
// propagação por plataforma, narrativas dominantes ESPECIFICAMENTE por
// plataforma (a tabela abaixo mostra a mesma lista geral de Narrativas, não
// quebrada por plataforma) e conteúdos de destaque (mentions individuais).
export default function PlatformsPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-platforms");

  return (
    <>
      <PageHeaderBar title="Análise por Plataforma" subtitle="Onde a conversa está acontecendo." />

      <div className="flex flex-col gap-6 p-8">
        <WidgetCard title="Sentimento por plataforma" status={status} onRetry={retry}>
          <BreakdownPanel
            breakdown={envelope?.breakdowns.find((b) => b.type === "platform")}
            emptyMessage="Nenhum dado de plataforma ainda."
          />
        </WidgetCard>

        <WidgetCard title="Evolução do volume por plataforma" status={status} onRetry={retry}>
          <EmptyState message="Ainda não implementado — sem function de série temporal por plataforma (ver _pending.md)." />
        </WidgetCard>

        <WidgetCard title="Narrativas" status={status} onRetry={retry}>
          <p className="mb-3 text-xs text-text-tertiary">
            Lista geral de Narrativas — quebra específica por plataforma dominante ainda não
            implementada.
          </p>
          <NarrativesTable rows={envelope?.narratives ?? []} />
        </WidgetCard>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <WidgetCard title="Perfis relevantes" status={status} onRetry={retry}>
            <AuthorsList authors={envelope?.authors ?? []} />
          </WidgetCard>
          <WidgetCard title="Velocidade de propagação por plataforma" status={status} onRetry={retry}>
            <EmptyState message="Ainda não implementado — sem function de comparação entre períodos por plataforma (ver _pending.md)." />
          </WidgetCard>
        </div>

        <WidgetCard title="Conteúdos de destaque" status={status} onRetry={retry}>
          <EmptyState message="Lista de mentions em destaque ainda não implementada — sem bloco correspondente no envelope atual." />
        </WidgetCard>

        <WidgetCard title="Insights" status={status} onRetry={retry}>
          <NarrativeTextPanel text={envelope?.narrative_text ?? null} />
        </WidgetCard>
      </div>
    </>
  );
}
