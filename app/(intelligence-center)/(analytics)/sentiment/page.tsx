"use client";

import { useState } from "react";
import type { TopicSortMode } from "@reputation/shared-types";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { BrazilSentimentMap } from "@/components/intelligence-center/charts/brazil-sentiment-map";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { TopicSentimentList } from "@/components/intelligence-center/term-signals-list";
import { HighlightsPanel, NarrativeTextPanel } from "@/components/intelligence-center/insights-panel";
import { EmptyState } from "@/components/ui/empty-state";

// Análise de Sentimento (`/sentiment`, intelligence-center/sentiment-analysis.md).
// ✅ "Sentimento por Narrativa" resolvido em 2026-07-17 — breakdown type
// 'narrative' (get_narrative_sentiment_breakdown), split completo
// positivo/neutro/negativo por Narrativa-folha, ver sql-aggregation.md.
// ✅ "Mudança de sentimento" wired em 2026-08-03 — ai-synthesis.md
// Camadas 0/1 implementadas desde 2026-08-02 (aggregated-metrics-service.ts,
// event-radar/fluxo-aggregated-metrics.md "Fase B"); `/sentiment` é uma das
// 3 páginas que hoje alcançam a Camada 1 de verdade (highlights + narrative_text
// juntos em PAGE_BLOCKS, get-page-sentiment já deployada — ver ai-synthesis.md).
// `narrative_text` já era lido no widget "Insights" no fim da página; movido
// pra cá (não duplicado) pra ocupar a posição do protótipo original, ao lado
// de "Distribuição geral" — mesmo padrão de dedup já usado em /overview
// ("O que os gráficos mostram?").
// ⚠️ "Menções que mais influenciaram o sentimento" continua fora desta
// versão — não existe bloco de "mentions em destaque" no contrato do
// envelope ainda (ver _pending.md #19).
export default function SentimentPage() {
  const [topicSort, setTopicSort] = useState<TopicSortMode>("trending");
  const { status, envelope, retry } = usePageEnvelope("get-page-sentiment", { topicSort });

  return (
    <>
      <PageHeaderBar
        title="Análise de Sentimento"
        subtitle="Distribuição, evolução e drivers do sentimento."
        topicSort={topicSort}
        onTopicSortChange={setTopicSort}
      />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <WidgetCard title="Distribuição geral" status={status} onRetry={retry}>
            <BreakdownPanel
              breakdown={envelope?.breakdowns.find((b) => b.type === "sentiment")}
              emptyMessage="Nenhum dado de sentimento ainda."
            />
          </WidgetCard>
          {/* "Mudança de sentimento" (protótipo: callout textual ao lado da
              distribuição geral) — narrative_text da síntese de IA
              (ai-synthesis.md, Camadas 0/1), posição exata do protótipo
              original. */}
          <WidgetCard title="Mudança de sentimento" status={status} onRetry={retry}>
            <NarrativeTextPanel text={envelope?.narrative_text ?? null} page="sentiment" onGenerated={retry} />
          </WidgetCard>
        </div>

        <WidgetCard title="Evolução temporal do sentimento" status={status} onRetry={retry}>
          <TrendLineChart trend={envelope?.trends[0]} emptyMessage="Nenhum dado de evolução ainda." />
        </WidgetCard>

        {/* ✅ Reorganizado 2026-07-14 (pedido do usuário: "mova a tabela
            Sentimento por pauta para baixo da tabela Sentimento por
            plataforma") — "por plataforma" e "por pauta" agora empilhados
            na mesma coluna (direita), "por narrativa" sozinha na coluna
            esquerda, em vez de "por pauta" abaixo das duas como uma linha
            própria de largura cheia.
            ✅ Reordenado de novo, mesmo dia (pedido do usuário: "Drivers de
            sentimento e Insights deve vir logo após Sentimento por pauta do
            lado direito") — os dois passaram a viver DENTRO da coluna
            direita, empilhados logo abaixo de "Sentimento por pauta", em
            vez de widgets de largura cheia abaixo da grade inteira. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <WidgetCard title="Sentimento por narrativa" status={status} onRetry={retry}>
            <BreakdownPanel
              breakdown={envelope?.breakdowns.find((b) => b.type === "narrative")}
              emptyMessage="Nenhuma Narrativa em monitoramento ainda."
            />
          </WidgetCard>
          <div className="flex flex-col gap-6">
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

            {/* ✅ Unificado 2026-07-14 (pedido do usuário: "no mesmo frente
                mudando apenas a cor") — antes "Drivers positivos"/"Drivers
                negativos" em 2 WidgetCards separados. */}
            <WidgetCard title="Drivers de sentimento" status={status} onRetry={retry}>
              <TopicSentimentList signals={envelope?.term_signals ?? []} />
            </WidgetCard>

            {/* "Insights" só mostra highlights aqui — narrative_text já
                ocupa o widget "Mudança de sentimento" acima (não duplicado,
                mesmo padrão de dedup de /overview). */}
            <WidgetCard title="Insights" status={status} onRetry={retry}>
              <HighlightsPanel highlights={envelope?.highlights ?? []} />
            </WidgetCard>
          </div>
        </div>

        {/* ✅ Repivotado 2026-07-25 (pedido do usuário: "breakdown por
            estado brasileiro") — get_region_breakdown lê dimension_type='region'
            (estado), não mais 'country'. Ver sql-aggregation.md.
            ✅ Mapa adicionado (2026-07-25, mesmo dia, pedido do usuário:
            "Sentimento por estado pode ser representado em um mapa com
            rótulos e cores") — complementa a tabela (leitura geográfica de
            relance + número exato por estado), não a substitui.
            ✅ Layout lado a lado (2026-07-14, pedido do usuário: "redimensione
            o mapa para aparecer do lado esquerdo e uma tabela com a lista
            dos estados do lado direito") — antes empilhado (mapa em cima,
            tabela embaixo, separados por um `border-t`); mapa não fica mais
            centralizado/limitado a `max-w-sm` (só fazia sentido quando
            ocupava a largura inteira do card) — agora preenche sua própria
            coluna à esquerda, tabela ocupa a coluna à direita. Ver
            brazil-sentiment-map.tsx. */}
        <WidgetCard title="Sentimento por estado" status={status} onRetry={retry}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <BrazilSentimentMap items={envelope?.breakdowns.find((b) => b.type === "region")?.items ?? []} />
            <div className="border-t border-border-subtle pt-4 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
              <BreakdownPanel
                breakdown={envelope?.breakdowns.find((b) => b.type === "region")}
                emptyMessage="Nenhum dado por estado ainda."
              />
            </div>
          </div>
        </WidgetCard>

        <WidgetCard title="Menções que mais influenciaram o sentimento" status={status} onRetry={retry}>
          <EmptyState message="Lista de menções em destaque ainda não implementada — sem bloco correspondente no envelope atual." />
        </WidgetCard>
      </div>
    </>
  );
}
