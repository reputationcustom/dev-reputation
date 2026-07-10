-- Pedido do usuário (2026-07-10): "Importante trazer as métricas por
-- narrativa e por outras dimensões como: engajamento, quantidade de
-- repost, qtde de comentários, etc."
--
-- Dois gaps reais encontrados ao revisar isso:
--
-- 1. `refresh_narrative_metrics()` (que popula `narrative_metrics` — a
--    tabela que a Executive Overview de fato lê, via
--    `public.narratives_overview`) existe desde a migration inicial mas
--    **nunca foi chamada** — não há `pg_cron` agendado pra ela (só existe
--    o comentário "chamada direto pelo pg_cron", sem `cron.schedule`
--    nenhum em nenhuma migration). Ou seja, mesmo com `narratives`
--    populada (fix anterior) e `bw_query_metrics_daily` sincronizada,
--    `narrative_metrics` sempre esteve vazia — não tinha nada calculando
--    os números por trás de cada Narrativa.
-- 2. Mesmo rodando, a função só cobre `total_mentions`/sentimento — não
--    engajamento (likes), repost (retweets/shares) ou comentários. A
--    pesquisa contra a documentação real da Brandwatch (ver commits
--    anteriores) confirmou que os endpoints de chart/aggregate não expõem
--    esses números quebrados por Category (só um `engagementScore`
--    composto, sem discriminar likes/reposts/comments, e nada quebrado
--    por Category de forma confiável) — a única fonte confiável é a
--    mention individual, já capturada em `mentions.engagement` jsonb
--    (migration `20260710010000`). Por isso essas 3 colunas novas são
--    sempre agregação local sobre `mentions` (mesma ressalva de sampling
--    de `reach_estimated`/`top_domain`/`unique_authors`, que já eram
--    assim), mesmo quando `source = 'bw_aggregate'` (que continua sendo a
--    fonte de verdade só pra total_mentions/sentimento).

alter table narrative_metrics
  add column if not exists engagement_total integer,
  add column if not exists repost_count integer,
  add column if not exists comment_count integer;

-- Helpers: somam os campos de engajamento por plataforma presentes em
-- mentions.engagement (ver ENGAGEMENT_FIELDS em bw-sync/index.ts) em 3
-- categorias — Brandwatch não tem um campo genérico, é tudo por rede.
create or replace function mention_engagement_likes(p_engagement jsonb)
returns integer
language sql
immutable
as $$
  select coalesce((p_engagement->>'twitterLikeCount')::int, 0)
       + coalesce((p_engagement->>'facebookLikes')::int, 0)
       + coalesce((p_engagement->>'instagramLikeCount')::int, 0)
       + coalesce((p_engagement->>'tiktokLikes')::int, 0)
       + coalesce((p_engagement->>'linkedinLikes')::int, 0)
       + coalesce((p_engagement->>'blueskyLikes')::int, 0)
$$;

create or replace function mention_engagement_reposts(p_engagement jsonb)
returns integer
language sql
immutable
as $$
  select coalesce((p_engagement->>'twitterRetweets')::int, 0)
       + coalesce((p_engagement->>'facebookShares')::int, 0)
       + coalesce((p_engagement->>'tiktokShares')::int, 0)
       + coalesce((p_engagement->>'linkedinShares')::int, 0)
       + coalesce((p_engagement->>'blueskyReposts')::int, 0)
$$;

create or replace function mention_engagement_comments(p_engagement jsonb)
returns integer
language sql
immutable
as $$
  select coalesce((p_engagement->>'twitterReplyCount')::int, 0)
       + coalesce((p_engagement->>'facebookComments')::int, 0)
       + coalesce((p_engagement->>'instagramCommentCount')::int, 0)
       + coalesce((p_engagement->>'tiktokComments')::int, 0)
       + coalesce((p_engagement->>'linkedinComments')::int, 0)
       + coalesce((p_engagement->>'blueskyReplies')::int, 0)
$$;

