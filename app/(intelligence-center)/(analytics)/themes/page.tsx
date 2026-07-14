"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { PautaCardGrid } from "@/components/intelligence-center/pauta-cards";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { TermSignalsList, PositiveDriversList, NegativeDriversList } from "@/components/intelligence-center/term-signals-list";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { EmptyState } from "@/components/ui/empty-state";

// Pautas Eleitorais (`/themes`, intelligence-center/electoral-themes.md).
// ✅ Escopo corrigido 2026-07-21 (pedido do usuário: "Essa página deve focar
// apenas na categoria Pautas. A ideia é que a análise que compõe essa
// página venha de todas as subcategorias de Pautas."): "Pauta" deixou de
// significar "qualquer Narrativa cuja Category é de topo" (o que misturava
// narrativas de crise/monitoramento gerais, ex. "Pesquisas"/"Banco
// Master", com pautas eleitorais de verdade) — agora é especificamente uma
// Subcategory da Category raiz chamada "Pautas" (pautas_root_category_id,
// migration 20260721030000). `get_theme_breakdown`/`get_narratives_table`
// (`p_scope='pautas'`)/`get_authors_ranking` (`p_scope='pautas'`) já
// aplicam esse filtro no backend — o widget "Narrativas" abaixo mostra
// exatamente as pautas eleitorais (Educação, Saúde, Segurança...), nada
// além disso. Sem drill-down "narrativas dentro da pauta": Brandwatch só
// suporta 2 níveis (Category → Subcategory), então uma pauta (já uma
// Subcategory) não tem filhas próprias.
export default function ThemesPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-themes");
  const themeBreakdown = envelope?.breakdowns.find((b) => b.type === "theme");

  return (
    <>
      <PageHeaderBar title="Pautas Eleitorais" subtitle="O que está sendo discutido, por tema político." />

      <div className="flex flex-col gap-6 p-8">
        {/* "Estrutura das pautas" — subcategorias da Category raiz "Pautas"
            (mesmos rótulos do card grid abaixo, só como chips soltos;
            protótipo original: `pautasChips`). */}
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
            <EmptyState message="Nenhuma subcategoria da categoria 'Pautas' configurada na Brandwatch ainda." />
          )}
        </WidgetCard>

        <WidgetCard title="Share of Voice e sentimento por pauta" status={status} onRetry={retry}>
          <PautaCardGrid breakdown={themeBreakdown} emptyMessage="Nenhuma subcategoria da categoria 'Pautas' configurada na Brandwatch ainda." />
        </WidgetCard>

        {/* ✅ Implementado 2026-07-25 — get_theme_sov_trend, uma linha por
            pauta (series_by_group), SOV = menções da pauta / menções da
            Query inteira nos dias do bucket. */}
        <WidgetCard title="SOV por pauta ao longo do tempo" status={status} onRetry={retry}>
          <TrendLineChart trend={envelope?.trends[0]} emptyMessage="Nenhum dado de SOV por pauta ainda." />
        </WidgetCard>

        <WidgetCard title="Narrativas" status={status} onRetry={retry}>
          <p className="mb-3 text-xs text-text-tertiary">
            Todas as pautas eleitorais (subcategorias da categoria &quot;Pautas&quot;).
          </p>
          <NarrativesTable rows={envelope?.narratives ?? []} />
        </WidgetCard>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <WidgetCard title="Autores e comunidades por pauta" status={status} onRetry={retry}>
            <AuthorsList
              authors={envelope?.authors ?? []}
              emptyMessage="Nenhum autor citou uma pauta eleitoral neste período ainda."
            />
          </WidgetCard>
          <WidgetCard title="Termos emergentes" status={status} onRetry={retry}>
            <TermSignalsList signals={envelope?.term_signals ?? []} />
          </WidgetCard>
        </div>

        {/* ✅ Adicionado 2026-07-14 (pedido do usuário: "em todas as
            páginas é importante existir os principais tópicos positivos e
            negativos") — mesmo `term_signals` de "Termos emergentes"
            acima, só separado por polaridade. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <WidgetCard title="Tópicos positivos por pauta" status={status} onRetry={retry}>
            <PositiveDriversList signals={envelope?.term_signals ?? []} />
          </WidgetCard>
          <WidgetCard title="Tópicos negativos por pauta" status={status} onRetry={retry}>
            <NegativeDriversList signals={envelope?.term_signals ?? []} />
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
