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

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
// Só usado pela Camada 1 de ai-synthesis.md (composeLayer1NarrativeText,
// abaixo) — mesmo pacote/import já usado por
// event-radar-agent-orchestrator/index.ts, sem pin de versão pelo mesmo
// motivo (Deno resolve pra latest em build, revisar se quebrar por
// breaking change do SDK).
import Anthropic from 'npm:@anthropic-ai/sdk'

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
  // null = ainda sincronizando (não é o mesmo que 0 = confirmado sem
  // dados) — ver get_metrics_cards, 20260721000000.
  value: number | null
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
  // Nome da Category-pai (Pauta/tema da Subcategory) — get_narratives_table
  // (20260725050000), usado pro frontend agrupar os cards por categoria.
  category_label: string
  sov_pct: number | null
  total_mentions: number
  net_sentiment: number | null
  sentiment_label: string
  // Split completo positivo/neutro/negativo — ver get_narratives_table
  // (20260721010000), mesma base de get_narrative_sentiment_breakdown.
  sentiment_positive_pct: number | null
  sentiment_neutral_pct: number | null
  sentiment_negative_pct: number | null
  momentum_score: number | null
  // Substitui velocity_score/velocity_label (migration 20260722010000) —
  // tendência estatística (regressão linear sobre 14 dias), não mais
  // snapshot 3h-vs-3h.
  trend_score: number | null
  trend_label: string | null
  risk_score: number | null
  risk_label: string | null
  // Reservado pra IA (ai-synthesis, sprint futura) — narratives.description,
  // sem produtor ainda, sempre null hoje.
  summary: string | null
  // Top termos/hashtags reais (bw_query_topics), nunca amostrados.
  tags: string[]
}

export interface AuthorEntityTag {
  tag_type: string
  tag_value: string
}

