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

export function RecentEventsPanel() {
  const { organizationId } = useIntelligenceCenterHeader();
  const { timezone } = useUserProfile();
  const { status, highlights, retry } = useRecentHighlights(organizationId);

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
    <div className="flex flex-col gap-3">
      {highlights.map((highlight) => (
        <EventCard key={highlight.id} highlight={highlight} timezone={timezone} />
      ))}
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
