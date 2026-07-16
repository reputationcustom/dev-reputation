-- Pedido do usuário (2026-08-09, mesma sessão do bug de sentimento por
-- pauta): "get_term_signals e get_narratives_table.tags/positive_topics/
-- negative_topics [devem] retornar tanto por trending quanto por
-- volumetria, pois no frontend adicionaremos essa opção para o usuário
-- selecionar qual a perspectiva ele deseja acompanhar. Default deve ser
-- trending."
--
-- Contexto (ver CLAUDE.md, resposta da sessão anterior): bw_query_topics
-- já guarda `volume` E `trending` por linha (ambos sincronizados por
-- bw-sync/syncTopicsData()) — o gap nunca foi de captura, foi de
-- exposição: get_term_signals sempre ranqueava só por `trending`,
-- get_narratives_table.tags/positive_topics/negative_topics sempre
-- ranqueava só por `volume`. Nenhuma das duas oferecia a outra
-- perspectiva.
--
-- Fix: as duas functions ganham um parâmetro `p_topic_sort text default
-- 'trending'` — controla qual métrica decide o TOP-N (top 20 por balde de
-- sentimento em get_term_signals; top 6/5/5 por Narrativa em
-- get_narratives_table), não só a ordem de exibição de um conjunto já
-- fixo. Isso importa: reordenar no frontend um top-N já cortado por
-- trending não reproduz o verdadeiro top-N por volume (itens diferentes
-- podem entrar/sair do corte dependendo do critério) — por isso o
-- parâmetro precisa ir até a CTE que faz o `row_number()`/corte, não só
-- no `order by` final.
--
-- get_term_signals ganha ainda a coluna `volume` no retorno (nunca
-- existiu antes) — permite ao frontend mostrar as duas métricas lado a
-- lado (ex: tamanho da fonte por trending, tooltip com volume, ou
-- vice-versa) independente de qual critério decidiu o corte.
-- get_narratives_table.tags/positive_topics/negative_topics continuam
-- `text[]` simples (só rótulos) — não precisam de coluna extra, o
-- parâmetro só muda QUAIS/EM QUE ORDEM os rótulos aparecem.
--
-- Qualquer valor de p_topic_sort diferente de 'volume' (incluindo null/
-- string inválida) cai no default 'trending' — mesmo padrão defensivo já
-- usado por p_scope em get_narratives_table.

-- =========================================================================
-- 1) get_term_signals — ganha p_topic_sort (5º parâmetro) + coluna
-- `volume` no retorno. Muda de aridade (4→5 params) — drop function
-- explícito antes do create or replace, mesma regra de sempre (Princípio
-- técnico 7, "Migration hygiene").
-- =========================================================================

drop function if exists get_term_signals(uuid, date, date, jsonb);

create or replace function get_term_signals(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_topic_sort text default 'trending'
)
returns table (
  term text,
  growth_pct numeric,
  volume integer,
  sentiment_associated text
)
language sql
stable
set search_path = public
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
  ),
  classified as (
    select
      label as term,
      trending as growth_pct,
      volume,
      case
        when sentiment_positive >= sentiment_neutral and sentiment_positive >= sentiment_negative then 'positive'
        when sentiment_negative >= sentiment_neutral and sentiment_negative >= sentiment_positive then 'negative'
        else 'neutral'
      end as sentiment_associated
    from scoped_base
    where metric_week = (select w from latest)
  ),
  ranked as (
    select
      term,
      growth_pct,
      volume,
      sentiment_associated,
      row_number() over (
        partition by sentiment_associated
        order by (case when p_topic_sort = 'volume' then volume::numeric else growth_pct end) desc nulls last
      ) as rn
    from classified
  )
  select term, growth_pct, volume, sentiment_associated
  from ranked
  where rn <= 20
  order by
    sentiment_associated,
    (case when p_topic_sort = 'volume' then volume::numeric else growth_pct end) desc nulls last
$$;

