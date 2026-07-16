-- Módulo: aggregated-metrics (Sprint 2)
-- Fonte: .dev/specs/aggregated-metrics/sql-aggregation.md
--
-- Uma function SQL por bloco do envelope (standard-json-envelope.md), lendo
-- sempre dos agregados oficiais já sincronizados por `foundation`, nunca de
-- `mentions` agregada (única exceção: get_dissemination_graph, que lê
-- `mentions` linha a linha via narrative_matched_mentions()). Todas
-- `security invoker` (default) + `stable`, nunca `security definer` — RLS
-- por organization_id/project_id continua sendo a garantia real de acesso,
-- não o parâmetro `p_organization_id` recebido (mesma regra de
-- "Regras de negócio" da spec).
--
-- ⚠️ Deferido nesta migration: `get_active_highlights` (bloco `highlights`).
-- Depende de `feed_events`, populada pelo módulo `event-radar` (Sprint 3,
-- ainda `rascunho`, tabela não existe) — implementar junto quando esse
-- módulo for construído, ver `_pending.md`. Os 9 blocos restantes do
-- envelope (metrics/breakdowns×3/trends/narratives/authors/graph/term_signals)
-- não dependem de event-radar e são implementados aqui.
--
-- Cobertura de `filters` (jsonb, mesmo shape de `EnvelopeFilters` em
-- types/envelope.ts): só `filters.narratives` (array de narrative id) está
-- de fato "ligado" nesta rodada — usado para restringir bw_query_metrics_*
-- ao(s) bw_category_id da(s) Narrativa(s) informada(s), o mecanismo que
-- permite reusar get_sentiment_breakdown/get_platform_breakdown/
-- get_volume_trend/get_term_signals tanto no escopo "Query inteira" (Visão
-- Geral) quanto no escopo "uma Narrativa" (detalhe de Narrativa) — ver
-- `filter_category_ids()` abaixo. `filters.platforms` só é interpretado por
-- `get_authors_ranking` (escolhe bw_query_top_authors vs. bw_query_top_tweeters
-- quando o escopo é X, conforme o texto da spec). `filters.themes`/`sentiment`/
-- `region`/`author_type`/`risk_level` são aceitos (a assinatura é sempre a
-- mesma, por pedido explícito da spec) mas ainda não têm efeito nestas
-- functions — nenhuma tabela de origem hoje suporta filtrar por região
-- (ver nota "gap: breakdown de região" mais abaixo) e os demais não têm
-- necessidade concreta ainda em nenhuma página do Sprint 2.

-- =========================================================================
-- Helpers internos (reusados por várias functions abaixo)
-- =========================================================================

-- Resolve as Queries de uma organização (bw_queries -> bw_projects), nunca
-- expostas ao client (ver nota "Uma organização pode ter 1+ Queries" em
-- sql-aggregation.md). security invoker (default) — RLS de bw_queries/
-- bw_projects se aplica normalmente por trás desta function.
create or replace function org_query_ids(p_organization_id uuid)
returns setof bigint
language sql
stable
as $$
  select bq.id
  from bw_queries bq
  join bw_projects bp on bp.id = bq.project_id
  where bp.organization_id = p_organization_id
$$;

-- Resolve filters->'narratives' (array de narrative id, mesmo shape de
-- EnvelopeFilters.narratives) para o array de bw_category_id correspondente
-- — usado por toda function que precisa alternar entre "Query inteira"
-- (category_id is null) e "uma Narrativa" (category_id = algum destes).
-- Retorna null quando o filtro está vazio/ausente (nenhuma Narrativa
-- selecionada = escopo "Query inteira", o default de toda página que não é
-- o detalhe de uma Narrativa).
create or replace function filter_category_ids(p_organization_id uuid, p_filters jsonb)
returns bigint[]
language sql
stable
as $$
  select nullif(array_agg(distinct bw_category_id), '{}')
  from narratives
  where organization_id = p_organization_id
    and bw_category_id is not null
    and id::text in (
      select jsonb_array_elements_text(coalesce(p_filters -> 'narratives', '[]'::jsonb))
    )
$$;

-- =========================================================================
-- Scores de Narrativa: função auxiliar norm_growth (ver sql-aggregation.md,
-- "Scores de Narrativa" — copiada verbatim da spec).
-- =========================================================================

