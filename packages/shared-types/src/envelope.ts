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

// Substitui VelocityLabel (2026-07-22, pedido do usuário) — antes um
// snapshot 3h-vs-3h com 5 rótulos; agora uma tendência estatística
// (regressão linear sobre 14 dias, get_narratives_table) com 3 estados.
// Nome deliberadamente distinto de `Trend`/`TrendPoint` (bloco
// `trends[]`, série temporal de gráfico) — conceitos diferentes que só
// compartilham a palavra em português.
export type NarrativeTrendLabel = 'decreasing' | 'stable' | 'increasing';

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
  // ✅ Adicionado 2026-07-14 — espelha o PeriodMode do seletor do header
  // (header-context.tsx: Diário/Semanal/Mensal/Personalizado). Opcional
  // (period.start/end sempre bastam pra qualquer function SQL), usado só
  // por fetchNarrativeText (ai-synthesis.md, Camada 1): a composição em
  // background só dispara automaticamente pra "daily"/"weekly"/"monthly"
  // — período "custom" nunca chama IA sozinho, só via o botão manual
  // "Analisar com IA" (compose-narrative-synthesis).
  mode?: "daily" | "weekly" | "monthly" | "custom";
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
  // null = ainda sincronizando (não é o mesmo que 0 = confirmado sem
  // dados) — ver get_metrics_cards, 20260721000000. Hoje só acontece pra
  // reach_estimate/engagement_score/unique_authors no período "Diário"
  // (1 dia), quando o dia já tem menções mas essa métrica específica ainda
  // não chegou de uma chamada mais tardia da fase daily_metrics de
  // bw-sync.
  value: number | null;
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
  // Nome da Category-pai (a Pauta/tema a que a Subcategory pertence) —
  // bw_categories.parent_id, get_narratives_table (20260725050000). Nunca
  // null: para uma linha de escopo 'roots' (sem pai) cai no próprio nome
  // da Category. Usado pra agrupar os cards da lista de Narrativas por
  // categoria (narratives/page.tsx).
  category_label: string;
  sov_pct: number;
  total_mentions: number;
  net_sentiment: number;
  sentiment_label: SentimentLabel;
  // Split completo positivo/neutro/negativo (não um score único como
  // net_sentiment) — narrative_metrics.sentiment_*, normalizado por
  // (positivo+neutro+negativo) no período pedido, nunca pelo total de
  // mentions (mesma base de get_narrative_sentiment_breakdown). Usado pela
  // barra de sentimento do card de Narrativa.
  sentiment_positive_pct: number | null;
  sentiment_neutral_pct: number | null;
  sentiment_negative_pct: number | null;
  momentum_score: number;
  trend_score: number;
  trend_label: NarrativeTrendLabel;
  risk_score: number;
  risk_label: RiskLevel;
  // Reservado para texto gerado por IA (ai-synthesis, sprint futura) — lido
  // de narratives.description, sem produtor ainda hoje (sempre null até
  // essa sprint popular a coluna). Ver foundation/narratives.md, "Resumo
  // executivo".
  summary: string | null;
  // Top termos/hashtags reais da Narrativa (bw_query_topics, agregado
  // oficial da Brandwatch, nunca amostrado) — nunca inclui um marcador de
  // emoção (sem fonte não-amostrada pra isso, ver get_narratives_table).
  tags: string[];
  // ✅ Adicionados 2026-07-14 (pedido do usuário: mapear os tópicos da
  // Brandwatch à Narrativa, por polaridade, tanto pra IA quanto pro
  // usuário final) — top 5 termos/hashtags de `tags` cujo sentimento
  // predominante (bw_query_topics.sentiment_positive/neutral/negative,
  // mesma classificação por maioria de `get_term_signals`) é positivo/
  // negativo. Sempre array (nunca null); `[]` quando a Narrativa não tem
  // nenhum termo com esse sentimento predominante no período sincronizado.
  // Usado pelo card de Narrativa (NarrativeCard) e por
  // narrative_summary_build_payload (payload da IA que escreve
  // `summary`) — ver sql-aggregation.md.
  positive_topics: string[];
  negative_topics: string[];
}

// Item de AuthorRow.entity_tags — espelha entity_tags linha a linha (state/
// power_branch/stance_to_candidate, qualquer dimensão nova) — nunca party/
// office, que viraram entity_partido/entity_cargo abaixo. Ver
// .dev/specs/entities/data-model.md.
export interface AuthorEntityTag {
  tag_type: string;
  tag_value: string;
}

