"use client";

import Link from "next/link";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";
import { useUserProfile } from "@/hooks/use-user-profile";
import { NarrativeCommunicationsSection } from "@/components/communications/narrative-communications-section";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { BreakdownPanel } from "@/components/intelligence-center/charts/breakdown-panel";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { DisseminationStanceLists } from "@/components/intelligence-center/dissemination-stance-lists";
import { DisseminationGraphPanel } from "@/components/intelligence-center/dissemination-graph";
import { TermSignalsList, TopicSentimentList } from "@/components/intelligence-center/term-signals-list";
import { SentimentBadge, RiskBadge, TrendIndicator, MomentumLabel } from "@/components/intelligence-center/score-badges";
import { KPI_TOOLTIPS } from "@/components/intelligence-center/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { Tooltip } from "@/components/ui/tooltip";

// Mesmo texto do tooltip de "Momentum" já usado em narratives-table.tsx
// (coluna Momentum) — não existe em KPI_TOOLTIPS (metric-card.tsx) porque
// Momentum não é um dos 5 KPIs da Visão Geral, só das Narrativas.
const MOMENTUM_TOOLTIP =
  "Força atual da Narrativa (volume, engajamento, autores e alcance), comparando o período selecionado com o período anterior de mesma duração.";

// Label de KPI padronizado (pedido do usuário 2026-07-25: "padronize as
// KPIs da mesma maneira que são mostrados na página overview") — mesmo
// estilo de metric-card.tsx (MetricCard/SentimentMetricCard): rótulo em
// caixa alta, negrito, preto, com "?" de tooltip ao lado. Local a este
// arquivo porque os 4 stats aqui vêm de `ui_meta.narrative` (um resumo por
// Narrativa), não do bloco `metrics` do envelope que MetricCard consome —
// sem `delta_pct`/comparação com período anterior disponível pra esses 4
// campos, então só o "shell" visual é reaproveitado, não o componente
// inteiro.
function KpiLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-primary">
      {label}
      {tooltip && (
        <Tooltip text={tooltip}>
          <span
            tabIndex={0}
            aria-label={`O que é ${label}`}
            className="flex h-3.5 w-3.5 flex-shrink-0 cursor-help items-center justify-center rounded-full border border-text-tertiary text-[9px] font-bold normal-case text-text-tertiary outline-none focus-visible:border-accent-blue focus-visible:text-accent-blue"
          >
            ?
          </span>
        </Tooltip>
      )}
    </p>
  );
}

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
  const { organizationId } = useIntelligenceCenterHeader();
  const { timezone } = useUserProfile();

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
          <KpiLabel label="Momentum (crescimento)" tooltip={MOMENTUM_TOOLTIP} />
          <p className="mt-2 text-2xl font-bold text-text-primary">
            {summary.momentum_score === null ? "—" : Math.round(summary.momentum_score)}
          </p>
          <div className="mt-1">
            <MomentumLabel score={summary.momentum_score} />
          </div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <KpiLabel label="Autores únicos" tooltip={KPI_TOOLTIPS.unique_authors} />
          <p className="mt-2 text-2xl font-bold text-text-primary">
            {summary.unique_authors === null ? "—" : new Intl.NumberFormat("pt-BR").format(summary.unique_authors)}
          </p>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <KpiLabel label="Alcance estimado" tooltip={KPI_TOOLTIPS.reach_estimate} />
          <p className="mt-2 text-2xl font-bold text-text-primary">
            {summary.reach_estimated === null ? "—" : new Intl.NumberFormat("pt-BR").format(summary.reach_estimated)}
          </p>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <KpiLabel label="Engajamento total" tooltip={KPI_TOOLTIPS.engagement_score} />
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
          <div className="flex flex-col gap-4">
            {/* ✅ 2026-08-08 (pedido do usuário: "quem está movimentando essa
                narrativa. Engajamento, reposts, comentários etc.") —
                variante "disseminators" de AuthorsList, focada em
                Plataforma/Papel na conversa/Seguidores/Publicações/
                Engajamento em vez de Partido/Ideologia/Alcance/Sentimento
                (colunas já cobertas por "full", reusada noutras páginas). */}
            <AuthorsList authors={envelope?.authors ?? []} variant="disseminators" />
            {(envelope?.authors ?? []).length > 0 && <DisseminationStanceLists authors={envelope?.authors ?? []} />}
          </div>
        </WidgetCard>

        <WidgetCard title="Grafo de disseminação simplificado" status={status} onRetry={retry}>
          <DisseminationGraphPanel graph={envelope?.graph ?? null} />
        </WidgetCard>
      </div>

      <WidgetCard title="Termos e frases mais citados" status={status} onRetry={retry}>
        <TermSignalsList
          signals={envelope?.term_signals ?? []}
          emptyMessage="Nenhum termo/frase em destaque para esta Narrativa neste período."
        />
      </WidgetCard>

      {/* ✅ Adicionado 2026-07-14 (pedido do usuário: "no caso das
          narrativas é importantíssimo esse mapeamento dos tópicos com a
          narrativa para melhorar o entendimento da IA e do usuário final")
          — mesmo `term_signals` acima (já escopado a esta Narrativa via
          filters.narratives), separado por polaridade. Unificado no mesmo
          frame na mesma data (pedido seguinte: "no mesmo frente mudando
          apenas a cor"). */}
      <WidgetCard title="Tópicos positivos e negativos da narrativa" status={status} onRetry={retry}>
        <TopicSentimentList signals={envelope?.term_signals ?? []} />
      </WidgetCard>

      <WidgetCard title="Menções relevantes" status={status} onRetry={retry}>
        <EmptyState message="Lista de menções relevantes ainda não implementada — sem bloco correspondente no envelope atual." />
      </WidgetCard>

      <WidgetCard title="Ações e decisões" status={status} onRetry={retry}>
        <EmptyState message="Nenhuma ação registrada ainda." />
      </WidgetCard>

      {/* Módulo `communications` (Sprint 2.1) — não confundir com "Ações e
          decisões" (cases) acima, ver communications/overview.md, "Relação
          com cases". organizationId vem do mesmo header global que já
          escopa o resto da página. */}
      <WidgetCard title="Comunicações e Decisões" status={status} onRetry={retry}>
        {organizationId && (
          <NarrativeCommunicationsSection
            organizationId={organizationId}
            narrativeId={narrativeId}
            narrativeTitle={summary.title}
            timezone={timezone}
          />
        )}
      </WidgetCard>
      </div>
    </>
  );
}
