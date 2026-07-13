---
tipo: module-overview
módulo: communications
status: rascunho
atualizado: 2026-07-25
---

# Módulo: Comunicações e Decisões (Sprint 2.1)

> Pedido do usuário (2026-07-25): "permitir que a equipe de comunicação
> registre as ações associadas a cada narrativa e assim cria-se um
> registro das comunicações realizadas ao longo do tempo para tentar
> mensurar se houve melhora ou piora no sentimento/percepção do público da
> rede referente aquela narrativa." Módulo novo, fora da sequência original
> de Sprint 2 (`_index.md`, "Sequência de implantação — Sprint 2") — daí o
> nome "Sprint 2.1": entra depois que as 5 páginas de `intelligence-center`
> e o backend de `aggregated-metrics` já estão implementados, e depende
> diretamente dos dois.
>
> ✅ **Ampliado, mesma sessão**: "o usuário poderá registrar uma
> comunicação ou uma decisão. Comunicação deve ter os campos já
> documentados e decisão deve ter apenas a data, um título, responsável,
> detalhamento." O módulo passa a cobrir **dois tipos de registro** — ver
> [data-model.md](data-model.md), `communication_record_type` — mas
> continua um módulo só, um formulário só, uma tela só; "Decisão" não é um
> segundo módulo nem uma segunda tela.

## Objetivo

Dar ao time de comunicação um lugar único para registrar **o que foi
feito** a respeito de uma Narrativa — uma **Comunicação** (post no perfil
do candidato, e-mail, propaganda de TV, nota de imprensa, material
impresso, evento presencial etc.) ou uma **Decisão** (o que o time
decidiu fazer ou não fazer, com um registro mais simples: data, título,
responsável, detalhamento) — e, a partir da data de cada uma, acompanhar
se a métrica objetiva da Narrativa (sentimento, volume de menções, risco,
momentum) melhorou ou piorou depois. O produto já mede *o que está
acontecendo* com uma Narrativa (`intelligence-center`); este módulo é o
primeiro a conectar essa medição a **uma ação concreta do time**,
respondendo "isso ajudou ou não?" — sempre como correlação observável,
nunca como prova de causalidade (ver `narrative-impact-tracking.md`,
"Regras de negócio") — para os dois tipos de registro igualmente.

## Relação com `cases` (não confundir)

`cases` (`intelligence-center/data-model.md`, seção "Ações e decisões" do
detalhe de Narrativa) e `communications` (este módulo, incluindo agora o
`record_type = 'decision'`) soam parecidos — os três são "uma
ação/decisão vinculada a uma Narrativa" — mas resolvem problemas
diferentes:

