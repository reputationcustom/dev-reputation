---
tipo: feature-spec
módulo: sync-console
funcionalidade: pipeline-monitoring
status: pronto
atualizado: 2026-07-15
---

# Funcionalidade: Monitoramento do pipeline `bw-sync`

## Objetivo

Dar ao admin visão contínua do estado do pipeline sem precisar abrir o
Supabase Dashboard/Logs: por par (Projeto, Query), em que fase está
agora, quando foi a última sincronização completa (ciclo fechado), quando
será a próxima (calculada a partir de `BW_SYNC_INTERVAL_HOURS`), se há
lock/rate-limit ativo, e o **histórico completo** de execuções (não só
recente) — pedido original: "acompanhar a fase da integração, quando
rolou, quando será a próxima execução, em que passo que está", com um
follow-up explícito do usuário: "garanta que também seja possível
verificar todas as execuções que ocorreram e quantos registros foram
sincronizados em cada etapa."

## Usuários afetados

Só `is_admin` (mesmo gate de `/admin/users`/`/admin/finops`/`/admin/entities`).

## Fluxo principal

1. Admin abre `/admin/sync-console`.
2. Frontend chama `get-sync-console-status` (sem parâmetros — devolve
   todos os pares da plataforma, mesmo padrão "plataforma inteira" de
   `finops`).
3. A página renderiza, nesta ordem:
   1. Um bloco explicativo fixo, **"Como funciona a integração"** (ver
      "Explicação em linguagem simples" abaixo).
   2. Um bloco de **estado global**: lock de concorrência, backoff de
      rate limit, última leitura de uso de chamadas, intervalo
      configurado.
   3. A **tabela de pares** — 1 linha por par (Projeto, Query), com um
      link "Ver histórico completo →" por linha.
   4. Um widget separado, **"Histórico de execuções"** (ver seção
      dedicada abaixo) — sempre visível na mesma página, não escondido
      atrás de uma segunda tela.
4. Clicar em "Ver histórico completo" numa linha da tabela de pares rola
   até o widget "Histórico de execuções" e pré-seleciona o filtro de Par
   para aquela linha (sem recarregar a página nem perder o resto do
   estado).
5. A tabela de pares (topo) se auto-atualiza periodicamente (polling a
   cada 30s) — o heartbeat roda a cada 1 minuto
   (`foundation/sync-brandwatch.md`), então um estado "parado" por mais
   de ~1-2min sem mudar já é um sinal de atenção para quem está olhando a
   tela. O widget "Histórico de execuções" **não** faz polling automático
   (evitaria resetar a página/filtro enquanto o admin está navegando) —
   só refaz a busca quando o filtro de Par muda, a página muda, ou o
   admin clica em "Atualizar".

## Histórico de execuções (verificar todas as execuções que ocorreram)

> Pedido de follow-up do usuário: "garanta que na sync-console também
> seja possível verificar todas as execuções que ocorreram e quantos
> registros foram sincronizados em cada etapa."

Widget próprio (`WidgetCard` "Histórico de execuções"), abaixo da tabela
de pares, sempre visível na página — nunca escondido dentro de uma linha
expansível (diferente de um primeiro desenho que tinha sido descartado):

- **Filtro "Par"**: `<select>` com "Todos os pares" (default) + 1 opção
  por par cadastrado. Clicar em "Ver histórico completo" numa linha da
  tabela de pares seleciona esse par aqui.
