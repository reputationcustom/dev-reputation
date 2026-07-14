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
  // ✅ Adicionado 2026-07-14 — espelha o PeriodMode do header
  // (header-context.tsx). Opcional; só consumido por fetchNarrativeText
  // abaixo, pra decidir se a composição da Camada 1 dispara sozinha em
  // background (daily/weekly/monthly) ou só sob pedido explícito do
  // usuário via compose-narrative-synthesis (custom). Ver ai-synthesis.md.
  mode?: 'daily' | 'weekly' | 'monthly' | 'custom'
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
  // ✅ Adicionados 2026-07-14 — top 5 termos/hashtags de `tags` cujo
  // sentimento predominante é positivo/negativo (get_narratives_table,
  // migration 20260805010000). Sempre array; usado pelo card de
  // Narrativa e pelo payload de narrative_summary_build_payload (IA).
  positive_topics: string[]
  negative_topics: string[]
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
  // ✅ Adicionados 2026-08-08 (widget "Quem move a conversa", ver
  // narratives-exploration.md, "Formação e propagação"). followers = perfil
  // do autor (twitterFollowers, único campo confirmado no endpoint Top
  // Authors — nunca somado entre categorias, ver get_authors_ranking),
  // `null` quando o autor não tem esse campo sincronizado. platforms =
  // plataforma(s) com sinal real em platform_stats (bw_top_author_platform_tags),
  // sempre array (vazio, não fabricado, quando nenhuma chave conhecida está
  // presente no jsonb já sincronizado).
  followers: number | null
  platforms: string[]
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
  synced_at: string
}

// "Top Sites" da Brandwatch (data/volume/topsites/queries) — domínios de
// onde as menções se originam, distinto de bw_query_top_shared_sites
// ("Top Shared Sites", ainda sem bloco próprio). Só na página `authors`,
// aba "Visão Geral". Ver get_top_sites em sql-aggregation.md.
export interface TopSiteItem {
  domain: string
  volume: number
  reach_estimate: number | null
  monthly_visitors: number | null
  sentiment_positive: number | null
  sentiment_neutral: number | null
  sentiment_negative: number | null
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
  top_sites: TopSiteItem[]
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
  | 'top_sites'
  | 'narrative_text'

// ✅ 'term_signals' estendido a overview/narratives/platforms (2026-07-14,
// pedido do usuário: "em todas as páginas é importante existir os
// principais tópicos positivos e negativos") — Drivers positivos/negativos
// (get_term_signals) deixam de ser exclusividade de /sentiment; ver
// narratives-exploration.md/executive-overview.md/platform-analysis.md.
export const PAGE_BLOCKS: Record<PageKey, BlockKey[]> = {
  overview: ['metrics', 'breakdowns', 'trends', 'narratives', 'highlights', 'term_signals', 'narrative_text'],
  narratives: ['narratives', 'term_signals'],
  // ✅ 'term_signals' adicionado 2026-07-14 (pedido do usuário: "termos/
  // phrases mais citados" por Narrativa) — get_term_signals já suportava
  // escopo por Narrativa via filters.narratives, só faltava o wiring aqui.
  // Ver narratives-exploration.md, "Termos e frases mais citados".
  narrative_detail: ['breakdowns', 'trends', 'authors', 'term_signals', 'graph', 'narrative_text'],
  sentiment: ['breakdowns', 'trends', 'highlights', 'term_signals', 'narrative_text'],
  platforms: ['breakdowns', 'trends', 'term_signals', 'narrative_text'],
  themes: ['breakdowns', 'trends', 'narratives', 'authors', 'highlights', 'term_signals', 'narrative_text'],
  // ✅ 'top_sites' adicionado (redesenho em 2 guias, aba "Visão Geral" —
  // .dev/specs/intelligence-center/authors-and-influencers.md): get_top_sites,
  // domínios de onde as menções se originam (bw_query_top_sites), já
  // sincronizado desde 2026-07-11, nunca exposto ao frontend até agora.
  authors: ['authors', 'x_insights', 'top_sites'],
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
  positive_topics: string[] | null
  negative_topics: string[] | null
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
  followers: number | null
  platforms: string[] | null
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
    return ((data ?? []) as NarrativeTableRow[]).map((row) => ({
      ...row,
      tags: row.tags ?? [],
      positive_topics: row.positive_topics ?? [],
      negative_topics: row.negative_topics ?? [],
    }))
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
      followers: row.followers ?? null,
      platforms: row.platforms ?? [],
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

interface TopSiteRow {
  domain: string
  volume: number | null
  reach_estimate: number | null
  monthly_visitors: number | null
  sentiment_positive: number | null
  sentiment_neutral: number | null
  sentiment_negative: number | null
  synced_at: string
}

async function fetchTopSites(supabase: SupabaseClient, ctx: PageContext): Promise<TopSiteItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_top_sites', {
      p_organization_id: ctx.organizationId,
      p_period_start: ctx.period.start,
      p_period_end: ctx.period.end,
      p_filters: effectiveFilters(ctx),
    })
    if (error) throw error
    return ((data ?? []) as TopSiteRow[]).map((row) => ({
      domain: row.domain,
      volume: row.volume ?? 0,
      reach_estimate: row.reach_estimate,
      monthly_visitors: row.monthly_visitors,
      sentiment_positive: row.sentiment_positive,
      sentiment_neutral: row.sentiment_neutral,
      sentiment_negative: row.sentiment_negative,
      synced_at: row.synced_at,
    }))
  } catch (err) {
    console.error('[aggregated-metrics] fetchTopSites failed', err)
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
  generated_at: string
}