create or replace function norm_growth(current_value numeric, previous_value numeric)
returns numeric
language sql
immutable
as $$
  select case
    when previous_value is null or previous_value = 0 then 50
    else greatest(0, least(100,
      50 + greatest(least((current_value - previous_value) / previous_value, 1), -1) * 50
    ))
  end
$$;

-- =========================================================================
-- get_metrics_cards — bloco `metrics`
-- Fonte: bw_query_metrics_daily, category_id is null (Query inteira),
-- somado entre as Queries da organização. Os 5 cards do Executive Overview
-- (ver intelligence-center/executive-overview.md, "Cards de topo").
-- =========================================================================

create or replace function get_metrics_cards(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  metric_key text,
  current_value numeric,
  previous_value numeric,
  delta_pct numeric,
  trend text
)
language sql
stable
as $$
  with period_len as (
    select (p_period_end - p_period_start + 1) as days
  ),
  prev_range as (
    select (p_period_start - (select days from period_len)) as prev_start,
           (p_period_start - 1) as prev_end
  ),
  current_agg as (
    select
      sum(total_mentions) as total_mentions,
      sum(reach_estimate) as reach_estimate,
      sum(engagement_score) as engagement_score,
      sum(unique_authors) as unique_authors,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as net_sentiment_weighted,
      sum(total_mentions) filter (where net_sentiment is not null) as net_sentiment_weight
    from bw_query_metrics_daily
    where query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_date between p_period_start and p_period_end
  ),
  previous_agg as (
    select
      sum(total_mentions) as total_mentions,
      sum(reach_estimate) as reach_estimate,
      sum(engagement_score) as engagement_score,
      sum(unique_authors) as unique_authors,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as net_sentiment_weighted,
      sum(total_mentions) filter (where net_sentiment is not null) as net_sentiment_weight
    from bw_query_metrics_daily
    where query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)
  ),
  metrics as (
    select 'total_mentions' as metric_key,
           coalesce((select total_mentions from current_agg), 0)::numeric as current_value,
           coalesce((select total_mentions from previous_agg), 0)::numeric as previous_value
    union all
    select 'reach_estimate',
           coalesce((select reach_estimate from current_agg), 0)::numeric,
           coalesce((select reach_estimate from previous_agg), 0)::numeric
    union all
    select 'engagement_score',
           coalesce((select engagement_score from current_agg), 0)::numeric,
           coalesce((select engagement_score from previous_agg), 0)::numeric
    union all
    select 'unique_authors',
           coalesce((select unique_authors from current_agg), 0)::numeric,
           coalesce((select unique_authors from previous_agg), 0)::numeric
    union all
    -- net_sentiment é score, não contagem — soma não faz sentido; usa média
    -- ponderada por total_mentions do próprio período (combina scores
    -- oficiais diários já não-amostrados, não recalcula sobre mentions).
    select 'net_sentiment',
           (select net_sentiment_weighted / nullif(net_sentiment_weight, 0) from current_agg),
           (select net_sentiment_weighted / nullif(net_sentiment_weight, 0) from previous_agg)
  )
  select
    metric_key,
    current_value,
    previous_value,
    case when previous_value is null or previous_value = 0 then null
         else round(((current_value - previous_value) / previous_value) * 100, 1)
    end as delta_pct,
    case
      when previous_value is null then 'stable'
      when current_value > previous_value then 'up'
      when current_value < previous_value then 'down'
      else 'stable'
    end as trend
  from metrics
$$;

-- =========================================================================
-- get_sentiment_breakdown — bloco `breakdowns` (type = 'sentiment')
-- Fonte: bw_query_metrics_daily (sentiment_positive/neutral/negative).
-- Escopo default = Query inteira; com filters.narratives, escopo = as
-- Narrativas informadas (ver filter_category_ids acima).
-- =========================================================================

