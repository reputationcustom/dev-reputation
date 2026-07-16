-- Aperta o heartbeat de `bw-sync` de 15min pra 1min (pedido do usuário,
-- depois de investigar por que rodar o pipeline inteiro uma vez estava
-- levando ~5,5-7h reais, medido via logs de produção — CLAUDE.md, "Análise
-- do log das últimas 3h").
--
-- ⚠️ O heartbeat NUNCA foi o gargalo real — o teto de 30 chamadas/10min da
-- Brandwatch continua sendo o mesmo, e nenhuma mudança de frequência de
-- invocação aumenta esse teto. O que a análise encontrou foi puro
-- desperdício de tempo ocioso: com o heartbeat fixo em 15min
-- (`*/15 * * * *`, migration `20260711020000`), quando a janela de 10min
-- da Brandwatch libera orçamento no minuto 3 (por exemplo), o sistema só
-- percebe isso no próximo múltiplo de 15 — até ~12 minutos de espera pura
-- em cada ciclo de rate-limit, sem nenhuma chamada real acontecendo. Isso
-- foi exatamente o padrão observado no log real: `topics` esgotou o
-- orçamento (rateLimitUsed=27) e o próximo trabalho real só aconteceu
-- ~17 minutos depois, a maior parte disso sendo espera pura, não trabalho.
--
-- Fix: aperta a cadência do heartbeat pra 1min (`* * * * *`) — uma
-- invocação ociosa (sem par devido, ou perto do teto de rate limit) já é
-- barata hoje, `invocation:no_pair_due`/`rate_limit_near_ceiling_skip` só
-- fazem 1-2 leituras no Postgres antes de sair, sem tocar a Brandwatch
-- (confirmado nos próprios logs — "booted (time: 24-46ms)" + poucos ms de
-- checagem). Rodar 15x mais vezes não pesa em custo real, só faz o
-- sistema reagir quase imediatamente assim que a janela da Brandwatch
-- libera, em vez de ficar parado até o próximo múltiplo de 15. Efeito
-- esperado: aproxima o tempo real de uma passagem completa do piso
-- teórico (~2,5-3h, ver CLAUDE.md) — não quebra o teto de 30/10min em si,
-- só elimina o desperdício de espera ociosa em torno dele.
--
-- `BW_SYNC_INTERVAL_HOURS` (secret, controla quando um PAR fica "devido"
-- pra um ciclo novo) e `getSyncStalenessWindowMs()` (janela de frescor por
-- fase, mesmo secret) continuam intocados por esta migration — esta
-- mudança é só a cadência de INFRAESTRUTURA (com que frequência a function
-- é sequer invocada pra checar se há trabalho), não o parâmetro de
-- negócio, exatamente a distinção já registrada no comentário original de
-- `20260711020000`.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'bw-sync-heartbeat'),
  schedule => '* * * * *'
);