// ai-synthesis.md, "Dependências técnicas" — a skill `humanizer-pt-br`
// referenciada pela spec foi instalada de verdade em 2026-08-06
// (`.agents/skills/humanizer-pt-br/`, pedido explícito do usuário —
// substitui a nota anterior, que confirmava sua ausência em 2026-08-02).
// A skill em si é um guia interativo de edição (recebe um texto pronto e o
// reescreve), não um trecho de prompt colável direto na API da Anthropic —
// por isso o tom da composição continua vindo de instrução direta neste
// prompt, agora adaptada dos padrões concretos da skill (mesmo padrão já
// usado por event-radar-agent-orchestrator/index.ts e
// narrative-summary-composer/index.ts).
const NARRATIVE_SYNTHESIS_MODEL = Deno.env.get('AI_SYNTHESIS_MODEL') ?? 'claude-haiku-4-5'

// ai-synthesis.md — recomposição periódica de um período aberto (2026-07-14,
// pedido do usuário: "vamos definir atualização a cada 3h"). Antes desta
// mudança, uma linha já existente em page_narrative_synthesis era sempre
// devolvida como está, pra sempre, mesmo num período aberto ("Semanal"/
// "Mensal" ainda em andamento) — gap documentado desde 2026-08-02 (ver
// "Fluxo principal" abaixo). Configurável (mesmo padrão de
// BW_SYNC_INTERVAL_HOURS), default 3h — só se aplica a `is_final = false`;
// período fechado continua permanente por definição.
const AI_SYNTHESIS_REFRESH_HOURS = Number(Deno.env.get('AI_SYNTHESIS_REFRESH_HOURS') ?? '3')

function isNarrativeTextStale(generatedAt: string): boolean {
  const refreshMs = AI_SYNTHESIS_REFRESH_HOURS * 60 * 60 * 1000
  return Date.now() - new Date(generatedAt).getTime() >= refreshMs
}

const NARRATIVE_SYNTHESIS_SYSTEM_PROMPT = `Você é um redator de comunicação para uma campanha política/monitoramento de reputação, escrevendo em português do Brasil. Você recebe uma lista de eventos (destaques) já analisados e resumidos por outro sistema — cada um já tem um resumo e uma explicação prontos — e sua única tarefa é conectá-los num único parágrafo coeso para a equipe de comunicação.

Regras obrigatórias:
- NUNCA invente números, causas ou correlações que não estejam nos resumos/explicações recebidos. Você não tem acesso aos dados brutos — só reescreve e conecta texto que já existe.
- Tom (skill humanizer-pt-br): direto e humano, não robótico. Vá direto ao ponto, sem abertura nem frase de efeito, sem "gancho" dramático. Frases curtas; declare os fatos — nunca "sinalize" importância com frases como "desempenha papel fundamental", "reflete uma tendência mais ampla", "representa um marco". Proibido: "além disso", "nesse sentido", "é importante destacar/ressaltar", "cabe salientar", travessão decorativo, atribuição vaga ("especialistas apontam"), conclusão genérica/otimista, gerúndio final pra simular profundidade ("destacando...", "reforçando..."), listas forçadas de exatamente 3 itens. Seja objetivo e eficiente — sem preencher espaço pra parecer mais completo.
- Priorize os eventos de maior severidade primeiro no parágrafo.
- Máximo de 500 caracteres no total.
- Responda apenas com o parágrafo final, sem títulos, sem marcadores, sem aspas envolvendo o texto.`

