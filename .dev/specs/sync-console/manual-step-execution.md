---
tipo: feature-spec
módulo: sync-console
funcionalidade: manual-step-execution
status: pronto
atualizado: 2026-07-15
---

# Funcionalidade: Execução manual de uma fase específica

## Objetivo

Permitir que um administrador force a execução de uma fase específica do
pipeline `bw-sync` para um par (Projeto, Query) específico, sob demanda,
sem esperar o dispatcher automático alcançar aquela fase na rotação
normal — cenário motivador explícito do pedido original: "identifiquei
que tópicos está inconsistente, posso executar apenas essa parte do
pipeline."

## Usuários afetados

Só `is_admin` (mesmo gate de `/admin/users`/`/admin/finops`/`/admin/entities`).

## Fluxo principal

1. Admin abre `/admin/sync-console`, vê a tabela de pares com o estado
   atual de cada um (`pipeline-monitoring.md`).
2. Clica em "Executar fase específica" na linha do par desejado.
3. Modal abre com:
   - Um `<select>` das 16 fases (`SYNC_STEPS`, mesma ordem/rótulos do
     dispatcher).
   - Um resumo de 1 linha do que a fase selecionada sincroniza,
     atualizado ao trocar a seleção (mesma tabela descritiva de
     `foundation/sync-brandwatch.md`, "Execução em fases" — ver também o
     accordion de referência em `pipeline-monitoring.md`).
   - Um "?" (tooltip) ao lado do título do modal explicando, em
     linguagem simples: "Isso roda só a etapa escolhida, agora, fora da
     ordem normal — não altera em que etapa o ciclo automático deste par
     está, nem acelera as próximas etapas dele."
4. Admin confirma. Frontend chama `trigger-sync-step` com
   `{ projectId, queryId, step }`.
5. `trigger-sync-step` valida `is_admin`, valida que o par existe
   (`sync_cursors` tem uma linha para esse `(projectId, queryId)`),
   valida `step` contra a lista de 16 valores válidos, e faz uma chamada
   server-to-server para `bw-sync` com
   `{ manualStep: { projectId, queryId, step, triggeredByUserId } }`.
6. `bw-sync` reconhece `manualStep` no corpo da requisição e entra no
   modo de execução manual (ver `data-model.md`, "Mudança em
   `bw-sync`"): tenta adquirir `bw_sync_lock` (mesmo lock da execução
   automática) — se já travado, devolve erro amigável imediatamente, sem
   tentar de novo sozinho (quem decide tentar de novo é o admin,
   clicando de novo). Verifica os mesmos gates de rate limit (local e o
   proativo via `x-rate-limit-used`) — se o orçamento estiver
   praticamente esgotado, recusa com mensagem explicando o motivo, sem
   gastar nenhuma chamada.
7. Se os gates passarem: monta o contexto necessário para aquela fase
   específica (token Brandwatch, `organizationId`, `categoryTargets`,
   `metricsStartDate`) e chama só a função runner daquela fase (ex:
   `runTopicsStep`) — exatamente a mesma função que o dispatcher
   automático já usa, nunca uma segunda implementação.
8. Grava uma linha em `sync_log` com `trigger_source: 'manual'`, `step`,
   `duration_ms`, `triggered_by_user_id` — **nunca mexe em
   `sync_cursors.next_step`/`last_synced_at`** (regra de negócio
   explícita, ver abaixo).
9. Libera o lock (`finally`), devolve o resultado (sucesso/quantas linhas
   afetadas, ou erro) para `trigger-sync-step`, que repassa para o
   frontend.
