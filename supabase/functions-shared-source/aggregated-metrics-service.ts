// Fonte: .dev/specs/aggregated-metrics/service-layer-aggregation.md
//
// ⚠️ Este arquivo NUNCA é deployado standalone — fica FORA de
// supabase/functions/ de propósito (por isso também está excluído do
// tsconfig.json da raiz, junto de supabase/functions/, já que é código Deno
// com `Deno`/`npm:` que o typecheck do Next.js não entende). `supabase
// functions deploy` só escaneia supabase/functions/, então esta pasta nunca
// é tratada como função.
//
// É o código-fonte canônico/mestre da camada de agregação — cada Edge
// Function `get-page-*` (ver edge-functions-per-page.md, ainda não
// implementada) deve COPIAR o conteúdo deste arquivo para dentro do seu
// próprio supabase/functions/get-page-*/index.ts, nunca importar daqui via
// caminho relativo (Princípio técnico 5, CLAUDE.md: Edge Functions são
// autossuficientes, sem `_shared/` compartilhado em produção). Mesma
// disciplina já usada por bw-sync/admin-*/update-my-timezone.
//
// Os tipos abaixo (PageEnvelope e blocos) são uma cópia intencional de
// packages/shared-types/src/envelope.ts (@reputation/shared-types) — não um
// import. A resposta à ⚠️ DECISÃO PENDENTE de service-layer-aggregation.md
// ("pacote compartilhado vs. duplicado") foi "pacote compartilhado" (pedido
// do usuário, 2026-07-14) — mas isso resolve o lado frontend (Next.js já
// consome @reputation/shared-types via npm workspace, ver next.config.ts
// `transpilePackages`), não o lado Edge Function: nenhum bundle de Edge
// Function alcança código fora da sua própria pasta em produção (Princípio
// técnico 5), pacote de workspace local incluso — `npm:`/`deno.land/x`/`jsr`
// só resolvem pacotes PUBLICADOS, não um workspace local não publicado.
// Então, apesar da decisão ser "pacote compartilhado", o lado Deno segue
// exatamente como antes: cópia inline, mantida manualmente em sincronia com
// packages/shared-types/src/envelope.ts. Mudou a forma de um bloco?
// Atualize os dois arquivos juntos.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

// =========================================================================
// Tipos do envelope (duplicados de packages/shared-types/src/envelope.ts —
// ver nota acima)
// =========================================================================

export type PageKey =
  | 'overview'
  | 'narratives'
  | 'narrative_detail'
  | 'sentiment'
  | 'platforms'
  | 'themes'
  | 'authors'
  | 'alerts'
  | 'reports'

export type TrendDirection = 'up' | 'down' | 'stable'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface EnvelopePeriod {
  start: string
  end: string
  granularity: string
  comparison: string
}

export interface EnvelopeFilters {
  narratives: string[]
  themes: string[]
  platforms: string[]
  sentiment: string[]
  region: string[]
  author_type: string[]
  risk_level: string[]
}

export interface MetricCard {
  key: string
  label: string
  value: number
  unit?: string
  delta_pct?: number | null
  trend: TrendDirection
  sparkline?: number[]
}

export interface BreakdownItem {
  label: string
  value: number
  pct: number
  // Só presentes quando type === 'narrative' — split completo (não um score
  // único como platform/theme), ver get_narrative_sentiment_breakdown em
  // sql-aggregation.md.
  positive?: number
  neutral?: number
  negative?: number
}

export interface Breakdown {
  key: string
  type: 'sentiment' | 'platform' | 'theme' | 'narrative' | 'region'
  items: BreakdownItem[]
}

export interface TrendPoint {
  date: string
  value: number
}

export interface TrendGroupSeries {
  group: string
  series: TrendPoint[]
}

export interface Trend {
  key: string
  label: string
  series?: TrendPoint[]
  series_by_group?: TrendGroupSeries[]
}

export interface NarrativeRow {
  id: string
  title: string
  sov_pct: number | null
  total_mentions: number
  net_sentiment: number | null
  sentiment_label: string
  momentum_score: number | null
  velocity_score: number | null
  velocity_label: string | null
  risk_score: number | null
  risk_label: string | null
}