comment on function get_term_signals(uuid, date, date, jsonb, text) is
  'Bloco `term_signals`. Fonte: bw_query_topics (label/volume/trending/sentiment_positive/neutral/negative), snapshot mais recente (metric_week), sem filtro de p_period_start/p_period_end (marcador de frescor, não bucket de calendário real). Ranking é feito DENTRO de cada bucket de sentimento (top 20 positive/neutral/negative cada). p_topic_sort (✅ 2026-08-09, migration 20260809130000): ''trending'' (default) ranqueia por growth_pct (bw_query_topics.trending); ''volume'' ranqueia pelo volume absoluto de menções — qualquer outro valor cai no default. O corte de top-20 é feito DEPOIS de aplicar o critério escolhido (não um resort de um top-20-por-trending fixo), então o conjunto de termos retornado pode mudar entre as duas perspectivas, não só a ordem. `volume` sempre retornado (nova coluna) independente do critério de corte, pro frontend poder exibir as duas métricas.';

-- =========================================================================
-- 2) get_narratives_table — ganha p_topic_sort (9º parâmetro, depois de
-- p_reference_at) — controla o critério de tags/positive_topics/
-- negative_topics. Mesma assinatura de saída de 20260809010000 (nenhuma
-- coluna nova — são text[] de rótulos, o parâmetro só muda quais/em que
-- ordem). Muda de aridade (8→9 params) — drop function explícito.
-- =========================================================================

drop function if exists get_narratives_table(uuid, date, date, jsonb, uuid, text, timestamptz);

