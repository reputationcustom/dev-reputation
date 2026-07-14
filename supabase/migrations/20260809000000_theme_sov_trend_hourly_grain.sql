-- get_theme_sov_trend ganha grão "hour" para o modo "Diário" (2026-08-09,
-- pedido do usuário: "a linha do tempo está ficando vazia quando o período
-- é diário. Nesse caso precisa mostrar por hora" — reportado no widget
-- "SOV por pauta ao longo do tempo" de /themes).
--
-- Mesmo bug de `get_volume_trend` corrigido em 20260719000000 (ver
-- CLAUDE.md, "Volume/sentiment trend chart — hourly grain..."): a regra de
-- grão automático (≤31d → day, 32-186d → week, >186d → month) nunca cobria
-- "Diário" (1 dia, período.start === período.end) — caía no mesmo bucket
-- "day" das outras janelas curtas, devolvendo 1 único ponto por pauta (o
-- dia inteiro), inútil como série temporal — exatamente o gráfico vazio do
-- relato do usuário. `get_theme_sov_trend` nunca ganhou esse fix junto
-- porque não existia ainda quando 20260719000000 foi escrita (adicionada
-- só em 20260725030000, cujo próprio comentário já registrava a lacuna:
-- "sem grão hour, já que nenhuma das duas páginas [platforms/themes] usa o
-- modo Diário horário do jeito que Visão Geral/Sentimento usam" — suposição
-- que se mostrou errada pra `themes` neste relato).
--
-- Fonte do grão hour: bw_query_metrics_hourly (foundation, migration
-- 20260713040000 — janela móvel de 30 dias, sempre fresca, já tem
-- category_id nullable, mesma tabela que `get_volume_trend` já usa).
-- Numerador (menções da Pauta por hora) = linhas com category_id = o
-- bw_category_id da Pauta; denominador (menções da Query inteira por hora)
-- = linhas com category_id is null — mesma definição de SOV de sempre
-- (menções da Pauta / menções da MESMA Query no mesmo bucket), só que por
-- hora em vez de por dia.
--
-- Sem `drop function` — `bucket_date` já era `text` desde a criação desta
-- function (nunca foi `date`, diferente do que aconteceu com
-- get_volume_trend), então a assinatura/tipos de retorno não mudam;
-- `create or replace` basta.

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
      when (p_period_end - p_period_start + 1) = 1 then 'hour'
      when (p_period_end - p_period_start + 1) <= 31 then 'day'
      when (p_period_end - p_period_start + 1) <= 186 then 'week'
      else 'month'
    end as g
  ),
  pautas as (
    select n.id as narrative_id, n.bw_category_id, n.title
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    where n.organization_id = p_organization_id
      and bc.status = 'active'
      and bc.parent_id = pautas_root_category_id(p_organization_id)
  ),
  pauta_hourly as (
    select
      p.title,
      to_char(h.metric_hour at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket_date,
      h.total_mentions as pauta_mentions,
      h.query_id
    from pautas p
    join bw_query_metrics_hourly h on h.category_id = p.bw_category_id
    where (select g from grain) = 'hour'
      and h.metric_hour >= p_period_start::timestamptz
      and h.metric_hour < (p_period_end + 1)::timestamptz
  ),
  query_hourly as (
    select
      query_id,
      to_char(metric_hour at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket_date,
      sum(total_mentions) as query_mentions
    from bw_query_metrics_hourly
    where (select g from grain) = 'hour'
      and query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_hour >= p_period_start::timestamptz
      and metric_hour < (p_period_end + 1)::timestamptz
    group by query_id, bucket_date
  ),
  hourly_sov as (
    select
      ph.title,
      ph.bucket_date,
      ph.pauta_mentions,
      qh.query_mentions
    from pauta_hourly ph
    left join query_hourly qh on qh.query_id = ph.query_id and qh.bucket_date = ph.bucket_date
  ),
  pauta_daily as (
    select p.title, nm.metric_date, nm.total_mentions, nm.query_id
    from pautas p
    join narrative_metrics nm on nm.narrative_id = p.narrative_id
    where (select g from grain) != 'hour'
      and nm.period = 'daily'
      and nm.metric_date between p_period_start and p_period_end
  ),
  query_daily as (
    select query_id, metric_date, sum(total_mentions) as total_mentions
    from bw_query_metrics_daily
    where (select g from grain) != 'hour'
      and query_id in (select org_query_ids(p_organization_id))
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
  ),
  unioned as (
    select title, bucket_date, pauta_mentions, query_mentions from hourly_sov
    union all
    select title, bucket_date, pauta_mentions, query_mentions from daily_sov
  )
  select
    title as pauta_title,
    bucket_date,
    round(sum(pauta_mentions) * 100.0 / nullif(sum(query_mentions), 0), 1) as sov_pct
  from unioned
  group by title, bucket_date
  order by title, bucket_date
$$;

comment on function get_theme_sov_trend(uuid, date, date, jsonb) is
  'Bloco `trends` de /themes — "SOV por pauta ao longo do tempo". Pauta = Subcategory da Category raiz "Pautas" (pautas_root_category_id). Grão automático: período de exatamente 1 dia ("Diário") usa bw_query_metrics_hourly (janela móvel de 30 dias); ≤31d dia, 32-186d semana, >186d mês, todos via narrative_metrics/bw_query_metrics_daily (2026-08-09, migration 20260809000000 — fecha o mesmo gap de get_volume_trend, 20260719000000). SOV por bucket = soma de menções da Pauta / soma de menções da Query inteira nos buckets, mesma definição de narratives_overview.sov_percent. p_filters mantido na assinatura por consistência de interface, não usado (SOV é sempre contra a Query inteira, nunca filtrado por Narrativa).';
