"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { PautaCardGrid } from "@/components/intelligence-center/pauta-cards";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { TermSignalsList } from "@/components/intelligence-center/term-signals-list";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { EmptyState } from "@/components/ui/empty-state";

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
  const themeBreakdown = envelope?.breakdowns.find((b) => b.type === "theme");

  return (
    <>
      <PageHeaderBar title="Pautas Eleitorais" subtitle="O que está sendo discutido, por tema político." />

      <div className="flex flex-col gap-6 p-8">
        {/* "Estrutura das pautas" — mesmos rótulos do card grid abaixo, só
            como chips soltos (protótipo original: `pautasChips`). */}
        <WidgetCard title="Estrutura das pautas" status={status} onRetry={retry}>
          {themeBreakdown && themeBreakdown.items.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {themeBreakdown.items.map((item) => (
                <span
                  key={item.label}
                  className="rounded-full bg-bg-page px-3 py-1.5 text-xs font-semibold text-text-secondary"
                >
                  {item.label}
                </span>
              ))}
            </div>
          ) : (
            <EmptyState message="Nenhuma Pauta em monitoramento ainda." />
          )}
        </WidgetCard>

        <WidgetCard title="Share of Voice e sentimento por pauta" status={status} onRetry={retry}>
          <PautaCardGrid breakdown={themeBreakdown} emptyMessage="Nenhuma Pauta em monitoramento ainda." />
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

        {/* "Comparação entre períodos" (protótipo: callout textual, ex.
            "Segurança perdeu 4 pontos..."). Depende de síntese narrativa
            (ai-synthesis, não implementado) — mesmo padrão do resto do
            produto, EmptyState honesto em vez de inventar o texto. */}
        <WidgetCard title="Comparação entre períodos" status={status} onRetry={retry}>
          <EmptyState message="Comparação textual entre períodos ainda não implementada — depende de síntese narrativa (ai-synthesis, ver _pending.md)." />
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
