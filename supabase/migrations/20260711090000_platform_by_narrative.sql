-- Pedido do usuário (2026-07-11): "importante que tenhamos share of voice
-- por plataforma, por narrativa e por autores, etc." Autores já era
-- coberto (bw_query_top_authors.volume / bw_query_metrics_daily.
-- total_mentions, mesmo project/query/category/date — sem dado novo,
-- só uma razão calculada). Plataforma por Narrativa não era coberto:
-- bw_query_metrics_daily_by_platform só existia no nível da Query inteira
-- (sem category_id), sem quebra por Narrativa. Ganha category_id/
-- category_id_key (mesmo padrão de bw_query_topics/bw_query_top_authors),
-- reusando o mesmo endpoint já sincronizado (data/volume/pageTypes/days),
-- só adicionando o filtro `category=<id>` já comprovado em outros passos.
--
-- Constraint antiga (unique (project_id, query_id, page_type, metric_date),
-- sem nome explícito na migration original) é localizada dinamicamente via
-- pg_constraint em vez de adivinhar o nome auto-gerado pelo Postgres (que
-- pode vir truncado pelo limite de 63 bytes de identificador).

alter table bw_query_metrics_daily_by_platform
  add column if not exists category_id bigint references bw_categories(id) on delete cascade,
  add column if not exists category_id_key bigint generated always as (coalesce(category_id, 0)) stored;

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'bw_query_metrics_daily_by_platform'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (project_id, query_id, page_type, metric_date)';
  if v_conname is not null then
    execute format('alter table bw_query_metrics_daily_by_platform drop constraint %I', v_conname);
  end if;
end $$;

alter table bw_query_metrics_daily_by_platform
  add constraint bw_query_metrics_daily_by_platform_key
  unique (project_id, query_id, category_id_key, page_type, metric_date);
