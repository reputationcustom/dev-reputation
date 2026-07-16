-- Módulo `finops` — .dev/specs/finops/data-model.md
--
-- Pedido do usuário: painel centralizado de custo de IA (uso real, nunca
-- estimativa) + cadastro de custos extras avulsos/mensais/anuais, com
-- previsão de gasto, pra facilitar o FinOps da plataforma.
--
-- Escopo deliberado: plataforma inteira (todas as organizações somadas),
-- admin-only — mesmo modelo de `/admin/users` (is_admin, não escopado por
-- organização), não o modelo das 5 páginas de análise (organização ativa +
-- período do header). Justificativa: o custo de IA (Anthropic) é cobrado
-- numa única conta da plataforma, não por cliente/organização — não faz
-- sentido escolher "qual organização" pra ver o gasto de IA.
--
-- ⚠️ Deliberadamente SEM tabela de resumo diário materializada + cron
-- (diferente do padrão `bw_query_metrics_daily`/`narrative_metrics` já
-- usado no projeto pra grão diário): aqui o volume esperado é
-- minúsculo (poucas dezenas de chamadas de IA por dia, no máximo — ver
-- event-radar 1.6 `daily_event_cap` = 15/organização/dia), então uma
-- consulta live agrupada por dia sobre `ai_usage_log` é trivial em
-- performance e sempre exata, sem o custo de manter um job/tabela extra em
-- sincronia. O padrão de grão diário materializado existe no projeto pra
-- evitar re-consultar uma API externa com rate limit (Brandwatch) — nenhuma
-- dessas duas razões se aplica aqui, já que `ai_usage_log` é local,
-- permanente (sem job de retenção/poda, mesma filosofia de
-- `bw_query_metrics_daily` etc.) e barato de escanear. "Atualizada
-- diariamente" (pedido do usuário) é satisfeito por construção: a página
-- lê direto de `ai_usage_log`, que é gravado em tempo real a cada chamada
-- de IA — nunca há atraso de um job noturno.

-- =========================================================================
-- 1. ai_usage_log — registro de uso REAL de IA, uma linha por chamada
--    (nunca estimativa) — gravado a partir do `usage.input_tokens`/
--    `usage.output_tokens` que a própria API da Anthropic retorna, nos
--    dois pontos do produto que chamam Claude: `event-radar-agent-
--    orchestrator` (event-radar 1.4) e a Camada 1 de `ai-synthesis`
--    (`composeLayer1NarrativeText`, aggregated-metrics-service.ts).
-- =========================================================================

