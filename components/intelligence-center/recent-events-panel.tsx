"use client";

import { useState } from "react";
import Link from "next/link";
import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";
import { useUserProfile } from "@/hooks/use-user-profile";
import { useRecentHighlights, type RecentHighlight } from "@/hooks/use-recent-highlights";
import { RiskBadge } from "@/components/intelligence-center/score-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorMessage } from "@/components/ui/error-message";
import { EmptyState } from "@/components/ui/empty-state";
import { Toast } from "@/components/ui/toast";
import { formatRelativeTime } from "@/lib/date/format";
import { createClient } from "@/lib/supabase/client";

// event-radar/frontend-highlights-feed.md — widget "Radar de Eventos",
// janela FIXA de 72h, independente do período selecionado no header (por
// isso tem seu próprio fetch/estado, não vem do envelope de
// get-page-overview). Substitui HighlightsPanel (bloco `highlights`
// genérico, por período) apenas neste lugar específico de /overview —
// HighlightsPanel continua existindo pra uso futuro em outras páginas.
const EVENT_ICON: Record<string, string> = {
  volume_spike: "↑",
  volume_drop: "↓",
  sentiment_change: "●",
  negative_sentiment_increase: "●",
  negative_sentiment_spike: "●",
  momentum_spike: "⚡",
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

// ✅ Duas visualizações alternáveis (2026-07-14, pedido do usuário: "Radar
// de Eventos deve ter duas possibilidades — a lista dos eventos como está
// hoje e o resumo executivo"). O toggle vive aqui (não em cada página que
// renderiza `RecentEventsPanel`) porque tanto /overview quanto /radar
// consomem este mesmo componente — um único lugar garante que as duas
// telas ganhem a mesma capacidade, sem duplicar lógica. "Resumo executivo"
// é 100% derivado dos mesmos `highlights` já buscados (agrupamento/
// contagem para exibição, não um novo cálculo de score — Princípio técnico
// 2), sem nenhuma chamada de rede adicional.
type RecentEventsView = "list" | "summary";

const VIEW_OPTIONS: { view: RecentEventsView; label: string }[] = [
  { view: "list", label: "Lista" },
  { view: "summary", label: "Resumo executivo" },
];

export function RecentEventsPanel() {
  const { organizationId } = useIntelligenceCenterHeader();
  const { timezone } = useUserProfile();
  const { status, highlights, retry } = useRecentHighlights(organizationId);
  const [view, setView] = useState<RecentEventsView>("list");

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

  if (highlights.length === 0) {
    return <EmptyState message="Nenhum evento nas últimas 72 horas." />;
  }

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
        <div className="flex flex-col gap-3">
          {highlights.map((highlight) => (
            <EventCard key={highlight.id} highlight={highlight} timezone={timezone} />
          ))}
        </div>
      ) : (
        <RecentEventsExecutiveSummary highlights={highlights} timezone={timezone} />
      )}
    </div>
  );
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Críticos",
  high: "Altos",
  medium: "Médios",
  low: "Baixos",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  volume_spike: "Pico de volume",
  volume_drop: "Queda de volume",
  sentiment_change: "Mudança de sentimento",
  negative_sentiment_increase: "Aumento de sentimento negativo",
  negative_sentiment_spike: "Pico de sentimento negativo",
  momentum_spike: "Momentum explosivo",
};

// Resumo executivo — contagens por severidade/tipo (agrupamento pra
// exibição, não recálculo de score) + os eventos de maior severidade em
// destaque, mesmos campos já buscados por `useRecentHighlights` (nenhuma
// chamada nova).
function RecentEventsExecutiveSummary({
  highlights,
  timezone,
}: {
  highlights: RecentHighlight[];
  timezone: string;
}) {
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const highlight of highlights) {
    if (highlight.severity && highlight.severity in bySeverity) {
      bySeverity[highlight.severity] += 1;
    }
  }

  const byType = new Map<string, number>();
  for (const highlight of highlights) {
    byType.set(highlight.event_type, (byType.get(highlight.event_type) ?? 0) + 1);
  }

  const topEvents = [...highlights]
    .sort((a, b) => (b.severity_score ?? 0) - (a.severity_score ?? 0))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      {/* ✅ Uma única linha (2026-08-08), pedido do usuário — antes
          `grid-cols-2 sm:grid-cols-4` deixava "Baixos" (5º item) quebrar
          pra uma segunda linha mesmo em telas largas. */}
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        <SummaryStat label="Total de eventos" value={highlights.length} />
        {(["critical", "high", "medium", "low"] as const).map((severity) => (
          <SummaryStat key={severity} label={SEVERITY_LABEL[severity]} value={bySeverity[severity]} />
        ))}
      </div>

      {byType.size > 0 && (
        <div>
          <h3 className="text-xs font-bold text-text-primary">Eventos por tipo</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...byType.entries()].map(([type, count]) => (
              <span
                key={type}
                className="rounded-full bg-bg-page px-3 py-1 text-xs font-medium text-text-secondary"
              >
                {EVENT_TYPE_LABEL[type] ?? type} · {count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-bold text-text-primary">Principais eventos</h3>
        <div className="mt-2 flex flex-col gap-3">
          {topEvents.map((highlight) => (
            <div
              key={highlight.id}
              className="flex items-start gap-2 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0"
            >
              <RiskBadge score={highlight.severity_score} label={highlight.severity} />
              <div>
                <p className="text-sm font-semibold text-text-primary">{highlight.title}</p>
                <p className="text-xs text-text-secondary">{highlight.explanation || highlight.summary}</p>
                <p className="mt-0.5 text-xs text-text-tertiary">
                  {formatRelativeTime(highlight.created_at, timezone)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg-page p-2 text-center sm:p-3">
      <p className="text-lg font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-tertiary">{label}</p>
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
