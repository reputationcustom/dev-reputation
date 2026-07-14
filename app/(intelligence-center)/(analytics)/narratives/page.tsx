"use client";

import { useState } from "react";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { NarrativeCard } from "@/components/intelligence-center/narrative-card";
import { NarrativeCategoryLanes } from "@/components/intelligence-center/narrative-category-lanes";
import { TopicSentimentList } from "@/components/intelligence-center/term-signals-list";

// Exploração de Narrativas — lista (`/narratives`,
// intelligence-center/narratives-exploration.md). Clique numa linha abre um
// painel de resumo abaixo da tabela sem navegar (equivalente ao estado
// `hasSelection` do protótipo); "Ver página completa"/"Ver" navegam para o
// detalhe. ✅ **Implementado (2026-07-22)**: o detalhe abre como modal
// (intercepting route `@modal/(.)narratives/[id]`, ver
// app/(intelligence-center)/(analytics)/@modal/) — clicar num link pra
// `/narratives/[id]` a partir de qualquer página dentro de `(analytics)`
// (não só daqui) abre por cima da tela atual; acessar a URL direto (link
// compartilhado, recarregar a página) continua renderizando a página cheia,
// sem modal — ver narrative-detail-content.tsx.
export default function NarrativesListPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-narratives");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = envelope?.narratives ?? [];
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <>
      <PageHeaderBar title="Narrativas" subtitle="Explore todas as Narrativas em monitoramento." />

      <div className="flex flex-col gap-6 p-8">
        <WidgetCard title="Todas as Narrativas" status={status} onRetry={retry}>
          <NarrativesTable rows={rows} onRowClick={(row) => setSelectedId(row.id)} selectedId={selectedId} />
        </WidgetCard>

        {/* Painel de resumo ao clicar numa linha — usa o mesmo NarrativeCard
            do resto do produto (Top 3 da Visão Geral, grade sem seleção
            logo abaixo), não mais um painel de badges ad hoc; garante que
            SOV/menções/risco/momentum/resumo (reservado pra IA)/sentimento/
            tags fiquem consistentes em toda tela, pedido do usuário
            2026-07-25. */}
        {selected && (
          <div className="sm:max-w-md">
            <NarrativeCard narrative={selected} />
          </div>
        )}

        {/* Cards agrupados por categoria (raia por Category-pai) —
            pedido do usuário 2026-07-25, ver narrative-category-lanes.tsx. */}
        {!selected && rows.length > 0 && <NarrativeCategoryLanes rows={rows} />}

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
      </div>
    </>
  );
}
