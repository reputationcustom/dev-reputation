"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { DisseminationGraphPanel } from "@/components/intelligence-center/dissemination-graph";
import { SentimentBadge, RiskBadge, VelocityIndicator, MomentumLabel } from "@/components/intelligence-center/score-badges";
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
  velocity_score: number | null;
  velocity_label: string | null;
  risk_score: number | null;
  risk_label: string | null;
  unique_authors: number | null;
  reach_estimated: number | null;
  engagement_total: number | null;
}

// Detalhe de Narrativa (`/narratives/[id]`,
// intelligence-center/narratives-exploration.md). ⚠️ Simplificação desta
// sessão: página cheia, não modal via intercepting route (ver nota em
// /narratives/page.tsx).
export default function NarrativeDetailPage() {
  const params = useParams<{ id: string }>();
  const narrativeId = params.id;
  const { status, envelope, retry } = usePageEnvelope("get-narrative-detail", { narrativeId });

  if (status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-6 w-6 text-accent-blue" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md">
          <ErrorMessage message="Não foi possível carregar esta Narrativa." onRetry={retry} />
        </div>
      </div>
    );
  }

  const summary = (envelope?.ui_meta.narrative ?? null) as NarrativeSummary | null;

  if (!summary) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState message="Narrativa não encontrada." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <Link href="/narratives" className="text-sm font-medium text-accent-blue hover:underline">
          ← Voltar para Narrativas
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-text-primary">{summary.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <SentimentBadge value={summary.net_sentiment} label={summary.sentiment_label} />
            <RiskBadge score={summary.risk_score} label={summary.risk_label} />
            <VelocityIndicator score={summary.velocity_score} label={summary.velocity_label} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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

        <WidgetCard title="Formação e propagação — principais disseminadores" status={status} onRetry={retry}>
          <AuthorsList authors={envelope?.authors ?? []} />
        </WidgetCard>
      </div>

      <WidgetCard title="Grafo de disseminação simplificado" status={status} onRetry={retry}>
        <DisseminationGraphPanel graph={envelope?.graph ?? null} />
      </WidgetCard>

      <WidgetCard title="Menções relevantes" status={status} onRetry={retry}>
        <EmptyState message="Lista de menções relevantes ainda não implementada — sem bloco correspondente no envelope atual." />
      </WidgetCard>

      <WidgetCard title="Ações e decisões" status={status} onRetry={retry}>
        <EmptyState message="Nenhuma ação registrada ainda." />
      </WidgetCard>
    </div>
  );
}
