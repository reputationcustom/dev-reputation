-- Pedido do usuário (2026-07-10/11), citado quase literalmente porque vira
-- premissa do projeto daqui pra frente: "Retire os cálculos locais
-- baseados em mentions, pois não fará sentido. Se tem na Brandwatch
-- mantém, se não tem, não faça cálculo local confiando na mentions, pois
-- não reflete a realidade, é apenas uma amostra. Isso deve ser premissa."
--
-- `mentions` é uma amostra em Queries de alto volume (`sampled`/
-- `samplePercentage` em `bw_queries` — ver CLAUDE.md, "Volume/sentiment
-- numbers must never be derived by summing locally synced mentions").
-- Várias features das últimas duas levas (`20260710030000`,
-- `20260710040000`, `20260710060000`, `20260710050000`) somavam/contavam
-- sobre `mentions` como se fosse a população inteira pra preencher gaps
-- que a Brandwatch não expõe como agregado oficial — exatamente o que o
-- usuário pediu pra parar de fazer. Removido:
--
-- 1. `refresh_narrative_metrics()` via 1 (Narrativas com bw_category_id):
--    para de fazer LEFT JOIN LATERAL contra `narrative_matched_mentions()`
--    pra computar `unique_authors`/`top_domain`/`repost_count`/
--    `comment_count`/fallback local de reach/engagement. Só usa
--    `bw_query_metrics_daily` (agregado oficial, não amostrado) — se um
--    campo não existe lá (reach_estimate/engagement_score só populados
--    depois que bw-sync roda `data/reachEstimate|engagementScore/
--    categories/days`), fica `null` até existir, nunca estimado.
-- 2. `refresh_narrative_metrics()` via 2 (Narrativas só com
--    narrative_signals, sem bw_category_id) — **removida inteiramente**.
--    Não existe nenhum agregado oficial da Brandwatch pra uma Narrativa
--    sem Category vinculada; a via antiga estimava tudo (total_mentions
--    incluso) contando `mentions` amostradas e apresentava como se fosse
--    dado real. Consequência aceita: Narrativa sem `bw_category_id` não
--    tem `narrative_metrics` — sem dado oficial, sem número nenhum, em vez
--    de um número que não reflete a realidade.
-- 3. `bw_query_topics.engagement_total`/`reach_estimated` (migration
--    `20260710060000`) e a função `refresh_topic_engagement_reach()` —
--    removidos. Cruzavam `insights_hashtag` contra `mentions` pra estimar
--    engajamento/alcance de tópicos hashtag; mesmo problema de amostragem.
-- 4. `influential_author_activity()` — removida. Os campos que faziam
--    sentido manter (`followers`/`is_influential`/`impact`/
--    `reach_estimate` — todos vindos direto de `data/volume/
--    topauthors/queries`, agregado oficial não amostrado) já existem como
--    colunas de `bw_query_top_authors`, consultáveis direto sem função
--    nenhuma. `original_count`/`reply_count`/`retweet_count`/
--    `total_reach`/`max_reach` — essas sim eram soma/contagem sobre
--    `mentions` amostradas, removidas.
-- 5. `narrative_metrics.unique_authors`/`top_domain`/`repost_count`/
--    `comment_count` — colunas removidas (nada mais as popula; mantê-las
--    sempre `null` sugeriria um dado que nunca vai existir).
--
-- Mantido deliberadamente: `mentions.mention_role` (classificação
-- individual de uma mention já capturada — `original`/`reply`/`retweet` —
-- não é uma soma/contagem sobre a amostra tentando representar um total,
-- é um fato sobre aquela mention específica) e `narrative_matched_mentions()`
-- (utilitário de filtro, não usado mais por `refresh_narrative_metrics`,
-- mas continua a definição canônica de "quais mentions batem com uma
-- Narrativa" pra uso futuro de drill-down, ex: Intelligence Center).

drop function if exists refresh_topic_engagement_reach(bigint, bigint, bigint);
drop function if exists influential_author_activity(bigint, bigint, bigint, integer, timestamptz, timestamptz, integer);

alter table bw_query_topics
  drop column if exists engagement_total,
  drop column if exists reach_estimated;

alter table narrative_metrics
  drop column if exists unique_authors,
  drop column if exists top_domain,
  drop column if exists repost_count,
  drop column if exists comment_count;

create or replace function refresh_narrative_metrics(
  p_from date default current_date - 1,
  p_to date default current_date - 1
)
returns void
language plpgsql
as $$
begin
  -- Única via: agregado oficial da Brandwatch, Narrativas com
  -- bw_category_id (todas as auto-criadas hoje). Sem join com `mentions`
  -- — reach_estimate/engagement_score ficam null até bw-sync sincronizar
  -- (data/reachEstimate|engagementScore/categories/days), nunca estimados
  -- localmente.
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative,
    reach_estimated, engagement_total
  )
  select
    n.id, q.metric_date, 'daily', 'bw_aggregate',
    q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative,
    q.reach_estimate, q.engagement_score
  from narratives n
  join bw_query_metrics_daily q
    on q.category_id = n.bw_category_id and q.metric_date between p_from and p_to
  where n.bw_category_id is not null
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    reach_estimated = excluded.reach_estimated,
    engagement_total = excluded.engagement_total;
end;
$$;

-- mention_engagement_likes/reposts/comments não têm mais chamador (eram
-- usadas só pelas duas vias removidas acima) — removidas.
drop function if exists mention_engagement_likes(jsonb);
drop function if exists mention_engagement_reposts(jsonb);
drop function if exists mention_engagement_comments(jsonb);