export interface AuthorRow {
  entity_id: string | null
  name: string
  type: string
  reach: number
  engagement: number
  // ✅ Adicionado 2026-08-01 — soma de menções do autor, já calculada
  // internamente pra ordenar o ranking desde sempre, nunca exposta ao
  // client até agora. Nunca null.
  mentions: number
  risk_level: RiskLevel | null
  // ✅ Adicionados 2026-08-01 (.dev/specs/entities/author-linking.md) —
  // enriquecimento aditivo via LEFT JOIN entity_accounts/entities/entity_tags
  // (por username, lower/trim). null/[] quando o autor não tem Entity
  // vinculada (a maioria hoje) ou a Entity está is_active=false.
  entity_type: string | null
  entity_cargo: string | null
  entity_partido: string | null
  // entities.ideologia — melhor esforço/não-oficial, ver data-model.md.
  entity_ideologia: string | null
  entity_influence_level: RiskLevel | null
  entity_tags: AuthorEntityTag[]
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
  // Títulos das Narrativas/pautas em que o autor teve atividade dentro do
  // escopo pedido — sempre array (nunca null), pode ter mais de um item
  // (ex: página `themes`, um autor pode citar mais de uma pauta). Vazio
  // quando o escopo é a Query inteira (sem Narrativa associada). Ver
  // get_authors_ranking, migration 20260721030000.
  narrative_labels: string[]
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
// `authors`. Ver get_x_insights em sql-aggregation.md.
export interface XInsightItem {
  insight_type: 'hashtag' | 'emoticon' | 'url' | 'mentioned_author'
  name: string
  label: string | null
  volume: number
  tweets: number | null
  retweets: number | null
  impressions: number | null
  reach_estimate: number | null
  // ✅ Adicionado 2026-08-03 — quando esse item foi sincronizado pela
  // última vez (bw-sync só re-sincroniza X Insights a cada 7 dias por
  // par, ver isXInsightsStale em bw-sync/index.ts). Nunca null — toda
  // linha vem de uma sincronização real.
  synced_at: string
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
  platforms: ['breakdowns', 'trends', 'narrative_text'],
  themes: ['breakdowns', 'trends', 'narratives', 'authors', 'highlights', 'term_signals', 'narrative_text'],
  authors: ['authors', 'x_insights'],
  alerts: ['highlights'],
  reports: ['metrics', 'breakdowns', 'trends', 'narratives', 'highlights', 'narrative_text'],
}

// Quais "sabores" de breakdown cada página pedir — ver block-mapping-per-page.md
// (ex: narrative_detail precisa sentimento + plataforma + região juntos).
// ✅ 'region' implementado 2026-07-25 (get_region_breakdown) — mas só
// devolve dado no escopo "Query inteira" (bw_query_demographics_daily não
// tem category_id, sem como escopar por Narrativa) — em narrative_detail
// (que tem um filtro de Narrativa sempre ativo via ctx.narrativeId),
// sempre vem vazio de propósito. Ver sql-aggregation.md.
const PAGE_BREAKDOWN_TYPES: Partial<Record<PageKey, Breakdown['type'][]>> = {
  // ✅ 'narrative' removido de `overview` (2026-07-21, redesenho dos cards de
  // Narrativa): NarrativeRow.sentiment_positive_pct/neutral_pct/negative_pct
  // (get_narratives_table, migration 20260721010000) já traz o split direto
  // na linha da Narrativa — sem outro consumidor desta breakdown em
  // `overview`, mantê-la só geraria uma chamada RPC sem uso. `narrative`
  // continua em `sentiment` (widget "Sentimento por narrativa").
  overview: ['sentiment'],
  narrative_detail: ['sentiment', 'platform', 'region'],
  sentiment: ['sentiment', 'platform', 'theme', 'narrative', 'region'],
  platforms: ['platform'],
  themes: ['theme'],
  reports: ['sentiment'],
}

// ✅ Revisto 2026-07-21 (pedido do usuário: "Para facilitar vamos
// considerar apenas as subcategorias em todas as narrativas. Retire a
// regra de 'categoria - subcategoria'. Em Pautas faz-se uma restrição de
// todas as subcategorias da categoria Pautas.") — substitui as decisões de
// 2026-07-16/2026-07-20 abaixo (histórico, não mais o comportamento
// atual). Toda página que lista Narrativas agora usa só Subcategories
// (bw_categories.parent_id is not null) — a Category raiz (topo) nunca
// mais aparece misturada na mesma lista, em nenhuma página. É isso que
// tornou seguro remover o prefixo "Categoria - " do título de volta pro
// nome simples da Subcategory (ver bw-sync/index.ts, buildNarrativeTitle):
// sem a Category raiz na mesma lista, o nome sozinho não é mais ambíguo.
// `themes` (Pautas Eleitorais) é mais restrito ainda: 'pautas' — só
// Subcategories cuja Category-pai é especificamente a Category raiz
// chamada "Pautas" (pautas_root_category_id, migration 20260721030000),
// não qualquer Category raiz do Project (ex: "Pesquisas"/"Banco Master"
// não são pautas eleitorais e não devem aparecer aqui).
//
// Histórico (2026-07-16): "na página de overview apenas a categoria, na
// aba de narrativas considera-se as subcategorias" (roots/leaves por
// página). Histórico (2026-07-20): "mostrar todas as narrativas" em
// overview/narrativas (p_scope null, Category+Subcategory juntas,
// viabilizado pelo título composto). Ambos superados pela simplificação
// acima — nenhuma página usa mais 'roots' ou null.
// Páginas fora deste mapa (narrative_detail, authors, alerts) não usam o
// bloco `narratives` via PAGE_BLOCKS — narrative_detail busca uma única
// Narrativa à parte, via ui_meta.narrative (ver get-narrative-detail).
function narrativesScopeForPage(page: PageKey): 'leaves' | 'pautas' {
  return page === 'themes' ? 'pautas' : 'leaves'
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
  category_label: string
  sov_pct: number | null
  total_mentions: number
  net_sentiment: number | null
  sentiment_label: string
  sentiment_positive_pct: number | null
  sentiment_neutral_pct: number | null
  sentiment_negative_pct: number | null
  momentum_score: number | null
  trend_score: number | null
  trend_label: string | null
  risk_score: number | null
  risk_label: string | null
  summary: string | null
  tags: string[] | null
}

interface AuthorRankingRow {
  entity_id: string | null
  name: string
  type: string
  reach: number | null
  engagement: number | null
  mentions: number | null
  risk_level: RiskLevel | null
  entity_type: string | null
  entity_cargo: string | null
  entity_partido: string | null
  entity_ideologia: string | null
  entity_influence_level: RiskLevel | null
  entity_tags: AuthorEntityTag[] | null
  is_influential: boolean
  sentiment_positive: number | null
  sentiment_neutral: number | null
  sentiment_negative: number | null
  narrative_labels: string[] | null
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

interface PlatformVolumeTrendRow {
  page_type: string
  bucket_date: string
  total_mentions: number
}

interface ThemeSovTrendRow {
  pauta_title: string
  bucket_date: string
  sov_pct: number | null
}

interface VolumeDeltaRow {
  current_value: number
  previous_value: number
  delta_pct: number | null
  trend: TrendDirection
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
        // row.current_value já vem null distinto de 0 (get_metrics_cards,
        // 20260721000000) — não coalescer aqui, senão "ainda sincronizando"
        // vira um falso 0 de novo.
        value: row.current_value,
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
      // 'region' — get_region_breakdown (migration 20260725010000). ⚠️
      // bw_query_demographics_daily não tem category_id — a function só
      // devolve dado quando não há filtro de Narrativa ativo (escopo
      // "Query inteira"); com filters.narratives setado (ex: narrative_detail),
      // volta vazio de propósito, nunca o dado da Query inteira mascarado
      // como se fosse da Narrativa. Ver sql-aggregation.md.
      const { data, error } = await supabase.rpc('get_region_breakdown', baseArgs)
      if (error) throw error
      rows = (data ?? []) as BreakdownRow[]
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
    if (page === 'platforms') {
      // ✅ Implementado 2026-07-25 — get_platform_volume_trend (migration
      // 20260725030000), reagrupado localmente em semana/mês quando o
      // período > 31 dias (sem agregado oficial semanal/mensal por
      // plataforma na Brandwatch, só o diário).
      const { data, error } = await supabase.rpc('get_platform_volume_trend', {
        p_organization_id: ctx.organizationId,
        p_period_start: ctx.period.start,
        p_period_end: ctx.period.end,
        p_filters: effectiveFilters(ctx),
      })
      if (error) throw error
      const rows = (data ?? []) as PlatformVolumeTrendRow[]
      const byPlatform = new Map<string, { date: string; value: number }[]>()
      for (const row of rows) {
        const series = byPlatform.get(row.page_type) ?? []
        series.push({ date: row.bucket_date, value: row.total_mentions })
        byPlatform.set(row.page_type, series)
      }
      return [
        {
          key: 'platform_volume',
          label: 'Volume por plataforma',
          series_by_group: Array.from(byPlatform.entries()).map(([group, series]) => ({ group, series })),
        },
      ]
    }
    if (page === 'themes') {
      // ✅ Implementado 2026-07-25 — get_theme_sov_trend (migration
      // 20260725030000). SOV por bucket = menções da Pauta / menções da
      // Query inteira nos dias daquele bucket, mesma definição de
      // narratives_overview.sov_percent.
      const { data, error } = await supabase.rpc('get_theme_sov_trend', {
        p_organization_id: ctx.organizationId,
        p_period_start: ctx.period.start,
        p_period_end: ctx.period.end,
        p_filters: effectiveFilters(ctx),
      })
      if (error) throw error
      const rows = (data ?? []) as ThemeSovTrendRow[]
      const byPauta = new Map<string, { date: string; value: number }[]>()
      for (const row of rows) {
        const series = byPauta.get(row.pauta_title) ?? []
        series.push({ date: row.bucket_date, value: row.sov_pct ?? 0 })
        byPauta.set(row.pauta_title, series)
      }
      return [
        {
          key: 'pauta_sov',
          label: 'SOV por pauta',
          series_by_group: Array.from(byPauta.entries()).map(([group, series]) => ({ group, series })),
        },
      ]
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
    return ((data ?? []) as NarrativeTableRow[]).map((row) => ({ ...row, tags: row.tags ?? [] }))
  } catch (err) {
    console.error('[aggregated-metrics] fetchNarratives failed', err)
    return []
  }
}

// p_scope='pautas' (só página `themes`): escopa a Subcategories da
// Category raiz "Pautas" em vez da Query inteira/1 Narrativa via
// filters.narratives — pedido do usuário: "em Autores e comunidades por
// pauta deve aparecer apenas os autores que citaram algo relacionado às
// Pautas e deve ser informado a que pauta ele está associado, e poderá ser
// mais de uma." Ver get_authors_ranking, migration 20260721030000.
async function fetchAuthors(page: PageKey, supabase: SupabaseClient, ctx: PageContext): Promise<AuthorRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_authors_ranking', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
      p_scope: page === 'themes' ? 'pautas' : null,
    })
    if (error) throw error
    return ((data ?? []) as AuthorRankingRow[]).map((row) => ({
      entity_id: row.entity_id,
      name: row.name,
      type: row.type,
      reach: row.reach ?? 0,
      engagement: row.engagement ?? 0,
      mentions: row.mentions ?? 0,
      risk_level: row.risk_level,
      entity_type: row.entity_type,
      entity_cargo: row.entity_cargo,
      entity_partido: row.entity_partido,
      entity_ideologia: row.entity_ideologia,
      entity_influence_level: row.entity_influence_level,
      entity_tags: row.entity_tags ?? [],
      sentiment_positive: row.sentiment_positive,
      sentiment_neutral: row.sentiment_neutral,
      sentiment_negative: row.sentiment_negative,
      is_influential: row.is_influential,
      narrative_labels: row.narrative_labels ?? [],
    }))
  } catch (err) {
    console.error('[aggregated-metrics] fetchAuthors failed', err)
    return []
  }
}