create or replace function get_sentiment_breakdown(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  label text,
  value bigint,
  pct numeric
)
language sql
stable
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select d.*
    from bw_query_metrics_daily d
    cross join cat_ids
    where d.query_id in (select org_query_ids(p_organization_id))
      and d.metric_date between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and d.category_id is null)
        or d.category_id = any(cat_ids.ids)
      )
  ),
  totals as (
    select
      coalesce(sum(sentiment_positive), 0) as pos,
      coalesce(sum(sentiment_neutral), 0) as neu,
      coalesce(sum(sentiment_negative), 0) as neg
    from scoped
  )
  select label, value, round(value * 100.0 / nullif((select pos + neu + neg from totals), 0), 1) as pct
  from (
    select 'positive' as label, (select pos from totals) as value
    union all
    select 'neutral', (select neu from totals)
    union all
    select 'negative', (select neg from totals)
  ) s
$$;

-- =========================================================================
-- get_platform_breakdown — bloco `breakdowns` (type = 'platform')
-- Fonte: bw_query_metrics_daily_by_platform. Em toda página que usa este
-- bloco (ver block-mapping-per-page.md) é sempre "sentimento por
-- plataforma", nunca "volume por plataforma" isolado — value = net_sentiment
-- (média ponderada por total_mentions no período, mesmo raciocínio de
-- get_metrics_cards), pct = participação de menções daquela plataforma no
-- total do escopo. net_sentiment é um score único (-100..100), não a
-- divisão positivo/neutro/negativo — precisa renderizar visualmente
-- distinto de get_sentiment_breakdown no frontend (mesma nota já registrada
-- em CLAUDE.md sobre bw_query_metrics_daily_by_platform.net_sentiment).
-- =========================================================================

create or replace function get_platform_breakdown(
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
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select d.*
    from bw_query_metrics_daily_by_platform d
    cross join cat_ids
    where d.query_id in (select org_query_ids(p_organization_id))
      and d.metric_date between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and d.category_id is null)
        or d.category_id = any(cat_ids.ids)
      )
  ),
  per_platform as (
    select
      page_type,
      sum(total_mentions) as total_mentions,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as weighted,
      sum(total_mentions) filter (where net_sentiment is not null) as weight
    from scoped
    group by page_type
  ),
  grand_total as (
    select sum(total_mentions) as total from per_platform
  )
  select
    page_type as label,
    round(weighted / nullif(weight, 0), 1) as value,
    round(total_mentions * 100.0 / nullif((select total from grand_total), 0), 1) as pct
  from per_platform
$$;

-- =========================================================================
-- get_theme_breakdown — bloco `breakdowns` (type = 'theme')
-- Fonte: narrative_metrics/narratives, restrito a Narrativas cujo
-- bw_category_id aponta pra uma bw_categories raiz (parent_id is null) —
-- mesma definição de "Pauta" de intelligence-center/electoral-themes.md.
-- value = net_sentiment médio ponderado da Pauta no período (mesmo padrão
-- de get_platform_breakdown); pct = participação de menções da Pauta no
-- total de todas as Pautas. p_pauta_id opcional restringe a uma única
-- Pauta (reuso entre a lista completa de Pautas e "dentro de uma Pauta").
-- =========================================================================

create or replace function get_theme_breakdown(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null
)
returns table (
  label text,
  value numeric,
  pct numeric
)
language sql
stable
as $$
  with root_narratives as (
    select n.id as narrative_id, n.title
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    where n.organization_id = p_organization_id
      and bc.parent_id is null
      and (p_pauta_id is null or n.id = p_pauta_id)
  ),
  scoped as (
    select nm.*
    from narrative_metrics nm
    join root_narratives rn on rn.narrative_id = nm.narrative_id
    where nm.period = 'daily'
      and nm.metric_date between p_period_start and p_period_end
  ),
  per_pauta as (
    select
      rn.narrative_id,
      rn.title,
      sum(s.total_mentions) as total_mentions,
      sum(s.net_sentiment * s.total_mentions) filter (where s.net_sentiment is not null) as weighted,
      sum(s.total_mentions) filter (where s.net_sentiment is not null) as weight
    from root_narratives rn
    left join scoped s on s.narrative_id = rn.narrative_id
    group by rn.narrative_id, rn.title
  ),
  grand_total as (
    select sum(total_mentions) as total from per_pauta
  )
  select
    title as label,
    round(weighted / nullif(weight, 0), 1) as value,
    round(coalesce(total_mentions, 0) * 100.0 / nullif((select total from grand_total), 0), 1) as pct
  from per_pauta