export interface AuthorRow {
  entity_id: string | null;
  name: string;
  type: string;
  reach: number;
  engagement: number;
  // ✅ Adicionado 2026-08-01 — soma de menções do autor (bw_query_top_authors/
  // bw_query_top_tweeters), já calculada internamente pra ordenar o ranking
  // desde sempre, nunca tinha sido exposta ao client. Nunca null.
  mentions: number;
  // Null in practice today: unlike narratives (get_narratives_table's full
  // "Scores de Narrativa" formula), no spec defines a risk formula for an
  // individual author — see sql-aggregation.md, get_authors_ranking.
  risk_level: RiskLevel | null;
  // ✅ Adicionados 2026-08-01 (.dev/specs/entities/author-linking.md) —
  // enriquecimento aditivo via LEFT JOIN entity_accounts/entities/entity_tags
  // (por username, lower/trim — nunca uma FK real). Todos null/[] quando o
  // autor não tem nenhuma Entity vinculada (a maioria hoje) ou a Entity
  // vinculada está is_active=false.
  entity_type: string | null; // entities.type ("person"|"media_outlet"|"party"|...)
  entity_cargo: string | null; // entities.cargo (ex: "Deputado Federal")
  entity_partido: string | null; // entities.partido (sigla, ex: "PT")
  // entities.ideologia — melhor esforço/não-oficial, ver data-model.md.
  // Vocabulário em uso: esquerda | centro-esquerda | centro | centro-direita | direita.
  entity_ideologia: string | null;
  entity_influence_level: RiskLevel | null; // entities.influence_level (severity_level)
  entity_tags: AuthorEntityTag[]; // sempre array, nunca null
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
  // Títulos das Narrativas/pautas em que o autor teve atividade dentro do
  // escopo pedido — sempre array (nunca null), pode ter mais de um item
  // (ex: página `themes`, um autor pode citar mais de uma pauta). Vazio
  // quando o escopo é a Query inteira (sem Narrativa associada). Ver
  // get_authors_ranking, migration 20260721030000.
  narrative_labels: string[];
  // ✅ Adicionados 2026-08-08 (widget "Quem move a conversa", ver
  // narratives-exploration.md, "Formação e propagação"). followers = perfil
  // do autor (twitterFollowers, único campo confirmado no endpoint Top
  // Authors — nunca somado entre categorias, ver get_authors_ranking),
  // `null` quando o autor não tem esse campo sincronizado. platforms =
  // plataforma(s) com sinal real em platform_stats (bw_top_author_platform_tags),
  // sempre array (vazio, não fabricado, quando nenhuma chave conhecida está
  // presente no jsonb já sincronizado).
  followers: number | null;
  platforms: string[];
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
  // ✅ 2026-07-14 — feed_events.created_at, sempre presente. Permite ao
  // consumidor (ai-synthesis Camada 1) detectar um evento mais novo que a
  // última composição salva, sem depender só de um TTL de tempo.
  created_at: string;
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

export type XInsightType = 'hashtag' | 'emoticon' | 'url' | 'mentioned_author';

// "X Themes" da Brandwatch (Top Hashtags/Emojis/Stories/Most Mentioned X
// Posters) — bw_query_x_insights (foundation/data-model.md), só na página
// `authors`. `tweets`/`retweets`/`volume` mapeiam pros rótulos da própria
// UI da Brandwatch: Posts = tweets, Reposts = retweets, All Posts = volume,
// Impressions = impressions (confirmado contra developers.brandwatch.com/
// docs/twitter-insights, ver sql-aggregation.md).
export interface XInsightItem {
  insight_type: XInsightType;
  name: string;
  label: string | null;
  volume: number;
  tweets: number | null;
  retweets: number | null;
  impressions: number | null;
  reach_estimate: number | null;
  // ✅ Adicionado 2026-08-03 — quando esse item foi sincronizado pela
  // última vez (bw-sync só re-sincroniza X Insights a cada 7 dias por
  // par, ver isXInsightsStale em bw-sync/index.ts). Nunca null — toda
  // linha vem de uma sincronização real.
  synced_at: string;
}

// "Top Sites" da Brandwatch (data/volume/topsites/queries) — domínios de
// onde as menções se originam, distinto de bw_query_top_shared_sites
// ("Top Shared Sites", ainda sem bloco próprio). Só na página `authors`,
// aba "Visão Geral". Ver get_top_sites em sql-aggregation.md.
export interface TopSiteItem {
  domain: string;
  volume: number;
  reach_estimate: number | null;
  monthly_visitors: number | null;
  sentiment_positive: number | null;
  sentiment_neutral: number | null;
  sentiment_negative: number | null;
  synced_at: string;
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
  x_insights: XInsightItem[];
  top_sites: TopSiteItem[];

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
    x_insights: [],
    top_sites: [],
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
    x_insights: envelope.x_insights,
    top_sites: envelope.top_sites,
  };
}
