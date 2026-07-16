-- Duas coisas encontradas/resolvidas na mesma revisão de documentação
-- (2026-07-25):
--
-- 1) Achado de segurança: as 10 functions originais da migration
--    20260714000000 (org_query_ids/filter_category_ids/norm_growth/
--    get_metrics_cards/get_sentiment_breakdown/get_platform_breakdown/
--    get_volume_trend/get_dissemination_graph/get_term_signals/
--    get_x_insights) nunca ganharam `set search_path = public` — a
--    remediação de Security Advisor original (20260713070000) só cobriu
--    functions que já existiam em 2026-07-13, antes deste módulo existir;
--    sessões posteriores que reescreveram get_narratives_table/
--    get_authors_ranking/get_theme_breakdown já passaram a incluir
--    `set search_path` nas suas próprias `create or replace`, mas essas 10
--    nunca foram tocadas de novo e ficaram pra trás. Mesmo padrão de
--    remediação de 20260713070000 (`alter function ... set search_path`,
--    sem redefinir o corpo).
--
-- 2) Gap #9 de _pending.md (decisão do usuário nesta sessão: "Implementar
--    agora: país + net_sentiment"): get_region_breakdown, fonte
--    bw_query_demographics_daily (dimension_type = 'country'). ⚠️
--    Limitação real, documentada aqui e em sql-aggregation.md: esta tabela
--    NUNCA teve category_id (só project_id/query_id) — não há como
--    escopar o breakdown de região a uma Narrativa específica (filters.
--    narratives), diferente de get_sentiment_breakdown/get_platform_breakdown/
--    get_theme_breakdown, que sempre tiveram essa coluna. Por isso esta
--    function só retorna dado quando o escopo é "Query inteira" (sem
--    filtro de Narrativa) — com um filtro de Narrativa ativo (ex: a página
--    de detalhe de Narrativa), retorna vazio, honestamente, em vez de
--    devolver o dado errado (da Query inteira) mascarado como se fosse da
--    Narrativa. Top 15 países por volume, ordenados por total_mentions.

-- =========================================================================
-- 1) search_path remediation
-- =========================================================================

alter function org_query_ids(uuid) set search_path = public;
alter function filter_category_ids(uuid, jsonb) set search_path = public;
alter function norm_growth(numeric, numeric) set search_path = public;
alter function get_metrics_cards(uuid, date, date, jsonb) set search_path = public;
alter function get_sentiment_breakdown(uuid, date, date, jsonb) set search_path = public;
alter function get_platform_breakdown(uuid, date, date, jsonb) set search_path = public;
alter function get_volume_trend(uuid, date, date, jsonb) set search_path = public;
alter function get_dissemination_graph(uuid, timestamptz, timestamptz) set search_path = public;
alter function get_term_signals(uuid, date, date, jsonb) set search_path = public;
alter function get_x_insights(uuid, date, date, jsonb) set search_path = public;

-- =========================================================================
-- 2) get_region_breakdown — bloco `breakdowns` (type = 'region')
-- =========================================================================

create or replace function get_region_breakdown(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  label text,
  value numeric,
  pct numeric
)
language sql
stable
set search_path = public
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select d.value as country, d.total_mentions, d.net_sentiment
    from bw_query_demographics_daily d
    cross join cat_ids
    where d.query_id in (select org_query_ids(p_organization_id))
      and d.dimension_type = 'country'
      and d.metric_date between p_period_start and p_period_end
      -- bw_query_demographics_daily não tem category_id — sem escopo por
      -- Narrativa possível (ver nota no topo do arquivo). Só retorna dado
      -- quando não há filtro de Narrativa ativo.
      and cat_ids.ids is null
  ),
  by_country as (
    select
      country,
      sum(total_mentions) as mentions,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as weighted_sentiment,
      sum(total_mentions) filter (where net_sentiment is not null) as sentiment_weight
    from scoped
    group by country
  ),
  grand_total as (
    select sum(mentions) as total from by_country
  )
  select
    country as label,
    round(weighted_sentiment / nullif(sentiment_weight, 0), 1) as value,
    round(mentions * 100.0 / nullif((select total from grand_total), 0), 1) as pct
  from by_country
  order by mentions desc
  limit 15
$$;

comment on function get_region_breakdown(uuid, date, date, jsonb) is
  'Bloco `breakdowns` (type=region). Fonte: bw_query_demographics_daily, dimension_type=country. value=net_sentiment médio ponderado do país no período, pct=participação de menções. Só cobre o escopo "Query inteira" — a tabela de origem não tem category_id, então um filtro de Narrativa ativo (filters.narratives) retorna vazio de propósito, nunca dado da Query inteira mascarado como se fosse de uma Narrativa.';
