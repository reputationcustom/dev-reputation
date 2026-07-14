"use client";

import { useState } from "react";
import type { NarrativeRow } from "@reputation/shared-types";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { useUserProfile } from "@/hooks/use-user-profile";
import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { NarrativeCard } from "@/components/intelligence-center/narrative-card";
import { NarrativeCategoryLanes } from "@/components/intelligence-center/narrative-category-lanes";
import { TopicSentimentList } from "@/components/intelligence-center/term-signals-list";
import { NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { Toast } from "@/components/ui/toast";
import { callFunction } from "@/lib/supabase/call-function";

type DisplayMode = "both" | "table" | "cards";
type TableGrouping = "flat" | "category";

const DISPLAY_MODE_OPTIONS: { mode: DisplayMode; label: string }[] = [
  { mode: "both", label: "Tabela e cards" },
  { mode: "table", label: "Só tabela" },
  { mode: "cards", label: "Só cards" },
];

const GROUPING_OPTIONS: { grouping: TableGrouping; label: string }[] = [
  { grouping: "flat", label: "Subcategorias" },
  { grouping: "category", label: "Categoria e subcategoria" },
];

// Exploração de Narrativas — lista (`/narratives`,
// intelligence-center/narratives-exploration.md). Clique numa linha
// seleciona (destaca a linha + abre o resumo ao lado); clicar no título
// abre o modal de detalhe. ✅ **Implementado (2026-07-22)**: o detalhe abre
// como modal (intercepting route `@modal/(.)narratives/[id]`, ver
// app/(intelligence-center)/(analytics)/@modal/) — clicar num link pra
// `/narratives/[id]` a partir de qualquer página dentro de `(analytics)`
// (não só daqui) abre por cima da tela atual; acessar a URL direto (link
// compartilhado, recarregar a página) continua renderizando a página cheia,
// sem modal — ver narrative-detail-content.tsx.
//
// ✅ **Reestruturado (2026-07-14)**, pedido do usuário, 5 itens:
// 1. Coluna "Ação" removida da tabela (`NarrativesTable`) — duplicava a
//    navegação que o título já oferece.
// 2. Selecionar uma linha agora divide a tela: tabela encolhe à esquerda,
//    `NarrativeCard` completo aparece à direita (`lg:grid-cols-
//    [minmax(0,1fr)_400px]`) — antes o card aparecia abaixo da tabela em
//    largura reduzida (`sm:max-w-md`), cortando a leitura do resumo.
// 3. Botão "✕ Fechar" acima do card + clicar de novo na mesma linha
//    desseleciona e volta à visualização padrão (tabela cheia + grade de
//    cards por categoria).
// 4. Tabela dinâmica: toggle "Subcategorias"/"Categoria e subcategoria" no
//    cabeçalho do widget da tabela (`NarrativesTable`'s `groupByCategory`).
// 5. Toggle "Tabela e cards"/"Só tabela"/"Só cards" — em "Só tabela", o
//    item 2 (painel lateral ao selecionar) é o único jeito de ler o resumo
//    completo, já que a grade de cards fica oculta.
export default function NarrativesListPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-narratives");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("both");
  const [tableGrouping, setTableGrouping] = useState<TableGrouping>("flat");

  const rows = envelope?.narratives ?? [];
  const showTable = displayMode !== "cards";
  const showCardsGrid = displayMode !== "table";
  // Seleção só é significativa quando a tabela está visível — em "Só
  // cards" não há como uma linha estar selecionada (não há tabela pra
  // clicar), então ignora qualquer `selectedId` remanescente de uma troca
  // de modo anterior.
  const selected = showTable ? (rows.find((row) => row.id === selectedId) ?? null) : null;

  function handleRowClick(row: NarrativeRow) {
    setSelectedId((current) => (current === row.id ? null : row.id));
  }

  return (
    <>
      <PageHeaderBar title="Narrativas" subtitle="Explore todas as Narrativas em monitoramento." />

      <div className="flex flex-col gap-6 p-8">
        {/* ✅ Adicionado 2026-07-14 (pedido do usuário: "atualizar o resumo
            executivo de todas as narrativas... permita que eu consiga
            executar a atualização... por algo disponível na sessão do
            administrador") — força narratives.description a ser
            recomposto AGORA pra toda Narrativa ativa desta organização,
            sem esperar o cron de 30min/janela de staleness (ver
            admin-refresh-narrative-summaries). Só admins veem o botão. */}
        <RefreshNarrativeSummariesButton />

        <div className="flex flex-wrap items-center gap-2 self-start rounded-md border border-border-default p-0.5">
          {DISPLAY_MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => setDisplayMode(option.mode)}
              className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                displayMode === option.mode ? "bg-accent-blue text-white" : "text-text-secondary hover:bg-bg-page"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {showTable && (
          <div className={`grid grid-cols-1 gap-6 ${selected ? "lg:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
            <WidgetCard
              title="Todas as Narrativas"
              status={status}
              onRetry={retry}
              headerAction={
                <div className="flex rounded-md border border-border-default p-0.5">
                  {GROUPING_OPTIONS.map((option) => (
                    <button
                      key={option.grouping}
                      type="button"
                      onClick={() => setTableGrouping(option.grouping)}
                      className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition-colors ${
                        tableGrouping === option.grouping
                          ? "bg-accent-blue text-white"
                          : "text-text-secondary hover:bg-bg-page"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            >
              <NarrativesTable
                rows={rows}
                onRowClick={handleRowClick}
                selectedId={selectedId}
                groupByCategory={tableGrouping === "category"}
              />
            </WidgetCard>

            {/* Painel de resumo ao lado da tabela — pedido do usuário
                2026-07-14: "mostre ao lado direito da tabela o card... de
                forma que o resumo executivo possa ser lido completamente."
                Mesmo NarrativeCard do resto do produto (Top N da Visão
                Geral, grade sem seleção abaixo) — garante que SOV/menções/
                risco/momentum/resumo/sentimento/tags fiquem consistentes em
                toda tela (pedido do usuário 2026-07-25). */}
            {selected && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">
                    Narrativa selecionada
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="text-xs font-medium text-text-secondary hover:text-accent-blue"
                  >
                    ✕ Fechar
                  </button>
                </div>
                <NarrativeCard narrative={selected} />
              </div>
            )}
          </div>
        )}

        {/* Cards agrupados por categoria (raia por Category-pai) — pedido do
            usuário 2026-07-25. Some quando há uma linha selecionada (o
            painel de resumo ao lado da tabela já cobre esse caso) e quando
            o modo de exibição é "Só tabela". */}
        {showCardsGrid && !selected && rows.length > 0 && <NarrativeCategoryLanes rows={rows} />}

        {/* ✅ Adicionado 2026-07-14 (pedido do usuário: "em todas as
            páginas é importante existir os principais tópicos positivos e
            negativos"), unificado no mesmo frame na mesma data (pedido
            seguinte: "no mesmo frente mudando apenas a cor") — visão
            agregada de todas as Narrativas listadas acima; o mapeamento
            tópico↔Narrativa individual já aparece em cada NarrativeCard
            (positive_topics/negative_topics). */}
        <WidgetCard title="Principais tópicos positivos e negativos" status={status} onRetry={retry}>
          <TopicSentimentList signals={envelope?.term_signals ?? []} />
        </WidgetCard>

        {/* ✅ Adicionado 2026-07-14 (pedido do usuário: "inclua um resumo
            executivo da página") — mesma Camada 0/1 de ai-synthesis.md já
            usada em Visão Geral/Sentimento/Pautas Eleitorais
            (PAGE_BLOCKS.narratives ganhou 'highlights'/'narrative_text'),
            nenhum mecanismo novo. */}
        <WidgetCard title="Resumo executivo da página" status={status} onRetry={retry}>
          <NarrativeTextPanel text={envelope?.narrative_text ?? null} page="narratives" onGenerated={retry} />
        </WidgetCard>
      </div>
    </>
  );
}

// Botão admin-only "Atualizar resumos das Narrativas" —
// admin-refresh-narrative-summaries (Edge Function nova, 2026-07-14).
// Diferente de NarrativeTextPanel's "Atualizar resumo executivo" (que
// recompõe o texto da PÁGINA via compose-narrative-synthesis), este botão
// força narratives.description (o resumo de CADA Narrativa,
// narrative-summary-composer) pra toda Narrativa ativa da organização de
// uma vez, ignorando a janela de staleness que o cron de 30min sempre
// respeita.
function RefreshNarrativeSummariesButton() {
  const { organizationId } = useIntelligenceCenterHeader();
  const { isAdmin } = useUserProfile();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  if (!isAdmin) return null;

  async function handleRefresh() {
    if (!organizationId) return;
    setIsRefreshing(true);
    try {
      const result = await callFunction<{ processed: number; updated: number; hasMore: boolean }>(
        "admin-refresh-narrative-summaries",
        { organization_id: organizationId },
      );
      setToast({
        type: "success",
        message:
          result.processed === 0
            ? "Nenhuma Narrativa ativa encontrada para esta organização."
            : `${result.updated} de ${result.processed} resumos executivos atualizados.${
                result.hasMore ? " Ainda há mais Narrativas — clique de novo para continuar." : ""
              }`,
      });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Não foi possível atualizar os resumos agora.",
      });
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setToast(null), 5000);
    }
  }

  return (
    <div className="flex flex-col gap-2 self-start">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="inline-flex items-center gap-2 rounded-md border border-accent-blue px-3 py-1.5 text-xs font-semibold text-accent-blue hover:bg-accent-blue-bg disabled:opacity-60"
      >
        {isRefreshing ? "Atualizando…" : "Atualizar resumos executivos das Narrativas"}
      </button>
      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}