$$;

-- =========================================================================
-- get_volume_trend — bloco `trends`
-- Fonte: bw_query_metrics_daily/weekly/monthly. Granularidade automática
-- pelo tamanho do período pedido.
-- ⚠️ A regra exata de granularidade citada em sql-aggregation.md
-- ("reaproveitando a regra já especificada em foundation/overview.md") não
-- foi localizada como texto concreto em nenhuma spec no momento desta
-- implementação (grep completo em .dev/specs, sem resultado) — o header do
-- produto hoje só oferece 7/14/30 dias (executive-overview.md), então o
-- caso >31 dias na prática só importa pra consumidores futuros (ex:
-- executive-reports, Sprint 4). Interpretação adotada aqui, documentada
-- para revisão: ≤31 dias = grão diário, 32–186 dias (~6 meses) = grão
-- semanal, >186 dias = grão mensal. Revisar/corrigir se uma spec futura
-- tornar a regra exata explícita.
-- =========================================================================

create or replace function get_volume_trend(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket_date date,
  total_mentions integer,
  sentiment_positive integer,
  sentiment_neutral integer,
  sentiment_negative integer,
  net_sentiment numeric
)
language sql
stable
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
  daily as (
    select metric_date as bucket_date, total_mentions, sentiment_positive, sentiment_neutral,
           sentiment_negative, net_sentiment
    from bw_query_metrics_daily
    cross join cat_ids
    where (select g from grain) = 'day'
      and query_id in (select org_query_ids(p_organization_id))
      and metric_date between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and category_id is null)
        or category_id = any(cat_ids.ids)
      )
  ),
  weekly as (
    select metric_week as bucket_date, total_mentions, sentiment_positive, sentiment_neutral,
           sentiment_negative, null::numeric as net_sentiment
    from bw_query_metrics_weekly
    cross join cat_ids
    where (select g from grain) = 'week'
      and query_id in (select org_query_ids(p_organization_id))
      and metric_week between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and category_id is null)
        or category_id = any(cat_ids.ids)
      )
  ),
  monthly as (
    select metric_month as bucket_date, total_mentions, sentiment_positive, sentiment_neutral,
           sentiment_negative, null::numeric as net_sentiment
    from bw_query_metrics_monthly
    cross join cat_ids
    where (select g from grain) = 'month'
      and query_id in (select org_query_ids(p_organization_id))
      and metric_month between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and category_id is null)
        or category_id = any(cat_ids.ids)
      )
  ),
  unioned as (
    select * from daily
    union all select * from weekly
    union all select * from monthly
  )
  select
    bucket_date,
    sum(total_mentions)::integer as total_mentions,
    sum(sentiment_positive)::integer as sentiment_positive,
    sum(sentiment_neutral)::integer as sentiment_neutral,
    sum(sentiment_negative)::integer as sentiment_negative,
    case when bool_or(net_sentiment is not null)
      then round(sum(net_sentiment * total_mentions) / nullif(sum(total_mentions) filter (where net_sentiment is not null), 0), 1)
      else null
    end as net_sentiment
  from unioned
  group by bucket_date
  order by bucket_date
$$;

