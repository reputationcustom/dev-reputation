"use client";

import Link from "next/link";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { DisseminationGraphPanel } from "@/components/intelligence-center/dissemination-graph";
import { SentimentBadge, RiskBadge, TrendIndicator, MomentumLabel } from "@/components/intelligence-center/score-badges";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";

// Espelha get-narrative-detail's NarrativeSummary (supabase/functions/
// get-narrative-detail/index.ts) — ui_meta.narrative não faz parte do
// contrato canônico do envelope (@reputation/shared-types só modela os 8
// blocos padrão), é um extra específico desta página, documentado nos dois
// lados (ver comentário no Edge Function).
interface NarrativeSummary {
  id: string;
  title: string;
  description: string | null;
  stage: string;
  risk_level: string;
  sov_pct: number | null;
  total_mentions: number;
  net_sentiment: number | null;
  sentiment_label: string | null;
  momentum_score: number | null;
  trend_score: number | null;
  trend_label: string | null;
  risk_score: number | null;
  risk_label: string | null;
  unique_authors: number | null;
  reach_estimated: number | null;
  engagement_total: number | null;
}

// Corpo do Detalhe de Narrativa (`intelligence-center/narratives-exploration.md`,
// "Detalhe (/narratives/[id])") — extraído de narratives/[id]/page.tsx
// (2026-07-22) pra ser reusado tanto pela página cheia quanto pelo modal
// (`@modal/(.)narratives/[id]/page.tsx`), exatamente como a spec original
// já pedia desde 2026-07-12 ("Um único componente de detalhe serve os dois
// casos — não duplica UI"). `isModal` só controla 2 detalhes de chrome: (1)
// não renderiza o `PageHeaderBar` completo (organização/período já estão
// visíveis na página por trás do modal); (2) troca o link "Voltar para
// Narrativas" por "Abrir página completa" — um `<a>` nativo (não
// `next/link`), de propósito: uma navegação client-side pro mesmo
// `/narratives/[id]` continuaria sendo interceptada pelo modal (a
// interceptação do Next.js é baseada em navegação soft, não na URL), então
// só uma navegação "dura" (reload real) escapa dela e renderiza a página
// cheia — mesmo efeito de "recarregar a página" que a spec original já
// previa para acesso direto por link compartilhado.
export function NarrativeDetailContent({
  narrativeId,
  isModal = false,
}: {
  narrativeId: string;
  isModal?: boolean;
}) {
  const { status, envelope, retry } = usePageEnvelope("get-narrative-detail", { narrativeId });

  if (status === "loading") {
    return (
      <>
        {!isModal && <PageHeaderBar title="Detalhe da Narrativa" />}
        <div className="flex flex-1 items-center justify-center p-8">
          <Spinner className="h-6 w-6 text-accent-blue" />
        </div>
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        {!isModal && <PageHeaderBar title="Detalhe da Narrativa" />}
        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <div className="w-full max-w-md">
            <ErrorMessage message="Não foi possível carregar esta Narrativa." onRetry={retry} />
          </div>
        </div>
      </>
    );
  }

  const summary = (envelope?.ui_meta.narrative ?? null) as NarrativeSummary | null;

  if (!summary) {
    return (
      <>
        {!isModal && <PageHeaderBar title="Detalhe da Narrativa" />}
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState message="Narrativa não encontrada." />
        </div>
      </>
    );
  }

  return (
    <>
      {/* Sem `title` aqui — a página já renderiza seu próprio <h1> +
          badges logo abaixo, ver comentário em page-header-bar.tsx. */}
      {!isModal && <PageHeaderBar />}
      <div className="flex flex-col gap-6 p-8">
      <div>
        {isModal ? (
          <a
            href={`/narratives/${narrativeId}`}
            className="text-sm font-medium text-accent-blue hover:underline"
          >
            Abrir página completa ↗
          </a>
        ) : (
          <Link href="/narratives" className="text-sm font-medium text-accent-blue hover:underline">
            ← Voltar para Narrativas
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-text-primary">{summary.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <SentimentBadge value={summary.net_sentiment} label={summary.sentiment_label} />
            <RiskBadge score={summary.risk_score} label={summary.risk_label} />
            <TrendIndicator score={summary.trend_score} label={summary.trend_label} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Momentum (crescimento)</p>
          <div className="mt-2">
            <MomentumLabel score={summary.momentum_score} />
          </div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Autores únicos</p>
          <p className="mt-2 text-2xl font-bold text-text-primary">
            {summary.unique_authors === null ? "—" : new Intl.NumberFormat("pt-BR").format(summary.unique_authors)}
          </p>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Alcance estimado</p>
          <p className="mt-2 text-2xl font-bold text-text-primary">
            {summary.reach_estimated === null ? "—" : new Intl.NumberFormat("pt-BR").format(summary.reach_estimated)}
          </p>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Engajamento total</p>
          <p className="mt-2 text-2xl font-bold text-text-primary">
            {summary.engagement_total === null ? "—" : new Intl.NumberFormat("pt-BR").format(summary.engagement_total)}
          </p>
        </div>
      </div>

      <WidgetCard title="Resumo executivo" status={status} onRetry={retry}>
        {summary.description ? (
          <p className="text-sm leading-relaxed text-text-primary">{summary.description}</p>
        ) : (
          <EmptyState message="Ainda sem resumo executivo gerado para esta Narrativa." />
        )}
      </WidgetCard>

      <WidgetCard title="Evolução (Narrativa vs. volume geral)" status={status} onRetry={retry}>
        <TrendLineChart
          trend={envelope?.trends.find((t) => t.key === "narrative_vs_overall_volume")}
          emptyMessage="Nenhum dado de evolução ainda."
        />
      </WidgetCard>

      {/* Extra além do protótipo (que não tem essa seção na página de
          detalhe) — dado real já disponível (mesmas breakdowns de
          Sentimento), não fabricado, mantido como valor agregado. */}
      <WidgetCard title="Sentimento e plataforma" status={status} onRetry={retry}>
        <div className="flex flex-col gap-4">
          <BreakdownPanel
            breakdown={envelope?.breakdowns.find((b) => b.type === "sentiment")}
            emptyMessage="Nenhum dado de sentimento ainda."
          />
          <BreakdownPanel
            breakdown={envelope?.breakdowns.find((b) => b.type === "platform")}
            emptyMessage="Nenhum dado de plataforma ainda."
          />
        </div>
      </WidgetCard>

      {/* Lado a lado, mesma organização do protótipo original: "Formação e
          propagação" (disseminadores) + "Grafo de disseminação
          simplificado". */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <WidgetCard title="Formação e propagação — principais disseminadores" status={status} onRetry={retry}>
          <AuthorsList authors={envelope?.authors ?? []} />
        </WidgetCard>

        <WidgetCard title="Grafo de disseminação simplificado" status={status} onRetry={retry}>
          <DisseminationGraphPanel graph={envelope?.graph ?? null} />
        </WidgetCard>
      </div>

      <WidgetCard title="Menções relevantes" status={status} onRetry={retry}>
        <EmptyState message="Lista de menções relevantes ainda não implementada — sem bloco correspondente no envelope atual." />
      </WidgetCard>

      <WidgetCard title="Ações e decisões" status={status} onRetry={retry}>
        <EmptyState message="Nenhuma ação registrada ainda." />
      </WidgetCard>
      </div>
    </>
  );
}