create table if not exists ai_usage_log (
  id                uuid primary key default gen_random_uuid(),
  source            text not null check (source in ('event_radar_agent_orchestrator', 'ai_synthesis_narrative')),
  model             text not null,
  input_tokens      integer not null check (input_tokens >= 0),
  output_tokens     integer not null check (output_tokens >= 0),
  -- Custo calculado no momento da gravação, com o preço vigente naquele
  -- instante (constantes duplicadas em cada Edge Function que chama
  -- Claude, Princípio técnico 5) — um registro antigo preserva o preço
  -- histórico mesmo que o preço do modelo mude no futuro, sem precisar de
  -- uma tabela de preços versionada (nenhum histórico de mudança de preço
  -- existe hoje pra justificar essa complexidade).
  cost_usd          numeric(12, 6) not null check (cost_usd >= 0),
  organization_id   uuid references organizations(id) on delete set null,
  -- Rastreabilidade livre (ex: radar_staging_events.id, ou "<page>:<período>"
  -- pra ai_synthesis) — nunca usado em filtro/agregação, só depuração.
  reference_id      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_ai_usage_log_created_at on ai_usage_log(created_at);

create trigger set_updated_at
  before update on ai_usage_log
  for each row execute function set_updated_at();

alter table ai_usage_log enable row level security;

-- Sem acesso direto — só a Edge Function `get-finops-overview` (chave
-- secreta, admin-only, checado no handler) lê; as duas Edge Functions que
-- geram uso (event-radar-agent-orchestrator, get-page-*/get-narrative-
-- detail via composeAndPersistLayer1) gravam com a chave secreta também,
-- nunca pelo client. Mesmo padrão de bw_sync_lock/sync_cursors/sync_log
-- (20260713070000).
create policy "ai_usage_log: sem acesso direto"
  on ai_usage_log for all using (false);

-- =========================================================================
-- 2. manual_costs — custos extras cadastrados manualmente pelo admin
--    (infraestrutura, ferramentas, contratos, etc.) fora do que
--    `ai_usage_log` já cobre automaticamente.
-- =========================================================================

create type finops_cost_recurrence as enum ('one_time', 'monthly', 'annual');

create table if not exists manual_costs (
  id              uuid primary key default gen_random_uuid(),
  description     text not null,
  amount_usd      numeric(12, 2) not null check (amount_usd >= 0),
  recurrence      finops_cost_recurrence not null,
  -- one_time: a data em que o custo é/foi incorrido. monthly/annual: data
  -- de início da recorrência.
  effective_date  date not null,
  -- Opcional — quando um custo recorrente deixa de valer. null = ainda em
  -- vigor (sem data de fim conhecida).
  end_date        date,
  created_by      uuid references user_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint manual_costs_end_date_after_effective
    check (end_date is null or end_date >= effective_date)
);

create trigger set_updated_at
  before update on manual_costs
  for each row execute function set_updated_at();

alter table manual_costs enable row level security;

-- Sem acesso direto — CRUD só via as 3 Edge Functions dedicadas (create/
-- update/delete-finops-manual-cost), todas checando is_admin no handler
-- antes de tocar a tabela (mesmo padrão de admin-invite-user/admin-set-
-- user-role/etc.), nunca RLS de authenticated.
create policy "manual_costs: sem acesso direto"
  on manual_costs for all using (false);

-- =========================================================================
-- 3. get_finops_overview — um único RPC devolvendo tudo que a página
--    precisa (hoje/mês corrente/projeção/tendência diária/custos extras).
--    Retorna jsonb (mesmo padrão de get_dissemination_graph em
--    aggregated-metrics/sql-aggregation.md — a forma mais simples de um
--    único RPC devolver vários blocos heterogêneos numa chamada só).
--
-- Fórmula de projeção (inferência de MVP, documentada aqui por não haver
-- nenhum spec prévio definindo isso — mesmo padrão já usado em
-- event_radar_config()/get_volume_trend):
--   avg_daily_ai_cost_usd = gasto_de_ia_no_mês_corrente / dias_decorridos_no_mês
--   projected_ai_cost_usd = avg_daily_ai_cost_usd × dias_no_mês
--   custos_extras_do_mês = soma de manual_costs ativos neste mês
--     (monthly: valor cheio se o mês está dentro de [effective_date, end_date]；
--      annual: valor/12 nas mesmas condições；
--      one_time: valor cheio se effective_date cai dentro do mês corrente,
--      já incorrido ou ainda programado pro resto do mês)
--   projected_total_month_usd = projected_ai_cost_usd + custos_extras_do_mês
-- =========================================================================

create or replace function get_finops_overview(p_trend_days integer default 30)
returns jsonb
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      (now() at time zone 'utc')::date as today,
      date_trunc('month', (now() at time zone 'utc')::date)::date as month_start,
      (date_trunc('month', (now() at time zone 'utc')::date) + interval '1 month - 1 day')::date as month_end
  ),
  usage_today as (
    select coalesce(sum(l.cost_usd), 0) as cost_usd, count(*) as call_count
    from ai_usage_log l, bounds b
    where (l.created_at at time zone 'utc')::date = b.today
  ),
  usage_month as (
    select
      l.source,
      coalesce(sum(l.cost_usd), 0) as cost_usd,
      coalesce(sum(l.input_tokens), 0) as input_tokens,
      coalesce(sum(l.output_tokens), 0) as output_tokens,
      count(*) as call_count
    from ai_usage_log l, bounds b
    where (l.created_at at time zone 'utc')::date between b.month_start and b.today
    group by l.source
  ),
  usage_month_total as (
    select coalesce(sum(cost_usd), 0) as cost_usd from usage_month
  ),
  trend_days as (
    select generate_series(b.today - (greatest(p_trend_days, 1) - 1), b.today, interval '1 day')::date as day
    from bounds b
  ),
  usage_by_day as (
    select (created_at at time zone 'utc')::date as day, coalesce(sum(cost_usd), 0) as cost_usd
    from ai_usage_log
    group by 1
  ),
  trend as (
    select td.day, coalesce(ubd.cost_usd, 0) as cost_usd
    from trend_days td
    left join usage_by_day ubd on ubd.day = td.day
  ),
  days_elapsed as (
    select
      greatest(extract(day from b.today)::int, 1) as n,
      extract(day from b.month_end)::int as days_in_month
    from bounds b
  ),
  projection as (
    select
      (select cost_usd from usage_month_total) / (select n from days_elapsed) as avg_daily_ai_cost_usd,
      ((select cost_usd from usage_month_total) / (select n from days_elapsed))
        * (select days_in_month from days_elapsed) as projected_ai_cost_usd
  ),
  manual_this_month as (
    select coalesce(sum(
      case
        when m.recurrence = 'monthly'
          and m.effective_date <= b.month_end
          and (m.end_date is null or m.end_date >= b.month_start)
          then m.amount_usd
        when m.recurrence = 'annual'
          and m.effective_date <= b.month_end
          and (m.end_date is null or m.end_date >= b.month_start)
          then m.amount_usd / 12.0
        when m.recurrence = 'one_time'
          and m.effective_date between b.month_start and b.month_end
          then m.amount_usd
        else 0
      end
    ), 0) as cost_usd
    from manual_costs m, bounds b
  )
  select jsonb_build_object(
    'today', jsonb_build_object(
      'cost_usd', (select cost_usd from usage_today),
      'call_count', (select call_count from usage_today)
    ),
    'month_to_date', jsonb_build_object(
      'cost_usd', (select cost_usd from usage_month_total),
      'by_source', coalesce((
        select jsonb_agg(jsonb_build_object(
          'source', source,
          'cost_usd', cost_usd,
          'input_tokens', input_tokens,
          'output_tokens', output_tokens,
          'call_count', call_count
        ))
        from usage_month
      ), '[]'::jsonb)
    ),
    'projection', jsonb_build_object(
      'avg_daily_ai_cost_usd', (select avg_daily_ai_cost_usd from projection),
      'projected_ai_cost_usd', (select projected_ai_cost_usd from projection),
      'manual_costs_this_month_usd', (select cost_usd from manual_this_month),
      'projected_total_month_usd',
        (select projected_ai_cost_usd from projection) + (select cost_usd from manual_this_month),
      'days_elapsed', (select n from days_elapsed),
      'days_in_month', (select days_in_month from days_elapsed)
    ),
    'daily_trend', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(day, 'YYYY-MM-DD'), 'cost_usd', cost_usd) order by day)
      from trend
    ), '[]'::jsonb),
    'manual_costs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'description', description,
        'amount_usd', amount_usd,
        'recurrence', recurrence,
        'effective_date', to_char(effective_date, 'YYYY-MM-DD'),
        'end_date', case when end_date is null then null else to_char(end_date, 'YYYY-MM-DD') end
      ) order by effective_date desc)
      from manual_costs
    ), '[]'::jsonb)
  )
$$;

comment on function get_finops_overview(integer) is
  'finops/data-model.md — painel de FinOps: gasto de IA hoje/mês corrente (uso real, ai_usage_log), projeção de fim de mês, tendência diária (últimos p_trend_days) e custos extras cadastrados (manual_costs). Escopo é a plataforma inteira, não uma organização — chamado só pela Edge Function get-finops-overview (admin-only).';
