-- Pendência de foundation #3 (.dev/specs/_pending.md, "Gaps técnicos" —
-- especificada em foundation/data-model.md §3 e passo 5 de
-- foundation/sync-brandwatch.md): busca seletiva de full_text (top-N por
-- Narrativa/dia, fontes não-redigidas). Nenhuma coluna nova é necessária —
-- `mentions.full_text` já existe desde a migration inicial, só ficava
-- sempre null. Esta migration só adiciona a nova fase `full_text_enrichment`
-- (bw-sync/index.ts, entre `demographics` e `sov`) à constraint de
-- sync_cursors.next_step.

alter table sync_cursors drop constraint if exists sync_cursors_next_step_check;
alter table sync_cursors
  add constraint sync_cursors_next_step_check
  check (next_step in (
    'metadata', 'mentions', 'daily_metrics', 'hourly_metrics', 'weekly_monthly', 'topics',
    'platform_by_narrative', 'x_insights', 'top_authors', 'top_tweeters',
    'author_enrichment', 'top_sites', 'top_shared_sites', 'demographics',
    'full_text_enrichment', 'sov'
  ));