-- =========================================================================
-- get_narratives_table — bloco `narratives`
-- Fonte: public.narratives_overview (dado bruto por dia) + os 3 scores
-- período-dependentes (momentum/velocity/risk), calculados aqui — ver
-- sql-aggregation.md, "Scores de Narrativa". p_pauta_id opcional restringe
-- às Narrativas cuja Category é subcategoria da Pauta informada ("narrativas
-- dentro da pauta" de electoral-themes.md).
-- =========================================================================

create or replace function get_narratives_table(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null
)
returns table (
  id uuid,
  title text,
  sov_pct numeric,
  total_mentions integer,
  net_sentiment numeric,
  sentiment_label text,
  momentum_score numeric,
  velocity_score numeric,
  velocity_label text,
  risk_score numeric,
  risk_label text
)
language sql
stable
as $$
  with period_len as (
    select (p_period_end - p_period_start + 1) as days
  ),
  prev_range as (
    select (p_period_start - (select days from period_len)) as prev_start,
           (p_period_start - 1) as prev_end
  ),
  scope as (
    select n.id, n.bw_category_id
    from narratives n
    where n.organization_id = p_organization_id
      and (
        p_pauta_id is null
        or n.bw_category_id in (
          select bc.id from bw_categories bc
          where bc.parent_id = (select bw_category_id from narratives where id = p_pauta_id)
        )
      )
  ),
  latest_day as (
    select distinct on (nv.narrative_id)
      nv.narrative_id, nv.title, nv.sov_percent, nv.total_mentions,
      nv.net_sentiment, nv.sentiment_bucket, nm.query_id
    from public.narratives_overview nv
    join narrative_metrics nm
      on nm.narrative_id = nv.narrative_id and nm.metric_date = nv.metric_date and nm.period = 'daily'
    where nv.organization_id = p_organization_id
      and nv.metric_date between p_period_start and p_period_end
      and nv.narrative_id in (select id from scope)
    order by nv.narrative_id, nv.metric_date desc
  ),
  period_agg as (
    select
      narrative_id,
      sum(total_mentions) filter (where metric_date between p_period_start and p_period_end) as vol_current,
      sum(total_mentions) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as vol_previous,
      sum(engagement_total) filter (where metric_date between p_period_start and p_period_end) as engagement_current,
      sum(engagement_total) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as engagement_previous,
      avg(unique_authors) filter (where metric_date between p_period_start and p_period_end) as authors_current,
      avg(unique_authors) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as authors_previous,
      sum(reach_estimated) filter (where metric_date between p_period_start and p_period_end) as reach_current,
      sum(reach_estimated) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as reach_previous
    from narrative_metrics
    where period = 'daily'
      and narrative_id in (select id from scope)
      and metric_date between (select prev_start from prev_range) and p_period_end
    group by narrative_id
  ),
  velocity_agg as (
    select
      s.id as narrative_id,
      sum(h.total_mentions) filter (where h.metric_hour >= now() - interval '3 hours') as last_3h,
      sum(h.total_mentions) filter (where h.metric_hour >= now() - interval '6 hours' and h.metric_hour < now() - interval '3 hours') as previous_3h
    from scope s
    left join bw_query_metrics_hourly h
      on h.category_id = s.bw_category_id
      and h.metric_hour >= now() - interval '6 hours'
    group by s.id
  ),
  latest_week_per_category as (
    select category_id, max(metric_week) as latest_week
    from bw_query_top_authors
    where category_id is not null
    group by category_id
  ),
  author_influence_agg as (
    select
      s.id as narrative_id,
      count(*) filter (where a.is_influential) * 100.0 / nullif(count(*), 0) as author_influence
    from scope s
    join latest_week_per_category lw on lw.category_id = s.bw_category_id
    left join bw_query_top_authors a on a.category_id = s.bw_category_id and a.metric_week = lw.latest_week
    group by s.id
  ),
  momentum as (
    select
      ld.narrative_id,
      round(
        0.40 * norm_growth(pa.vol_current, pa.vol_previous) +
        0.25 * norm_growth(pa.engagement_current, pa.engagement_previous) +
        0.20 * norm_growth(pa.authors_current, pa.authors_previous) +
        0.15 * norm_growth(pa.reach_current, pa.reach_previous)
      ) as momentum_score
    from latest_day ld
    left join period_agg pa on pa.narrative_id = ld.narrative_id
  ),
  velocity as (
    select
      ld.narrative_id,
      norm_growth(va.last_3h, va.previous_3h) as velocity_score
    from latest_day ld
    left join velocity_agg va on va.narrative_id = ld.narrative_id
  ),
  risk_inputs as (
    select
      ld.narrative_id,
      greatest(0, least(100, (100 - coalesce(ld.net_sentiment, 0)) / 2.0)) as sentiment_risk,
      m.momentum_score,
      v.velocity_score,
      coalesce(pa.reach_current, 0) * 100.0 / nullif(max(coalesce(pa.reach_current, 0)) over (partition by ld.query_id), 0) as reach_risk,
      coalesce(pa.engagement_current, 0) * 100.0 / nullif(max(coalesce(pa.engagement_current, 0)) over (partition by ld.query_id), 0) as impact_risk,
      coalesce(ai.author_influence, 0) as author_influence
    from latest_day ld
    left join period_agg pa on pa.narrative_id = ld.narrative_id
    left join momentum m on m.narrative_id = ld.narrative_id
    left join velocity v on v.narrative_id = ld.narrative_id
    left join author_influence_agg ai on ai.narrative_id = ld.narrative_id
  ),
  risk as (
    select
      narrative_id,
      round(
        0.25 * sentiment_risk +
        0.25 * coalesce(momentum_score, 50) +
        0.20 * coalesce(velocity_score, 50) +
        0.15 * coalesce(reach_risk, 0) +
        0.10 * author_influence +
        0.05 * coalesce(impact_risk, 0)
      ) as risk_score
    from risk_inputs
  )
  select
    ld.narrative_id as id,
    ld.title,
    ld.sov_percent as sov_pct,
    ld.total_mentions,
    ld.net_sentiment,
    ld.sentiment_bucket as sentiment_label,
    m.momentum_score,
    v.velocity_score,
    case
      when v.velocity_score is null then null
      when v.velocity_score < 20 then 'shrinking_fast'
      when v.velocity_score < 40 then 'declining'
      when v.velocity_score < 60 then 'stable'
      when v.velocity_score < 80 then 'growing'
      else 'viral'
    end as velocity_label,
    r.risk_score,
    case
      when r.risk_score is null then null
      when r.risk_score < 34 then 'low'
      when r.risk_score < 60 then 'medium'
      when r.risk_score < 85 then 'high'
      else 'critical'
    end as risk_label
  from latest_day ld
  left join momentum m on m.narrative_id = ld.narrative_id
  left join velocity v on v.narrative_id = ld.narrative_id
  left join risk r on r.narrative_id = ld.narrative_id
  order by r.risk_score desc nulls last, ld.total_mentions desc nulls last
$$;

-- =========================================================================
-- get_authors_ranking — bloco `authors`
-- Fonte: bw_query_top_authors (geral) ou bw_query_top_tweeters (quando
-- filters.platforms indica escopo X/Twitter) — nativos da Brandwatch, não
-- amostrados. entity_id fica null até `entities` (Sprint 2, sem spec ainda)
-- existir. risk_level fica null — nenhuma spec define uma fórmula de risco
-- por autor (diferente de narratives, que tem "Scores de Narrativa"
-- completo) — ver nota em types/envelope.ts (AuthorRow.risk_level).
-- =========================================================================

create or replace function get_authors_ranking(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  entity_id uuid,
  name text,
  type text,
  reach numeric,
  engagement numeric,
  risk_level text,
  is_influential boolean
)
language sql
stable
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  use_tweeters as (
    select coalesce((p_filters -> 'platforms') ? 'twitter', false)
        or coalesce((p_filters -> 'platforms') ? 'x', false) as flag
  ),
  scoped_authors as (
    select author, volume, reach_estimate, impact, account_type, is_influential, metric_week, category_id, query_id
    from bw_query_top_authors
    where not (select flag from use_tweeters)
    union all
    select author, volume, reach_estimate, impact, account_type, is_influential, metric_week, category_id, query_id
    from bw_query_top_tweeters
    where (select flag from use_tweeters)
  ),
  filtered as (
    select sa.*
    from scoped_authors sa
    cross join cat_ids
    where sa.query_id in (select org_query_ids(p_organization_id))
      and (
        (cat_ids.ids is null and sa.category_id is null)
        or sa.category_id = any(cat_ids.ids)
      )
  ),
  latest_week as (
    select max(metric_week) as w from filtered
  )
  select
    null::uuid as entity_id,
    author as name,
    coalesce(account_type, 'unknown') as type,
    reach_estimate::numeric as reach,
    impact as engagement,
    null::text as risk_level,
    coalesce(is_influential, false) as is_influential
  from filtered
  where metric_week = (select w from latest_week)
  order by volume desc nulls last
$$;

-- =========================================================================
-- get_dissemination_graph — bloco `graph`
-- Única function com narrative_id obrigatório em vez de (organization_id,
-- period, filters) — ver sql-aggregation.md. p_since/p_until opcionais
-- (repassados a narrative_matched_mentions) evitam varrer todo o histórico
-- por padrão; sem eles, cobre a Narrativa inteira.
--
-- Fonte real por mention (nunca agregada): mentions.insights_mentioned
-- (handles @mencionados, campo confirmado) vira aresta 'mention'.
-- reply_to/retweet_of guardam a URL do post alvo, não o autor original
-- (Brandwatch não expõe essa resolução — ver comentário em
-- 20260710050000_influencer_and_participation_tracking.sql) — este bloco
-- só consegue montar aresta 'reply'/'retweet' quando esse post alvo também
-- está no próprio conjunto de mentions casadas da Narrativa (join por
-- mentions.raw->>'url'). ⚠️ Chave `url` dentro de `raw` não confirmada
-- contra um payload real nesta implementação (mesma categoria de risco já
-- registrada para outros campos de `raw` no projeto) — se o nome real for
-- outro, este bloco só deixa de gerar arestas reply/retweet (a 'mention'
-- continua funcionando), nunca quebra a function.
-- =========================================================================

create or replace function get_dissemination_graph(
  p_narrative_id uuid,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns jsonb
language sql
stable
as $$
  with matched as (
    select * from narrative_matched_mentions(p_narrative_id, p_since, p_until)
  ),
  mention_edges as (
    select distinct m.author_handle_normalized as source, lower(h) as target, 'mention' as type
    from matched m, unnest(m.insights_mentioned) as h
    where m.author_handle_normalized is not null and h is not null and h <> ''
  ),
  reply_retweet_edges as (
    select distinct
      m.author_handle_normalized as source,
      m2.author_handle_normalized as target,
      case when m.mention_role = 'retweet' then 'retweet' else 'reply' end as type
    from matched m
    join matched m2
      on (m.reply_to is not null and m2.raw ->> 'url' = m.reply_to)
      or (m.retweet_of is not null and m2.raw ->> 'url' = m.retweet_of)
    where m.mention_role in ('reply', 'retweet')
      and m.author_handle_normalized is not null
      and m2.author_handle_normalized is not null
      and m2.author_handle_normalized <> m.author_handle_normalized
  ),
  all_edges as (
    select * from mention_edges
    union
    select * from reply_retweet_edges
  ),
  node_reach as (
    select author_handle_normalized as node_id, max(author) as label, max(reach_estimate) as reach
    from matched
    where author_handle_normalized is not null
    group by author_handle_normalized
  ),
  node_ids as (
    select source as node_id from all_edges
    union
    select target as node_id from all_edges
    union
    select node_id from node_reach
  )
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.node_id,
        'label', coalesce(nr.label, n.node_id),
        'reach', coalesce(nr.reach, 0)
      ))
      from node_ids n
      left join node_reach nr on nr.node_id = n.node_id
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object('source', source, 'target', target, 'type', type))
      from all_edges
    ), '[]'::jsonb)
  )
