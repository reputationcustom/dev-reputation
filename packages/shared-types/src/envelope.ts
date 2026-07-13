// Contrato único de resposta de página — ver .dev/specs/aggregated-metrics/standard-json-envelope.md
// Toda Edge Function de página (get-page-*, get-narrative-detail) retorna exatamente este formato;
// o que muda de página para página é quais blocos vêm preenchidos, nunca a estrutura.
//
// Pacote compartilhado (@reputation/shared-types) — resolve a ⚠️ DECISÃO PENDENTE #2 de
// _pending.md ("pacote compartilhado vs. duplicado"), a pedido do usuário (2026-07-14): "em
// aggregated-metrics utilizar Tipos TS do envelope: pacote compartilhado para facilitar a
// organização e manutenção". O frontend Next.js consome este pacote diretamente (workspace npm,
// ver next.config.ts `transpilePackages`). Edge Functions continuam sem poder importar daqui em
// produção (Princípio técnico 5 — nenhum bundle de Edge Function alcança código fora da sua
// própria pasta em supabase/functions/, pacote de workspace local incluso) — o pacote é a fonte
// canônica para tudo que CONSEGUE importá-lo; supabase/functions-shared-source/
// aggregated-metrics-service.ts continua com uma cópia inline dos tipos para o lado Deno, mantida
// manualmente em sincronia com este arquivo (ver comentário lá).

export const ENVELOPE_SCHEMA_VERSION = '1.0';

export type PageKey =
  | 'overview'
  | 'narratives'
  | 'narrative_detail'
  | 'sentiment'
  | 'platforms'
  | 'themes'
  | 'authors'
  | 'alerts'
  | 'reports';

export type TrendDirection = 'up' | 'down' | 'stable';

export type SentimentLabel =
  | 'very_positive'
  | 'positive'
  | 'slightly_positive'
  | 'neutral'
  | 'slightly_negative'
  | 'negative'
  | 'very_negative';

export type VelocityLabel = 'shrinking_fast' | 'declining' | 'stable' | 'growing' | 'viral';

// Mesmo enum de risco de _index.md ("risco_nivel" → risk_level): low|medium|high|critical.
// Reaproveitado tanto por narratives[].risk_label quanto por authors[].risk_level/highlights[].severity.
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type BreakdownType = 'sentiment' | 'platform' | 'theme' | 'narrative' | 'region';

export type GraphEdgeType = 'reply' | 'retweet' | 'mention';

export interface EnvelopePeriod {
  start: string;
  end: string;
  granularity: string;
  comparison: string;
}

export interface EnvelopeFilters {
  narratives: string[];
  themes: string[];
  platforms: string[];
  sentiment: string[];
  region: string[];
  author_type: string[];
  risk_level: string[];
}

export interface MetricCard {
  key: string;
  label: string;
  value: number;
  unit?: string;
  delta_pct?: number | null;
  trend: TrendDirection;
  sparkline?: number[];
}

export interface BreakdownItem {
  label: string;
  value: number;
  pct: number;
  // Só presentes quando type === 'narrative' — split completo (não um score
  // único como platform/theme), ver get_narrative_sentiment_breakdown em
  // sql-aggregation.md.
  positive?: number;
  neutral?: number;
  negative?: number;
}

export interface Breakdown {
  key: string;
  type: BreakdownType;
  items: BreakdownItem[];
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendGroupSeries {
  group: string;
  series: TrendPoint[];
}

// Uma linha usa `series` (uma curva) OU `series_by_group` (várias curvas, ex: total/positivo/neutro/negativo).
export interface Trend {
  key: string;
  label: string;
  series?: TrendPoint[];
  series_by_group?: TrendGroupSeries[];
}

export interface NarrativeRow {
  id: string;
  title: string;
  sov_pct: number;
  total_mentions: number;
  net_sentiment: number;
  sentiment_label: SentimentLabel;
  momentum_score: number;
  velocity_score: number;
  velocity_label: VelocityLabel;
  risk_score: number;
  risk_label: RiskLevel;
}

export interface AuthorRow {
  entity_id: string | null;
  name: string;
  type: string;
  reach: number;
  engagement: number;
  // Null in practice today: unlike narratives (get_narratives_table's full
  // "Scores de Narrativa" formula), no spec defines a risk formula for an
  // individual author — see sql-aggregation.md, get_authors_ranking.
  risk_level: RiskLevel | null;
  // Null para a maioria dos autores: só os top 10 por volume da Query
  // inteira são enriquecidos com temas por autor (bw_query_author_topics),
  // única fonte confiável de sentimento por autor — ver
  // sql-aggregation.md, get_authors_ranking, e data-model.md,
  // "bw_query_top_authors" (campo sentiment_* dessa tabela nunca confirmado
  // contra o payload real do endpoint, não usado aqui).
  sentiment_positive: number | null;
  sentiment_neutral: number | null;
  sentiment_negative: number | null;
  is_influential: boolean;
}

export interface Highlight {
  event_type: string;
  severity: RiskLevel;
  severity_score: number;
  title: string;
  summary: string;
  explanation: string;
  recommendation?: string | null;
  confidence: number;
  tags: string[];
  related_narrative_id: string | null;
  related_entity_id: string | null;
}

export interface TermSignal {
  term: string;
  growth_pct: number;
  sentiment_associated: string;
}

export interface DisseminationGraphNode {
  id: string;
  label: string;
  reach: number;
}

export interface DisseminationGraphEdge {
  source: string;
  target: string;
  type: GraphEdgeType;
}

export interface DisseminationGraph {
  nodes: DisseminationGraphNode[];
  edges: DisseminationGraphEdge[];
}

export interface PageEnvelope {
  schema_version: string;
  page: PageKey;
  organization_id: string;
  period: EnvelopePeriod;
  filters_applied: EnvelopeFilters;
  generated_at: string;

  metrics: MetricCard[];
  breakdowns: Breakdown[];
  trends: Trend[];
  narratives: NarrativeRow[];
  authors: AuthorRow[];
  highlights: Highlight[];
  term_signals: TermSignal[];
  graph: DisseminationGraph | null;

  narrative_text: string | null;
  ui_meta: Record<string, unknown>;
}

export function createEmptyEnvelope(
  page: PageKey,
  organizationId: string,
  period: EnvelopePeriod,
  filters: EnvelopeFilters,
): PageEnvelope {
  return {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    page,
    organization_id: organizationId,
    period,
    filters_applied: filters,
    generated_at: new Date().toISOString(),
    metrics: [],
    breakdowns: [],
    trends: [],
    narratives: [],
    authors: [],
    highlights: [],
    term_signals: [],
    graph: null,
    narrative_text: null,
    ui_meta: {},
  };
}

export type EnvelopeAiPayload = Omit<PageEnvelope, 'ui_meta' | 'narrative_text'>;

// Regra do envelope: ui_meta e narrative_text nunca vão para a IA — o resto do objeto vai inteiro.
export function toAiPayload(envelope: PageEnvelope): EnvelopeAiPayload {
  return {
    schema_version: envelope.schema_version,
    page: envelope.page,
    organization_id: envelope.organization_id,
    period: envelope.period,
    filters_applied: envelope.filters_applied,
    generated_at: envelope.generated_at,
    metrics: envelope.metrics,
    breakdowns: envelope.breakdowns,
    trends: envelope.trends,
    narratives: envelope.narratives,
    authors: envelope.authors,
    highlights: envelope.highlights,
    term_signals: envelope.term_signals,
    graph: envelope.graph,
  };
}
