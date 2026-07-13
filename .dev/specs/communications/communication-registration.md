---
tipo: feature-spec
módulo: communications
funcionalidade: communication-registration
status: rascunho
atualizado: 2026-07-25
---

# Cadastro de Comunicações e Decisões

## Objetivo

Dar ao time de comunicação uma tela para registrar, editar e excluir dois
tipos de registro vinculados a uma Narrativa — **Comunicações** já
realizadas (post, e-mail, propaganda de TV etc., campos completos) e
**Decisões** (data, título, responsável e detalhamento, campos reduzidos —
✅ adicionado 2026-07-25, pedido do usuário: "o usuário poderá registrar
uma comunicação ou uma decisão") — a base de dados que
[narrative-impact-tracking.md](narrative-impact-tracking.md) consome para
medir impacto, para os dois tipos igualmente. Sem esta tela não existe
registro nenhum: diferente de `cases`, este módulo nasce com CRUD completo
pela UI, não como schema somente-leitura.

✅ **Princípio de UX explícito (pedido do usuário, 2026-07-25): "pense na
experiência do usuário para facilitar o máximo possível"** — o time de
comunicação registra uma comunicação **enquanto já está olhando para a
Narrativa** na maior parte dos casos reais (acabou de investigar o
detalhe, decidiu agir, quer registrar ali mesmo), não navegando a partir
de uma tela genérica de "todas as comunicações". Por isso o formulário de
cadastro é **um único componente reaproveitado em 3 entradas** (ver
"Entrada rápida a partir de uma Narrativa" abaixo), e o campo Narrativa
nunca obriga o usuário a procurar de novo algo que ele já tinha aberto na
tela.

## Usuários afetados

Qualquer usuário autenticado, membro de ao menos uma organização — sem
restrição de `is_admin` (ver `data-model.md`, "Políticas RLS").

## Fluxo principal

1. Usuário acessa `/communications` pelo item de menu "Comunicação"
   (`Sidebar`, grupo ANÁLISES — ver `overview.md`, "Integração com o
   menu").
2. Tabela com todos os registros (Comunicações e Decisões juntos) da
   organização ativa (mesmo seletor de organização do header global,
   `intelligence-center/executive-overview.md`): **Narrativa**, **Tipo**
   (mostra o rótulo de `communication_types.label` para uma Comunicação, ou
   "Decisão" para uma Decisão — ver "Interface (UI)"), **Canal** ("—" para
   Decisão, que não tem esse campo), **Data**, **Responsável**, **Ações**
   (editar/excluir). Ordenada por `occurred_at` desc por padrão.
3. Filtros acima da tabela: **Narrativa** (mesmo `NarrativeCombobox`
   descrito abaixo, com uma opção extra "Todas"), **Tipo de registro**
   (Todos / Comunicação / Decisão — quando "Comunicação" é escolhido, um
   segundo filtro aparece: **Tipo de comunicação**, lista
   `communication_types` ativos ordenados por `position`), **Período**
   (mesmos atalhos Diário/Semanal/Mensal/Personalizado já usados no header
   global, aplicado a `occurred_at`).
4. Botão "Registrar" → abre o modal `CommunicationFormModal` (componente
   único, reaproveitado nas 4 entradas — ver "Entrada rápida a partir de
   uma Narrativa" abaixo). O primeiro campo do formulário é sempre o
   seletor **Tipo de registro** (segmented control: "Comunicação" |
   "Decisão", "Comunicação" pré-selecionado por ser o caso mais comum) — o
   restante dos campos muda dinamicamente conforme a escolha:
   - **Comunicação**: Narrativa (`NarrativeCombobox`, obrigatório — ver
     "Interface (UI)"), Tipo de comunicação (select, obrigatório, lista
     `communication_types` ativos), Título (obrigatório), Descrição
     (opcional, textarea), Canal (texto livre, opcional — ex: "Instagram",
     "Rede Globo"), Data/hora da publicação (obrigatório, não pode ser no
     futuro — ver "Fluxos alternativos"), Link/evidência (URL, opcional),
     ID/URL da mention na Brandwatch (opcional, `bw_resource_id`, sempre
     colado manualmente — ver `data-model.md`), Responsável (select de
     `user_profiles` da organização, opcional).
   - **Decisão**: Narrativa (`NarrativeCombobox`, obrigatório — mesmo
     campo), Data da decisão (obrigatório, não pode ser no futuro), Título
     (obrigatório), Responsável (select de `user_profiles`, opcional),
     Detalhamento (opcional, textarea — mapeia para `description`).
     **Nenhum outro campo aparece** — sem Tipo de comunicação, Canal,
     Link, ID da Brandwatch (esses 4 não existem para `record_type =
     'decision'`, ver `data-model.md`, CHECK constraint).
5. Submit → Edge Function `create-communication` (ver "Dependências
   técnicas") → insere em `communications`, `organization_id` derivado no
   servidor via trigger (`data-model.md`) a partir da Narrativa escolhida.
6. Editar (ação da linha) → mesmo modal, pré-preenchido, com o seletor
   "Tipo de registro" já travado no valor original (trocar o tipo de um
   registro existente — de Comunicação para Decisão ou vice-versa — não é
   suportado; para isso, excluir e recriar) → Edge Function
   `update-communication`.
7. Excluir (ação da linha, com confirmação explícita) → Edge Function
   `delete-communication`.
8. Cada linha da tabela tem um link "Ver impacto →" para
   `/communications/[narrativeId]` (ver [narrative-impact-tracking.md](narrative-impact-tracking.md)),
   escopado à Narrativa daquela linha — vale para Comunicações e Decisões
   igualmente (o cálculo de impacto usa só `narrative_id`/`occurred_at`,
   nenhum campo exclusivo de Comunicação).

## Entrada rápida a partir de uma Narrativa

✅ Pedido explícito do usuário (2026-07-25): "de dentro do modal e do
detalhamento de uma narrativa, deve existir um botão para registrar uma
comunicação." O mesmo `CommunicationFormModal` do "Fluxo principal" item 4
— com o seletor "Tipo de registro" (Comunicação/Decisão) igualmente
disponível nas 4 entradas, nunca só numa delas — é aberto a partir de
**4 pontos de entrada**, nunca formulários diferentes:

| Entrada | Onde | Campo Narrativa |
|---|---|---|
| Lista geral | Botão "Registrar" em `/communications` | `NarrativeCombobox` vazio — usuário escolhe |
| Detalhe completo de uma Narrativa | Botão "+ Registrar" no cabeçalho da seção "Comunicações e Decisões" de `/narratives/[id]` (ver `intelligence-center/narratives-exploration.md`) | **Pré-preenchido e travado** (ver abaixo) |
| Modal rápido de uma Narrativa | Mesmo botão, mesma seção, dentro do modal de `@modal/(.)narratives/[id]` (`narratives-exploration.md`, "Fluxo principal" item 5) | **Pré-preenchido e travado** |
| Linha do tempo de impacto | Botão "+ Registrar" no cabeçalho de `/communications/[narrativeId]` (ver `narrative-impact-tracking.md`) | **Pré-preenchido e travado** |

Quando aberto a partir de uma Narrativa já conhecida (as 3 últimas linhas
da tabela acima), o campo Narrativa **não aparece como combobox editável**
— vira um rótulo fixo, não interativo: "Narrativa: **[título]**" acima dos
demais campos. Motivo de UX: um combobox desabilitado é confuso ("por que
está cinza?"); um rótulo fixo comunica de forma inequívoca que o contexto
já foi resolvido, sem exigir nenhuma ação extra do usuário nem risco de
trocar a Narrativa por engano no meio do fluxo. O restante do formulário
(Tipo, Título, Data, etc.) é idêntico nas 4 entradas.

**Depois de salvar, a experiência não navega para longe de onde o usuário
estava**: o modal fecha, aparece o toast de confirmação (ver
"Notificações"), e a seção/página de onde o botão foi acionado atualiza a
lista de comunicações/indicadores **no lugar** (sem recarregar a página
inteira) — o usuário continua exatamente onde estava, olhando a mesma
Narrativa, já vendo o registro novo refletido.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhum registro ainda | `<EmptyState />` com o botão "Registrar" visível (regra transversal #2 de `CLAUDE.md` — ação primária sempre visível, mesmo no estado vazio) |
| Data no futuro (publicação ou decisão) | Erro inline no campo: "A data não pode ser no futuro" — o módulo assume ações/decisões já realizadas (ver `overview.md`, Objetivo); nada **planejado** é o que esta tela registra, para nenhum dos 2 tipos |
| Narrativa não selecionada no formulário | Erro inline: "Selecione uma Narrativa" — bloqueia o submit, para os dois tipos |
| Título vazio | Erro inline: "Informe um título" — para os dois tipos |
| Tipo de comunicação não selecionado (só quando "Tipo de registro" = Comunicação) | Erro inline: "Selecione o tipo de comunicação" |
| Falha na Edge Function (erro de rede/Supabase) | Toast de erro com mensagem amigável (`BACKEND_ERROR_MESSAGE`/mensagem específica, `lib/errors.ts`) — nunca a mensagem crua do Postgres (regra global "Edge Function error handling") |
| Exclusão de um registro (Comunicação ou Decisão) que já tem impacto calculado/exibido em algum lugar | Sem bloqueio — é só um registro histórico, a exclusão é permitida; modal de confirmação explícita ("Esta ação não pode ser desfeita") antes de chamar `delete-communication`, mesmo padrão de `admin-delete-user` |

## Interface (UI)

- **Seletor "Tipo de registro"** (Comunicação/Decisão): segmented control
  no topo do `CommunicationFormModal`, "Comunicação" pré-selecionado.
  Trocar a seleção troca os campos exibidos abaixo instantaneamente (sem
  perder o que já foi preenchido nos campos comuns — Narrativa, Título,
  Data, Responsável — caso o usuário mude de ideia no meio do
  preenchimento). Some/vira somente leitura na edição (ver "Fluxo
  principal" item 6).
- **`NarrativeCombobox`** (novo componente compartilhado,
  `components/communications/narrative-combobox.tsx` — primeiro campo do
  produto com busca/filtro por texto; não existe equivalente reutilizável
  ainda, `OrganizationsMultiSelect` é multi-seleção sem busca): campo de
  texto que filtra, em tempo real, a lista de Narrativas já carregada da
  organização ativa (sem chamada nova por tecla digitada — filtro
  client-side sobre a lista já disponível, mesma lista que popula o filtro
  da tabela), navegável por teclado (setas + Enter), mostra o título da
  Narrativa (mesma granularidade "folha" já usada em toda a UI do produto,
  ver `_glossary.md`/`electoral-themes.md`). Justificativa da escolha
  (combobox com busca, não um `<select>` simples): uma organização pode ter
  dezenas de Narrativas — digitar para filtrar é bem mais rápido que rolar
  uma lista longa, direto na linha do pedido do usuário de "facilitar ao
  máximo".
- **Tabela**: colunas Narrativa (link para o detalhe da Narrativa,
  `/narratives/[id]`), Tipo (rótulo de `communication_types.label` para
  `record_type = 'communication'`, ou "Decisão" para `record_type =
  'decision'` — badge simples sem cor semântica própria, não é um score),
  Canal ("—" para Decisão), Data (via `formatDate`, timezone do usuário —
  regra global "User timezone"), Responsável (nome ou "—"), Ações (menu ⋮
  — Editar, Ver impacto, Excluir).
- **`CommunicationFormModal`**: campos do "Fluxo principal" item 4, botão
  "Salvar"/"Registrar" desabilitado + spinner durante o envio (regra
  transversal #5), erros de validação inline por campo (regra transversal
  #4). Campo Narrativa é o `NarrativeCombobox` **ou** o rótulo fixo
  travado, dependendo da entrada (ver "Entrada rápida a partir de uma
  Narrativa").
- **Botão "+ Registrar"** nas 3 entradas por Narrativa (detalhe completo,
  modal rápido, linha do tempo de impacto): sempre visível no cabeçalho da
  seção correspondente, mesmo quando a Narrativa ainda não tem nenhum
  registro (regra transversal #2 — ação primária sempre visível, mesmo no
  estado vazio).
- **Confirmação de exclusão**: modal de confirmação explícita, mesmo
  componente `ConfirmDialog` já usado por `admin-delete-user`.
- **Estados**: `<Skeleton />` (linhas falsas da tabela durante o
  carregamento, regra transversal #1), `<ErrorMessage retry />` (falha ao
  carregar), `<EmptyState />` (nenhum registro, com a ação primária
  visível).
- **Paginação**: 10 por página (`DEFAULT_PAGE_SIZE`, regra transversal #6).

## Regras de negócio

- `organization_id` nunca é aceito do client — sempre derivado de
  `narrative_id` no servidor (trigger, ver `data-model.md`) — vale para os
  dois `record_type`.
- Uma Narrativa pode ter **qualquer número** de registros, misturando
  Comunicações e Decisões livremente (0, 1 ou muitos de cada) — sem limite
  imposto pelo produto.
- `occurred_at` não pode ser uma data futura (ver "Fluxos alternativos") —
  a validação client-side é conveniência, o servidor (Edge Function)
  revalida (Princípio técnico 2/regra global "Form validation").
- Os campos exclusivos de Comunicação (`communication_type_id`/
  `channel_detail`/`external_url`/`bw_resource_id`) nunca são enviados
  quando `record_type = 'decision'` — a Edge Function os ignora/zera
  mesmo que o client envie algo (defesa em profundidade além do CHECK
  constraint do banco, ver `data-model.md`).
- Sem workflow/aprovação — qualquer membro da organização pode registrar,
  editar ou excluir qualquer Comunicação ou Decisão (ver `data-model.md`,
  "Políticas RLS"). ✅ **Decidido (2026-07-25)**: sem restrição por
  perfil/criador nesta versão — restrição por perfis fica para uma versão
  futura do produto, quando um sistema de perfis existir (ver
  `data-model.md`).

## Dados envolvidos

- **Lê**: `communications` (join com `narratives.title` para a coluna
  Narrativa, `communication_types.label` para a coluna Tipo quando
  `record_type = 'communication'`, `user_profiles.full_name` para
  Responsável), `narratives` (para popular o `NarrativeCombobox`),
  `communication_types` (`is_active = true`, ordenado por `position`,
  para popular o select de Tipo de comunicação — leitura direta pelo
  client, mesma lógica de `use-organizations.ts`, dado global sem filtro
  de organização; irrelevante quando "Tipo de registro" = Decisão),
  `user_profiles` (para popular o select de Responsável, escopado à
  organização via `organization_members`).
- **Escreve**: `communications` (INSERT/UPDATE/DELETE, via as 3 Edge
  Functions abaixo).

## Permissões

| Ação | Quem pode |
|---|---|
| Acessar `/communications` | qualquer usuário autenticado, membro de ao menos uma organização |
| Registrar Comunicação ou Decisão | membro da organização ativa |
| Editar/excluir Comunicação ou Decisão | membro da organização ativa (qualquer uma, não só a que criou — sem restrição por perfil nesta versão, ver `data-model.md`) |

## Notificações / Feedback ao usuário

| Evento | Feedback |
|---|---|
| Comunicação registrada | Toast: "Comunicação registrada" |
| Decisão registrada | Toast: "Decisão registrada" |
| Registro atualizado | Toast: "Comunicação atualizada" / "Decisão atualizada" (conforme `record_type`) |
| Registro excluído | Toast: "Comunicação excluída" / "Decisão excluída" (conforme `record_type`) |
| Erro em qualquer ação | Toast de erro com mensagem amigável |

## Dependências técnicas

- Edge Functions (autossuficientes, Princípio técnico 5; client Supabase
  com **chave publicável + JWT do usuário encaminhado**, mesmo padrão de
  exceção documentado em `aggregated-metrics/edge-functions-per-page.md`
  — RLS continua valendo, a Edge Function existe para validar e traduzir
  erro, não para bypassar isolamento multi-tenant):
  - `create-communication` — valida `narrative_id`/`title`/`occurred_at`
    (não-futuro) sempre; valida `communication_type_id` (obrigatório) só
    quando `record_type = 'communication'`; ignora/zera
    `communication_type_id`/`channel_detail`/`external_url`/
    `bw_resource_id` quando `record_type = 'decision'` (mesmo se o client
    enviar algo — defesa em profundidade); traduz erro de Postgres
    (incluindo uma eventual violação do CHECK constraint) para mensagem
    amigável.
  - `update-communication`.
  - `delete-communication`.
- Leitura da listagem e dos comboboxes (`communications`, `narratives`,
  `communication_types`, `user_profiles`) é feita **diretamente pelo
  client** via `supabase-js` + RLS — mesmo padrão já usado por
  `hooks/use-organizations.ts`/`use-user-profile.ts` (leitura simples,
  sem agregação/cálculo, não precisa passar por Edge Function). O cálculo
  de impacto (bloco "Ver impacto") é que exige uma Edge Function própria —
  ver [narrative-impact-tracking.md](narrative-impact-tracking.md).

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [narrative-impact-tracking.md](narrative-impact-tracking.md)
- [../auth/user-management.md](../auth/user-management.md) — padrão de Edge Function/modal/confirmação reaproveitado
