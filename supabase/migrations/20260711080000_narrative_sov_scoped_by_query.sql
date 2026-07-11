-- Pedido do usuário (2026-07-11): "O SOV corresponde a: Menções da
-- Narrativa / Total de Menções. Verifique se estamos seguindo esse
-- conceito... Se houver alguma divergência, corrija."
--
-- Achado: havia, sim, uma divergência real. `fetchNarrativeCategoryIds()`
-- devolvia TODAS as Narrativas do Project (via bw_categories), pra
-- QUALQUER Query sendo sincronizada — sem noção de qual Query cada
-- Category pertence. Isso já era um desperdício de orçamento (uma Query
-- filtrando por Categories de candidatos alheios), mas o problema real
-- estava em refresh_narrative_metrics(): o join com bw_query_metrics_daily
-- era só `on q.category_id = n.bw_category_id`, sem restringir `query_id`
-- — se o mesmo category_id aparecesse em bw_query_metrics_daily pra mais
-- de uma Query (exatamente o que passou a acontecer depois que
-- fetchNarrativeCategoryIds() alimentava categoryTargets errados pra cada
-- Query), o "total_mentions" de uma Narrativa podia vir da Query errada.
--
-- Consequência direta pro SOV: `public.narratives_overview` calculava
-- `sov_percent` dividindo pelo total de TODAS as Narrativas da
-- ORGANIZAÇÃO (`org_totals`, agrupado só por organization_id) — correto
-- só na coincidência de a organização ter uma única Query monitorada. Com
-- múltiplos candidatos/Queries no mesmo Project (confirmado no export de
-- dashboard real validado nesta mesma revisão), Narrativas de candidatos
-- diferentes ficariam misturadas no mesmo denominador, produzindo um SOV
-- que não corresponde a "Menções da Narrativa / Total de Menções [da MESMA
-- Query/candidato]" — o conceito correto, conforme o exemplo do usuário
-- (200 mil menções de UM monitoramento, distribuídas em 5 Narrativas
-- somando 100%).
--
-- Correção:
--   1. bw_categories ganha `query_ids` (Brandwatch já devolve isso em
--      GET rulecategories — `queryIds` — sem chamada nova; ver
--      refreshMetadata() em bw-sync/index.ts).
--   2. fetchNarrativeCategoryIds() passa a filtrar por Query (só
--      Categories cujo query_ids contém a Query sendo sincronizada).
--   3. narrative_metrics ganha `query_id`, preenchido só quando a Category
--      da Narrativa está associada a exatamente 1 Query (o padrão
--      recomendado em brandwatch-setup.md; Categories associadas a 0 ou
--      >1 Queries ficam sem narrative_metrics — sem escopo inequívoco,
--      sem estimar).
--   4. `public.narratives_overview`/`reporting.narratives_overview`
--      recalculam sov_percent com o total agrupado por `query_id`, não
--      por `organization_id`.

alter table bw_categories
  add column if not exists query_ids bigint[] not null default '{}';

alter table narrative_metrics
  add column if not exists query_id bigint references bw_queries(id) on delete cascade;

create or replace function refresh_narrative_metrics(
  p_from date default current_date - 1,
  p_to date default current_date - 1
)
returns void
language plpgsql
as $$
begin
  insert into narrative_metrics (
    narrative_id, query_id, metric_date, period, source,
    total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative,
    reach_estimated, engagement_total
  )
  select
    n.id, q.query_id, q.metric_date, 'daily', 'bw_aggregate',
    q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative,
    q.reach_estimate, q.engagement_score
  from narratives n
  join bw_categories bc on bc.id = n.bw_category_id
  join bw_query_metrics_daily q
    on q.category_id = n.bw_category_id
    and q.query_id = any(bc.query_ids)
    and q.metric_date between p_from and p_to
  where n.bw_category_id is not null
    -- Só Categories com exatamente 1 Query associada — evita contagem
    -- dupla se uma Category um dia se aplicar a mais de uma Query (o
    -- schema da Brandwatch permite, mas brandwatch-setup.md documenta e
    -- recomenda sempre 1:1). array_length('{}', 1) é null, então isso
    -- também exclui Categories ainda sem query_ids sincronizado (linhas
    -- de bw_categories anteriores a esta migration, até o próximo
    -- refresh de metadata popular o campo).
    and array_length(bc.query_ids, 1) = 1
  on conflict (narrative_id, metric_date, period) do update set
    query_id = excluded.query_id,
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    reach_estimated = excluded.reach_estimated,
    engagement_total = excluded.engagement_total;
end;
$$;

-- Recalcula o SOV por Query em vez de por organização inteira — ver
-- racional completo no comentário do topo desta migration.
create or replace view public.narratives_overview as
with daily as (
  select narrative_id, query_id, metric_date, total_mentions,
         sentiment_positive, sentiment_neutral, sentiment_negative,
         lag(total_mentions) over (partition by narrative_id order by metric_date) as prev_total_mentions
  from narrative_metrics
  where period = 'daily'
),
query_totals as (
  select metric_date, query_id, sum(total_mentions) as query_total_mentions
  from narrative_metrics
  where period = 'daily' and query_id is not null
  group by metric_date, query_id
)
select
  n.id as narrative_id,
  n.organization_id,
  n.title,
  n.stage,
  n.risk_level,
  d.metric_date,
  d.total_mentions,
  round(100.0 * d.total_mentions / nullif(t.query_total_mentions, 0), 1) as sov_percent,
  round(100.0 * (d.total_mentions - d.prev_total_mentions) / nullif(d.prev_total_mentions, 0), 1) as trend_percent,
  case
    when d.total_mentions = 0 then 'neutral'
    when (d.sentiment_positive - d.sentiment_negative)::numeric / d.total_mentions > 0.2 then 'positive'
    when (d.sentiment_positive - d.sentiment_negative)::numeric / d.total_mentions < -0.2 then 'negative'
    else 'neutral'
  end as sentiment_bucket
from narratives n
join daily d on d.narrative_id = n.id
left join query_totals t on t.metric_date = d.metric_date and t.query_id = d.query_id;

comment on view public.narratives_overview is
  'View usada pela tabela interativa de Narrativas no Executive Overview (via PostgREST/RLS). sov_percent = menções da Narrativa / total de menções de todas as Narrativas da MESMA Query (candidato/monitoramento) no mesmo dia — corrigido 2026-07-11 (antes agrupava por organization_id inteira, misturando Narrativas de Queries/candidatos diferentes quando o Project tem mais de uma Query). Thresholds de sentiment_bucket (±20%) e o bucket de Momentum (calculado no frontend a partir de trend_percent) são placeholders — ver DECISÃO PENDENTE em overview.md.';

create or replace view reporting.narratives_overview as
select * from public.narratives_overview;

comment on view reporting.narratives_overview is
  'Espelho de public.narratives_overview para BI externo via bi_reader (conexão Postgres direta). bi_reader tem bypassrls — enxerga todas as organizações por design (uso interno da Lidi, ver Princípio técnico 6 em _index.md); não confundir com acesso multi-tenant seguro.';