export interface AuthorRow {
  entity_id: string | null
  name: string
  type: string
  reach: number
  engagement: number
  risk_level: RiskLevel | null
  // Null pra maioria dos autores — só os top 10 por volume da Query inteira
  // são enriquecidos com temas por autor (bw_query_author_topics), única
  // fonte confiável de sentimento por autor. NUNCA vem de
  // bw_query_top_authors.sentiment_* (campo nunca confirmado contra o
  // payload real do endpoint Top Authors) — ver sql-aggregation.md,
  // get_authors_ranking, e data-model.md, "bw_query_top_authors".
  sentiment_positive: number | null
  sentiment_neutral: number | null
  sentiment_negative: number | null
  is_influential: boolean
}

export interface Highlight {
  event_type: string
  severity: RiskLevel
  severity_score: number
  title: string
  summary: string
  explanation: string
  recommendation?: string | null
  confidence: number
  tags: string[]
  related_narrative_id: string | null
  related_entity_id: string | null
}

export interface TermSignal {
  term: string
  growth_pct: number | null
  sentiment_associated: string
}

export interface DisseminationGraph {
  nodes: { id: string; label: string; reach: number }[]
  edges: { source: string; target: string; type: 'reply' | 'retweet' | 'mention' }[]
}

// "X Themes" da Brandwatch (Top Hashtags/Emojis/Stories/Most Mentioned X
// Posters) — bw_query_x_insights (foundation/data-model.md), só na página
// `platforms`. Ver get_x_insights em sql-aggregation.md.
export interface XInsightItem {
  insight_type: 'hashtag' | 'emoticon' | 'url' | 'mentioned_author'
  name: string
  label: string | null
  volume: number
  tweets: number | null
  retweets: number | null
  impressions: number | null
  reach_estimate: number | null
}

export interface PageEnvelope {
  schema_version: string
  page: PageKey
  organization_id: string
  period: EnvelopePeriod
  filters_applied: EnvelopeFilters
  generated_at: string
  metrics: MetricCard[]
  breakdowns: Breakdown[]
  trends: Trend[]
  narratives: NarrativeRow[]
  authors: AuthorRow[]
  highlights: Highlight[]
  term_signals: TermSignal[]
  graph: DisseminationGraph | null
  x_insights: XInsightItem[]
  narrative_text: string | null
  ui_meta: Record<string, unknown>
}

const ENVELOPE_SCHEMA_VERSION = '1.0'

// =========================================================================
// PAGE_BLOCKS — espelha block-mapping-per-page.md exatamente. Se a tabela
// mudar, esta constante muda junto (ver "Regras de negócio" da spec).
// =========================================================================

type BlockKey =
  | 'metrics'
  | 'breakdowns'
  | 'trends'
  | 'narratives'
  | 'authors'
  | 'highlights'
  | 'term_signals'
  | 'graph'
  | 'x_insights'
  | 'narrative_text'

export const PAGE_BLOCKS: Record<PageKey, BlockKey[]> = {
  overview: ['metrics', 'breakdowns', 'trends', 'narratives', 'highlights', 'narrative_text'],
  narratives: ['narratives'],
  narrative_detail: ['breakdowns', 'trends', 'authors', 'graph', 'narrative_text'],
  sentiment: ['breakdowns', 'trends', 'highlights', 'term_signals', 'narrative_text'],
  platforms: ['breakdowns', 'trends', 'narratives', 'authors', 'x_insights', 'narrative_text'],
  themes: ['breakdowns', 'trends', 'narratives', 'authors', 'highlights', 'term_signals', 'narrative_text'],
  authors: ['authors'],
  alerts: ['highlights'],
  reports: ['metrics', 'breakdowns', 'trends', 'narratives', 'highlights', 'narrative_text'],
}

// Quais "sabores" de breakdown cada página pedir — ver block-mapping-per-page.md
// (ex: narrative_detail precisa sentimento + plataforma + região juntos).
// 'region' está listado onde a spec pede, mas nenhuma function SQL cobre
// ainda breakdown por localização (bw_query_demographics_daily não tem
// function correspondente em sql-aggregation.md — gap real, ver
// _pending.md) — fetchBreakdown() loga e retorna null pra esse tipo, o
// bloco só fica sem aquele item, nunca quebra o envelope inteiro.
const PAGE_BREAKDOWN_TYPES: Partial<Record<PageKey, Breakdown['type'][]>> = {
  overview: ['sentiment'],
  narrative_detail: ['sentiment', 'platform', 'region'],
  sentiment: ['sentiment', 'platform', 'theme', 'narrative', 'region'],
  platforms: ['platform'],
  themes: ['theme'],
  reports: ['sentiment'],
}

