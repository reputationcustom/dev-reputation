---
tipo: module-overview
módulo: sync-console
status: pronto
atualizado: 2026-07-15
---

# Módulo: Sync Console (observabilidade e controle manual do pipeline Brandwatch)

> 📝 **Spec criada (2026-07-15)**, ainda não implementada — pedido direto
> do usuário: "Como administrador eu quero poder acompanhar a fase da
> integração, quando rolou, quando será a próxima execução, em que passo
> que está. Além disso, quero conseguir executar partes específicas da
> integração, por exemplo: identifiquei que tópicos está inconsistente,
> posso executar apenas essa parte do pipeline." Este módulo **não
> reimplementa nem duplica** a lógica de sincronização em si — `bw-sync`
> (`foundation/sync-brandwatch.md`, `status: implementado`) continua sendo
> a única fonte de verdade de como cada fase funciona. `sync-console` é
> uma camada fina de observabilidade + um gatilho manual em cima do
> pipeline já existente, no mesmo espírito de `finops` ser um painel em
> cima de dado que o produto já produz, não um novo motor de cálculo.

## Objetivo

Dar a administradores da plataforma uma tela dedicada para:

1. **Observar** o estado do pipeline `bw-sync` sem precisar abrir o
   Supabase Dashboard/Logs — por par (Projeto, Query) da Brandwatch: em
   que fase está agora, quando foi a última sincronização completa (ciclo
   fechado das 16 fases), quando está prevista a próxima, se há uma trava
   de concorrência ou de rate limit ativa, e o **histórico completo**
   (não só recente, paginado) de todas as execuções já ocorridas
   (automáticas e manuais), incluindo quantos registros cada uma
   sincronizou.
2. **Executar uma fase específica sob demanda**, para um par (Projeto,
   Query) específico, sem esperar o dispatcher automático alcançar
   aquela fase na rotação normal das 16 fases — cenário motivador
   explícito do pedido: um admin percebe que os dados de "Tópicos" estão
   inconsistentes e quer forçar só aquela fase a rodar de novo, sem
   esperar o ciclo inteiro nem re-sincronizar tudo.

## Por que um módulo próprio, e não uma seção de `foundation`

`foundation` é Sprint 1, deliberadamente "só backend, nenhuma rota
própria" (`_index.md`, tabela de Módulos) — a única UI que os specs desse
módulo preveem é o consumo indireto via `aggregated-metrics`/
`intelligence-center`. Este pedido é uma tela nova, admin-only, que expõe
estado **operacional** do pipeline (não dado de negócio) — mesmo
enquadramento já usado para separar `finops` de `aggregated-metrics`:
"admin-only e global... não faz sentido pedir pro admin escolher qual
organização" (`finops/overview.md`, "Escopo"). `sync-console` segue o
mesmo precedente: módulo transversal, sem Sprint própria, dependente de
`foundation` (lê o estado que `bw-sync` já produz) e de `auth` (gate
`is_admin`), nunca o contrário.

## Escopo: plataforma inteira, não por organização

Mesmo modelo de `/admin/users`/`/admin/finops`/`/admin/entities`: só
`is_admin` (global, não por organização) vê esta tela, e ela lista **todo
par (Projeto, Query) da plataforma** (hoje, MVP de uma única organização,
isso é sinônimo de "tudo"; se o produto ganhar múltiplas organizações
futuramente, cada linha da tabela já mostra o nome do Projeto/Query, o
que basta para o admin identificar a qual organização pertence, sem
precisar de um seletor de organização nesta tela).

## As duas funcionalidades do módulo

| Funcionalidade | Resumo | Spec |
|---|---|---|
| Monitoramento do pipeline | Estado atual por par + histórico completo paginado de todas as execuções (com registros sincronizados por etapa), leitura apenas | [pipeline-monitoring.md](pipeline-monitoring.md) |
| Execução manual de fase | Forçar 1 fase específica para 1 par específico, sob demanda | [manual-step-execution.md](manual-step-execution.md) |

## Relação com `foundation/sync-brandwatch.md`

