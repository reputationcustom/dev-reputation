-- Pedido do usuário (2026-07-10):
-- 1) capturar todos os top autores com >100k seguidores como "mais
--    influentes";
-- 2) identificar quem iniciou um post, quem repostou, quem se engajou e
--    quem teve maior participação (comentários e/ou repost);
-- 3) saber o alcance dos posts dos autores mais influentes.
--
-- (1) bw_query_top_authors ganha `followers`/`is_influential`. `followers`
-- vem de `twitterFollowers` (único campo de seguidores confirmado no
-- envelope do endpoint Top Authors, ver mention-metadata-field-definitions
-- e top-authors da Brandwatch — Facebook/Reddit no mesmo endpoint não têm
-- campo de seguidores documentado, só de engajamento/karma). "Todos" os
-- autores com >100k seguidores só é garantido até o limite de retorno do
-- endpoint (`limit=1000`, o máximo documentado — bw-sync agora usa esse
-- valor em vez de 100); a Brandwatch ordena Top Authors por
-- volume/relevância, não por seguidores, então um autor de altíssimo
-- alcance mas baixo volume na Query pode ficar de fora mesmo com o limite
-- máximo — limitação do endpoint, não do código.
--
-- (2) `mentions.mention_role` classifica cada mention como
-- 'original' | 'reply' | 'retweet' a partir de reply_to/retweet_of (já
-- capturados na migration `20260710010000`) — responde "quem iniciou"
-- (mention_role='original', mentions.author) e "quem repostou"
-- (mention_role='retweet', mentions.author = quem fez o repost, não o
-- autor original — Brandwatch só dá a URL do post original em
-- retweet_of, não o autor original propriamente, então não é possível
-- reconstruir o autor originante de um retweet sem resolver essa URL
-- contra outra mention própria, o que não é garantido — ver nota na
-- função abaixo). "Quem se engajou" = qualquer autor com mention
-- (`original`/`reply`/`retweet`) associada à Narrativa/Query — a
-- Brandwatch não expõe curtidas individuais atribuíveis a uma pessoa, só
-- contagem agregada (`mentions.engagement->>'twitterLikeCount'` etc.,
-- recebido pela mention, não uma lista de quem curtiu).
--
-- (3) Função `influential_author_activity()` cruza (1)+(2)+`reach_estimate`
-- por mention — dá, por autor influente, quantas mentions
-- originais/replies/retweets ele tem (participação) e o alcance
-- (soma/máximo) dos posts dele.

alter table bw_query_top_authors
  add column if not exists followers integer,
  add column if not exists is_influential boolean generated always as (coalesce(followers, 0) >= 100000) stored;

create index if not exists idx_bw_query_top_authors_is_influential
  on bw_query_top_authors(project_id, query_id, is_influential) where is_influential;

alter table mentions
  add column if not exists mention_role text generated always as (
    case
      when retweet_of is not null then 'retweet'
      when reply_to is not null then 'reply'
      else 'original'
    end
  ) stored;

create index if not exists idx_mentions_mention_role on mentions(mention_role);

-- Cruza autores influentes (bw_query_top_authors.is_influential) com as
-- mentions deles (join por author_handle_normalized — ambos os endpoints
-- devolvem o mesmo identificador de autor da Brandwatch, mas não há
-- payload real confirmando isso byte a byte, mesma categoria de risco já
-- assumida noutras funções desta leva). category_id null = ranking da
-- Query inteira; passar um category_id filtra pra uma Narrativa.
create or replace function influential_author_activity(
  p_project_id bigint,
  p_query_id bigint,
  p_category_id bigint default null,
  p_min_followers integer default 100000,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_limit integer default 50
)
returns table (
  author text,
  followers integer,
  impact numeric,
  reach_estimate integer,
  total_mentions bigint,
  original_count bigint,
  reply_count bigint,
  retweet_count bigint,
  total_reach bigint,
  max_reach integer
)
language sql
stable
as $$
  -- bw_query_top_authors tem uma linha por autor **por semana**
  -- (metric_week) — sem restringir à leva mais recente antes do join, a
  -- contagem de mentions por autor multiplicaria por semana (fan-out).
  -- `distinct on` pega só o snapshot mais recente por autor.
  with latest_authors as (
    select distinct on (ta.author)
      ta.author, ta.followers, ta.impact, ta.reach_estimate
    from bw_query_top_authors ta
    where ta.project_id = p_project_id
      and ta.query_id = p_query_id
      and ta.category_id_key = coalesce(p_category_id, 0)
      and coalesce(ta.followers, 0) >= p_min_followers
    order by ta.author, ta.metric_week desc
  )
  select
    la.author,
    la.followers,
    la.impact,
    la.reach_estimate,
    count(m.id) as total_mentions,
    count(*) filter (where m.mention_role = 'original') as original_count,
    count(*) filter (where m.mention_role = 'reply') as reply_count,
    count(*) filter (where m.mention_role = 'retweet') as retweet_count,
    coalesce(sum(m.reach_estimate), 0) as total_reach,
    coalesce(max(m.reach_estimate), 0) as max_reach
  from latest_authors la
  left join mentions m
    on m.project_id = p_project_id
   and m.query_id = p_query_id
   and m.author_handle_normalized = lower(la.author)
   and (p_since is null or m.added >= p_since)
   and (p_until is null or m.added < p_until)
  group by la.author, la.followers, la.impact, la.reach_estimate
  order by total_reach desc nulls last
  limit p_limit
$$;