create or replace function get_narratives_table(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null,
  p_scope text default null,
  p_reference_at timestamptz default now(),
  p_topic_sort text default 'trending'
)
returns table (
  id uuid,
  title text,
  category_label text,
  sov_pct numeric,
  total_mentions integer,
  net_sentiment numeric,
  sentiment_label text,
  sentiment_positive_pct numeric,
  sentiment_neutral_pct numeric,
  sentiment_negative_pct numeric,
  momentum_score numeric,
  trend_score numeric,
  trend_label text,
  risk_score numeric,
  risk_label text,
  summary text,
  tags text[],
  positive_topics text[],
  negative_topics text[]
)
language sql
stable
set search_path = public
as $$
  with period_len as (
    select (p_period_end - p_period_start + 1) as days
  ),
  prev_range as (
    select (p_period_start - (select days from period_len)) as prev_start,
           (p_period_start - 1) as prev_end
  ),
  narrative_ids as (
    select nullif(array_agg((elem)::uuid), '{}') as ids
    from jsonb_array_elements_text(coalesce(p_filters -> 'narratives', '[]'::jsonb)) as elem
  ),
  scope as (
    select
      n.id,
      n.bw_category_id,
      n.description,
      coalesce(parent_bc.name, bc.name) as category_label
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    left join bw_categories parent_bc on parent_bc.id = bc.parent_id
    cross join narrative_ids
    where n.organization_id = p_organization_id
      and bc.status = 'active'
      and (
        (
          p_pauta_id is not null
          and bc.parent_id = (select bw_category_id from narratives where id = p_pauta_id)
        )
        or (
          p_pauta_id is null
          and (
            p_scope is null
            or (p_scope = 'roots' and bc.parent_id is null)
            or (p_scope = 'leaves' and bc.parent_id is not null)
            or (p_scope = 'pautas' and bc.parent_id = pautas_root_category_id(p_organization_id))
          )
        )
      )
      and (narrative_ids.ids is null or n.id = any(narrative_ids.ids))
  ),
  latest_day as (
    select distinct on (nv.narrative_id)
      nv.narrative_id, nv.title, nv.sov_percent, nv.total_mentions, nm.query_id
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
      max(query_id) as query_id,
      sum(total_mentions) filter (where metric_date between p_period_start and p_period_end) as vol_current,
      sum(total_mentions) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as vol_previous,
      sum(engagement_total) filter (where metric_date between p_period_start and p_period_end) as engagement_current,
      sum(engagement_total) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as engagement_previous,
      avg(unique_authors) filter (where metric_date between p_period_start and p_period_end) as authors_current,
      avg(unique_authors) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as authors_previous,
      sum(reach_estimated) filter (where metric_date between p_period_start and p_period_end) as reach_current,
      sum(reach_estimated) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as reach_previous,
      sum(sentiment_positive) filter (where metric_date between p_period_start and p_period_end) as sentiment_positive_current,
      sum(sentiment_neutral) filter (where metric_date between p_period_start and p_period_end) as sentiment_neutral_current,
      sum(sentiment_negative) filter (where metric_date between p_period_start and p_period_end) as sentiment_negative_current
    from narrative_metrics
    where period = 'daily'
      and narrative_id in (select id from scope)
      and metric_date between (select prev_start from prev_range) and p_period_end
    group by narrative_id
  ),
  -- Denominador padrão de SOV (todas as páginas exceto Pautas) — soma de
  -- total_mentions de TODAS as Narrativas do mesmo query_id, não só as do
  -- `scope`/filtro atual (mesma definição de public.narratives_overview.sov_percent,
  -- só agregada sobre o período em vez de um único dia, ver 20260808030000).
  query_period_totals as (
    select query_id, sum(total_mentions) as query_total_current
    from narrative_metrics
    where period = 'daily'
      and query_id is not null
      and metric_date between p_period_start and p_period_end
    group by query_id
  ),
  -- Denominador de SOV específico pra `p_scope = 'pautas'`: soma de
  -- total_mentions de TODAS as Subcategories ativas da Category raiz
  -- "Pautas" no período, org-wide (mesma definição já usada por
  -- get_theme_breakdown, "Share of Voice e sentimento por pauta").
  pautas_period_total as (
    select sum(nm.total_mentions) as total
    from narrative_metrics nm
    join narratives n on n.id = nm.narrative_id
    join bw_categories bc on bc.id = n.bw_category_id
    where n.organization_id = p_organization_id
      and bc.status = 'active'
      and bc.parent_id = pautas_root_category_id(p_organization_id)
      and nm.period = 'daily'
      and nm.metric_date between p_period_start and p_period_end
  ),
  sentiment_final as (
    select
      narrative_id,
      sentiment_positive_current,
      sentiment_neutral_current,
      sentiment_negative_current,
      case
        when coalesce(sentiment_positive_current, 0) + coalesce(sentiment_negative_current, 0) > 0
          then (sentiment_positive_current - sentiment_negative_current)::numeric * 100.0
               / (sentiment_positive_current + sentiment_negative_current)
      end as net_sentiment_skew
    from period_agg
  ),
  sentiment_labeled as (
    select
      narrative_id,
      case
        when coalesce(sentiment_neutral_current, 0) > 0
         and coalesce(sentiment_neutral_current, 0) >= coalesce(sentiment_positive_current, 0)
         and coalesce(sentiment_neutral_current, 0) >= coalesce(sentiment_negative_current, 0)
          then 0
        else net_sentiment_skew
      end as net_sentiment,
      case
        when coalesce(sentiment_neutral_current, 0) > 0
         and coalesce(sentiment_neutral_current, 0) >= coalesce(sentiment_positive_current, 0)
         and coalesce(sentiment_neutral_current, 0) >= coalesce(sentiment_negative_current, 0)
          then 'neutral'
        when net_sentiment_skew >= 50 then 'very_positive'
        when net_sentiment_skew >= 20 then 'positive'
        when net_sentiment_skew >= 5 then 'slightly_positive'
        when net_sentiment_skew >= -4 then 'neutral'
        when net_sentiment_skew >= -19 then 'slightly_negative'
        when net_sentiment_skew >= -49 then 'negative'
        when net_sentiment_skew is not null then 'very_negative'
        else 'neutral'
      end as sentiment_label
    from sentiment_final
  ),
  trend_series as (
    select
      s.id as narrative_id,
      nm.total_mentions,
      row_number() over (partition by s.id order by nm.metric_date) as day_index
    from scope s
    join narrative_metrics nm
      on nm.narrative_id = s.id
      and nm.period = 'daily'
      and nm.metric_date >= (p_reference_at::date) - interval '13 days'
      and nm.metric_date <= (p_reference_at::date)
  ),
  trend_agg as (
    select
      narrative_id,
      regr_slope(total_mentions::double precision, day_index::double precision) as slope_per_day,
      avg(total_mentions) as avg_mentions,
      count(*) as n_points
    from trend_series
    group by narrative_id
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
  trend as (
    select
      ld.narrative_id,
      case
        when ta.n_points is null or ta.n_points < 4 or coalesce(ta.avg_mentions, 0) = 0 then null
        else greatest(0, least(100,
          50 + greatest(least((ta.slope_per_day * ta.n_points) / ta.avg_mentions, 1), -1) * 50
        ))
      end as trend_score
    from latest_day ld
    left join trend_agg ta on ta.narrative_id = ld.narrative_id
  ),
  risk_inputs as (
    select
      ld.narrative_id,
      greatest(0, least(100, (100 - coalesce(sl.net_sentiment, 0)) / 2.0)) as sentiment_risk,
      m.momentum_score,
      t.trend_score,
      coalesce(pa.reach_current, 0) * 100.0 / nullif(max(coalesce(pa.reach_current, 0)) over (partition by ld.query_id), 0) as reach_risk,
      coalesce(pa.engagement_current, 0) * 100.0 / nullif(max(coalesce(pa.engagement_current, 0)) over (partition by ld.query_id), 0) as impact_risk,
      coalesce(ai.author_influence, 0) as author_influence
    from latest_day ld
    left join sentiment_labeled sl on sl.narrative_id = ld.narrative_id
    left join period_agg pa on pa.narrative_id = ld.narrative_id
    left join momentum m on m.narrative_id = ld.narrative_id
    left join trend t on t.narrative_id = ld.narrative_id
    left join author_influence_agg ai on ai.narrative_id = ld.narrative_id
  ),
  radar_boost as (
    select
      related_narrative_id as narrative_id,
      max(severity_score) as severity_score
    from feed_events
    where organization_id = p_organization_id
      and related_narrative_id is not null
      and closed_at is null
    group by related_narrative_id
  ),
  risk as (
    select
      ri.narrative_id,
      greatest(
        round(
          0.25 * ri.sentiment_risk +
          least(1, greatest(0.5, ri.sentiment_risk / 50.0)) * (
            0.25 * coalesce(ri.momentum_score, 50) +
            0.20 * coalesce(ri.trend_score, 50)
          ) +
          0.15 * coalesce(ri.reach_risk, 0) +
          0.10 * ri.author_influence +
          0.05 * coalesce(ri.impact_risk, 0)
        ),
        coalesce(rb.severity_score, 0)
      ) as risk_score
    from risk_inputs ri
    left join radar_boost rb on rb.narrative_id = ri.narrative_id
  ),
  tag_latest_week as (
    select bqt.category_id, max(bqt.metric_week) as w
    from bw_query_topics bqt
    where bqt.category_id in (select bw_category_id from scope)
      and bqt.topic_type in ('hashtags', 'phrases', 'words')
    group by bqt.category_id
  ),
  -- ✅ 2026-08-09 (migration 20260809130000): topic_classified ganha
  -- `trending` (já sincronizado desde sempre, nunca lido aqui) — necessário
  -- pra tag_ranked/positive_topic_ranked/negative_topic_ranked poderem
  -- ranquear por p_topic_sort, não só por volume.
  topic_classified as (
    select
      t.category_id,
      t.label,
      t.volume,
      t.trending,
      case
        when t.sentiment_positive >= t.sentiment_neutral and t.sentiment_positive >= t.sentiment_negative then 'positive'
        when t.sentiment_negative >= t.sentiment_neutral and t.sentiment_negative >= t.sentiment_positive then 'negative'
        else 'neutral'
      end as sentiment_bucket
    from bw_query_topics t
    join tag_latest_week lw on lw.category_id = t.category_id and lw.w = t.metric_week
    where t.topic_type in ('hashtags', 'phrases', 'words')
  ),
  tag_ranked as (
    select
      category_id,
      label,
      row_number() over (
        partition by category_id
        order by (case when p_topic_sort = 'volume' then volume::numeric else trending end) desc nulls last
      ) as rn
    from topic_classified
  ),
  tags_by_category as (
    select category_id, array_agg(label order by rn) as tags
    from tag_ranked
    where rn <= 6
    group by category_id
  ),
  positive_topic_ranked as (
    select
      category_id,
      label,
      row_number() over (
        partition by category_id
        order by (case when p_topic_sort = 'volume' then volume::numeric else trending end) desc nulls last
      ) as rn
    from topic_classified
    where sentiment_bucket = 'positive'
  ),
  negative_topic_ranked as (
    select
      category_id,
      label,
      row_number() over (
        partition by category_id
        order by (case when p_topic_sort = 'volume' then volume::numeric else trending end) desc nulls last
      ) as rn
    from topic_classified
    where sentiment_bucket = 'negative'
  ),
  positive_topics_by_category as (
    select category_id, array_agg(label order by rn) as positive_topics
    from positive_topic_ranked
    where rn <= 5
    group by category_id
  ),
  negative_topics_by_category as (
    select category_id, array_agg(label order by rn) as negative_topics
    from negative_topic_ranked
    where rn <= 5
    group by category_id
  )
  select
    ld.narrative_id as id,
    ld.title,
    s.category_label,
    round(
      100.0 * coalesce(pa.vol_current, 0) / nullif(
        case when p_scope = 'pautas' then (select total from pautas_period_total) else qpt.query_total_current end,
        0
      ),
      1
    ) as sov_pct,
    coalesce(pa.vol_current, 0)::integer as total_mentions,
    sl.net_sentiment,
    sl.sentiment_label,
    round(coalesce(pa.sentiment_positive_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_positive_pct,
    round(coalesce(pa.sentiment_neutral_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_neutral_pct,
    round(coalesce(pa.sentiment_negative_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_negative_pct,
    m.momentum_score,
    t.trend_score,
    case
      when t.trend_score is null then null
      when t.trend_score < 40 then 'decreasing'
      when t.trend_score < 60 then 'stable'
      else 'increasing'
    end as trend_label,
    r.risk_score,
    case
      when r.risk_score is null then null
      when r.risk_score < 34 then 'low'
      when r.risk_score < 60 then 'medium'
      when r.risk_score < 85 then 'high'
      else 'critical'
    end as risk_label,
    s.description as summary,
    coalesce(tc.tags, '{}') as tags,
    coalesce(ptc.positive_topics, '{}') as positive_topics,
    coalesce(ntc.negative_topics, '{}') as negative_topics
  from latest_day ld
  join scope s on s.id = ld.narrative_id
  left join sentiment_labeled sl on sl.narrative_id = ld.narrative_id
  left join period_agg pa on pa.narrative_id = ld.narrative_id
  left join query_period_totals qpt on qpt.query_id = pa.query_id
  left join momentum m on m.narrative_id = ld.narrative_id
  left join trend t on t.narrative_id = ld.narrative_id
  left join risk r on r.narrative_id = ld.narrative_id
  left join tags_by_category tc on tc.category_id = s.bw_category_id
  left join positive_topics_by_category ptc on ptc.category_id = s.bw_category_id
  left join negative_topics_by_category ntc on ntc.category_id = s.bw_category_id
  order by r.risk_score desc nulls last, total_mentions desc nulls last
$$;

comment on function get_narratives_table(uuid, date, date, jsonb, uuid, text, timestamptz, text) is
  'Bloco `narratives` do envelope. ÚNICO overload desta function (migration 20260731040000 consolidou dois overloads conflitantes, mantido desde então a cada mudança de aridade). p_scope: null = sem filtro extra, ''roots'' = só Category de topo, ''leaves'' = só Subcategory de qualquer Category, ''pautas'' = só Subcategory cuja Category-pai é a Category raiz "Pautas". p_reference_at (default now()): ancora o cálculo de Tendência numa data específica — usado por get_communication_impact. sov_pct/total_mentions: agregados sobre p_period_start..p_period_end (period_agg.vol_current). Denominador de sov_pct: quando p_scope=''pautas'', soma de total_mentions de TODAS as Subcategories ativas de "Pautas" no período (pautas_period_total); em qualquer outro escopo, soma de TODAS as Narrativas do mesmo query_id (query_period_totals). risk_score = greatest(fórmula composta de sentimento+momentum+tendência+alcance+influência+impacto, MAX(feed_events.severity_score) entre eventos ativos da Narrativa) — event-radar (A2) só pode ELEVAR o risco mostrado, nunca derrubá-lo. net_sentiment/sentiment_label: quando o balde Neutro é predominante, o rótulo é sempre ''neutral'' e o score reportado é 0; só quando Neutro não é predominante o skew (positivo-negativo)/(positivo+negativo) decide o rótulo nas 7 faixas de sempre. category_label = nome da Category-pai de bw_categories. p_topic_sort (✅ 2026-08-09, migration 20260809130000, 9º parâmetro, default ''trending''): controla o critério de ranking de tags/positive_topics/negative_topics — ''trending'' usa bw_query_topics.trending (crescimento), ''volume'' usa bw_query_topics.volume (menções absolutas); qualquer outro valor cai no default. tags = top 6 termos/hashtags da Narrativa pelo critério escolhido, sem filtro de sentimento. positive_topics/negative_topics: top 5 termos/hashtags cujo sentimento predominante (maioria dos 3 contadores de bw_query_topics) é positivo/negativo, mesma classificação de get_term_signals aplicada por Narrativa, mesmo critério de ranking escolhido via p_topic_sort.';