- **Tabela paginada** (`components/ui/pagination.tsx`,
  `DEFAULT_PAGE_SIZE = 10`, regra transversal #6), chamando
  `get-sync-console-history` a cada mudança de página/filtro — nunca uma
  janela fixa tipo "últimas 20": literalmente todo `sync_log` já
  registrado para o filtro atual, navegável até a primeira execução que
  o sistema já fez.
- **Colunas**: Par (Projeto/Query — só quando o filtro é "Todos os
  pares", oculta quando já filtrado a 1 par específico), Fase, Quando
  (`created_at`, mesma disciplina de fuso horário do resto do produto),
  Duração, **Registros sincronizados** (`rows_processed` — ver
  `data-model.md`, "Gap real... `rows_processed`", para a mudança de
  código necessária para esse número ser real em toda fase, não só
  `mentions`), Origem (`trigger_source` — "Automático"/"Manual", com o
  nome do admin quando manual), Resultado (sucesso/erro — `status`), e
  Motivo de parada (`stop_reason`, só preenchido em linhas automáticas).
- Uma linha com `status = 'error'` mostra `error_message` ao passar o
  mouse/tocar (tooltip), mesma linguagem visual de alerta já usada em
  outras tabelas do produto.
- Cabeçalho de tabela `font-bold text-text-primary` (regra transversal
  #7), tooltip "?" em "Registros sincronizados"/"Motivo de parada" (ver
  tabela de tooltips abaixo).

## Explicação em linguagem simples (pedido explícito do usuário)

> Pedido do usuário: "Inclua no frontend uma breve explicação de como
> funciona a integração e coloque tooltips ou (?) nas informações para
> facilitar o entendimento por quem for sustentar isso no dia a dia."
> Esta seção é dirigida a quem vai **operar/dar suporte** a esta tela no
> dia a dia — não necessariamente a mesma pessoa que a construiu — então
> a linguagem evita jargão de implementação sempre que um termo mais
> simples existir.

Um card fixo no topo da página, sempre visível (não escondido atrás de um
"saiba mais", já que o pedido é justamente reduzir a curva de aprendizado
de quem vai sustentar isso), com um texto curto no estilo:

> "A cada minuto, o sistema verifica se algum Projeto/Query da Brandwatch
> está pronto para uma nova rodada de sincronização (o intervalo
> configurado hoje é de **{BW_SYNC_INTERVAL_HOURS} horas**). Cada rodada
> completa passa por 16 etapas, uma de cada vez (volume de menções,
> métricas diárias, tópicos, autores, etc.) — isso existe para nunca
> estourar o limite de chamadas que a Brandwatch permite (30 a cada 10
> minutos). Se uma etapa específica parecer com dado desatualizado ou
> incorreto, use o botão "Executar fase específica" na linha
> correspondente para forçar só aquela etapa a rodar de novo, sem esperar
> o ciclo inteiro."

Este texto é estático (não gerado por IA, não busca dado nenhum) — vive
direto no componente React, mesmo padrão de qualquer texto de UI fixo do
produto.

### Tooltips — um "?" em cada informação não autoexplicativa

Mesmo padrão já usado nos cards de KPI da Visão Geral e nos cabeçalhos de
`NarrativesTable` (Regra transversal #8: "coluna com significado
não-óbvio/computado ganha tooltip de hover", `components/ui/tooltip.tsx`)
— reaproveitado aqui, não reinventado. Toda informação técnica desta tela
ganha um ícone "?" com uma definição em linguagem simples:

| Campo/rótulo | Texto do tooltip |
|---|---|
| "Fase atual" (`next_step`) | "A próxima etapa que este par vai executar quando for a vez dele. O pipeline tem 16 etapas fixas, sempre na mesma ordem — ver a lista completa abaixo." |
| "Última sincronização completa" (`last_synced_at`) | "A última vez que este par terminou as 16 etapas do início ao fim. Enquanto isso não acontece de novo, o par continua acumulando progresso etapa por etapa." |
| "Próxima execução prevista" | "Calculada como: última sincronização completa + intervalo configurado. Se já passou desse horário, o par está 'devido' — a próxima verificação do sistema (a cada 1 minuto) já deve pegá-lo." |
| Badge de status "Travado" (lock) | "Uma sincronização (automática ou manual) está em andamento neste exato momento, para evitar que duas rodadas rodem ao mesmo tempo e disputem o limite de chamadas da Brandwatch." |
| Badge de status "Aguardando limite" (rate limit) | "O sistema recebeu um aviso da Brandwatch de que o limite de chamadas está perto do teto e está pausando novas chamadas por um tempo, para evitar erro. Isso se resolve sozinho." |
| "Uso do limite de chamadas" (`last_rate_limit_used`) | "De um total de 30 chamadas permitidas a cada 10 minutos (regra da própria Brandwatch, compartilhada entre todos os pares), quantas já foram usadas na última verificação." |
| Coluna "Origem" no histórico (`trigger_source`) | "'Automático' = rodou sozinho, no ciclo normal a cada {intervalo}. 'Manual' = um admin forçou essa etapa específica a rodar." |
| Coluna "Motivo de parada" (`stop_reason`, só em linhas automáticas) | "Por que a sequência de etapas parou nesta invocação — sempre um destes 4 motivos: ciclo completo (as 16 etapas terminaram), aguardando (esta etapa ainda tem trabalho pendente para o próximo minuto), limite de chamadas atingido, ou tempo de execução esgotado. Nenhum desses é um erro." |
| Coluna "Registros sincronizados" no histórico (`rows_processed`) | "Quantas linhas essa execução gravou ou atualizou no banco de dados. Um número baixo ou zero não é necessariamente um problema — pode ser que já estivesse tudo em dia (nada de novo para sincronizar naquele momento)." |

### Lista de referência das 16 fases (colapsável)

Um `<details>`/accordion (mesmo padrão já usado em `_design-tokens.md`'s
"Histórico" — expandir só quando alguém realmente quiser o detalhe)
listando as 16 fases na ordem real do dispatcher (`SYNC_STEPS`,
`bw-sync/index.ts`), cada uma com 1 linha dizendo o que sincroniza —
tabela já existe pronta em `foundation/sync-brandwatch.md`, "Execução em
fases"; esta tela só a reproduz em formato compacto para consulta rápida,
sem duplicar a explicação completa (que continua vivendo só naquele
arquivo).

## Cálculo de "Próxima execução prevista"

- Se `sync_cursors.last_synced_at is null` → "Ainda não sincronizado"
  (nunca uma data fantasiosa).
- Senão: `last_synced_at + BW_SYNC_INTERVAL_HOURS`.
  - Se esse instante já passou → "Devido agora — aguardando o próximo
    minuto" (reflete a cadência real do `pg_cron`, `* * * * *`).
  - Se está no futuro → mostra a data/hora absoluta convertida para o
    fuso do usuário (mesma disciplina de `formatDateTime`/
    `useUserProfile().timezone`, regra global "User timezone").

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhum par cadastrado ainda (`sync_cursors` vazia) | `<EmptyState>` explicando que o bootstrap inicial (`ensureBootstrapSeed`) ainda não rodou — sem uma "ação primária" de criar um par manualmente, já que pares só são criados a partir dos secrets `BRANDWATCH_PROJECT_ID`/`BRANDWATCH_QUERY_IDS` |
| Falha ao chamar `get-sync-console-status` | 3 estados padrão loading/error/loaded (regra "Backend communication failures") — nunca spinner infinito |
| Um par está com `status = 'error'` | Linha destacada com a mesma linguagem visual de alerta já usada em outras tabelas do produto; `last_error` visível num tooltip, explicando que é a mensagem técnica bruta do último erro |
| Falha ao chamar `get-sync-console-history` | Mesmo padrão 3-estados, escopado só ao widget "Histórico de execuções" (a tabela de pares acima continua funcionando normalmente mesmo se só o histórico falhar) |
| Nenhuma execução ainda registrada para o filtro selecionado | `<EmptyState>` simples ("Nenhuma execução encontrada para este filtro") — nunca uma tabela vazia sem explicação |

## Interface (UI)

- Segue os padrões transversais já fixados: skeleton loading (regra 1),
  tabela com cabeçalho `font-bold text-text-primary` (regra 7),
  paginação padrão de 10 (`DEFAULT_PAGE_SIZE`, regra 6) no widget
  "Histórico de execuções" (a tabela de pares, no topo, normalmente
  pequena, não precisa paginar hoje — mesma ressalva de sempre, "a regra
  já existe para quando crescer").
- Card explicativo "Como funciona a integração" sempre visível, no topo,
  antes do bloco de estado global e da tabela (ver acima).
- Sem gráfico/série temporal nesta primeira versão — estado atual da
  tabela de pares + histórico completo paginado, suficiente para o
  pedido original.

## Regras de negócio

- Esta tela é só leitura, exceto pelo botão de execução manual (que é
  `manual-step-execution.md`, uma funcionalidade separada, montada na
  mesma página/mesma linha da tabela).
- Nunca expõe segredos (token Brandwatch, credenciais) — só metadados
  operacionais, mesmo princípio já usado nos logs do `bw-sync`
  (`console.log`/`console.error` nunca loga `access_token`).

## Dados envolvidos

- Lê: `sync_cursors`, `bw_sync_lock`, `sync_log`, `bw_projects`/
  `bw_queries` (nomes para exibição), `user_profiles` (nome de quem
  disparou uma execução manual), secret `BW_SYNC_INTERVAL_HOURS` (lido
  pela própria Edge Function via `Deno.env.get`).
- Escreve: nada.

## Permissões

| Ação | Quem pode |
|---|---|
| Ver o console de sincronização | `is_admin` |

## Notificações / Feedback ao usuário

- Falha ao carregar o status: `<ErrorMessage>` com "Tentar novamente"
  (regra transversal, "Backend communication failures").
- Nenhum toast nesta funcionalidade — é uma tela de leitura, sem ação
  que produza efeito colateral (a ação com efeito colateral é
  `manual-step-execution.md`, que sim usa toast).

## Dependências técnicas

- `get-sync-console-status` (nova Edge Function — estado atual dos pares)
- `get-sync-console-history` (nova Edge Function — histórico completo
  paginado, ver `data-model.md`)
- `components/ui/tooltip.tsx` (reaproveitado, sem mudança)
- `components/ui/pagination.tsx` (reaproveitado, `DEFAULT_PAGE_SIZE`)
- `bw-sync/index.ts` — mudança aditiva em `StepResult`/dispatcher para
  que `rows_processed` reflita um número real em toda fase, não só
  `mentions` (ver `data-model.md`, "Gap real... `rows_processed`") —
  pré-requisito para a coluna "Registros sincronizados" do histórico ter
  dado de verdade desde o primeiro deploy

## Referências relacionadas

- [foundation/sync-brandwatch.md](../foundation/sync-brandwatch.md) — o
  pipeline em si, as 16 fases, os 5 gates do fluxo principal
- [sync-console/overview.md](overview.md)
- [sync-console/data-model.md](data-model.md)
- [sync-console/manual-step-execution.md](manual-step-execution.md)
