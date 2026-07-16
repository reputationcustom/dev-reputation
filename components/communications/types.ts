// Tipos compartilhados do módulo `communications` (Sprint 2.1) — não faz
// parte do envelope de aggregated-metrics (@reputation/shared-types), por
// isso vive local a este módulo em vez de lá.

export type CommunicationRecordType = "communication" | "decision";

export interface CommunicationRow {
  id: string;
  narrative_id: string;
  record_type: CommunicationRecordType;
  title: string;
  description: string | null;
  occurred_at: string;
  channel_detail: string | null;
  external_url: string | null;
  bw_resource_id: string | null;
  assignee_id: string | null;
  created_by: string | null;
  communication_type_id: string | null;
  narratives: { title: string } | null;
  communication_types: { label: string } | null;
}

export interface CommunicationTimelineItem {
  communication_id: string;
  narrative_id: string;
  record_type: CommunicationRecordType;
  occurred_at: string;
  title: string;
  communication_type_label: string | null;
  channel_detail: string | null;
  before_start: string;
  before_end: string;
  after_start: string;
  after_end: string;
  after_window_complete: boolean;
  mentions_per_day_before: number | null;
  mentions_per_day_after: number | null;
  mentions_delta_pct: number | null;
  net_sentiment_before: number | null;
  net_sentiment_after: number | null;
  sentiment_label_before: string | null;
  sentiment_label_after: string | null;
  momentum_score_before: number | null;
  momentum_score_after: number | null;
  risk_score_before: number | null;
  risk_score_after: number | null;
  risk_label_before: string | null;
  risk_label_after: string | null;
  trend_score_before: number | null;
  trend_score_after: number | null;
  trend_label_before: string | null;
  trend_label_after: string | null;
}