Este módulo **lê** o estado que `bw-sync` já mantém (`sync_cursors`,
`bw_sync_lock`) e **estende** `sync_log` com colunas novas para que a
tela de histórico tenha o que mostrar (ver `data-model.md`) — nunca
reimplementa as 16 funções `run*Step()` que já existem em
`bw-sync/index.ts`. A execução manual de uma fase específica (ver
`manual-step-execution.md`) reaproveita literalmente essas mesmas
funções, através de uma nova ramificação dentro do próprio `bw-sync`
(nunca uma segunda cópia da lógica de sincronização em outra Edge
Function) — ver a justificativa completa dessa decisão em
`data-model.md`, "Mudança em `bw-sync`".

`sync-brandwatch.md` continua sendo a referência normativa de: a lista
completa das 16 fases e o que cada uma sincroniza, os 5 gates do "Fluxo
principal" (intervalo devido, lock de concorrência, backoff de rate
limit, gate proativo via `x-rate-limit-used`), e o comportamento do
dispatcher (encadeamento de fases por invocação, `stopReason`). Este
módulo não duplica esse conteúdo — só referencia.

## Rotas / Páginas

- `/admin/sync-console` — único destino. Tabela de pares (Projeto, Query)
  com estado atual, um widget separado "Histórico de execuções" (todas as
  execuções já ocorridas, paginado, filtrável por par —
  `pipeline-monitoring.md`) e um botão "Executar fase específica" por
  linha, que abre um modal (`manual-step-execution.md`). Segue o mesmo
  padrão de diretório dos
  outros 3 destinos admin já existentes (`app/(intelligence-center)/admin/{users,finops,entities}/`):
  `page.tsx` + `sync-console-admin-view.tsx` + `types.ts` + modal(s).
- Item de menu "Sincronização" (ou "Pipeline Brandwatch") em
  CONFIGURAÇÕES (`sidebar.tsx`), visível só para `is_admin` — mesmo gate
  de "Administração"/"FinOps".

## Fora de escopo (v1)

- **Editar `BW_SYNC_INTERVAL_HOURS` pela UI.** Continua sendo uma
  operação de secret (`supabase secrets set BW_SYNC_INTERVAL_HOURS=...`),
  fora desta tela — o valor configurado só é **exibido**, somente
  leitura, na tela de monitoramento. Mudar esse mecanismo (de secret para
  uma tabela editável pela UI) é uma decisão de produto separada, não
  pedida nesta sessão.
- **Editar diretamente `sync_cursors`/`bw_sync_lock` pela UI** (ex: um
  botão "resetar `next_step` para `metadata`", ou "forçar liberar o
  lock"). O único mecanismo de intervenção é o previsto em
  `manual-step-execution.md` (rodar 1 fase, sem alterar o cursor da
  rotação automática) — uma edição direta de estado interno é mais
  arriscada (pode deixar o pipeline num estado inconsistente) e não foi
  pedida.
- **Executar mais de uma fase de uma vez, ou "re-rodar o ciclo inteiro
  agora".** O pedido original é especificamente "executar apenas essa
  parte" — um botão de "forçar o ciclo inteiro" reabriria o mesmo risco
  de estouro de orçamento de chamadas que a execução em fases (`next_step`)
  já foi desenhada para evitar (`sync-brandwatch.md`, "Execução em
  fases"). Se esse cenário for pedido no futuro, é uma extensão
  deliberada, não algo a antecipar aqui.
- **Notificação/alerta automático** quando um par fica preso numa fase ou
  acumula erros (ex: e-mail/Slack). Esta tela é *pull* (o admin abre e
  confere), não *push* — mesmo raciocínio já aplicado a `event-radar`
  ("push" automático) vs. `decision-center` ("pull" sob demanda), mas
  aqui nem um "push" foi pedido.
- **Gráfico/série temporal de execuções.** A primeira versão mostra
  estado atual + histórico completo em tabela paginada, suficiente para
  responder "quando rolou / quando será a próxima / em que passo está /
  quantos registros cada execução sincronizou" — sem gráfico.
