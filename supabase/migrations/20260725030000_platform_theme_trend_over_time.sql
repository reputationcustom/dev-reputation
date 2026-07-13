-- Gap #10 de _pending.md, resolvido nesta sessão (decisão do usuário:
-- "Trend de plataforma/pauta ao longo do tempo" — implementar agora):
-- "volume por plataforma ao longo do tempo" (`platforms`) e "SOV por pauta
-- ao longo do tempo" (`themes`) — block-mapping-per-page.md sempre pediu
-- os dois, mas get_volume_trend só cobre volume/sentimento geral, sem
-- quebra por plataforma/pauta ao longo de uma série temporal.
--
-- Nenhuma das duas soma sobre `mentions` cru — ambas partem de agregados
-- diários já oficiais (bw_query_metrics_daily_by_platform,
-- narrative_metrics/bw_query_metrics_daily), só reagrupados localmente em
-- buckets de semana/mês via date_trunc quando o período pedido é maior que
-- 31 dias — não existe agregado oficial semanal/mensal por plataforma na
-- Brandwatch (diferente de bw_query_metrics_weekly/monthly, que cobrem
-- volume/sentimento geral), então bucketizar o diário localmente é a única
-- forma de oferecer o grão maior sem inventar um novo endpoint. Mesma
-- regra de grão automático de get_volume_trend (<=31d dia, <=186d semana,
-- senão mês) — sem grão "hour", já que nenhuma das duas páginas usa o
-- modo "Diário" horário do jeito que Visão Geral/Sentimento usam.

-- =========================================================================
-- get_platform_volume_trend — bloco `trends` de `platforms`
-- Fonte: bw_query_metrics_daily_by_platform.
-- =========================================================================

create or replace function get_platform_volume_trend(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  page_type text,
  bucket_date text,
  total_mentions bigint
)
language sql
stable
set search_path = public
as $$
  with grain as (
    select case
      when (p_period_end - p_period_start + 1) <= 31 then 'day'
      when (p_period_end - p_period_start + 1) <= 186 then 'week'
      else 'month'
    end as g
  ),
  cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select d.page_type, d.metric_date, d.total_mentions
    from bw_query_metrics_daily_by_platform d
    cross join cat_ids
    where d.query_id in (select org_query_ids(p_organization_id))
      and d.metric_date between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and d.category_id is null)
        or d.category_id = any(cat_ids.ids)
      )
  ),
  bucketed as (
    select
      page_type,
      case (select g from grain)
        when 'day' then to_char(metric_date, 'YYYY-MM-DD')
        when 'week' then to_char(date_trunc('week', metric_date), 'YYYY-MM-DD')
        else to_char(date_trunc('month', metric_date), 'YYYY-MM-DD')
      end as bucket_date,
      total_mentions
    from scoped
  )
  select page_type, bucket_date, sum(total_mentions)::bigint as total_mentions
  from bucketed
  group by page_type, bucket_date
  order by page_type, bucket_date
$$;

comment on function get_platform_volume_trend(uuid, date, date, jsonb) is
  'Bloco `trends` de /platforms — "volume por plataforma ao longo do tempo". Fonte: bw_query_metrics_daily_by_platform, reagrupado localmente em semana/mês quando o período > 31 dias (sem agregado oficial semanal/mensal por plataforma na Brandwatch). Envelope: um group por page_type em series_by_group.';

-- =========================================================================
-- get_theme_sov_trend — bloco `trends` de `themes`
-- Fonte: narrative_metrics (Pautas = Subcategories da Category raiz
-- "Pautas", mesmo modelo corrigido em 20260721030000) + bw_query_metrics_daily
-- (category_id is null) como denominador de SOV — mesma definição de SOV
-- já usada em narratives_overview.sov_percent (menções da Narrativa /
-- total da MESMA Query no mesmo dia), só agregada por bucket em vez de por
-- dia isolado.
-- =========================================================================

create or replace function get_theme_sov_trend(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  pauta_title text,
  bucket_date text,
  sov_pct numeric
)
language sql
stable
set search_path = public
as $$
  with grain as (
    select case
      when (p_period_end - p_period_start + 1) <= 31 then 'day'
      when (p_period_end - p_period_start + 1) <= 186 then 'week'
      else 'month'
    end as g
  ),
  pautas as (
    select n.id as narrative_id, n.title
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    where n.organization_id = p_organization_id
      and bc.status = 'active'
      and bc.parent_id = pautas_root_category_id(p_organization_id)
  ),
  pauta_daily as (
    select p.title, nm.metric_date, nm.total_mentions, nm.query_id
    from pautas p
    join narrative_metrics nm on nm.narrative_id = p.narrative_id
    where nm.period = 'daily'
      and nm.metric_date between p_period_start and p_period_end
  ),
  query_daily as (
    select query_id, metric_date, sum(total_mentions) as total_mentions
    from bw_query_metrics_daily
    where query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_date between p_period_start and p_period_end
    group by query_id, metric_date
  ),
  daily_sov as (
    select
      pd.title,
      case (select g from grain)
        when 'day' then to_char(pd.metric_date, 'YYYY-MM-DD')
        when 'week' then to_char(date_trunc('week', pd.metric_date), 'YYYY-MM-DD')
        else to_char(date_trunc('month', pd.metric_date), 'YYYY-MM-DD')
      end as bucket_date,
      pd.total_mentions as pauta_mentions,
      qd.total_mentions as query_mentions
    from pauta_daily pd
    left join query_daily qd on qd.query_id = pd.query_id and qd.metric_date = pd.metric_date
  )
  select
    title as pauta_title,
    bucket_date,
    round(sum(pauta_mentions) * 100.0 / nullif(sum(query_mentions), 0), 1) as sov_pct
  from daily_sov
  group by title, bucket_date
  order by title, bucket_date
$$;

comment on function get_theme_sov_trend(uuid, date, date, jsonb) is
  'Bloco `trends` de /themes — "SOV por pauta ao longo do tempo". Pauta = Subcategory da Category raiz "Pautas" (pautas_root_category_id, mesmo modelo de 20260721030000). SOV por bucket = soma de menções da Pauta / soma de menções da Query inteira nos dias daquele bucket, mesma definição de narratives_overview.sov_percent. p_filters mantido na assinatura por consistência de interface, não usado (SOV é sempre contra a Query inteira, nunca filtrado por Narrativa).';
