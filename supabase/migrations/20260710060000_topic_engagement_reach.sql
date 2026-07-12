-- Pedido do usuário (2026-07-10): "Importante que nos tópicos também tenha
-- o engajamento e o alcance de cada tópico".
--
-- Pesquisa direta contra developers.brandwatch.com/docs/data-topics
-- confirmou: o parâmetro `metrics` de `data/topics` só aceita `volume,
-- percentageVolume, sentiment, gender, trending, timeSeries` — reach e
-- engajamento **não existem** como métrica desse endpoint. Não é uma
-- lacuna do código, é limitação real da API.
--
-- Única forma de aproximar isso: cruzar localmente contra `mentions`. Só
-- é preciso pra `topic_type = 'hashtags'` — dá pra casar
-- `mentions.insights_hashtag` (containment exato `@>`, já com índice GIN)
-- contra o `label` do tópico sem ambiguidade. Pra `words`/`phrases`/
-- `entities`/`people`/`places`/`organisations` não existe correspondência
-- exata e barata (exigiria busca textual fuzzy tipo `ilike` sobre
-- snippet/full_text, o mesmo problema já documentado pra
-- `narrative_signals` do tipo `keyword` — lento e poderia super/
-- subestimar). Por decisão deliberada, esses tipos ficam com
-- `engagement_total`/`reach_estimated` `null` em vez de um número
-- estimado às cegas.

alter table bw_query_topics
  add column if not exists engagement_total numeric,
  add column if not exists reach_estimated integer;

-- Roda depois do upsert de bw_query_topics numa invocação (ver
-- syncTopicsData() em bw-sync/index.ts) — agregação em lote (1 UPDATE),
-- não uma chamada por tópico.
create or replace function refresh_topic_engagement_reach(
  p_project_id bigint,
  p_query_id bigint,
  p_category_id bigint default null
)
returns void
language plpgsql
as $$
begin
  update bw_query_topics t
  set
    engagement_total = agg.engagement_total,
    reach_estimated = agg.reach_estimated
  from (
    select
      t2.id as topic_id,
      sum(
        mention_engagement_likes(m.engagement)
        + mention_engagement_reposts(m.engagement)
        + mention_engagement_comments(m.engagement)
      ) as engagement_total,
      sum(m.reach_estimate) as reach_estimated
    from bw_query_topics t2
    join mentions m
      on m.project_id = t2.project_id
     and m.query_id = t2.query_id
     and m.insights_hashtag @> array[t2.label]
    where t2.project_id = p_project_id
      and t2.query_id = p_query_id
      and t2.category_id_key = coalesce(p_category_id, 0)
      and t2.topic_type = 'hashtags'
    group by t2.id
  ) agg
  where t.id = agg.topic_id;
end;
$$;
