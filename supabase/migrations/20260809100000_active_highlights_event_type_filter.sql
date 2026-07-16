-- aggregated-metrics/sql-aggregation.md, get_active_highlights — pedido do
-- usuário (2026-07-14): "Insights de sentimento estão relacionado aos
-- sentimentos? se não, corrija." Achado real: get_active_highlights não
-- tem nenhum filtro por event_type — o widget "Insights" de /sentiment
-- (e o texto de IA "Mudança de sentimento", que reusa a mesma lista de
-- highlights como contexto) sempre mostrou highlights de QUALQUER tipo
-- (volume_spike/volume_drop/momentum_spike inclusos), não só os
-- relacionados a sentimento (sentiment_change/negative_sentiment_increase/
-- negative_sentiment_spike). Mesma classe de bug de escopo já corrigida
-- pra /themes em 2026-08-09 (Insights lendo a organização inteira em vez
-- de só Pautas), agora fechada aqui via um filtro novo.
--
-- Aridade muda de 4 pra 5 parâmetros — drop explícito da assinatura antiga
-- antes do create or replace (Migration hygiene, CLAUDE.md/_index.md).
drop function if exists get_active_highlights(uuid, date, date, jsonb);

create or replace function get_active_highlights(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_event_types text[] default null
)
returns table (
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
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with narrative_ids as (
    select nullif(array_agg((elem)::uuid), '{}') as ids
    from jsonb_array_elements_text(coalesce(p_filters -> 'narratives', '[]'::jsonb)) as elem
  )
  select
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
    fe.created_at
  from feed_events fe
  cross join narrative_ids
  where fe.organization_id = p_organization_id
    and fe.created_at::date between p_period_start and p_period_end
    and (narrative_ids.ids is null or fe.related_narrative_id = any(narrative_ids.ids))
    and (p_event_types is null or fe.event_type = any(p_event_types))
  order by fe.severity_score desc nulls last, fe.created_at desc
  limit 30
$$;

comment on function get_active_highlights(uuid, date, date, jsonb, text[]) is
  'Bloco `highlights` do envelope (sql-aggregation.md, A1 de event-radar/fluxo-aggregated-metrics.md "Fase B"). Leitura pura de feed_events — nunca recalcula severidade/detecção (essa lógica pertence só ao event-radar). Escopo: organization_id sempre; filters.narratives (quando presente) restringe a related_narrative_id; p_event_types (novo, 2026-07-14) restringe a fe.event_type quando presente — usado por /sentiment pra mostrar só sentiment_change/negative_sentiment_increase/negative_sentiment_spike, nunca volume_spike/volume_drop/momentum_spike. period_start/period_end filtram por feed_events.created_at (data de publicação do card, não a janela de detecção do evento). Sem filtro de closed_at de propósito — um evento fechado dentro do período pedido ainda é um insight relevante pra quem está olhando aquele período. Limit 30: salvaguarda de payload pra períodos multi-dia, o cap diário de 15 eventos/organização (event-radar 1.6) já bounda o volume por dia.';
