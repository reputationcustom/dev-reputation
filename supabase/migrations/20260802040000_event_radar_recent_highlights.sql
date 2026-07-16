-- event-radar/frontend-highlights-feed.md — widget "Radar de Eventos"
-- (Visão Geral, últimas 72h fixas, independente do período do header).
--
-- get_recent_highlights: leitura pura de feed_events numa janela de tempo
-- FIXA (nunca o período selecionado na página) — distinta de
-- get_active_highlights (aggregated-metrics/sql-aggregation.md), que é
-- escopada pelo período/filtros de cada página. As duas convivem servindo
-- propósitos diferentes, nunca reimplementam a mesma coisa uma da outra.
--
-- Diferente de get_active_highlights, esta function devolve `id`/
-- `created_at`/`closed_at` — necessários pro frontend calcular "há Xh",
-- ordenar cronologicamente e vincular feedback (`feed_event_feedback.
-- feed_event_id`). O tipo `Highlight` do envelope padrão não tem esses
-- campos (standard-json-envelope.md) — este widget usa sua própria forma
-- de resposta, não reaproveita `Highlight`/o bloco `highlights` genérico.
--
-- Chamada direto do client autenticado (supabase-js), sem Edge Function —
-- decisão tomada nesta migration (estava em aberto no spec): esta consulta
-- não depende de período/filtros do header como o resto do envelope de
-- página, então o padrão já usado por `use-narratives-list.ts`/
-- `use-communication-types.ts` (leitura direta via RLS) se aplica igual
-- aqui. `security invoker` (default) garante que a RLS de `feed_events`
-- (`feed_events_select_org`) segue valendo para o usuário real.
create or replace function get_recent_highlights(
  p_organization_id uuid,
  p_hours integer default 72,
  p_limit integer default 10
)
returns table (
  id uuid,
  event_type text,
  severity severity_level,
  severity_score numeric,
  title text,
  summary text,
  explanation text,
  recommendation text,
  confidence numeric,
  tags text[],
  related_narrative_id uuid,
  related_entity_id uuid,
  created_at timestamptz,
  closed_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    fe.id,
    fe.event_type,
    fe.severity,
    fe.severity_score,
    fe.title,
    fe.summary,
    fe.description as explanation,
    fe.recommendation,
    fe.confidence,
    coalesce(fe.tags, '{}'),
    fe.related_narrative_id,
    fe.related_entity_id,
    fe.created_at,
    fe.closed_at
  from feed_events fe
  where fe.organization_id = p_organization_id
    and fe.created_at >= now() - make_interval(hours => p_hours)
  order by fe.created_at desc
  limit p_limit
$$;

comment on function get_recent_highlights(uuid, integer, integer) is
  'Widget "Radar de Eventos" (frontend-highlights-feed.md) — leitura pura de feed_events numa janela FIXA de p_hours (default 72), nunca o período selecionado na página (distinto de get_active_highlights). Inclui eventos já fechados (closed_at preenchido) de propósito — "o que aconteceu", não "o que está ativo agora". Chamada direto pelo client autenticado, sem Edge Function.';