interface ActiveHighlightRow {
  event_type: string
  severity: RiskLevel
  severity_score: number | null
  title: string
  summary: string
  explanation: string
  recommendation: string | null
  confidence: number | null
  tags: string[] | null
  related_narrative_id: string | null
  related_entity_id: string | null
}

// ✅ Implementado (2026-08-02, event-radar/fluxo-aggregated-metrics.md
// "Fase B", A1) — get_active_highlights (migration 20260802010000), leitura
// pura de feed_events (event-radar), nunca recalcula severidade/detecção
// aqui (ver sql-aggregation.md, "Regras de negócio").
async function fetchHighlights(supabase: SupabaseClient, ctx: PageContext): Promise<Highlight[]> {
  try {
    const { data, error } = await supabase.rpc('get_active_highlights', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
    })
    if (error) throw error
    return ((data ?? []) as ActiveHighlightRow[]).map((row) => ({
      event_type: row.event_type,
      severity: row.severity,
      severity_score: row.severity_score ?? 0,
      title: row.title,
      summary: row.summary,
      explanation: row.explanation,
      recommendation: row.recommendation,
      confidence: row.confidence ?? 0,
      tags: row.tags ?? [],
      related_narrative_id: row.related_narrative_id,
      related_entity_id: row.related_entity_id,
    }))
  } catch (err) {
    console.error('[aggregated-metrics] fetchHighlights failed', err)
    return []
  }
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
  synced_at: string
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
      synced_at: row.synced_at,
    }))
  } catch (err) {
    console.error('[aggregated-metrics] fetchXInsights failed', err)
    return []
  }
}