// Pedido do usuário (2026-07-16): "Quando há categoria e subcategoria, o
// sistema deve considerar na página de overview apenas a categoria, porém
// na aba de narrativas considera-se as subcategorias." — 'roots' = só
// Narrativas cuja Category é de topo (bw_categories.parent_id is null,
// mesma definição de "Pauta" de electoral-themes.md); 'leaves' = só
// Narrativas-filhas (Subcategory). get_narratives_table (migration
// 20260716010000) só aplica p_scope quando p_pauta_id está ausente — a
// página `themes` continua usando p_pauta_id (ctx.pautaId) pra "todas as
// subcategorias da categoria Pauta" quando uma Pauta específica é aberta;
// sem pautaId, cai no default 'leaves' abaixo (todas as Narrativas-filhas
// de todas as Pautas, mesmo escopo de granularidade de `narratives`).
// Páginas fora deste mapa (narrative_detail, authors, alerts) não usam o
// bloco `narratives` via PAGE_BLOCKS — narrative_detail busca uma única
// Narrativa à parte, via ui_meta.narrative (ver get-narrative-detail).
function narrativesScopeForPage(page: PageKey): 'roots' | 'leaves' | null {
  if (page === 'overview' || page === 'reports') return 'roots'
  if (page === 'narratives' || page === 'platforms' || page === 'themes') return 'leaves'
  return null
}

// =========================================================================
// Contexto de montagem — organização/período/filtros vêm sempre do header
// global (nunca recalculados aqui, ver "Regras de negócio" do envelope).
// narrativeId só é setado pela Edge Function de detalhe de Narrativa
// (get-narrative-detail) — quando presente, escopa automaticamente todo
// bloco que aceita filters.narratives pra essa única Narrativa (ver
// effectiveFilters abaixo), sem precisar de lógica por página aqui.
// =========================================================================

export interface PageContext {
  organizationId: string
  period: EnvelopePeriod
  filters: EnvelopeFilters
  narrativeId?: string
  pautaId?: string
}

function effectiveFilters(ctx: PageContext): EnvelopeFilters {
  if (!ctx.narrativeId) return ctx.filters
  return { ...ctx.filters, narratives: [ctx.narrativeId] }
}

// =========================================================================
// Shapes de retorno das RPCs (sql-aggregation.md) — 1:1 com cada `returns
// table`/`returns jsonb`.
// =========================================================================

interface MetricsCardRow {
  metric_key: string
  current_value: number | null
  previous_value: number | null
  delta_pct: number | null
  trend: TrendDirection
}

interface BreakdownRow {
  label: string
  value: number | null
  pct: number | null
}

interface VolumeTrendRow {
  bucket_date: string
  total_mentions: number
  sentiment_positive: number
  sentiment_neutral: number
  sentiment_negative: number
  net_sentiment: number | null
}

interface NarrativeTableRow {
  id: string
  title: string
  sov_pct: number | null
  total_mentions: number
  net_sentiment: number | null
  sentiment_label: string
  momentum_score: number | null
  velocity_score: number | null
  velocity_label: string | null
  risk_score: number | null
  risk_label: string | null
}

interface AuthorRankingRow {
  entity_id: string | null
  name: string
  type: string
  reach: number | null
  engagement: number | null
  risk_level: RiskLevel | null
  is_influential: boolean
  sentiment_positive: number | null
  sentiment_neutral: number | null
  sentiment_negative: number | null
}

interface NarrativeSentimentBreakdownRow {
  label: string
  positive: number | null
  neutral: number | null
  negative: number | null
  total_mentions: number | null
  pct: number | null
}

interface TermSignalRow {
  term: string
  growth_pct: number | null
  sentiment_associated: string
}