| | `cases` | `communications` (`record_type = 'communication'`) | `communications` (`record_type = 'decision'`) |
|---|---|---|---|
| O que representa | Uma tarefa de resposta, com ciclo de vida (`status`: aberto → em andamento → resolvido) | Um fato já consumado: uma comunicação que **já foi ao ar/publicada** | Uma decisão já tomada — data, título, responsável, detalhamento |
| CRUD pela UI | Não — schema mínimo, somente leitura (gap técnico #20 de `_pending.md`) | Sim, desde a primeira versão | Sim, mesmo formulário/tela de Comunicação |
| Mede impacto? | Não | Sim — é a razão do módulo existir (ver [narrative-impact-tracking.md](narrative-impact-tracking.md)) | Sim, mesmo mecanismo |
| Onde aparece | Seção "Ações e decisões" do detalhe de Narrativa (`intelligence-center`) | Página própria `/communications` (menu "Comunicação") + seção nova no detalhe de Narrativa | Mesma página/seção que Comunicação |

⚠️ **Observação explícita, não uma pendência bloqueante**: com a adição de
"Decisão", a sobreposição conceitual com `cases` ficou mais próxima do
que quando só existia "Comunicação" (ambos agora têm data/título/
responsável/detalhamento como o núcleo do registro). Mantidos como
conceitos separados porque foi um pedido explícito e específico do
usuário dentro deste módulo — não uma fusão dos dois modelos, que
seguiria sendo especulação sem um pedido direto para isso (mesma razão
pela qual `command-center` foi descontinuado como módulo próprio em
`_index.md`, "Módulo `command-center` removido": não inventar uma
abstração maior do que o pedido concreto, nem na direção contrária — não
apagar uma distinção que o usuário pediu especificamente). Se no futuro o
produto quiser unificar `cases`/"Decisão" (ou "Comunicação"), isso é uma
decisão a ser pedida explicitamente, não assumida aqui.

## Funcionalidades

| Funcionalidade | Spec | Status | Depende de |
|---|---|---|---|
| Modelo de dados (`communications`, `communication_types`) | [data-model.md](data-model.md) | rascunho | `foundation` (`narratives`), `auth` (`user_profiles`) |
| Cadastro de Comunicações e Decisões (CRUD) | [communication-registration.md](communication-registration.md) | rascunho | `data-model.md` |
| Acompanhamento pós-comunicação/decisão (linha do tempo de impacto) | [narrative-impact-tracking.md](narrative-impact-tracking.md) | rascunho | `data-model.md`, `aggregated-metrics` (fórmulas de Sentimento/Momentum/Tendência/Risco, `sql-aggregation.md`) |

## Rotas/Páginas (sugestão, não fechada)

| Rota | Página |
|---|---|
| `/communications` | Lista de Comunicações e Decisões registradas (todas as Narrativas da organização) + formulário de cadastro/edição (modal, com seletor "Tipo de registro") |
| `/communications/[narrativeId]` | Acompanhamento pós-comunicação/decisão de uma Narrativa específica — linha do tempo de todos os registros daquela Narrativa com os 4 indicadores antes/depois |

Ambas vivem dentro do route group `(intelligence-center)` (não um shell
próprio) — mesma convenção já aplicada a `/admin/users`/`/perfil` (módulo
`auth`, ver `intelligence-center/overview.md`, "Premissas de shell/layout"
e `_pending.md` item #12): o shell (Sidebar/header/footer fixos) é
propriedade de `intelligence-center`, reaproveitado por qualquer página
autenticada nova, não recriado por módulo.

## Integração com o menu e com `intelligence-center`

- **Novo item de menu "Comunicação"**, pedido explícito do usuário — entra
  no grupo `ANÁLISES` da barra lateral (`Sidebar`, componente de
  `intelligence-center`, ver `CLAUDE.md` "Full prototype re-import...
  full nav IA"), ao lado de Narrativas/Sentimento/Plataformas/Pautas
  Eleitorais/Autores — não em `CONFIGURAÇÕES`, porque é uma funcionalidade
  de uso operacional diário do time de comunicação, não uma tela de
  administração. Aponta para `/communications`.
- **Detalhe de Narrativa** (`intelligence-center/narratives-exploration.md`,
  `/narratives/[id]`, **tanto na página cheia quanto no modal rápido**
  `@modal/(.)narratives/[id]`) ganha uma nova seção "Comunicações e
  Decisões" (posição sugerida: logo abaixo de "Ações e decisões" de
  `cases`, já que ambas são "o que o time fez a respeito desta Narrativa")
  — resumo compacto (até 3 registros mais recentes, Comunicações e
  Decisões misturados + indicadores), um botão **"+ Registrar"** sempre
  visível no cabeçalho da seção (abre o formulário, com o seletor "Tipo de
  registro", com a Narrativa já pré-preenchida e travada — ver
  `communication-registration.md`, "Entrada rápida a partir de uma
  Narrativa") e um link "Ver linha do tempo completa →" para
  `/communications/[id]`. Ver nota equivalente adicionada em
  `narratives-exploration.md` neste mesmo commit de specs.
- Esta é uma dependência **forte**: as páginas deste módulo não têm shell
  próprio, então não podem ir ao ar antes de `intelligence-center` (já
  implementado) — ver `_architecture.md`.

## Dependências técnicas de mais alto nível

- `foundation`: `narratives` (FK de `communications`), `narrative_metrics`/
  `bw_query_metrics_daily` (histórico diário já sincronizado — nenhuma
  captura nova da Brandwatch é necessária para este módulo).
- `auth`: `user_profiles` (`assignee_id`/`created_by`), sessão válida para
  qualquer tela.
- `aggregated-metrics`: reaproveita as fórmulas de Sentimento/Momentum/
  Tendência/Risco já definidas em `sql-aggregation.md`, "Scores de
  Narrativa" — este módulo **não recalcula nada do zero**, só invoca essas
  mesmas fórmulas com uma janela de tempo histórica (antes/depois do
  registro — Comunicação ou Decisão) em vez do período "agora" que as
  páginas de
  `intelligence-center` usam. Requer uma extensão aditiva pequena em
  `get_narratives_table` (novo parâmetro opcional `p_reference_at`, ver
  [narrative-impact-tracking.md](narrative-impact-tracking.md), "Dependências
  técnicas") — sem essa extensão, a Tendência histórica (antes/depois) não
  pode ser calculada corretamente, só Sentimento/Momentum/Risco.

## Decisões pendentes deste módulo

Nenhuma decisão de produto pendente aberta — todas resolvidas em
2026-07-25 (ver lista abaixo).

✅ **Decisões resolvidas (2026-07-25, pedidos do usuário na mesma sessão)**:
- **Permissão de CRUD sem restrição por enquanto** — qualquer membro da
  organização pode registrar/editar/excluir qualquer Comunicação ou
  Decisão. "Versões mais adiante será restrito por perfis" — evolução
  futura já anunciada pelo usuário, sem sistema de perfis definido ainda
  no produto para modelar agora (ver [data-model.md](data-model.md),
  "Políticas RLS").
- **Janela padrão de comparação antes/depois: 7 dias**, com seletor
  3/7/14 na tela (`p_window_days` já é parâmetro das functions, os 3
  valores já suportados) — ver [narrative-impact-tracking.md](narrative-impact-tracking.md),
  "Conceito: janelas de comparação".
- **Tipo de comunicação vira tabela, não enum** — `communication_types`
  (ver [data-model.md](data-model.md)): "a lógica do módulo pega dela",
  extensível por `INSERT`, sem `ALTER TYPE`.
- **Tipo de comunicação vira tabela, não enum** — `communication_types`
  (ver [data-model.md](data-model.md)): "a lógica do módulo pega dela",
  extensível por `INSERT`, sem `ALTER TYPE`.
- **Vínculo com `mentions` é manual, definitivo** — o usuário cola o
  link/ID da mention no formulário; sem matching automático planejado.
- **Vínculo com a Narrativa é feito por combobox** no formulário de
  cadastro, e **botões de atalho** "Registrar" existem tanto no modal
  quanto na página cheia do detalhe de Narrativa, pré-preenchendo esse
  campo — ver [communication-registration.md](communication-registration.md),
  "Entrada rápida a partir de uma Narrativa".
- **O módulo cobre dois tipos de registro, Comunicação e Decisão**
  (`communications.record_type`) — Decisão com campos reduzidos (data,
  título, responsável, detalhamento), mesma tabela/formulário/tela/
  mecanismo de impacto que Comunicação — ver [data-model.md](data-model.md)
  e "Relação com `cases`" acima.

## Referências relacionadas

- [data-model.md](data-model.md)
- [communication-registration.md](communication-registration.md)
- [narrative-impact-tracking.md](narrative-impact-tracking.md)
- [../foundation/data-model.md](../foundation/data-model.md) — `narratives`, `narrative_metrics`, `bw_query_metrics_daily`
- [../auth/data-model.md](../auth/data-model.md) — `user_profiles`
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md) — "Scores de Narrativa" (Sentimento/Momentum/Tendência/Risco)
- [../intelligence-center/narratives-exploration.md](../intelligence-center/narratives-exploration.md) — ponto de integração no detalhe de Narrativa
- [../_index.md](../_index.md) — tabela de módulos