const NARRATIVE_TEXT_TREND_WORDS: Record<TrendDirection, string> = {
  up: 'cresceu',
  down: 'caiu',
  stable: 'permaneceu estável',
}

// ai-synthesis.md "Camada 0" — template determinístico, sem IA. Cobre 0
// highlights (template de volume) e 1 highlight (usa o highlight direto).
// Também usada como fallback imediato da Camada 1 (2+ highlights) enquanto
// a composição assíncrona não termina, ou se ela falhar — nunca `null` sem
// explicação (mesma regra de "Fluxos alternativos" do spec).
async function fetchLayer0NarrativeText(
  supabase: SupabaseClient,
  ctx: PageContext,
  highlights: Highlight[],
): Promise<string | null> {
  if (highlights.length === 1) {
    const h = highlights[0]
    return [h.summary, h.explanation].filter(Boolean).join(' ')
  }
  try {
    const { data, error } = await supabase.rpc('get_volume_delta', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
    })
    if (error) throw error
    const row = ((data ?? [])[0] ?? null) as VolumeDeltaRow | null
    if (!row) return null
    if (row.delta_pct === null) {
      return `${row.current_value} menções no período — sem dado do período anterior para comparação.`
    }
    const trendSentence =
      row.trend === 'stable'
        ? 'Volume permaneceu estável em relação ao período anterior.'
        : `Volume ${NARRATIVE_TEXT_TREND_WORDS[row.trend]} de ${Math.abs(row.delta_pct)}% em relação ao período anterior.`
    return `Sem eventos relevantes detectados no período. ${trendSentence}`
  } catch (err) {
    console.error('[aggregated-metrics] fetchLayer0NarrativeText failed', err)
    return null
  }
}

