-- Revisão pedida pelo usuário: "reveja se os dados dessas tabelas [X
-- Themes: Hashtags, Posters, Stories, Emojis] estão sendo corretamente
-- atualizadas pelo bw-sync, pois os dados de uma publicação não está
-- batendo com os dados vindos na integração."
--
-- Auditoria completa (bw-sync/index.ts syncXInsights + get_x_insights):
-- endpoints/parâmetros/nomes de campo conferidos contra
-- developers.brandwatch.com/docs/twitter-insights ao vivo nesta sessão —
-- sem divergência (mesma confirmação já feita em 2026-07-18). Upsert key
-- (`project_id, query_id, category_id_key, insight_type, name,
-- metric_week`) e dedupe (`dedupeByKey`) corretos. Um bug real de leitura
-- encontrado e corrigido abaixo, mais um campo novo pra tornar a
-- staleness visível em vez de silenciosa (a causa mais provável de "não
-- bate": bw-sync só re-sincroniza X Insights a cada 7 dias por par —
-- `isXInsightsStale`, 7*24h —, e a página nunca mostrava desde quando
-- aquele snapshot valia).
--
-- ⚠️ **Bug real: `get_x_insights` agrupava "qual é a semana mais recente"
-- só por `insight_type`, ignorando `category_id`.** Em `scoped`, quando o
-- filtro de Narrativas resolve mais de uma Category ao mesmo tempo
-- (`filter_category_ids` devolvendo 2+ ids — não acontece hoje pela UI
-- atual, que nunca envia mais de uma Narrativa em `filters.narratives`,
-- mas a function precisa estar correta independente disso), a CTE
-- `latest` escolhia UM `max(metric_week)` global pro tipo, igual pra
-- todas as Categories misturadas — qualquer Category cujo último sync
-- caiu num dia diferente do "mais recente" combinado ficava
-- silenciosamente excluída do `ranked` (o `join ... on l.w = s.metric_week`
-- nunca casava as linhas dela). Corrigido: `latest` agora agrupa por
-- `(insight_type, category_id)`, cada Category compara só contra o
-- próprio snapshot mais recente.
--
-- ✅ **Novo: `synced_at` no retorno** — permite ao frontend mostrar "dado
-- de até X dias atrás" em vez de apresentar um número sem contexto de
-- frescor, que é o que mais provavelmente está por trás do relato do
-- usuário (o valor pode estar correto, só desatualizado até 7 dias vs. o
-- que a Brandwatch mostra ao vivo).

drop function if exists get_x_insights(uuid, date, date, jsonb);

create or replace function get_x_insights(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  insight_type text,
  name text,
  label text,
  volume integer,
  tweets integer,
  retweets integer,
  impressions bigint,
  reach_estimate bigint,
  synced_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select xi.*
    from bw_query_x_insights xi
    cross join cat_ids
    where xi.query_id in (select org_query_ids(p_organization_id))
      and (
        (cat_ids.ids is null and xi.category_id is null)
        or xi.category_id = any(cat_ids.ids)
      )
  ),
  latest as (
    select insight_type, category_id, max(metric_week) as w
    from scoped
    group by insight_type, category_id
  ),
  ranked as (
    select
      s.insight_type,
      s.name,
      s.label,
      s.volume,
      s.tweets,
      s.retweets,
      s.impressions,
      s.reach_estimate,
      s.synced_at,
      row_number() over (partition by s.insight_type order by s.volume desc) as rn
    from scoped s
    join latest l
      on l.insight_type = s.insight_type
      and l.category_id is not distinct from s.category_id
      and l.w = s.metric_week
  )
  select insight_type, name, label, volume, tweets, retweets, impressions, reach_estimate, synced_at
  from ranked
  where rn <= 10
  order by insight_type, volume desc
$$;

comment on function get_x_insights(uuid, date, date, jsonb) is
  'Bloco x_insights do envelope (X Themes: hashtags/emoticons/stories/mentioned_authors), só na página authors. "latest" agrupa por (insight_type, category_id) — nunca só insight_type, senão Categories com sync em dias diferentes se excluem mutuamente. synced_at exposto pro frontend mostrar frescor do dado (bw-sync só re-sincroniza a cada 7 dias por par, ver isXInsightsStale em bw-sync/index.ts).';
