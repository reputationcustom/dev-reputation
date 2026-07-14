-- finops/data-model.md — ai_usage_log estava faltando a terceira fonte real
-- de chamada de IA do produto: narrative-summary-composer (2026-07-14,
-- roda a cada 30min via pg_cron, gera narratives.description via Claude).
-- Só event_radar_agent_orchestrator e ai_synthesis_narrative foram
-- instrumentados quando o módulo finops foi criado (20260805000000) — esta
-- terceira função nunca foi revisitada, então seu custo real de IA nunca
-- aparecia no painel /admin/finops, mesmo rodando na cadência mais
-- constante das três (a única sem gate condicional de dado — sempre
-- processa Narrativas "due").

alter table ai_usage_log drop constraint if exists ai_usage_log_source_check;

alter table ai_usage_log add constraint ai_usage_log_source_check
  check (source in (
    'event_radar_agent_orchestrator',
    'ai_synthesis_narrative',
    'narrative_summary_composer'
  ));