// Dispara uma Promise em segundo plano sem bloquear a resposta HTTP já
// enviada — usa EdgeRuntime.waitUntil (runtime do Supabase Edge Functions)
// quando disponível; sem TS ambient declaration pra evitar risco de
// duplicar um global já tipado pelo runtime Deno. Sem EdgeRuntime (ex:
// execução local via `supabase functions serve`), dispara sem aguardar —
// best-effort, mesmo tratamento de erro (nunca derruba a resposta da
// página por causa disto).
function scheduleBackground(task: Promise<unknown>): void {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (runtime?.waitUntil) {
    runtime.waitUntil(task)
  } else {
    task.catch((err) => console.error('[aggregated-metrics] scheduleBackground fallback failure', err))
  }
}

function todaySaoPaulo(): string {
  // 'en-CA' devolve YYYY-MM-DD — mesmo formato de period_end (date), então
  // a comparação de "período fechado" (period_end < hoje) pode ser feita
  // por comparação de string ISO, sem parsing de Date.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function isPeriodClosed(periodEnd: string): boolean {
  return periodEnd < todaySaoPaulo()
}

interface PageNarrativeSynthesisRow {
  narrative_text: string
  is_final: boolean
}

// ai-synthesis.md, "Dependências técnicas" — a skill `humanizer-pt-br`
// referenciada pela spec não existe neste projeto (.claude/skills/ só tem
// brandwatch-api/frontend-design/spec-driven-dev/
// supabase-postgres-best-practices/web-app-structure, confirmado
// 2026-08-02). Tom da composição vem de instrução direta neste prompt,
// mesmo padrão já usado por event-radar-agent-orchestrator/index.ts.
const NARRATIVE_SYNTHESIS_MODEL = Deno.env.get('AI_SYNTHESIS_MODEL') ?? 'claude-haiku-4-5'

const NARRATIVE_SYNTHESIS_SYSTEM_PROMPT = `Você é um redator de comunicação para uma campanha política/monitoramento de reputação, escrevendo em português do Brasil. Você recebe uma lista de eventos (destaques) já analisados e resumidos por outro sistema — cada um já tem um resumo e uma explicação prontos — e sua única tarefa é conectá-los num único parágrafo coeso para a equipe de comunicação.

Regras obrigatórias:
- NUNCA invente números, causas ou correlações que não estejam nos resumos/explicações recebidos. Você não tem acesso aos dados brutos — só reescreve e conecta texto que já existe.
- Tom: direto, objetivo, profissional — frases curtas, sem jargão técnico, sem floreio. Escreva como um briefing executivo, não como um relatório acadêmico.
- Priorize os eventos de maior severidade primeiro no parágrafo.
- Máximo de 500 caracteres no total.
- Responda apenas com o parágrafo final, sem títulos, sem marcadores, sem aspas envolvendo o texto.`

