-- Módulo: foundation / aggregated-metrics (narrative-summary-composer)
-- Pedido do usuário (2026-08-06): "incluir algumas mentions da narrativa na
-- IA para que ela inclua no resumo executivo das narrativas uma explicação
-- do que é a narrativa e o que está acontecendo na narrativa, além dos
-- indicadores que já temos."
--
-- Reverte, só para este produtor, a decisão original de
-- narrative_summary_build_payload ("nunca texto bruto de mentions",
-- 20260804010000, mesmo princípio de event_radar_build_agent_payload). O
-- resto do projeto continua proibido de AGREGAR/somar sobre `mentions` pra
-- representar um total (amostrado, não reflete a realidade — CLAUDE.md,
-- "Retire os cálculos locais..."); usar um punhado de mentions reais como
-- contexto QUALITATIVO pra um redator (aqui, a IA) entender do que uma
-- Narrativa trata é uma categoria de uso diferente, já com precedente no
-- próprio projeto via `enrichFullTextForNarrativeDay()`
-- (bw-sync/index.ts, fase full_text_enrichment).
--
-- Fonte: `narrative_matched_mentions()` (foundation/data-model.md — única
-- definição de "mentions desta Narrativa", reusada aqui, nunca
-- reimplementada), mesma janela de 30 dias já usada por `scores` neste
-- mesmo payload (get_narratives_table). Texto = coalesce(full_text,
-- snippet), truncado a 400 caracteres — `snippet` sempre existe (captado em
-- todo poll de mentions), `full_text` só quando já enriquecido pela fase
-- full_text_enrichment de bw-sync; nenhuma chamada nova à Brandwatch, 100%
-- dado já sincronizado localmente. Ranqueado por reach_estimate desc (mesmo
-- critério de "maior alcance primeiro" já usado por
-- enrichFullTextForNarrativeDay), até 8 mentions (mesma ordem de grandeza
-- de FULL_TEXT_ENRICHMENT_TOP_N em bw-sync/index.ts).
--
-- `create or replace` sem `drop function`: assinatura (uuid) e tipo de
-- retorno (jsonb) inalterados — só uma chave nova dentro do objeto jsonb
-- construído, não uma mudança de `returns table`.
create or replace function narrative_summary_build_payload(p_narrative_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', n.title,
    'category_label', coalesce(parent_bc.name, bc.name),
    'scores', (
      select jsonb_build_object(
        'sov_pct', g.sov_pct,
        'total_mentions', g.total_mentions,
        'net_sentiment', g.net_sentiment,
        'sentiment_label', g.sentiment_label,
        'sentiment_positive_pct', g.sentiment_positive_pct,
        'sentiment_neutral_pct', g.sentiment_neutral_pct,
        'sentiment_negative_pct', g.sentiment_negative_pct,
        'momentum_score', g.momentum_score,
        'trend_score', g.trend_score,
        'trend_label', g.trend_label,
        'risk_score', g.risk_score,
        'risk_label', g.risk_label,
        'tags', g.tags,
        'positive_topics', g.positive_topics,
        'negative_topics', g.negative_topics
      )
      from get_narratives_table(
        n.organization_id,
        current_date - 29,
        current_date,
        jsonb_build_object('narratives', jsonb_build_array(n.id)),
        null,
        null,
        now()
      ) g
      limit 1
    ),
    'recent_events', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'title', fe.title, 'summary', fe.summary, 'event_type', fe.event_type,
          'severity', fe.severity, 'created_at', fe.created_at, 'closed_at', fe.closed_at
        ) order by fe.created_at desc), '[]'::jsonb)
      from (select title, summary, event_type, severity, created_at, closed_at
            from feed_events where related_narrative_id = n.id
            order by created_at desc limit 5) fe
    ),
    'recent_communications', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'title', c.title, 'record_type', c.record_type,
          'occurred_at', c.occurred_at, 'channel_detail', c.channel_detail
        ) order by c.occurred_at desc), '[]'::jsonb)
      from (select title, record_type, occurred_at, channel_detail
            from communications where narrative_id = n.id
            order by occurred_at desc limit 5) c
    ),
    'sample_mentions', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'text', x.excerpt,
          'sentiment', x.sentiment,
          'content_source', x.content_source,
          'mention_date', x.mention_date
        ) order by x.reach_estimate desc nulls last, x.mention_date desc), '[]'::jsonb)
      from (
        select
          left(coalesce(nullif(m.full_text, ''), m.snippet), 400) as excerpt,
          m.sentiment,
          m.content_source,
          m.mention_date,
          m.reach_estimate
        from narrative_matched_mentions(
          n.id,
          (current_date - 29)::timestamptz,
          (current_date + 1)::timestamptz
        ) m
        where coalesce(nullif(m.full_text, ''), m.snippet) is not null
        order by m.reach_estimate desc nulls last, m.mention_date desc
        limit 8
      ) x
    )
  )
  from narratives n
  join bw_categories bc on bc.id = n.bw_category_id
  left join bw_categories parent_bc on parent_bc.id = bc.parent_id
  where n.id = p_narrative_id
$$;

comment on function narrative_summary_build_payload(uuid) is
  'Payload agregado enviado à IA pelo job narrative-summary-composer para compor narratives.description: scores via get_narratives_table (últimos 30 dias, mesma fonte da tabela/cards), até 5 eventos recentes do event-radar, até 5 Comunicações/Decisões recentes, e sample_mentions (2026-08-06): até 8 mentions reais da Narrativa (narrative_matched_mentions, mesma janela de 30 dias), texto = coalesce(full_text, snippet) truncado a 400 caracteres, ranqueadas por reach_estimate — contexto QUALITATIVO para a IA explicar do que a Narrativa trata e o que está acontecendo; nunca usar para afirmar proporções/percentuais (amostra pequena, não estatística — para números, usar exclusivamente "scores"). null se a Narrativa não existir.';