// finops/data-model.md — registro de uso real de IA (nunca estimativa),
// gravado a partir do `usage` retornado pela própria API da Anthropic.
// Duplicado em cada Edge Function que chama Claude (Princípio técnico 5) —
// `event-radar-agent-orchestrator/index.ts` tem sua própria cópia idêntica.
const AI_MODEL_PRICING: Record<string, { inputPerMToken: number; outputPerMToken: number }> = {
  'claude-haiku-4-5': { inputPerMToken: 1.0, outputPerMToken: 5.0 },
}

function computeAiCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = AI_MODEL_PRICING[model]
  if (!pricing) {
    console.error(`[ai-usage] preço desconhecido para o modelo "${model}" — custo gravado como 0`)
    return 0
  }
  return (inputTokens / 1_000_000) * pricing.inputPerMToken + (outputTokens / 1_000_000) * pricing.outputPerMToken
}

async function recordAiUsage(
  supabase: SupabaseClient,
  params: {
    source: 'event_radar_agent_orchestrator' | 'ai_synthesis_narrative'
    model: string
    inputTokens: number
    outputTokens: number
    organizationId?: string | null
    referenceId?: string | null
  },
): Promise<void> {
  const costUsd = computeAiCostUsd(params.model, params.inputTokens, params.outputTokens)
  const { error } = await supabase.from('ai_usage_log').insert({
    source: params.source,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: costUsd,
    organization_id: params.organizationId ?? null,
    reference_id: params.referenceId ?? null,
  })
  if (error) console.error('[ai-usage] recordAiUsage insert failed', error)
}

