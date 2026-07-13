-- Módulo: foundation / bw-sync
-- Pedido do usuário: "tem ocorrido muito esse erro ao executar a bw-sync,
-- resolva em definitivo" — HTTP 429 recorrente em `daily_metrics` (ex:
-- /data/authors/categories/days), mesmo com o backoff reativo já existente
-- (migration `20260716020000`, `bw_sync_lock.rate_limited_until`).
--
-- Esse backoff reativo já evita crash/retentativa infinita, mas só age
-- DEPOIS de 3 tentativas locais já terem esgotado em 429 (até ~60s+ de
-- espera desperdiçada por invocação) — ele nunca impede o 429 de acontecer
-- em primeiro lugar. `callBrandwatch()` já lê o header oficial
-- `x-rate-limit-used` (documentado em brandwatch-setup.md §1, também citado
-- no cliente de referência da skill `brandwatch-api`) desde a implementação
-- original, mas só para log — nunca era usado para decidir se vale a pena
-- continuar chamando. Esse header é a contagem AUTORITATIVA da Brandwatch
-- do quanto do teto de 30 chamadas/10min (por Client) já foi consumido,
-- inclusive por invocações/testes manuais anteriores — muito mais confiável
-- que o contador local `brandwatchCallCount` (que reinicia a zero a cada
-- invocação e não enxerga nada fora dela).
--
-- Esta migration só adiciona onde persistir o último valor observado desse
-- header entre invocações; a lógica de gate (parar de chamar a Brandwatch
-- assim que o uso reportado chegar perto do teto, tanto dentro da mesma
-- invocação quanto ANTES de começar uma nova) vive em bw-sync/index.ts.

alter table bw_sync_lock
  add column if not exists last_rate_limit_used integer,
  add column if not exists last_rate_limit_observed_at timestamptz;

comment on column bw_sync_lock.last_rate_limit_used is
  'Último valor observado do header x-rate-limit-used (contagem real da Brandwatch, 30/10min por Client) ao final de uma invocação de bw-sync. Usado pelo gate proativo no início do handler para decidir se vale a pena sequer mintar token/chamar a Brandwatch de novo antes da janela de 10min girar.';
comment on column bw_sync_lock.last_rate_limit_observed_at is
  'Quando last_rate_limit_used foi observado — só é considerado válido pelo gate se dentro dos últimos 10min (janela real da Brandwatch); passado isso, presume-se que a janela já girou e o valor está obsoleto.';

-- Grava o último uso observado (chamado ao final de toda invocação que
-- efetivamente chamou a Brandwatch, sucesso ou falha). `p_used = null` é
-- ignorado (não sobrescreve um valor anterior com "nada observado").
create or replace function record_bw_rate_limit_usage(p_used integer)
returns void
language sql
set search_path = public
as $$
  update bw_sync_lock
  set last_rate_limit_used = coalesce(p_used, last_rate_limit_used),
      last_rate_limit_observed_at = case when p_used is null then last_rate_limit_observed_at else now() end
  where id = true;
$$;
