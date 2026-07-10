-- Gap encontrado ao testar bw-sync com BRANDWATCH_MENTIONS_START_DATE=2026-01-01:
-- 20260707000000 só criou partições de mentions para o mês do deploy
-- (2026-07) e o seguinte (2026-08) — "select create_mentions_partition(...)"
-- rodou só 2x. Qualquer mention com mention_date fora desse range (ex: um
-- histórico de janeiro/26, que é exatamente o que pedimos pra trazer) falha
-- com "no partition of relation \"mentions\" found for row".

-- bw-sync agora chama create_mentions_partition(...) via supabase.rpc() em
-- tempo de execução (SUPABASE_SECRET_KEY = role service_role). A função
-- original não era security definer, então dependia dos grants de DDL do
-- service_role sobre o schema public, que não são garantidos por padrão.
-- Mesmo padrão de auth_organization_ids() (ver comentário na migration
-- inicial): security definer + search_path fixo evita depender de grants do
-- chamador e evita sequestro de função via search_path malicioso.
create or replace function create_mentions_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  partition_start date := date_trunc('month', p_month)::date;
  partition_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  partition_name  text := 'mentions_' || to_char(partition_start, 'YYYY_MM');
begin
  execute format(
    'create table if not exists %I partition of mentions for values from (%L) to (%L)',
    partition_name, partition_start, partition_end
  );
end;
$$;

grant execute on function create_mentions_partition(date) to service_role;

-- Backfill: garante uma partição por mês de 2026-01 até 2026-12 (cobre o
-- default de BRANDWATCH_MENTIONS_START_DATE e o ano corrente inteiro).
-- Meses futuros além disso são criados dinamicamente pelo próprio bw-sync
-- (ver ensureMentionPartitions() em index.ts) — não depende de pg_cron.
select create_mentions_partition(d::date)
from generate_series('2026-01-01'::date, '2026-12-01'::date, interval '1 month') as d;