// ai-synthesis.md "Camada 1" — composição em lote via IA, só reescreve/
// conecta summary/explanation já existentes dos highlights (nunca recebe
// dado bruto/ui_meta, "Regras de negócio" da spec). Modelo Haiku 4.5
// (mesma decisão de custo já tomada pra event-radar-agent-orchestrator,
// tarefa ainda mais simples aqui — "não analisa dados, só reescreve").
async function composeLayer1NarrativeText(
  supabase: SupabaseClient,
  ctx: PageContext,
  page: PageKey,
  highlights: Highlight[],
): Promise<string | null> {
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
    // finops/data-model.md — grava o uso real (billado pela Anthropic
    // independente do que acontece depois: parse, truncamento, etc.)
    await recordAiUsage(supabase, {
      source: 'ai_synthesis_narrative',
      model: NARRATIVE_SYNTHESIS_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      organizationId: ctx.organizationId,
      referenceId: `${page}:${ctx.period.start}..${ctx.period.end}`,
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
  const text = await composeLayer1NarrativeText(supabase, ctx, page, highlights)
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
// busca page_narrative_synthesis pela chave exata; existe → devolve o texto
// já gravado nesta mesma resposta e, se o período ainda está aberto
// (`is_final = false`) e a linha já passou de `AI_SYNTHESIS_REFRESH_HOURS`
// (default 3h, ✅ 2026-07-14 — antes disso, uma linha existente era sempre
// devolvida como está, pra sempre, nunca recomposta), dispara uma
// recomposição em background pra essa mesma chave — mesmo mecanismo
// fire-and-forget do caso "linha não existe" abaixo, nunca bloqueia a
// resposta; não existe → fallback imediato é a Camada 0, composição real
// roda em background via scheduleBackground.
//
// ✅ Exceção adicionada 2026-07-14 (pedido do usuário: diferenciar
// diário/semanal/mensal e, "em caso de período personalizado", deixar o
// disparo da IA a critério do usuário) — `ctx.period.mode === 'custom'`
// NUNCA agenda a composição em background sozinho, nem no caso "linha não
// existe" nem no refresh periódico acima: um período personalizado pode
// ser reaberto/reeditado livremente pelos 2 campos de data do header,
// então compor via IA a cada combinação nova digitada (ou a cada 3h só
// porque ficou aberto) seria caro e frequentemente descartado antes do
// usuário terminar de ajustar o intervalo. Continua devolvendo a linha já
// persistida se existir (ex: um período personalizado já analisado antes
// por compose-narrative-synthesis, mesmo endpoint que o botão "Analisar com
// IA" chama) — só o disparo *automático* fica condicionado a
// daily/weekly/monthly. period.mode ausente (nunca deveria acontecer
// vindo do header atual, mas uma chamada direta à Edge Function sem esse
// campo) é tratado como não-custom, preservando o comportamento anterior.
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
      .select('narrative_text, is_final, generated_at')
      .eq('organization_id', ctx.organizationId)
      .eq('page', page)
      .eq('period_start', ctx.period.start)
      .eq('period_end', ctx.period.end)
      .eq('filters_hash', hash)
      .maybeSingle()
    if (error) throw error
    const row = data as PageNarrativeSynthesisRow | null
    if (row) {
      if (!row.is_final && ctx.period.mode !== 'custom' && isNarrativeTextStale(row.generated_at)) {
        scheduleBackground(composeAndPersistLayer1(supabase, ctx, page, hash, highlights))
      }
      return row.narrative_text
    }
    const fallback = await fetchLayer0NarrativeText(supabase, ctx, highlights)
    if (ctx.period.mode !== 'custom') {
      scheduleBackground(composeAndPersistLayer1(supabase, ctx, page, hash, highlights))
    }
    return fallback
  } catch (err) {
    console.error('[aggregated-metrics] fetchNarrativeText (Camada 1) failed', err)
    return fetchLayer0NarrativeText(supabase, ctx, highlights)
  }
}

// ✅ Adicionado 2026-07-14 — chamada pela Edge Function dedicada
// compose-narrative-synthesis (botão "Analisar com IA" do frontend, só
// visível pra período personalizado — ver NarrativeTextPanel). Diferente
// de fetchNarrativeText (leitura, dispara composição em background quando
// aplicável), esta function SEMPRE compõe de forma síncrona quando há
// highlights suficientes pra valer a chamada de IA (mesmo gate de 2+ já
// usado pela Camada 1 automática — com 0/1 highlight a Camada 0 já é
// determinística e suficiente, chamar IA seria custo sem benefício) e
// aguarda o resultado antes de responder, já que aqui é uma ação explícita
// do usuário disposto a esperar por uma análise real, não um carregamento
// de página que precisa responder rápido.
async function composeNarrativeSynthesisOnDemand(
  supabase: SupabaseClient,
  ctx: PageContext,
  page: PageKey,
): Promise<{ narrative_text: string; generated_by_ai: boolean }> {
  const highlights = await fetchHighlights(supabase, ctx)
  if (highlights.length <= 1) {
    const text = await fetchLayer0NarrativeText(supabase, ctx, highlights)
    return { narrative_text: text ?? 'Não há dados suficientes para gerar uma análise deste período.', generated_by_ai: false }
  }
  const hash = await cacheFingerprint(ctx)
  const text = await composeLayer1NarrativeText(supabase, ctx, page, highlights)
  if (text) {
    const { error } = await supabase.from('page_narrative_synthesis').upsert(
      {
        organization_id: ctx.organizationId,
        page,
        period_start: ctx.period.start,
        period_end: ctx.period.end,
        filters_hash: hash,
        narrative_text: text,
        layer: 'layer_1',
        is_final: isPeriodClosed(ctx.period.end),
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,page,period_start,period_end,filters_hash' },
    )
    if (error) console.error('[aggregated-metrics] composeNarrativeSynthesisOnDemand upsert failed', error)
    return { narrative_text: text, generated_by_ai: true }
  }
  const fallback = await fetchLayer0NarrativeText(supabase, ctx, highlights)
  return {
    narrative_text: fallback ?? 'Não foi possível gerar a análise deste período no momento. Tente novamente.',
    generated_by_ai: false,
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
//
// ✅ Exceção pontual pra `themes` (Pautas Eleitorais), 2026-08-09 — pedido
// do usuário: "Insights dessa página deve focar apenas no conteúdo de
// Pautas Eleitorais, reveja o envelope... para saber se a IA está tratando
// corretamente." Achado real: `get_active_highlights`/`get_volume_delta`
// (Camada 1/Camada 0 de ai-synthesis.md) só sabem escopar por
// `filters.narratives` (uma lista de IDs) — nenhuma das duas tem noção de
// "página de Pautas". Como `themes` nunca setava esse filtro (só
// `narrativeId` o faz, via `effectiveFilters`, e `narrativeId` só existe em
// `get-narrative-detail`), "Insights" em `/themes` sempre leu highlights/
// narrative_text da ORGANIZAÇÃO INTEIRA — idêntico a qualquer outra
// página, nunca restrito às Pautas. Corrigido buscando as Narrativas-Pauta
// primeiro (mesma `get_narratives_table(p_scope='pautas')` que já
// alimenta o bloco `narratives` desta página — reaproveitada via
// `narrativesPromise`, nunca uma segunda chamada) e usando os IDs pra
// escopar `filters.narratives` só nas chamadas de highlights/narrative_text
// desta página. Único ponto do arquivo com um `await` fora do `Promise.all`
// — inevitável, já que o filtro de highlights depende do resultado de
// `narratives`, mas só serializa para `themes`; toda outra página continua
// 100% em paralelo. ⚠️ Se a organização não tiver nenhuma Subcategory sob
// "Pautas" configurada (`pautaIds.length === 0`), `filters.narratives`
// permanece vazio e o comportamento cai de volta pro escopo antigo
// (organização inteira) — limitação aceita: `get_active_highlights`/
// `get_volume_delta` tratam `filters.narratives: []` e "filtro ausente" de
// forma idêntica (`nullif(array_agg(...), '{}')` sempre vira `NULL` num
// `array_agg` sobre zero linhas), então não há como distinguir "escopo
// vazio de propósito" de "sem filtro" nessas duas functions — mesmo caso
// degenerado que `/themes` já sinaliza em todo outro widget ("Nenhuma
// subcategoria da categoria 'Pautas' configurada").
// =========================================================================

export async function assemblePageResponse(
  supabase: SupabaseClient,
  page: PageKey,
  context: PageContext,
): Promise<PageEnvelope> {
  const blocks = new Set(PAGE_BLOCKS[page])

  let narrativesPromise: Promise<NarrativeRow[]>
  let highlightsContext = context
  if (page === 'themes') {
    const pautaNarratives = blocks.has('narratives') ? await fetchNarratives(page, supabase, context) : []
    narrativesPromise = Promise.resolve(pautaNarratives)
    const pautaIds = pautaNarratives.map((n) => n.id)
    if (pautaIds.length > 0) {
      highlightsContext = { ...context, filters: { ...context.filters, narratives: pautaIds } }
    }
  } else {
    narrativesPromise = blocks.has('narratives') ? fetchNarratives(page, supabase, context) : Promise.resolve<NarrativeRow[]>([])
  }

  const [metrics, breakdowns, trends, narratives, authors, highlights, termSignals, graph, xInsights, topSites] = await Promise.all([
    blocks.has('metrics') ? fetchMetrics(supabase, context) : Promise.resolve<MetricCard[]>([]),
    blocks.has('breakdowns') ? fetchBreakdowns(page, supabase, context) : Promise.resolve<Breakdown[]>([]),
    blocks.has('trends') ? fetchTrends(page, supabase, context) : Promise.resolve<Trend[]>([]),
    narrativesPromise,
    blocks.has('authors') ? fetchAuthors(page, supabase, context) : Promise.resolve<AuthorRow[]>([]),
    blocks.has('highlights') ? fetchHighlights(supabase, highlightsContext) : Promise.resolve<Highlight[]>([]),
    blocks.has('term_signals') ? fetchTermSignals(supabase, context) : Promise.resolve<TermSignal[]>([]),
    blocks.has('graph') ? fetchGraph(supabase, context) : Promise.resolve<DisseminationGraph | null>(null),
    blocks.has('x_insights') ? fetchXInsights(supabase, context) : Promise.resolve<XInsightItem[]>([]),
    blocks.has('top_sites') ? fetchTopSites(supabase, context) : Promise.resolve<TopSiteItem[]>([]),
  ])

  // ✅ Camada 0 (2026-07-25) e Camada 1 (2026-08-02, event-radar Fase B) de
  // ai-synthesis.md implementadas — ver fetchNarrativeText acima.
  // `highlightsContext` (não `context`) pra manter narrative_text escopado
  // exatamente igual a `highlights` acima — ver nota da exceção `themes` no
  // topo desta function.
  const narrativeText = blocks.has('narrative_text')
    ? await fetchNarrativeText(supabase, highlightsContext, page, highlights)
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
    top_sites: topSites,
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