// =========================================================================
// fetchX — uma por bloco, 1:1 com uma function SQL (ver "Fluxo principal"
// da spec). Cada uma tenta a chamada e, em erro, loga e retorna o fallback
// vazio do bloco — nenhuma derruba o envelope inteiro (mesma regra de
// "Regras de negócio").
// =========================================================================

const METRIC_META: Record<string, { label: string; unit?: string }> = {
  total_mentions: { label: 'Total de menções' },
  reach_estimate: { label: 'Alcance estimado' },
  engagement_score: { label: 'Engajamento total' },
  unique_authors: { label: 'Autores únicos' },
  net_sentiment: { label: 'Sentimento geral', unit: 'net_sentiment_pct' },
}

async function fetchMetrics(supabase: SupabaseClient, ctx: PageContext): Promise<MetricCard[]> {
  try {
    const { data, error } = await supabase.rpc('get_metrics_cards', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
    })
    if (error) throw error
    return ((data ?? []) as MetricsCardRow[]).map((row) => {
      const meta = METRIC_META[row.metric_key] ?? { label: row.metric_key }
      return {
        key: row.metric_key,
        label: meta.label,
        value: row.current_value ?? 0,
        unit: meta.unit,
        delta_pct: row.delta_pct,
        trend: row.trend,
      }
    })
  } catch (err) {
    console.error('[aggregated-metrics] fetchMetrics failed', err)
    return []
  }
}

async function fetchOneBreakdown(
  type: Breakdown['type'],
  supabase: SupabaseClient,
  ctx: PageContext,
): Promise<Breakdown | null> {
  try {
    let rows: BreakdownRow[]
    const baseArgs = {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
    }
    if (type === 'sentiment') {
      const { data, error } = await supabase.rpc('get_sentiment_breakdown', baseArgs)
      if (error) throw error
      rows = (data ?? []) as BreakdownRow[]
    } else if (type === 'platform') {
      const { data, error } = await supabase.rpc('get_platform_breakdown', baseArgs)
      if (error) throw error
      rows = (data ?? []) as BreakdownRow[]
    } else if (type === 'theme') {
      const { data, error } = await supabase.rpc('get_theme_breakdown', {
        ...baseArgs,
        p_pauta_id: ctx.pautaId ?? null,
      })
      if (error) throw error
      rows = (data ?? []) as BreakdownRow[]
    } else if (type === 'narrative') {
      // Split completo (positive/neutral/negative), não um net_sentiment
      // único como platform/theme — narrative_metrics já tem o dado, só
      // faltava a function/o wiring (ver sql-aggregation.md,
      // get_narrative_sentiment_breakdown, e _pending.md #19).
      const { data, error } = await supabase.rpc('get_narrative_sentiment_breakdown', baseArgs)
      if (error) throw error
      const narrativeRows = (data ?? []) as NarrativeSentimentBreakdownRow[]
      return {
        key: type,
        type,
        items: narrativeRows.map((r) => ({
          label: r.label,
          value: r.total_mentions ?? 0,
          pct: r.pct ?? 0,
          positive: r.positive ?? 0,
          neutral: r.neutral ?? 0,
          negative: r.negative ?? 0,
        })),
      }
    } else {
      // 'region' — sem function SQL ainda (bw_query_demographics_daily sem
      // get_region_breakdown correspondente). Gap documentado, não inventado.
      console.error('[aggregated-metrics] fetchOneBreakdown(region) skipped: no backing SQL function yet')
      return null
    }
    return {
      key: type,
      type,
      items: rows.map((r) => ({ label: r.label, value: r.value ?? 0, pct: r.pct ?? 0 })),
    }
  } catch (err) {
    console.error(`[aggregated-metrics] fetchOneBreakdown(${type}) failed`, err)
    return null
  }
}

async function fetchBreakdowns(page: PageKey, supabase: SupabaseClient, ctx: PageContext): Promise<Breakdown[]> {
  const types = PAGE_BREAKDOWN_TYPES[page] ?? []
  const results = await Promise.all(types.map((type) => fetchOneBreakdown(type, supabase, ctx)))
  return results.filter((b): b is Breakdown => b !== null)
}