// ai-synthesis.md "Camada 1" — composição em lote via IA, só reescreve/
// conecta summary/explanation já existentes dos highlights (nunca recebe
// dado bruto/ui_meta, "Regras de negócio" da spec). Modelo Haiku 4.5
// (mesma decisão de custo já tomada pra event-radar-agent-orchestrator,
// tarefa ainda mais simples aqui — "não analisa dados, só reescreve").
async function composeLayer1NarrativeText(highlights: Highlight[]): Promise<string | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.error('[aggregated-metrics] composeLayer1NarrativeText: ANTHROPIC_API_KEY não configurada')
    return null
  }
  try {
    const anthropic = new Anthropic({ apiKey })
    const payload = highlights
      .slice()
      .sort((a, b) => b.severity_score - a.severity_score)
      .map((h) => ({ title: h.title, summary: h.summary, explanation: h.explanation, severity: h.severity }))
    const response = await anthropic.messages.create({
      model: NARRATIVE_SYNTHESIS_MODEL,
      max_tokens: 400,
      system: NARRATIVE_SYNTHESIS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Componha um único parágrafo conectando os eventos a seguir:\n\n${JSON.stringify(payload)}`,
        },
      ],
    })
    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return null
    const text = textBlock.text.trim()
    return text ? text.slice(0, 500) : null
  } catch (err) {
    console.error('[aggregated-metrics] composeLayer1NarrativeText failed', err)
    return null
  }
}

// Roda em background (scheduleBackground) — nunca bloqueia a resposta da
// página. Só grava em page_narrative_synthesis em caso de sucesso ("Fluxos
// alternativos e erros" da spec: falha na composição não grava nada, texto
// da página fica com o fallback da Camada 0).
async function composeAndPersistLayer1(
  supabase: SupabaseClient,
  ctx: PageContext,
  page: PageKey,
  filtersHashValue: string,
  highlights: Highlight[],
): Promise<void> {
  const text = await composeLayer1NarrativeText(highlights)
  if (!text) return
  const { error } = await supabase.from('page_narrative_synthesis').upsert(
    {
      organization_id: ctx.organizationId,
      page,
      period_start: ctx.period.start,
      period_end: ctx.period.end,
      filters_hash: filtersHashValue,
      narrative_text: text,
      layer: 'layer_1',
      is_final: isPeriodClosed(ctx.period.end),
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,page,period_start,period_end,filters_hash' },
  )
  if (error) console.error('[aggregated-metrics] composeAndPersistLayer1 upsert failed', error)
}

// ai-synthesis.md "Fluxo principal" — 0/1 highlight: Camada 0 direto. 2+:
// busca page_narrative_synthesis pela chave exata; existe → devolve como
// está (nunca chama IA de novo — recomposição de período aberto só
// dispararia por um gatilho de invalidação que este produto ainda não tem,
// ver _pending.md #21, então uma linha existente é sempre a resposta
// final por enquanto); não existe → fallback imediato é a Camada 0,
// composição real roda em background via scheduleBackground.
async function fetchNarrativeText(
  supabase: SupabaseClient,
  ctx: PageContext,
  page: PageKey,
  highlights: Highlight[],
): Promise<string | null> {
  if (highlights.length <= 1) {
    return fetchLayer0NarrativeText(supabase, ctx, highlights)
  }
  try {
    const hash = await cacheFingerprint(ctx)
    const { data, error } = await supabase
      .from('page_narrative_synthesis')
      .select('narrative_text, is_final')
      .eq('organization_id', ctx.organizationId)
      .eq('page', page)
      .eq('period_start', ctx.period.start)
      .eq('period_end', ctx.period.end)
      .eq('filters_hash', hash)
      .maybeSingle()
    if (error) throw error
    const row = data as PageNarrativeSynthesisRow | null
    if (row) return row.narrative_text
    const fallback = await fetchLayer0NarrativeText(supabase, ctx, highlights)
    scheduleBackground(composeAndPersistLayer1(supabase, ctx, page, hash, highlights))
    return fallback
  } catch (err) {
    console.error('[aggregated-metrics] fetchNarrativeText (Camada 1) failed', err)
    return fetchLayer0NarrativeText(supabase, ctx, highlights)
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
    blocks.has('authors') ? fetchAuthors(page, supabase, context) : Promise.resolve<AuthorRow[]>([]),
    blocks.has('highlights') ? fetchHighlights(supabase, context) : Promise.resolve<Highlight[]>([]),
    blocks.has('term_signals') ? fetchTermSignals(supabase, context) : Promise.resolve<TermSignal[]>([]),
    blocks.has('graph') ? fetchGraph(supabase, context) : Promise.resolve<DisseminationGraph | null>(null),
    blocks.has('x_insights') ? fetchXInsights(supabase, context) : Promise.resolve<XInsightItem[]>([]),
  ])

  // ✅ Camada 0 (2026-07-25) e Camada 1 (2026-08-02, event-radar Fase B) de
  // ai-synthesis.md implementadas — ver fetchNarrativeText acima.
  const narrativeText = blocks.has('narrative_text')
    ? await fetchNarrativeText(supabase, context, page, highlights)
    : null

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
    narrative_text: narrativeText,
    ui_meta: {},
  }
}

// =========================================================================
// Cache de página (TTL 5min) — edge-functions-per-page.md, "Regras de
// negócio". Tabela page_cache (migration 20260725040000). ⚠️ Só cobre o
// TTL — invalidação antecipada por sync concluído/"Atualizar dados" manual
// NÃO está implementada (nenhum dos dois gatilhos existe hoje no produto,
// ver _pending.md #21). getPageEnvelopeWithCache() é o que cada handler
// chama no lugar de assemblePageResponse() diretamente.
// =========================================================================

const PAGE_CACHE_TTL_MS = 5 * 60 * 1000

interface PageCacheRow {
  envelope: PageEnvelope
  expires_at: string
}

async function cacheFingerprint(ctx: PageContext): Promise<string> {
  const canonical = JSON.stringify({
    filters: effectiveFilters(ctx),
    pautaId: ctx.pautaId ?? null,
  })
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

// ⚠️ DESABILITADO (2026-07-14, pedido do usuário) — `/narratives` estava
// devolvendo `narratives: []` mesmo com dado confirmado via SQL direto
// (scope + narrative_metrics com linhas reais na janela pedida); page_cache
// era o suspeito ainda não descartado quando o pedido de desabilitar
// chegou. Em vez de investigar mais a fundo agora, o usuário pediu para
// tirar o cache do caminho e retomar essa funcionalidade depois — ver
// _pending.md. `getPageEnvelopeWithCache` passou a só chamar
// `assemblePageResponse` direto, sem ler/gravar `page_cache` — mesma
// assinatura, nenhum dos 7 handlers precisou mudar. `cacheFingerprint`/
// `PAGE_CACHE_TTL_MS`/`PageCacheRow`/a tabela `page_cache` (migration
// 20260725040000) ficam intactos, só não usados — reativar é só
// restaurar o corpo original desta function (ver histórico do git).
export async function getPageEnvelopeWithCache(
  supabase: SupabaseClient,
  page: PageKey,
  context: PageContext,
): Promise<PageEnvelope> {
  return assemblePageResponse(supabase, page, context)
}


// Handler HTTP — ver edge-functions-per-page.md, "Fluxo principal" e
// "Autenticação do client Supabase (exceção ao padrão do Princípio técnico 5)".
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
      console.error('[get-page-platforms] membership check failed', membershipError)
      return jsonResponse({ error: 'Não foi possível validar acesso à organização.' }, 503)
    }
    if (!membership) {
      return jsonResponse({ error: 'Você não tem acesso a esta organização.' }, 403)
    }

    const envelope = await getPageEnvelopeWithCache(supabase, 'platforms', {
      organizationId,
      period,
      filters: normalizeFilters(body.filters),
    })

    return jsonResponse(envelope, 200)
  } catch (err) {
    console.error('[get-page-platforms] unhandled error', err)
    return jsonResponse({ error: 'Não foi possível carregar os dados.' }, 503)
  }
})