$$;

-- =========================================================================
-- get_term_signals — bloco `term_signals`
-- Fonte: bw_query_topics (label, sentiment_positive/neutral/negative,
-- trending). metric_week aqui é só um marcador de frescor do sync semanal,
-- não um bucket de calendário real (ver foundation/data-model.md) — por
-- isso esta function ignora p_period_start/p_period_end para filtrar linhas
-- (mantidos na assinatura só por consistência de interface) e sempre lê o
-- snapshot mais recente disponível no escopo.
-- =========================================================================

create or replace function get_term_signals(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  term text,
  growth_pct numeric,
  sentiment_associated text
)
language sql
stable
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped_base as (
    select t.*
    from bw_query_topics t
    cross join cat_ids
    where t.query_id in (select org_query_ids(p_organization_id))
      and (
        (cat_ids.ids is null and t.category_id is null)
        or t.category_id = any(cat_ids.ids)
      )
  ),
  latest as (
    select max(metric_week) as w from scoped_base
  )
  select
    label as term,
    trending as growth_pct,
    case
      when sentiment_positive >= sentiment_neutral and sentiment_positive >= sentiment_negative then 'positive'
      when sentiment_negative >= sentiment_neutral and sentiment_negative >= sentiment_positive then 'negative'
      else 'neutral'
    end as sentiment_associated
  from scoped_base
  where metric_week = (select w from latest)
  order by trending desc nulls last
  limit 50
$$;
