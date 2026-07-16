"use client";

import { useState } from "react";
import Link from "next/link";
import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";
import { useUserProfile } from "@/hooks/use-user-profile";
import { useRecentHighlights, type RecentHighlight } from "@/hooks/use-recent-highlights";
import { RiskBadge } from "@/components/intelligence-center/score-badges";
import { ExpandableText } from "@/components/ui/expandable-text";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorMessage } from "@/components/ui/error-message";
import { EmptyState } from "@/components/ui/empty-state";
import { Toast } from "@/components/ui/toast";
import { formatRelativeTime } from "@/lib/date/format";
import { createClient } from "@/lib/supabase/client";

// event-radar/frontend-highlights-feed.md — widget "Radar de Eventos". A
// aba "Lista" tem janela FIXA de 72h, independente do período selecionado
// no header (por isso busca `highlights` com seu próprio fetch/estado, via
// `useRecentHighlights`, não vem do envelope da página). Substitui
// HighlightsPanel (bloco `highlights` genérico, por período) apenas neste
// lugar específico de /overview — HighlightsPanel continua existindo pra
// uso futuro em outras páginas.
//
// ✅ "Resumo executivo" reescrito (2026-07-16) — pedido do usuário: o texto
// precisa cobrir tudo que aconteceu nas últimas 72h (eventos do radar E o
// que mudou nas Narrativas monitoradas, mesmo sem virar evento), com
// associação entre assunto quente/engajamento, sentimento que
// melhorou/piorou, plataformas/autores, Momentum/Tendência/Risco. Antes
// disso, esta aba só reaproveitava `narrative_text` — o mesmo texto
// período-escopado de "O que os gráficos mostram?", que nunca combinava
// eventos do radar com o snapshot das Narrativas e variava com o período
// do header (o oposto do que "últimas 72h" promete). Agora recebe
// `radarSummaryText` (ver `aggregated-metrics-service.ts`,
// fetchOverviewRadarSummaryText/ui_meta.radar_summary_text) — uma seção
// Camada 2 própria, com janela fixa de 72h, independente do período do
// header, igual à aba "Lista". Sem botão de atualização manual por
// enquanto (fora de escopo desta rodada — `compose-narrative-synthesis`
// só recompõe a seção `main`, não `radar_summary`); o texto se atualiza
// sozinho via o mesmo gatilho de tempo/evento novo de qualquer outra
// seção Camada 2.
const EVENT_ICON: Record<string, string> = {
  volume_spike: "↑",
  volume_drop: "↓",
  sentiment_change: "●",
  negative_sentiment_increase: "●",
  negative_sentiment_spike: "●",
  momentum_spike: "⚡",
  emerging_topic: "✦",
  notable_mention: "★",
};

const SEVERITY_BORDER: Record<string, string> = {
  low: "border-risk-low",
  medium: "border-risk-medium",
  high: "border-risk-high",
  critical: "border-risk-critical",
};

const FEEDBACK_OPTIONS: { type: string; label: string }[] = [
  { type: "useful", label: "Útil" },
  { type: "irrelevant", label: "Irrelevante" },
  { type: "wrong_severity", label: "Severidade errada" },
  { type: "wrong_explanation", label: "Explicação incorreta" },
];

// ✅ Reintroduzido 2026-07-14 — pedido do usuário: as KPIs "Quantidade de
// alertas por risco" (existiam na 1ª versão do "Resumo executivo",
// 2026-08-08, antes de ele virar só o texto de IA em 2026-07-14 mais
// cedo) tinham desaparecido junto com o resto daquele resumo derivado.
// Volta só a contagem por severidade — 100% derivada dos mesmos
// `highlights` já buscados por `useRecentHighlights` (nenhuma chamada
// nova, Princípio técnico 2), sem o restante do resumo antigo (Eventos
// por tipo/Principais eventos), que o texto de IA já cobre em prosa.
const SEVERITY_LABEL: Record<string, string> = {
  critical: "Críticos",
  high: "Altos",
  medium: "Médios",
  low: "Baixos",
};

function severityCounts(highlights: RecentHighlight[]) {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const highlight of highlights) {
    if (highlight.severity && highlight.severity in counts) {
      counts[highlight.severity] += 1;
    }
  }
  return counts;
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg-page p-2 text-center sm:p-3">
      <p className="text-lg font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-tertiary">{label}</p>
    </div>
  );
}

// ✅ Duas visualizações alternáveis (2026-07-14, pedido do usuário: "Radar
// de Eventos deve ter duas possibilidades — a lista dos eventos como está
// hoje e o resumo executivo"). O toggle vive aqui (não em cada página que
// renderiza `RecentEventsPanel`) porque tanto /overview quanto /radar
// consomem este mesmo componente — um único lugar garante que as duas
// telas ganhem a mesma capacidade, sem duplicar lógica.
//
// ✅ **"Resumo executivo" reescrito de novo (2026-07-16)** — ver o
// blockquote de topo do arquivo: agora recebe `radarSummaryText`
// (`ui_meta.radar_summary_text`, seção Camada 2 própria com janela fixa de
// 72h), não mais `narrative_text` da página hospedeira. A visualização
// "Lista" continua inalterada (fixed-72h, seu propósito original).
type RecentEventsView = "list" | "summary";

