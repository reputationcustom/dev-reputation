// Edge Function: get-narrative-detail
// Fonte: .dev/specs/aggregated-metrics/edge-functions-per-page.md
//
// Página "Narrativa — detalhe" (`/narratives/[id]`,
// intelligence-center/narratives-exploration.md). Única Edge Function deste
// módulo que recebe `narrative_id` obrigatório, além do contexto padrão.
//
// ⚠️ Este arquivo é uma CÓPIA de supabase/functions-shared-source/
// aggregated-metrics-service.ts (código-fonte canônico da camada de
// agregação) + um handler de requisição no final. Mudou a lógica de
// agregação (assemblePageResponse/fetchX/PAGE_BLOCKS)? Atualize o arquivo
// canônico primeiro, depois recopie para as 6 Edge Functions get-page-*/
// get-narrative-detail — Princípio técnico 5 (CLAUDE.md) proíbe importar
// daqui via caminho relativo, cada Edge Function é autossuficiente.
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

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

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
}

export interface Breakdown {
  key: string
  type: 'sentiment' | 'platform' | 'theme' | 'region'
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
  | 'narrative_text'

export const PAGE_BLOCKS: Record<PageKey, BlockKey[]> = {
  overview: ['metrics', 'breakdowns', 'trends', 'narratives', 'highlights', 'narrative_text'],
  narratives: ['narratives'],
  narrative_detail: ['breakdowns', 'trends', 'authors', 'graph', 'narrative_text'],
  sentiment: ['breakdowns', 'trends', 'highlights', 'term_signals', 'narrative_text'],
  platforms: ['breakdowns', 'trends', 'narratives', 'authors', 'narrative_text'],
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
  sentiment: ['sentiment', 'platform', 'theme', 'region'],
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
  net_sentiment: { label: 'Sentimento geral', unit: 'score' },
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

  const [metrics, breakdowns, trends, narratives, authors, highlights, termSignals, graph] = await Promise.all([
    blocks.has('metrics') ? fetchMetrics(supabase, context) : Promise.resolve<MetricCard[]>([]),
    blocks.has('breakdowns') ? fetchBreakdowns(page, supabase, context) : Promise.resolve<Breakdown[]>([]),
    blocks.has('trends') ? fetchTrends(page, supabase, context) : Promise.resolve<Trend[]>([]),
    blocks.has('narratives') ? fetchNarratives(page, supabase, context) : Promise.resolve<NarrativeRow[]>([]),
    blocks.has('authors') ? fetchAuthors(supabase, context) : Promise.resolve<AuthorRow[]>([]),
    blocks.has('highlights') ? fetchHighlights(supabase, context) : Promise.resolve<Highlight[]>([]),
    blocks.has('term_signals') ? fetchTermSignals(supabase, context) : Promise.resolve<TermSignal[]>([]),
    blocks.has('graph') ? fetchGraph(supabase, context) : Promise.resolve<DisseminationGraph | null>(null),
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
    // ai-synthesis.md ainda não implementado nesta sessão — fica null até
    // a síntese rodar, exatamente o estado que o envelope já prevê.
    narrative_text: null,
    ui_meta: {},
  }
}

// =========================================================================
// Resumo da própria Narrativa (cabeçalho do detalhe) — bloco `narratives` do
// envelope fica vazio em `narrative_detail` por desenho (PAGE_BLOCKS, ver
// block-mapping-per-page.md: "narratives" = "—" nesta página, é uma lista,
// não o resumo de uma linha só). Mas intelligence-center/narratives-exploration.md
// pede exatamente esses campos no cabeçalho ("nome, badges de SOV/sentimento/
// risco/momentum/velocidade — mesmos scores e faixas de executive-overview.md",
// "Resumo executivo": narratives.description). Sem um bloco canônico do
// envelope pra isso, anexado em `ui_meta.narrative` — ui_meta é
// explicitamente "dado que serve só pra renderização" (standard-json-envelope.md),
// nunca vai pra IA, exatamente o encaixe certo pra este extra específico
// desta página.
interface NarrativeSummary {
  id: string
  title: string
  description: string | null
  stage: string
  risk_level: string
  sov_pct: number | null
  total_mentions: number
  net_sentiment: number | null
  sentiment_label: string | null
  momentum_score: number | null
  velocity_score: number | null
  velocity_label: string | null
  risk_score: number | null
  risk_label: string | null
  unique_authors: number | null
  reach_estimated: number | null
  engagement_total: number | null
}

async function fetchNarrativeSummary(
  supabase: SupabaseClient,
  ctx: PageContext,
): Promise<NarrativeSummary | null> {
  if (!ctx.narrativeId) return null

  const { data: narrative, error: narrativeError } = await supabase
    .from('narratives')
    .select('id, title, description, stage, risk_level')
    .eq('id', ctx.narrativeId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()
  if (narrativeError || !narrative) {
    if (narrativeError) console.error('[get-narrative-detail] fetchNarrativeSummary narratives failed', narrativeError)
    return null
  }

  const { data: scoreRows, error: scoreError } = await supabase.rpc('get_narratives_table', {
    p_organization_id: ctx.organizationId,
    p_period_start: ctx.period.start,
    p_period_end: ctx.period.end,
    p_filters: { ...ctx.filters, narratives: [ctx.narrativeId] },
    p_pauta_id: null,
  })
  if (scoreError) {
    console.error('[get-narrative-detail] fetchNarrativeSummary scores failed', scoreError)
  }
  const score = ((scoreRows ?? []) as NarrativeTableRow[])[0] ?? null

  // Autores únicos/alcance/engajamento do período — narrative_metrics já é
  // um agregado oficial por dia (foundation/data-model.md); somar/tirar
  // média entre os dias do período pedido é o mesmo padrão já usado em
  // get_narratives_table's period_agg, não uma soma sobre `mentions` cru.
  const { data: periodRows, error: periodError } = await supabase
    .from('narrative_metrics')
    .select('unique_authors, reach_estimated, engagement_total')
    .eq('narrative_id', ctx.narrativeId)
    .eq('period', 'daily')
    .gte('metric_date', ctx.period.start)
    .lte('metric_date', ctx.period.end)
  if (periodError) {
    console.error('[get-narrative-detail] fetchNarrativeSummary period aggregates failed', periodError)
  }
  const rows = (periodRows ?? []) as { unique_authors: number | null; reach_estimated: number | null; engagement_total: number | null }[]
  const authorsValues = rows.map((r) => r.unique_authors).filter((v): v is number => v !== null)
  const uniqueAuthors = authorsValues.length > 0 ? Math.round(authorsValues.reduce((a, b) => a + b, 0) / authorsValues.length) : null
  const reachValues = rows.map((r) => r.reach_estimated).filter((v): v is number => v !== null)
  const reachEstimated = reachValues.length > 0 ? reachValues.reduce((a, b) => a + b, 0) : null
  const engagementValues = rows.map((r) => r.engagement_total).filter((v): v is number => v !== null)
  const engagementTotal = engagementValues.length > 0 ? engagementValues.reduce((a, b) => a + b, 0) : null

  return {
    id: narrative.id,
    title: narrative.title,
    description: narrative.description,
    stage: narrative.stage,
    risk_level: narrative.risk_level,
    sov_pct: score?.sov_pct ?? null,
    total_mentions: score?.total_mentions ?? 0,
    net_sentiment: score?.net_sentiment ?? null,
    sentiment_label: score?.sentiment_label ?? null,
    momentum_score: score?.momentum_score ?? null,
    velocity_score: score?.velocity_score ?? null,
    velocity_label: score?.velocity_label ?? null,
    risk_score: score?.risk_score ?? null,
    risk_label: score?.risk_label ?? null,
    unique_authors: uniqueAuthors,
    reach_estimated: reachEstimated,
    engagement_total: engagementTotal,
  }
}

// =========================================================================
// Handler HTTP — ver edge-functions-per-page.md, "Fluxo principal",
// "Autenticação do client Supabase" e "Regras de negócio" ("get-narrative-detail
// é a única Edge Function que recebe narrative_id como parâmetro obrigatório,
// além do contexto padrão").
// =========================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface RequestBody {
  organization_id?: string
  period?: EnvelopePeriod
  filters?: Partial<EnvelopeFilters>
  narrative_id?: string
}

function normalizeFilters(filters?: Partial<EnvelopeFilters>): EnvelopeFilters {
  return {
    narratives: filters?.narratives ?? [],
    themes: filters?.themes ?? [],
    platforms: filters?.platforms ?? [],
    sentiment: filters?.sentiment ?? [],
    region: filters?.region ?? [],
    author_type: filters?.author_type ?? [],
    risk_level: filters?.risk_level ?? [],
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Não autenticado.' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      // SUPABASE_PUBLISHABLE_KEY só existe se alguém provisionou explicitamente
      // (Princípio técnico 3) — SUPABASE_ANON_KEY é o auto-injetado pela
      // plataforma Supabase em toda Edge Function, sem setup manual, mesmo
      // valor. Mesmo padrão de fallback já usado por admin-*/update-my-timezone
      // pro par SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) {
      return jsonResponse({ error: 'Não autenticado.' }, 401)
    }

    let body: RequestBody
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'Corpo da requisição inválido.' }, 400)
    }

    const organizationId = body.organization_id
    if (!organizationId) {
      return jsonResponse({ error: 'organization_id é obrigatório.' }, 400)
    }

    const narrativeId = body.narrative_id
    if (!narrativeId) {
      return jsonResponse({ error: 'narrative_id é obrigatório.' }, 400)
    }

    const period = body.period
    if (!period?.start || !period?.end) {
      return jsonResponse({ error: 'period.start e period.end são obrigatórios.' }, 400)
    }
    if (period.start > period.end) {
      return jsonResponse({ error: 'period.start não pode ser maior que period.end.' }, 400)
    }

    const { data: membership, error: membershipError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (membershipError) {
      console.error('[get-narrative-detail] membership check failed', membershipError)
      return jsonResponse({ error: 'Não foi possível validar acesso à organização.' }, 503)
    }
    if (!membership) {
      return jsonResponse({ error: 'Você não tem acesso a esta organização.' }, 403)
    }

    const context: PageContext = {
      organizationId,
      period,
      filters: normalizeFilters(body.filters),
      narrativeId,
    }

    const summary = await fetchNarrativeSummary(supabase, context)
    if (!summary) {
      return jsonResponse({ error: 'Narrativa não encontrada.' }, 404)
    }

    const envelope = await assemblePageResponse(supabase, 'narrative_detail', context)
    envelope.ui_meta = { ...envelope.ui_meta, narrative: summary }

    return jsonResponse(envelope, 200)
  } catch (err) {
    console.error('[get-narrative-detail] unhandled error', err)
    return jsonResponse({ error: 'Não foi possível carregar os dados.' }, 503)
  }
})
