"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { PautaCardGrid } from "@/components/intelligence-center/pauta-cards";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { TermSignalsList, TopicSentimentList } from "@/components/intelligence-center/term-signals-list";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { ExpandableText } from "@/components/ui/expandable-text";
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
//
// ✅ **Reorganizado (2026-08-09)**, pedido do usuário, 3 itens de layout:
// 1. "Share of Voice e sentimento por pauta" ordenado por SOV decrescente
//    (ver `pauta-cards.tsx`).
// 2-3. A metade inferior da página virou uma grade de 2 colunas: à
//    esquerda, a tabela interativa ("Narrativas") + "Autores e comunidades
//    por pauta"; à direita, "Termos emergentes" (frame reduzido, com
//    scroll interno) e "Tópicos positivos e negativos por pauta". Um 4º
//    pedido, "Insights dessa página deve focar apenas no conteúdo de
//    Pautas Eleitorais", era na verdade um bug de escopo no backend
//    (highlights/narrative_text liam a organização inteira, não só as
//    Pautas) — corrigido em `aggregated-metrics-service.ts`/
//    `assemblePageResponse`, ver CLAUDE.md; nenhuma mudança de layout do
//    widget "Insights" em si.
// ✅ **"Comparação entre períodos" movida pro início da página e fechada
// via ai-synthesis Camada 2 (2026-07-14)** — vivia dentro da grade de 2
// colunas acima até então, sempre EmptyState (dependia de síntese
// narrativa, ainda não implementada). Ver ai-synthesis.md.
export default function ThemesPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-themes");
  const themeBreakdown = envelope?.breakdowns.find((b) => b.type === "theme");

  return (
    <>
      <PageHeaderBar title="Pautas Eleitorais" subtitle="O que está sendo discutido, por tema político." />

      <div className="flex flex-col gap-6 p-8">
        {/* ✅ Movido pro início da página (2026-07-14, pedido do usuário) —
            "Comparação entre períodos" era EmptyState desde a
            reorganização de 2026-08-09 (dependia de ai-synthesis, ainda
            não implementado à época). Fechado via Camada 2: compara o SOV
            por Pauta do período atual contra o período imediatamente
            anterior (mesma duração), reaproveitando get_theme_breakdown
            (já usado por "Share of Voice e sentimento por pauta" abaixo)
            chamado uma 2ª vez pro período anterior — ver ai-synthesis.md. */}
        <WidgetCard title="Comparação entre períodos" status={status} onRetry={retry}>
          {envelope?.ui_meta && typeof envelope.ui_meta.period_comparison_text === "string" ? (
            <ExpandableText text={envelope.ui_meta.period_comparison_text} />
          ) : (
            <p className="text-sm text-text-tertiary">Síntese automática indisponível no momento.</p>
          )}
        </WidgetCard>

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

        {/* ✅ Reorganizado 2026-08-09 (pedido do usuário) — esquerda: tabela
            interativa + Autores e comunidades por pauta; direita: 2 frames
            empilhados (Termos emergentes reduzido, Tópicos positivos e
            negativos por pauta) — "Comparação entre períodos" saiu daqui
            em 2026-07-14, ver início da página. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <WidgetCard title="Narrativas" status={status} onRetry={retry}>
              <p className="mb-3 text-xs text-text-tertiary">
                Todas as pautas eleitorais (subcategorias da categoria &quot;Pautas&quot;).
              </p>
              <NarrativesTable rows={envelope?.narratives ?? []} />
            </WidgetCard>

            <WidgetCard title="Autores e comunidades por pauta" status={status} onRetry={retry}>
              <AuthorsList
                authors={envelope?.authors ?? []}
                emptyMessage="Nenhum autor citou uma pauta eleitoral neste período ainda."
              />
            </WidgetCard>
          </div>

          <div className="flex flex-col gap-6">
            {/* ✅ Frame reduzido (2026-08-09, pedido do usuário: "diminuir o
                frame de Termos emergentes") — mesmo `TermSignalsList` de
                sempre, só dentro de um container com altura máxima e
                scroll interno em vez de crescer livremente. */}
            <WidgetCard title="Termos emergentes" status={status} onRetry={retry}>
              <div className="max-h-48 overflow-y-auto">
                <TermSignalsList signals={envelope?.term_signals ?? []} />
              </div>
            </WidgetCard>

            {/* ✅ Adicionado 2026-07-14 (pedido do usuário: "em todas as
                páginas é importante existir os principais tópicos positivos e
                negativos") — mesmo `term_signals` de "Termos emergentes"
                acima, só separado por polaridade. Unificado no mesmo frame na
                mesma data (pedido seguinte: "no mesmo frente mudando apenas a
                cor"). */}
            <WidgetCard title="Tópicos positivos e negativos por pauta" status={status} onRetry={retry}>
              <TopicSentimentList signals={envelope?.term_signals ?? []} />
            </WidgetCard>
          </div>
        </div>

        <WidgetCard title="Insights" status={status} onRetry={retry}>
          <div className="flex flex-col gap-4">
            <NarrativeTextPanel text={envelope?.narrative_text ?? null} page="themes" onGenerated={retry} />
            <HighlightsPanel highlights={envelope?.highlights ?? []} />
          </div>
        </WidgetCard>
      </div>
    </>
  );
}
