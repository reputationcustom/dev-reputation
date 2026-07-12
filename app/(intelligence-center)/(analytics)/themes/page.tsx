"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { TermSignalsList } from "@/components/intelligence-center/term-signals-list";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";

// Pautas Eleitorais (`/themes`, intelligence-center/electoral-themes.md).
// "Pauta" = Narrativa cujo bw_category_id aponta a uma Category raiz — não
// é uma entidade nova (ver spec, "Mapeamento de conceito"). ⚠️ Simplificação
// desta sessão: a tabela "Narrativas" abaixo mostra todas as Narrativas do
// escopo (Pautas e Narrativas-filhas juntas, sem distinguir visualmente) —
// o bloco `narratives` do envelope não expõe bw_category_id/hierarquia, só
// o próprio `get_theme_breakdown` (painel de SOV/sentimento acima) já
// filtra corretamente só as Pautas de topo. Drill-down "narrativas dentro
// da pauta" (clicar numa Pauta e ver só as filhas, via `get-page-themes`
// com `pauta_id`) fica para uma sessão futura.
export default function ThemesPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-themes");

  return (
    <>
      <PageHeaderBar title="Pautas Eleitorais" subtitle="O que está sendo discutido, por tema político." />

      <div className="flex flex-col gap-6 p-8">
        <WidgetCard title="Share of Voice e sentimento por pauta" status={status} onRetry={retry}>
          <BreakdownPanel
            breakdown={envelope?.breakdowns.find((b) => b.type === "theme")}
            emptyMessage="Nenhuma Pauta em monitoramento ainda."
          />
        </WidgetCard>

        <WidgetCard title="Narrativas" status={status} onRetry={retry}>
          <p className="mb-3 text-xs text-text-tertiary">
            Todas as Narrativas do escopo ativo — Pautas e Narrativas-filhas juntas.
          </p>
          <NarrativesTable rows={envelope?.narratives ?? []} />
        </WidgetCard>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <WidgetCard title="Autores e comunidades por pauta" status={status} onRetry={retry}>
            <AuthorsList authors={envelope?.authors ?? []} />
          </WidgetCard>
          <WidgetCard title="Termos emergentes" status={status} onRetry={retry}>
            <TermSignalsList signals={envelope?.term_signals ?? []} />
          </WidgetCard>
        </div>

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
