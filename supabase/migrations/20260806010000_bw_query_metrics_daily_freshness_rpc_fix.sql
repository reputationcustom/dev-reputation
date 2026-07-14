-- bw-sync — bug real de produção encontrado via log colado pelo usuário
-- ("os dados não estão sendo atualizados completamente, o pipeline da
-- bw_sync não executa completamente"). Sintoma no log: toda invocação da
-- fase `daily_metrics` reprocessa exatamente as MESMAS 8 categoryIds
-- (32827164, 32844977, 32844976, 32752127, 32752126, 32827165, 32827163,
-- 32752234) a cada heartbeat de 15min, sempre termina em
-- `invocation:step_done {"stayOnStep":true}` sem nunca avançar pra
-- `hourly_metrics`/`topics`/`top_authors`/etc — e cada invocação, sozinha,
-- já empurra o uso real da Brandwatch perto do teto (27/30), fazendo o
-- gate proativo (20260721020000) pular a invocação seguinte inteira
-- ("brandwatch_rate_limit_near_ceiling"). Ou seja: o pipeline nunca sai da
-- fase `daily_metrics`, e mesmo dentro dela nunca sobra orçamento pra
-- `syncCategoryDailyMultiAggregate`/`syncQueryDailyMultiAggregate`/
-- `syncPlatformMultiAggregate` (as últimas chamadas da própria fase) — o
-- resto do pipeline (fases seguintes) nunca chega a rodar.
--
-- Causa raiz: `fetchDailySentimentFreshness()` (bw-sync/index.ts, usada
-- pelo throttle de burst da 2026-07-22 — "MAX_SENTIMENT_TARGETS_PER_INVOCATION")
-- decide quais Narrativas pular (já sincronizadas há menos de
-- `DAILY_SENTIMENT_FRESH_WINDOW_MS` = 25min) fazendo:
--
--   select category_id, synced_at from bw_query_metrics_daily
--   where project_id = ... and query_id = ... and category_id in (...)
--
-- sem `.order()` nem `.limit()`, e computando o MAX(synced_at) por
-- categoria no lado do client (TypeScript). Essa organização tem mais de 8
-- Narrativas ativas para esta Query, e `bw_query_metrics_daily` acumula
-- histórico indefinidamente por design (CLAUDE.md, "Data storage is
-- historical by design") — desde 2026-01-01, ~196 dias por categoria. Com
-- mais de 8 categorias × ~196 linhas cada, essa query facilmente devolve
-- mais de 1000 linhas — e `supabase/config.toml` já fixa `max_rows = 1000`
-- (o limite padrão do PostgREST). Sem `ORDER BY`, o Postgres não garante
-- NENHUMA ordem específica para as linhas devolvidas antes do corte de
-- 1000 — então, para categorias cujas linhas mais recentes (as que
-- realmente importam para o cálculo de frescor) ficam fora das primeiras
-- 1000 devolvidas, o `MAX(synced_at)` calculado no client fica incompleto
-- ou ausente, fazendo essas categorias parecerem SEMPRE "não sincronizadas
-- recentemente" — mesmo tendo sido sincronizadas há poucos segundos. Como
-- o loop processa `narrativeCategoryIds` em ordem fixa e capa em
-- `MAX_SENTIMENT_TARGETS_PER_INVOCATION = 8`, as mesmas primeiras 8
-- categorias afetadas por esse corte são reprocessadas para sempre, e as
-- categorias além da 8ª nunca chegam a ser tentadas.
--
-- Fix: substitui a query bruta (sujeita ao corte de linhas do PostgREST)
-- por uma function agregada — `GROUP BY category_id` no próprio Postgres
-- devolve no máximo `len(category_ids)` linhas, nunca mais que isso,
-- imune ao `max_rows` independentemente de quanto histórico a tabela
-- acumule. bw-sync (chave secreta, bypassa RLS) passa a chamar via
-- `.rpc(...)` em vez de `.from(...).select(...)`.

-- `set local` — escopado só a esta transação de migration (mesmo padrão
-- de 20260803000000): a tabela já acumula histórico sem poda, então o
-- `CREATE INDEX` abaixo pode legitimamente demorar mais que o
-- `statement_timeout` padrão da sessão.
set local statement_timeout = '15min';

-- Índice de suporte pro `GROUP BY category_id` / `MAX(synced_at)` da
-- function nova — sem ele, a mesma classe de problema de performance já
-- corrigida em 20260803000000 (tabela grande, sem índice cuja coluna
-- líder sirva o filtro real) se repetiria aqui, só que sem estourar em
-- erro (um `GROUP BY` sem índice adequado apenas fica lento, não falha) —
-- prevenção, não reação a um segundo incidente.
create index if not exists bw_query_metrics_daily_project_query_category_synced_idx
  on bw_query_metrics_daily (project_id, query_id, category_id, synced_at desc);

-- Devolve, para cada category_id pedido, o synced_at mais recente já
-- upsertado em bw_query_metrics_daily para o par (project_id, query_id) —
-- no máximo len(p_category_ids) linhas, nunca sujeito a paginação/corte.
-- `stable` (não `security definer`): só lê uma tabela org-scoped, chamada
-- sempre pela Edge Function (chave secreta, já bypassa RLS por outro
-- caminho) — nunca pelo client autenticado.
create or replace function bw_query_metrics_daily_category_freshness(
  p_project_id bigint,
  p_query_id bigint,
  p_category_ids bigint[]
)
returns table (
  category_id bigint,
  latest_synced_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    d.category_id,
    max(d.synced_at) as latest_synced_at
  from bw_query_metrics_daily d
  where d.project_id = p_project_id
    and d.query_id = p_query_id
    and d.category_id = any(p_category_ids)
  group by d.category_id
$$;

comment on function bw_query_metrics_daily_category_freshness(bigint, bigint, bigint[]) is
  'Frescor por categoria (MAX(synced_at)) para o throttle de bw-sync (daily_metrics/sentimento) — agregado no Postgres para nunca ser truncado pelo max_rows do PostgREST, diferente da select bruta que substituiu (ver 20260806010000).';
