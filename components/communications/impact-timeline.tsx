"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { SentimentBadge, RiskBadge, MomentumLabel, TrendIndicator } from "@/components/intelligence-center/score-badges";
import { formatDateTime } from "@/lib/date/format";
import type { CommunicationTimelineItem } from "@/components/communications/types";

// Linha do tempo de impacto (communications/narrative-impact-tracking.md)
// — reaproveitada tanto pela página cheia (/communications/[narrativeId])
// quanto pelo resumo compacto no detalhe de Narrativa (narrative-detail-content.tsx).
// `compact` limita a 3 itens mais recentes e omite o texto de rodapé
// (correlação/causalidade) por item — mostrado uma vez só na página cheia.

function directionArrow(before: number | null, after: number | null, invert = false): { symbol: string; color: string } {
  if (before === null || after === null) return { symbol: "—", color: "text-text-tertiary" };
  const diff = after - before;
  if (Math.abs(diff) < 0.5) return { symbol: "→", color: "text-text-tertiary" };
  const up = diff > 0;
  const good = invert ? !up : up;
  return { symbol: up ? "↑" : "↓", color: good ? "text-sentiment-positive" : "text-sentiment-negative" };
}

function MetricDelta({
  label,
  before,
  after,
  arrow,
  formatValue,
}: {
  label: string;
  before: number | null;
  after: number | null;
  arrow: { symbol: string; color: string };
  formatValue: (v: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{label}</span>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-secondary">{before === null ? "sem dado suficiente" : formatValue(before)}</span>
        <span className={`font-bold ${arrow.color}`} aria-hidden>
          {arrow.symbol}
        </span>
        <span className="font-semibold text-text-primary">{after === null ? "sem dado suficiente" : formatValue(after)}</span>
      </div>
    </div>
  );
}

function TimelineCard({ item, timezone, compact }: { item: CommunicationTimelineItem; timezone: string; compact: boolean }) {
  const mentionsArrow = directionArrow(item.mentions_per_day_before, item.mentions_per_day_after);
  const sentimentArrow = directionArrow(item.net_sentiment_before, item.net_sentiment_after);
  const momentumArrow = directionArrow(item.momentum_score_before, item.momentum_score_after);
  const riskArrow = directionArrow(item.risk_score_before, item.risk_score_after, true);

  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-text-primary">{item.title}</p>
          <p className="text-xs text-text-tertiary">
            {item.communication_type_label ?? "Decisão"}
            {item.channel_detail ? ` · ${item.channel_detail}` : ""} · {formatDateTime(item.occurred_at, timezone)}
          </p>
        </div>
        {!item.after_window_complete && (
          <span className="rounded-full bg-[#fdf3e0] px-2.5 py-1 text-xs font-semibold text-[#e0a13e]">
            Ainda em observação
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Sentimento</span>
          <div className="flex items-center gap-2">
            <SentimentBadge value={item.net_sentiment_before} label={item.sentiment_label_before} />
            <span className={`font-bold ${sentimentArrow.color}`} aria-hidden>
              {sentimentArrow.symbol}
            </span>
            <SentimentBadge value={item.net_sentiment_after} label={item.sentiment_label_after} />
          </div>
        </div>

        <MetricDelta
          label="Menções (média/dia)"
          before={item.mentions_per_day_before}
          after={item.mentions_per_day_after}
          arrow={mentionsArrow}
          formatValue={(v) => v.toFixed(1)}
        />

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Risco</span>
          <div className="flex items-center gap-2">
            <RiskBadge score={item.risk_score_before} label={item.risk_label_before} />
            <span className={`font-bold ${riskArrow.color}`} aria-hidden>
              {riskArrow.symbol}
            </span>
            <RiskBadge score={item.risk_score_after} label={item.risk_label_after} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Momentum</span>
          <div className="flex items-center gap-2 text-sm">
            <MomentumLabel score={item.momentum_score_before} />
            <span className={`font-bold ${momentumArrow.color}`} aria-hidden>
              {momentumArrow.symbol}
            </span>
            <MomentumLabel score={item.momentum_score_after} />
          </div>
        </div>
      </div>

      {item.trend_score_before !== null || item.trend_score_after !== null ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-text-tertiary">
          <span className="font-semibold uppercase tracking-wide">Tendência:</span>
          <TrendIndicator score={item.trend_score_before} label={item.trend_label_before} />
          <span aria-hidden>→</span>
          <TrendIndicator score={item.trend_score_after} label={item.trend_label_after} />
        </div>
      ) : null}

      {!compact && (
        <p className="mt-4 border-t border-border-subtle pt-3 text-xs text-text-tertiary">
          Comparação de correlação, não de causalidade — outros fatores no mesmo período também podem ter
          influenciado esta variação.
        </p>
      )}
    </div>
  );
}

export function ImpactTimeline({
  items,
  timezone,
  compact = false,
  narrativeId,
}: {
  items: CommunicationTimelineItem[];
  timezone: string;
  compact?: boolean;
  narrativeId?: string;
}) {
  if (items.length === 0) {
    return <EmptyState message="Nenhuma comunicação ou decisão registrada para esta Narrativa ainda." />;
  }

  const ordered = [...items].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  const visible = compact ? ordered.slice(0, 3) : ordered;

  return (
    <div className="flex flex-col gap-4">
      {visible.map((item) => (
        <TimelineCard key={item.communication_id} item={item} timezone={timezone} compact={compact} />
      ))}
      {compact && items.length > 3 && narrativeId && (
        <Link href={`/communications/${narrativeId}`} className="text-sm font-medium text-accent-blue hover:underline">
          Ver linha do tempo completa →
        </Link>
      )}
    </div>
  );
}