10. Frontend mostra o resultado dentro do próprio modal (não só um
    toast que já sumiu) + um toast de confirmação (regra transversal
    #3), e atualiza a tabela (novo fetch de `get-sync-console-status`).

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Usuário não é admin | 403 na Edge Function; UI nunca mostra o botão para não-admin (mesmo padrão de `/admin/users`) |
| `bw_sync_lock` já travado (uma execução automática ou outra manual em andamento) | `trigger-sync-step` devolve erro amigável ("Uma sincronização já está em andamento. Tente novamente em instantes.") — não enfileira, não tenta de novo sozinho |
| Orçamento de chamadas Brandwatch praticamente esgotado | Erro amigável explicando que o limite de chamadas está próximo do teto; sugere tentar de novo em alguns minutos |
| Par `(projectId, queryId)` não existe em `sync_cursors` | 400 — "Par Projeto/Query não encontrado" |
| `step` fora da lista de 16 valores válidos | 400 — validação server-side, nunca confia só no `<select>` do frontend (Princípio técnico 2) |
| A fase em si falha (ex: Brandwatch retorna erro) | Mesmo tratamento de erro que o dispatcher automático já tem — loga o erro real no `console.error`, devolve mensagem genérica amigável para o client (regra "Edge Function error handling"), grava `sync_log` com `status: 'error'`/`error_message` |
| Execução demora mais que o esperado | O mesmo `INVOCATION_TIME_BUDGET_MS` já existente protege o worker; se estourar, a chamada retorna erro de timeout padrão da plataforma — frontend mostra erro genérico + orientação para conferir os logs do Supabase |

## Interface (UI)

- Botão "Executar fase específica" por linha da tabela (não em massa —
  sempre 1 par + 1 fase por vez, decisão deliberada para manter o
  raciocínio "identifiquei X inconsistente, corrijo só X" do pedido
  original, não virar um botão de "re-rodar tudo").
- Modal com select de fase + descrição curta de cada uma + tooltip "?"
  explicando o efeito da ação (ver "Fluxo principal", passo 3) + botão
  "Executar" com spinner enquanto roda (regra transversal #5) —
  desabilitado durante a chamada, nunca clicável 2x.
- Resultado inline no modal (sucesso com contagem, ou erro) antes de
  fechar — não só um toast que já sumiu.

## Regras de negócio

- Execução manual **nunca avança nem retrocede**
  `sync_cursors.next_step`/`last_synced_at` — é sempre um "desvio"
  observável (fica registrado em `sync_log`) que não interfere na
  rotação automática das 16 fases. Motivo: se um admin forçar `topics`
  fora de ordem e isso alterasse o cursor, o próximo heartbeat poderia
  pular ou repetir fases de forma confusa — a rotação automática precisa
  continuar previsível independentemente de quantas execuções manuais
  aconteceram no meio do caminho.
- Execução manual **sempre respeita** lock de concorrência e os gates de
  rate limit — nunca é um "bypass de emergência" que ignora o teto de 30
  chamadas/10min da Brandwatch (motivo: um único Client compartilhado —
  ver `foundation/sync-brandwatch.md`, "Rate limit budget" — uma
  execução manual displicente pode gerar o mesmo tipo de incidente já
  documentado nesse arquivo).
- Sem limite de quantas execuções manuais um admin pode disparar por dia
  (v1) — cada uma já é naturalmente limitada pelo lock (uma de cada vez)
  e pelos gates de orçamento. ⚠️ Se abuso real for observado em
  produção, um cooldown por admin é um candidato natural de v2, mas não
  é implementado nesta primeira versão.
- `bw-sync` continua, para toda invocação **sem** `manualStep` no corpo,
  se comportando exatamente como hoje — nenhuma mudança de comportamento
  para o heartbeat automático.

## Dados envolvidos

- Lê: `sync_cursors` (validação do par), `bw_sync_lock` (gates),
  `bw_categories`/`narratives` (via `fetchNarrativeCategoryIds`, já
  existente).
- Escreve: `sync_log` (1 linha por execução manual), potencialmente as
  mesmas tabelas de dado que a fase escolhida já escreve normalmente
  (ex: `topics` escreve em `bw_query_topics`) — nenhuma tabela nova além
  do já existente.

## Permissões

| Ação | Quem pode |
|---|---|
| Ver a tabela de pares/histórico | `is_admin` |
| Disparar execução manual de uma fase | `is_admin` |

## Notificações / Feedback ao usuário

- Sucesso: toast de confirmação + resultado inline no modal (regra
  transversal #3).
- Erro (qualquer um dos listados em "Fluxos alternativos e erros"):
  toast de erro + mensagem inline no modal, nunca uma falha silenciosa.
- Botão "Executar" desabilitado + spinner durante a chamada (regra
  transversal #5).

## Dependências técnicas

- `trigger-sync-step` (nova Edge Function)
- `bw-sync` (mudança aditiva — novo branch `manualStep`, ver
  `data-model.md`)
- `sync_log` (migration — 5 colunas novas, ver `data-model.md`)

## Referências relacionadas

- [foundation/sync-brandwatch.md](../foundation/sync-brandwatch.md) — o
  pipeline em si, os 16 passos, os runners
- [sync-console/overview.md](overview.md)
- [sync-console/data-model.md](data-model.md)
- [sync-console/pipeline-monitoring.md](pipeline-monitoring.md)
