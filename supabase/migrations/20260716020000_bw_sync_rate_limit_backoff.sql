-- Módulo: foundation / bw-sync
-- Bug de produção relatado pelo usuário (2026-07-16): 429 em
-- /data/volume/sentiment/days logo na PRIMEIRA chamada Brandwatch da fase
-- `daily_metrics` de uma invocação — mesmo já com `hasBrandwatchCallBudget()`
-- guardando toda chamada dessa fase desde a correção de 2026-07-13 (ver
-- CLAUDE.md, "foundation gap closure + a production bug fix"). O guard de
-- 25 chamadas é só um contador LOCAL, reiniciado a zero em toda invocação
-- (`brandwatchCallCount = 0` no topo de `Deno.serve`) — ele protege contra
-- uma ÚNICA invocação estourar sozinha o teto, mas não tem nenhuma memória
-- do quanto do orçamento real de 30 chamadas/10min da Brandwatch (que é por
-- Client, não por invocação) já foi gasto por invocações ANTERIORES bem
-- recentes. Uma invocação nova pode começar com orçamento local "cheio"
-- (25/25) e ainda assim tomar 429 na primeira chamada, porque o lado da
-- Brandwatch já estava perto do teto antes dela sequer começar.
--
-- `try_acquire_bw_sync_lock()` (migration 20260711000000) já resolve
-- concorrência (só uma invocação chama a Brandwatch por vez), mas não
-- resolve isto — invocações SEQUENCIAIS de um heartbeat de 15min ainda
-- podem se acumular na mesma janela real de 10min da Brandwatch,
-- especialmente durante testes com "Invoke" manual no Dashboard (já citado
-- como cenário real em CLAUDE.md, "Rate limit budget").
--
-- Fix: `bw_sync_lock` ganha `rate_limited_until` — quando `callBrandwatch()`
-- esgota as 3 tentativas locais em um 429 (ver sync-brandwatch.md, item 8,
-- comportamento inalterado), `runSyncInvocation()` chama
-- `mark_bw_rate_limited()` antes de encerrar, gravando um backoff de 10min
-- (a janela real documentada da Brandwatch — usar um valor fixo em vez de
-- tentar inferir da resposta 429, que na prática não confirma header nenhum
-- de reset, só `retry-after` por tentativa individual, já consumido pelo
-- backoff local entre tentativas). A próxima invocação (mesmo par ou par
-- diferente — o rate limit é por Client, não por par) checa
-- `rate_limited_until` bem no início do handler, antes de mintar token ou
-- reivindicar o lock, e sai cedo (mesmo padrão do gate de
-- BW_SYNC_INTERVAL_HOURS já existente) em vez de repetir a mesma chamada
-- fadada a tomar 429 de novo.

alter table bw_sync_lock
  add column if not exists rate_limited_until timestamptz;

comment on column bw_sync_lock.rate_limited_until is
  'Setado por mark_bw_rate_limited() quando callBrandwatch() esgota as 3 tentativas locais em HTTP 429 — enquanto no futuro, novas invocações de bw-sync saem cedo sem chamar a Brandwatch (ver Deno.serve() em bw-sync/index.ts). Null = sem backoff ativo.';

-- p_seconds default 600 (10min) = a janela real documentada do rate limit
-- da Brandwatch (30 chamadas/10min por Client, ver brandwatch-setup.md §1).
-- greatest(...) preserva o backoff mais distante no futuro se duas
-- invocações tomarem 429 quase ao mesmo tempo (nunca encurta um backoff já
-- em andamento).
create or replace function mark_bw_rate_limited(p_seconds integer default 600)
returns void
language sql
set search_path = public
as $$
  update bw_sync_lock
  set rate_limited_until = greatest(coalesce(rate_limited_until, now()), now() + (p_seconds || ' seconds')::interval)
  where id = true;
$$;