function volumeRowsToTrend(key: string, label: string, rows: VolumeTrendRow[]): Trend {
  return {
    key,
    label,
    series_by_group: [
      { group: 'total', series: rows.map((r) => ({ date: r.bucket_date, value: r.total_mentions })) },
      { group: 'positive', series: rows.map((r) => ({ date: r.bucket_date, value: r.sentiment_positive })) },
      { group: 'neutral', series: rows.map((r) => ({ date: r.bucket_date, value: r.sentiment_neutral })) },
      { group: 'negative', series: rows.map((r) => ({ date: r.bucket_date, value: r.sentiment_negative })) },
    ],
  }
}

async function fetchVolumeTrend(
  supabase: SupabaseClient,
  ctx: PageContext,
  filters: EnvelopeFilters,
): Promise<VolumeTrendRow[]> {
  const { data, error } = await supabase.rpc('get_volume_trend', {
    p_organization_id: ctx.organizationId,
    p_period_start: ctx.period.start,
    p_period_end: ctx.period.end,
    p_filters: filters,
  })
  if (error) throw error
  return (data ?? []) as VolumeTrendRow[]
}

async function fetchTrends(page: PageKey, supabase: SupabaseClient, ctx: PageContext): Promise<Trend[]> {
  try {
    if (page === 'narrative_detail' && ctx.narrativeId) {
      const [scoped, overall] = await Promise.all([
        fetchVolumeTrend(supabase, ctx, effectiveFilters(ctx)),
        fetchVolumeTrend(supabase, ctx, { ...ctx.filters, narratives: [] }),
      ])
      return [
        volumeRowsToTrend('volume_sentiment', 'Volume e sentimento da Narrativa', scoped),
        {
          key: 'narrative_vs_overall_volume',
          label: 'Narrativa vs. volume geral',
          series_by_group: [
            { group: 'narrativa', series: scoped.map((r) => ({ date: r.bucket_date, value: r.total_mentions })) },
            { group: 'geral', series: overall.map((r) => ({ date: r.bucket_date, value: r.total_mentions })) },
          ],
        },
      ]
    }
    if (page === 'platforms' || page === 'themes') {
      // "Volume por plataforma"/"SOV por pauta" ao longo do tempo — sem
      // function SQL própria em sql-aggregation.md (só o breakdown estático
      // existe, get_platform_breakdown/get_theme_breakdown). Gap
      // documentado (_pending.md), não substituído por uma série genérica
      // que fingiria ser algo que não é.
      console.error(`[aggregated-metrics] fetchTrends(${page}) skipped: no backing SQL function yet`)
      return []
    }
    const rows = await fetchVolumeTrend(supabase, ctx, effectiveFilters(ctx))
    return [volumeRowsToTrend('volume_sentiment', 'Volume e sentimento', rows)]
  } catch (err) {
    console.error('[aggregated-metrics] fetchTrends failed', err)
    return []
  }
}

async function fetchNarratives(page: PageKey, supabase: SupabaseClient, ctx: PageContext): Promise<NarrativeRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_narratives_table', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
      p_pauta_id: ctx.pautaId ?? null,
      p_scope: narrativesScopeForPage(page),
    })
    if (error) throw error
    return (data ?? []) as NarrativeTableRow[]
  } catch (err) {
    console.error('[aggregated-metrics] fetchNarratives failed', err)
    return []
  }
}

async function fetchAuthors(supabase: SupabaseClient, ctx: PageContext): Promise<AuthorRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_authors_ranking', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
    })
    if (error) throw error
    return ((data ?? []) as AuthorRankingRow[]).map((row) => ({
      entity_id: row.entity_id,
      name: row.name,
      type: row.type,
      reach: row.reach ?? 0,
      engagement: row.engagement ?? 0,
      risk_level: row.risk_level,
      sentiment_positive: row.sentiment_positive,
      sentiment_neutral: row.sentiment_neutral,
      sentiment_negative: row.sentiment_negative,
      is_influential: row.is_influential,
    }))
  } catch (err) {
    console.error('[aggregated-metrics] fetchAuthors failed', err)
    return []
  }
}

// ⚠️ Deferido: get_active_highlights (bloco `highlights`) depende de
// feed_events, que só existe quando `event-radar` (Sprint 3, rascunho) for
// implementado — ver sql-aggregation.md e _pending.md. Até lá, todo bloco
// `highlights` de toda página fica vazio (não é erro, é o estado esperado
// hoje — narrative_text/ai-synthesis.md's Camada 0 já cobre o texto
// determinístico sem depender de highlights reais).
async function fetchHighlights(_supabase: SupabaseClient, _ctx: PageContext): Promise<Highlight[]> {
  return []
}