const VIEW_OPTIONS: { view: RecentEventsView; label: string }[] = [
  { view: "list", label: "Lista" },
  { view: "summary", label: "Resumo executivo" },
];

export function RecentEventsPanel({
  radarSummaryText,
  defaultView = "list",
}: {
  radarSummaryText: string | null;
  // ✅ 2026-07-14, pedido do usuário: /overview deve abrir o widget já no
  // "Resumo executivo" — /radar continua abrindo em "Lista" (default),
  // já que lá o feed completo de 72h é o próprio propósito da página.
  defaultView?: RecentEventsView;
}) {
  const { organizationId } = useIntelligenceCenterHeader();
  const { timezone } = useUserProfile();
  const { status, highlights, retry } = useRecentHighlights(organizationId);
  const [view, setView] = useState<RecentEventsView>(defaultView);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (status === "error") {
    return <ErrorMessage message="Não foi possível carregar os eventos recentes." onRetry={retry} />;
  }

  const bySeverity = severityCounts(highlights);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex rounded-md border border-border-default p-0.5 self-start">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.view}
            type="button"
            onClick={() => setView(option.view)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              view === option.view ? "bg-accent-blue text-white" : "text-text-secondary hover:bg-bg-page"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view === "list" ? (
        highlights.length === 0 ? (
          <EmptyState message="Nenhum evento nas últimas 72 horas." />
        ) : (
          <div className="flex flex-col gap-3">
            {highlights.map((highlight) => (
              <EventCard key={highlight.id} highlight={highlight} timezone={timezone} />
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            <SummaryStat label="Total de eventos" value={highlights.length} />
            {(["critical", "high", "medium", "low"] as const).map((severity) => (
              <SummaryStat key={severity} label={SEVERITY_LABEL[severity]} value={bySeverity[severity]} />
            ))}
          </div>
          {radarSummaryText ? (
            <ExpandableText text={radarSummaryText} maxLines={6} />
          ) : (
            <p className="text-sm text-text-tertiary">Síntese automática indisponível no momento.</p>
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({ highlight, timezone }: { highlight: RecentHighlight; timezone: string }) {
  const [feedbackSent, setFeedbackSent] = useState(false);

  return (
    <div
      className={`rounded-lg border-l-4 bg-bg-page p-4 ${SEVERITY_BORDER[highlight.severity ?? ""] ?? "border-border-default"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-base leading-none text-text-tertiary" aria-hidden>
            {EVENT_ICON[highlight.event_type] ?? "•"}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge score={highlight.severity_score} label={highlight.severity} />
              <span className="text-xs text-text-tertiary">{formatRelativeTime(highlight.created_at, timezone)}</span>
            </div>
            <p className="mt-1 text-sm font-semibold text-text-primary">{highlight.title}</p>
            <p className="mt-1 text-sm text-text-secondary">{highlight.summary}</p>
            {highlight.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {highlight.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-bg-card px-2 py-0.5 text-xs font-medium text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {highlight.related_narrative_id && (
              <Link
                href={`/narratives/${highlight.related_narrative_id}`}
                className="mt-2 inline-block text-sm font-medium text-accent-blue hover:underline"
              >
                Ver Narrativa →
              </Link>
            )}
          </div>
        </div>
        <FeedbackMenu feedEventId={highlight.id} sent={feedbackSent} onSent={() => setFeedbackSent(true)} />
      </div>
    </div>
  );
}

function FeedbackMenu({
  feedEventId,
  sent,
  onSent,
}: {
  feedEventId: string;
  sent: boolean;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function submit(feedbackType: string) {
    setSubmitting(true);
    setOpen(false);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sem sessão ativa.");

      const { error } = await supabase.from("feed_event_feedback").insert({
        feed_event_id: feedEventId,
        user_id: user.id,
        feedback_type: feedbackType,
      });
      if (error) throw error;

      onSent();
      setToast({ type: "success", message: "Feedback enviado." });
    } catch {
      setToast({ type: "error", message: "Não foi possível enviar o feedback." });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  if (sent) {
    return <span className="whitespace-nowrap text-xs text-text-tertiary">Feedback enviado ✓</span>;
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={submitting}
        aria-label="Dar feedback sobre este evento"
        className="rounded-md px-2 py-1 text-text-tertiary hover:bg-bg-card hover:text-text-primary disabled:opacity-50"
      >
        ⋮
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border border-border-default bg-bg-card py-1 shadow-lg">
            {FEEDBACK_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => submit(option.type)}
                className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-bg-page"
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}
