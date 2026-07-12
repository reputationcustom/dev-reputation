-- Dois bugs relatados pelo usuário em teste real (2026-07-10):
--
-- 1. Categories/Tags foram configuradas na Brandwatch DEPOIS do primeiro
--    refresh de metadata de um Project — o primeiro refresh cacheou "zero
--    Categories" e o throttle de needsMetadataRefresh() (24h) não
--    reconsiderava isso, então narratives ficaria vazia por até 24h mesmo
--    com Categories já existindo do lado da Brandwatch. Corrigido em
--    bw-sync/index.ts (needsMetadataRefresh agora também força refresh se
--    bw_categories estiver vazia pro Project) — sem alteração de schema
--    necessária pra esse.
--
-- 2. sync_cursors.last_added_cursor de execuções anteriores ao fix de
--    paginação (commit anterior a este) já tinha avançado pra perto de
--    "agora" — a lógica antiga buscava as mentions mais recentes primeiro
--    (orderDirection=desc) e o cursor pulava direto pra lá, sem nunca
--    varrer o histórico configurado (BRANDWATCH_MENTIONS_START_DATE).
--    Resultado: mesmo com pageSize/paginação corrigidos, resumir a partir
--    desse cursor (ou do MAX(added) já persistido em `mentions`, que tem
--    a mesma leva viciada) continuaria pulando o histórico permanentemente
--    — nenhum dos dois sinais existentes distinguia "já cobri tudo" de
--    "cursor avançou errado por um bug".
--
-- Fix: sync_cursors ganha backfill_completed_at — null significa "ainda
-- não completei um walk ascendente até o presente sob a lógica corrigida".
-- Enquanto null, bw-sync ignora o fallback de MAX(added) em `mentions`
-- (que poderia mascarar o mesmo bug) e confia só em last_added_cursor
-- dentro do próprio walk. Reseta last_added_cursor pra null em todas as
-- linhas existentes, forçando um novo walk completo desde
-- BRANDWATCH_MENTIONS_START_DATE na próxima invocação — seguro porque o
-- upsert de mentions é idempotente (onConflict query_id,resource_id,
-- mention_date), não duplica nada ao re-varrer.

alter table sync_cursors
  add column if not exists backfill_completed_at timestamptz;

update sync_cursors
set last_added_cursor = null,
    backfill_completed_at = null;