async function fetchTermSignals(supabase: SupabaseClient, ctx: PageContext): Promise<TermSignal[]> {
  try {
    const { data, error } = await supabase.rpc('get_term_signals', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
    })
    if (error) throw error
    return (data ?? []) as TermSignalRow[]
  } catch (err) {
    console.error('[aggregated-metrics] fetchTermSignals failed', err)
    return []
  }
}

interface XInsightRow {
  insight_type: 'hashtag' | 'emoticon' | 'url' | 'mentioned_author'
  name: string
  label: string | null
  volume: number | null
  tweets: number | null
  retweets: number | null
  impressions: number | null
  reach_estimate: number | null
}

async function fetchXInsights(supabase: SupabaseClient, ctx: PageContext): Promise<XInsightItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_x_insights', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
    })
    if (error) throw error
    return ((data ?? []) as XInsightRow[]).map((row) => ({
      insight_type: row.insight_type,
      name: row.name,
      label: row.label,
      volume: row.volume ?? 0,
      tweets: row.tweets,
      retweets: row.retweets,
      impressions: row.impressions,
      reach_estimate: row.reach_estimate,
    }))
  } catch (err) {
    console.error('[aggregated-metrics] fetchXInsights failed', err)
    return []
  }
}

async function fetchGraph(supabase: SupabaseClient, ctx: PageContext): Promise<DisseminationGraph | null> {
  if (!ctx.narrativeId) return null
  try {
    const { data, error } = await supabase.rpc('get_dissemination_graph', {
      p_narrative_id: ctx.narrativeId,
      p_since: null,
      p_until: null,
    })
    if (error) throw error
    return (data ?? null) as DisseminationGraph | null
  } catch (err) {
    console.error('[aggregated-metrics] fetchGraph failed', err)
    return null
  }
}

// =========================================================================
// assemblePageResponse — orquestra os fetchX necessários pra uma página
// (PAGE_BLOCKS), sempre em paralelo (Promise.all, nunca em série), e monta
// o envelope completo com [] /null nos blocos não usados.
// =========================================================================

export async function assemblePageResponse(
  supabase: SupabaseClient,
  page: PageKey,
  context: PageContext,
): Promise<PageEnvelope> {
  const blocks = new Set(PAGE_BLOCKS[page])

  const [metrics, breakdowns, trends, narratives, authors, highlights, termSignals, graph, xInsights] = await Promise.all([
    blocks.has('metrics') ? fetchMetrics(supabase, context) : Promise.resolve<MetricCard[]>([]),
    blocks.has('breakdowns') ? fetchBreakdowns(page, supabase, context) : Promise.resolve<Breakdown[]>([]),
    blocks.has('trends') ? fetchTrends(page, supabase, context) : Promise.resolve<Trend[]>([]),
    blocks.has('narratives') ? fetchNarratives(page, supabase, context) : Promise.resolve<NarrativeRow[]>([]),
    blocks.has('authors') ? fetchAuthors(supabase, context) : Promise.resolve<AuthorRow[]>([]),
    blocks.has('highlights') ? fetchHighlights(supabase, context) : Promise.resolve<Highlight[]>([]),
    blocks.has('term_signals') ? fetchTermSignals(supabase, context) : Promise.resolve<TermSignal[]>([]),
    blocks.has('graph') ? fetchGraph(supabase, context) : Promise.resolve<DisseminationGraph | null>(null),
    blocks.has('x_insights') ? fetchXInsights(supabase, context) : Promise.resolve<XInsightItem[]>([]),
  ])

  return {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    page,
    organization_id: context.organizationId,
    period: context.period,
    filters_applied: context.filters,
    generated_at: new Date().toISOString(),
    metrics,
    breakdowns,
    trends,
    narratives,
    authors,
    highlights,
    term_signals: termSignals,
    graph,
    x_insights: xInsights,
    // ai-synthesis.md ainda não implementado nesta sessão — fica null até
    // a síntese rodar, exatamente o estado que o envelope já prevê.
    narrative_text: null,
    ui_meta: {},
  }
}