-- Reescreve refresh_narrative_metrics: (a) recebe um range [p_from, p_to]
-- em vez de um único dia, pra servir tanto de backfill histórico quanto
-- de refresh incremental; (b) via 1 (bw_category_id) agora também agrega
-- engagement/reach/authors/domain localmente sobre mentions, além do
-- total_mentions/sentimento oficiais — antes essas colunas ficavam null
-- pra qualquer Narrativa com Category (ou seja, todas as de hoje, já que
-- são auto-criadas a partir de Category); (c) via 2 idem, quebrando por
-- dia dentro do range via generate_series.
create or replace function refresh_narrative_metrics(
  p_from date default current_date - 1,
  p_to date default current_date - 1
)
returns void
language plpgsql
as $$
begin
  -- Via 1: total_mentions/sentimento do agregado oficial da Brandwatch
  -- (bw_query_metrics_daily); engagement/reach/authors/domain agregados
  -- localmente sobre as mentions da Narrativa no mesmo dia (mesma
  -- ressalva de sampling que já valia pra reach_estimated/top_domain).
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative,
    unique_authors, reach_estimated, top_domain,
    engagement_total, repost_count, comment_count
  )
  select
    n.id, q.metric_date, 'daily', 'bw_aggregate',
    q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative,
    eng.unique_authors, eng.reach_estimated, eng.top_domain,
    eng.engagement_total, eng.repost_count, eng.comment_count
  from narratives n
  join bw_query_metrics_daily q
    on q.category_id = n.bw_category_id and q.metric_date between p_from and p_to
  left join lateral (
    select
      count(distinct m.author_handle_normalized) as unique_authors,
      sum(m.reach_estimate) as reach_estimated,
      mode() within group (order by m.domain) as top_domain,
      sum(mention_engagement_likes(m.engagement)) as engagement_total,
      sum(mention_engagement_reposts(m.engagement)) as repost_count,
      sum(mention_engagement_comments(m.engagement)) as comment_count
    from narrative_matched_mentions(n.id, q.metric_date::timestamptz, (q.metric_date + 1)::timestamptz) m
  ) eng on true
  where n.bw_category_id is not null
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    unique_authors = excluded.unique_authors,
    reach_estimated = excluded.reach_estimated,
    top_domain = excluded.top_domain,
    engagement_total = excluded.engagement_total,
    repost_count = excluded.repost_count,
    comment_count = excluded.comment_count;

  -- Via 2: agregação local completa (Narrativas só com sinais, sem
  -- bw_category_id) — quebrado por dia dentro do range via generate_series.
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, unique_authors, sentiment_positive, sentiment_neutral,
    sentiment_negative, reach_estimated, top_domain,
    engagement_total, repost_count, comment_count
  )
  select
    n.id, d.metric_date, 'daily', 'mentions_sample',
    count(*),
    count(distinct m.author_handle_normalized),
    count(*) filter (where m.sentiment = 'positive'),
    count(*) filter (where m.sentiment = 'neutral'),
    count(*) filter (where m.sentiment = 'negative'),
    sum(m.reach_estimate),
    mode() within group (order by m.domain),
    sum(mention_engagement_likes(m.engagement)),
    sum(mention_engagement_reposts(m.engagement)),
    sum(mention_engagement_comments(m.engagement))
  from narratives n
  cross join generate_series(p_from, p_to, interval '1 day') as d(metric_date)
  join lateral narrative_matched_mentions(
    n.id, d.metric_date::timestamptz, (d.metric_date + 1)::timestamptz
  ) m on true
  where n.bw_category_id is null
  group by n.id, d.metric_date
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    unique_authors = excluded.unique_authors,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    reach_estimated = excluded.reach_estimated,
    top_domain = excluded.top_domain,
    engagement_total = excluded.engagement_total,
    repost_count = excluded.repost_count,
    comment_count = excluded.comment_count;
end;
$$;

-- Backfill único, imediato, cobrindo o mesmo histórico configurado pro
-- resto da integração (default de BRANDWATCH_MENTIONS_START_DATE) — sem
-- isso, narrative_metrics só começaria a ganhar linhas dali pra frente,
-- via o cron recorrente abaixo, e o histórico Jan-Jul ficaria sem números
-- até o próximo pg_cron pegar o range inteiro de novo.
select refresh_narrative_metrics('2026-01-01'::date, current_date);

-- Agendamento recorrente. Diferente de bw-sync (bloqueado em pg_cron real
-- até o cache de token no Vault existir — ver CLAUDE.md), esta função não
-- chama a Brandwatch, só agrega dado já sincronizado — sem implicação de
-- rate limit, pode rodar em pg_cron desde já.
--
-- Cobre um range largo (últimos ~210 dias, > que o histórico configurado
-- desde 2026-01-01) a cada execução, não só "ontem", porque o backfill de
-- mentions/bw_query_metrics_daily pelo bw-sync ainda está em andamento
-- (invocações manuais, sem pg_cron próprio ainda) — um range só de "ontem"
-- deixaria dias antigos que acabaram de ganhar dado (via bw-sync) sem
-- nunca serem reprocessados aqui. Revisar esse range pra algo mais estreito
-- (ex: só os últimos 2-3 dias) quando o backfill de mentions estiver
-- confirmadamente completo e bw-sync estiver num cron estável.
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'refresh_narrative_metrics_hourly',
  '0 * * * *',
  $$select refresh_narrative_metrics(current_date - 210, current_date)$$
);
