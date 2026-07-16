---
tipo: feature-spec
módulo: entities
funcionalidade: entity-registration
status: implementado
atualizado: 2026-07-16
---

# Cadastro de Entidades (CRUD)

> ✅ **4 melhorias de UX adicionadas (2026-07-16)**, depois do CRUD já
> implementado (2026-07-15) — pedidos do usuário na mesma sessão, em
> cima de um screenshot real da tabela em produção:
>
> 1. **Seletor de linhas por página** — `components/ui/pagination.tsx`
>    ganhou `pageSize`/`onPageSizeChange`/`pageSizeOptions` opcionais (10/
>    25/50/100), aditivo/retrocompatível (nenhum dos outros 3 consumidores
>    do componente precisou mudar). `EntitiesAdminView` mantém `pageSize`
>    em estado local, reseta pra página 1 ao trocar.
> 2. **Selecionar uma linha mostra a Entidade ao lado, sem precisar clicar
>    em "Editar"** — mesmo mecanismo já usado por `/narratives`
>    (`grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]` quando algo está
>    selecionado): a tabela encolhe pra uma coluna elástica, um novo
>    `EntityDetailPanel` (nome/tipo/cargo/partido/ideologia/influência/
>    contas/classificações, tudo somente leitura) aparece fixo a 400px à
>    direita, com "✕ Fechar" e um único botão "Editar" (só ele abre o
>    `EntityFormModal`). Clicar de novo na mesma linha desseleciona.
> 3. **Ordenação por qualquer coluna** — pedido explícito do usuário pra
>    virar padrão de toda tabela do sistema, não só desta (ver CLAUDE.md,
>    Regras transversais de UX #11). Extraído de `NarrativesTable`
>    (`components/intelligence-center/narratives-table.tsx`, que já tinha
>    esse comportamento desde 2026-08-08) pra um par compartilhado —
>    `components/ui/sortable-th.tsx`'s `useSortableRows()`/`<SortableTh>`
>    — reusado aqui pras 8 colunas de dado (Nome/Tipo/Cargo/Partido/
>    Ideologia/Influência/Contas/Status; "Ações" fica de fora, não é
>    coluna de dado). Colunas ordinais (Ideologia/Influência) ordenam pela
>    posição na escala real (`IDEOLOGIA_OPTIONS`/`severity_level`), não
>    alfabeticamente.
> 4. **Filtro "Sem conta associada"** — nova checkbox ao lado de "Mostrar
>    inativas", filtra Entidades com `accounts.length === 0` — atalho pra
>    localizar quem ainda precisa de enriquecimento em "Contas nas redes"
>    antes de aparecer no vínculo aditivo de `author-linking.md`.
>
> ✅ **2 correções de segurança/UX no mesmo lote, também pedidas pelo
> usuário**: (1) o menu de ações "⋮" (`EntityRowMenu`, portal-based, mesmo
> padrão de `UserRowMenu`) foi **substituído por botões sempre visíveis**
> (Editar/Desativar-Reativar/Excluir) — `EntityRowMenu` foi apagado do
> repositório (sem consumidor restante, nenhum código morto). (2)
> "Desativar" (mas não "Reativar") ganhou o `ConfirmDialog` "leve" que o
> texto original desta spec já pedia ("Fluxo principal" item 7) mas que a
> primeira implementação (2026-07-15) tinha deixado de fora — chamava
> `update-entity` direto do clique, sem confirmação nenhuma. Fechado junto
> com a auditoria mais ampla que o usuário pediu nesta mesma mensagem
> ("em todas as exclusões do sistema, é necessário confirmação... nunca
> excluir diretamente") — os outros 4 fluxos de exclusão do produto
> (`admin-delete-user`, `delete-communication`, `delete-finops-manual-cost`,
> e o próprio `delete-entity` desta tela) já passavam por
> `ConfirmDialog` desde que foram implementados, confirmado por auditoria
> nesta sessão, nenhum ajuste necessário neles. Ver CLAUDE.md, Regras
> transversais de UX #12-14, pro detalhe completo dos 3 padrões (preview
> por seleção de linha, botões visíveis em vez de menu, confirmação
> obrigatória em toda exclusão).

> ✅ **Implementado (2026-07-15)**, pedido do usuário: "Implemente o
> frontend de gerenciamento de entities e entities account para que seja
> gerenciado pelo administrador. Crie uma nova guia na página de admin
> para esse gerenciamento." Nenhuma migration nova — o schema já estava
> 100% implementado desde `data-model.md` (2026-07-13); esta sessão só
> escreveu a UI e as Edge Functions que faltavam.
>
> - **`/admin/entities`** — nova 3ª guia de "Administração"
>   (`components/intelligence-center/admin-tabs.tsx`, ao lado de
>   "Usuários"/"FinOps"), mesmo gate `is_admin` server-side de
>   `/admin/users`/`/admin/finops` (`page.tsx` redireciona pra `/overview`
>   sem renderizar nada pra não-admin). Nenhuma mudança na Sidebar — o item
>   "Administração" já usa `matchPrefix="/admin"`, então continua
>   destacado em qualquer uma das 3 guias sem precisar de ajuste.
> - **3 Edge Functions** (`create-entity`/`update-entity`/`delete-entity`)
>   — **um desvio deliberado do texto original da spec**: a seção
>   "Dependências técnicas" abaixo descrevia o padrão de exceção "chave
>   publicável + JWT do usuário encaminhado" (o mesmo de `communications`).
>   Implementado, em vez disso, com o padrão **já estabelecido por toda
>   tela `/admin/*` deste projeto** (`admin-invite-user` e as
>   `create/update/delete-finops-manual-cost` mais recentes) — chave
>   secreta + `Bearer` token, `supabaseAdmin.auth.getUser(token)` — por
>   consistência com o precedente real do código, não com o texto da spec.
>   RLS (`is_current_user_admin()`) continua sendo a garantia real de
>   qualquer forma, então o resultado de segurança é idêntico; só a
>   convenção de qual chave a função usa mudou.
> - **`update-entity` é um único endpoint pros 3 usos do "Fluxo
>   principal"** (edição completa, Desativar, Reativar) — distingue os
>   casos por quais chaves o corpo da requisição inclui: `accounts`/`tags`
>   presentes (mesmo `[]`) substituem por completo o conjunto já
>   cadastrado daquela Entity (delete-all + reinsert, sem diff — exatamente
>   como o item 6 do "Fluxo principal" pede); ausentes (Desativar/Reativar
>   só envia `{ id, is_active }`), nenhuma das duas tabelas é tocada.
>   Qualquer outro campo (`type`/`name`/`cargo`/`partido`/`ideologia`/
>   `photo_url`/`influence_level`) só é atualizado quando a chave
>   correspondente está presente no corpo — mesmo mecanismo.
> - **Conflito de handle duplicado (`entity_accounts_unique_handle`,
>   SQLSTATE 23505) é traduzido e localizado na linha certa**, não só numa
>   mensagem genérica de topo — a Edge Function faz parse do `details` que
>   o Postgres já devolve (`Key (platform, username)=(x, y) already
>   exists.`) e retorna `{ error, conflict_account: { platform, username }
>   }`; o formulário (`EntityFormModal`) destaca a linha de conta
>   correspondente com borda vermelha + texto inline, além do erro de
>   topo. Isso exigiu ampliar `lib/supabase/call-function.ts` — o `Error`
>   lançado por `callFunction()` agora carrega qualquer campo extra do
>   corpo JSON de erro (`Object.assign`), não só `.message` — mudança
>   aditiva/retrocompatível, nenhum consumidor existente lê algo além de
>   `.message` hoje.
> - **`EntityFormModal` reaproveita, não reimplementa**, os helpers de
>   rótulo/cor já existentes de `/authors`
>   (`components/intelligence-center/author-color.ts`) onde fazia sentido
>   — mas os componentes de exibição da tabela (`EntityTypeBadge`/
>   `IdeologiaBadge`/`InfluenceBadge`, em `entities-admin-view.tsx`) são
>   novos, por pedido explícito da spec ("implementar como um componente
>   novo... não reaproveitar `RiskBadge` diretamente" — `InfluenceBadge`
>   usa os mesmos tokens `risk-*`/`risk-*-bg` só pela cor, com rótulos
>   próprios "Baixa/Média/Alta/Muito alta").
> - **Sugestões de Partido/Dimensão/Valor são `<datalist>` nativo**, não um
>   componente de combobox novo — texto livre com sugestões, exatamente o
>   texto da spec ("texto livre com sugestões"), e mais simples que
>   replicar `NarrativeCombobox` (`communications/`, que é single-select
>   estrito, não o caso aqui). Nenhuma chamada de rede nova para essas
>   sugestões — vêm da própria listagem já carregada.
> - **Campos reorganizados (2026-07-13)**, pedido do usuário anterior:
>   "renomeie o campo descrição para cargo, inclua um novo campo chamado
>   partido, crie um campo chamado ideologia... e reorganize os dados
>   nessas novas colunas." O formulário implementado já reflete o schema
>   atualizado (`data-model.md`, migration `20260731050000`) —
>   `Cargo`/`Partido`/`Ideologia` são campos estruturados de "Dados
>   básicos", desabilitados quando `type = 'party'` (não se aplica ao
>   próprio partido).
> - Não verificado contra um Supabase real nesta sessão (sem credenciais
>   de deploy neste ambiente, mesma limitação recorrente de toda sessão
>   sem acesso ao Supabase Dashboard já registrada em `CLAUDE.md`) — `npx
>   tsc --noEmit` e `npm run build` (23 rotas, `/admin/entities` nova)
>   passam limpos; `git push` pra `develop` é o próximo passo.

## Objetivo

Dar a administradores da plataforma (`user_profiles.is_admin = true`) uma
tela para cadastrar, editar, desativar/reativar e excluir Entidades
(pessoas, veículos de imprensa, partidos, instituições, empresas e
movimentos relevantes ao debate público monitorado) e suas classificações
(cargo/partido/ideologia + contas por plataforma + classificações
adicionais via `entity_tags`, ex: estado/poder-instituição/postura em
relação ao candidato) — mesmo padrão de tela administrativa já usado por
`auth/user-management.md` (`/admin/users`), aplicado a um cadastro
diferente.

## Usuários afetados

Exclusivamente usuários com `user_profiles.is_admin = true` — mesma
restrição (e mesma razão: `is_admin` é global de plataforma, não por
organização) já usada em `/admin/users`. Qualquer outro usuário
autenticado é bloqueado ao tentar acessar `/admin/entities` (ver
"Permissões").

## Fluxo principal

1. Admin acessa `/admin/entities` (item de menu "Entidades", visível só
   para admins, dentro do grupo `CONFIGURAÇÕES` da barra lateral — mesmo
   grupo/visibilidade de "Administração", ver
   `CLAUDE.md`, "Full prototype re-import... full nav IA").
2. Tabela com todas as Entidades cadastradas (por padrão, só `is_active =
   true` — ver "Interface"): **Nome**, **Tipo** (badge com o rótulo em
   português do enum `entity_type`), **Cargo**, **Partido**, **Ideologia**
   (badge — "—" quando `null`, ver "Interface" para a paleta), **Influência**
   (badge, quando avaliada — "—" quando `null`), **Contas** (contagem — ex:
   "2 contas" — ou "Nenhuma"), **Status** (Ativa/Inativa), **Ações**.
3. Filtros acima da tabela: **Busca por nome** (texto livre, client-side
   sobre a lista já carregada), **Tipo** (todos os valores de
   `entity_type`), **Partido** (todos os valores distintos já cadastrados),
   **Ideologia** (os 5 valores em uso — `esquerda`/`centro-esquerda`/
   `centro`/`centro-direita`/`direita`), **Mostrar inativas** (toggle,
   desligado por padrão).
4. Botão "Nova Entidade" → abre o modal `EntityFormModal`, com 3 seções:
   - **Dados básicos**: Tipo (obrigatório, select com os 7 valores de
     `entity_type`), Nome (obrigatório), Cargo (opcional, texto livre —
     ex: "Deputado Federal", "Senadora", "Colunista"; não se aplica a
     `type = 'party'`, campo fica desabilitado/oculto nesse caso), Partido
     (opcional, texto livre com sugestões dos partidos já cadastrados como
     `type = 'party'` — não se aplica ao próprio partido), Ideologia
     (opcional, select com os 5 valores em uso —
     `esquerda`/`centro-esquerda`/`centro`/`centro-direita`/`direita` —
     mais "Outra..." em texto livre, já que a coluna não é um enum
     travado, ver `data-model.md`), URL da foto (opcional), Nível de
     influência sobre o candidato (opcional, select com os 4 níveis — ver
     `data-model.md`, `influence_level`).
   - **Contas nas redes** (repetível, 0 ou mais linhas): Plataforma (texto
     livre com sugestões das plataformas já conhecidas —
     twitter/instagram/facebook/tiktok/reddit/linkedin/news/blog),
     Usuário/handle (obrigatório se a linha existir — exatamente como
     aparece na Brandwatch, sem `@` a menos que a Brandwatch use `@`),
     URL do perfil (opcional). Botão "+ Adicionar conta" adiciona uma
     linha vazia; cada linha tem um "✕" para remover.
   - **Classificação adicional** (repetível, 0 ou mais linhas — para
     dimensões que não têm coluna própria): Dimensão (`tag_type` — select
     com o vocabulário sugerido de `data-model.md`, ex: `state`/
     `power_branch`/`stance_to_candidate`, **mais** um campo "Outra
     dimensão..." que aceita texto livre, já que `entity_tags` é
     extensível por design), Valor (`tag_value`, texto livre, com
     sugestões quando a dimensão escolhida já tem valores usados por
     outras Entities). Botão "+ Adicionar classificação"/"✕" por linha,
     mesmo padrão da seção de contas. ✅ **`party`/`office` não aparecem
     mais como opções de Dimensão** (2026-07-13) — viraram os campos
     Partido/Cargo de "Dados básicos" acima, ver `data-model.md`.
5. Submit → Edge Function `create-entity` (ver "Dependências técnicas") →
   insere `entities` + todas as linhas de `entity_accounts`/`entity_tags`
   preenchidas na mesma chamada.
6. Editar (ação da linha) → mesmo modal, pré-preenchido com os dados
   atuais, incluindo todas as contas/tags já cadastradas → Edge Function
   `update-entity`: atualiza `entities` e **substitui por completo** o
   conjunto de `entity_accounts`/`entity_tags` daquela Entity pelo que foi
   enviado (remove as linhas que não estão mais no formulário, insere as
   novas — sem tentar diff campo a campo, já que linhas de conta/tag não
   têm identidade própria que valha a pena preservar entre edições).
7. Ação "Desativar" (menu de ações da linha, com confirmação leve — não
   destrutiva) → Edge Function `update-entity` com `is_active: false`.
   Linha muda para Status "Inativa", some da listagem padrão (mas
   continua existindo — ver "Regras de negócio").
8. Ação "Reativar" (só aparece em linhas inativas, com "Mostrar inativas"
   ligado) → mesma Edge Function, `is_active: true`.
9. Ação "Excluir" (menu de ações, com confirmação explícita — destrutiva)
   → Edge Function `delete-entity`: `DELETE` definitivo, cascade em
   `entity_accounts`/`entity_tags` (ver `data-model.md`). Diferente de
   "Desativar" — ver "Regras de negócio" para quando usar cada uma.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhuma Entidade cadastrada ainda | `<EmptyState />` com o botão "Nova Entidade" visível (regra transversal #2 — ação primária sempre visível) |
| Nome vazio | Erro inline: "Informe um nome" |
| Tipo não selecionado | Erro inline: "Selecione um tipo" |
| Linha de conta com Plataforma preenchida mas Usuário vazio (ou vice-versa) | Erro inline na linha: "Preencha plataforma e usuário, ou remova esta linha" |
| Handle já cadastrado em outra Entity na mesma plataforma (violação de `entity_accounts_unique_handle`) | Erro inline na linha: "Este usuário já está cadastrado em outra Entidade nesta plataforma" — a Edge Function traduz a violação da constraint (nunca expõe o erro cru do Postgres, regra global "Edge Function error handling") |
| Linha de classificação com Dimensão preenchida mas Valor vazio (ou vice-versa) | Erro inline na linha: "Preencha a dimensão e o valor, ou remova esta linha" |
| Tentativa de excluir uma Entidade que tem contas vinculadas | Sem bloqueio — o cascade remove as contas/tags junto; modal de confirmação deixa isso explícito: "Esta Entidade tem N conta(s) e M classificação(ões) cadastradas — todas serão removidas junto. Esta ação não pode ser desfeita." |
| Usuário não-admin tenta acessar `/admin/entities` | Servidor redireciona (ex: para `/overview`) — a rota nunca renderiza para não-admin, mesmo digitando a URL direto (mesmo padrão de `/admin/users`) |
| Falha na Edge Function (erro de rede/Supabase) | Toast de erro: "Não foi possível salvar. Tente novamente." (`BACKEND_ERROR_MESSAGE`/mensagem específica) |

## Interface (UI)

- **Tabela**: colunas do "Fluxo principal" passo 2. Badge de Tipo usa uma
  cor neutra por tipo (sem significado de score — não reaproveitar a
  paleta de sentimento/risco). Badge de Influência reaproveita o enum
  Postgres `severity_level` só no valor de banco, **com rótulo próprio**
  ("Baixa"/"Média"/"Alta"/"Muito alta" — ver `data-model.md`, nota em
  `influence_level`) — implementar como um componente novo
  (`InfluenceBadge`), não reaproveitar `RiskBadge` diretamente. Badge de
  Ideologia (`IdeologiaBadge`, novo componente): cor neutra/informativa
  por valor (não é um score de bom/ruim — não reaproveitar a paleta de
  sentimento, que implicaria positivo/negativo onde não há); "—" quando
  `null`. Cargo/Partido renderizam como texto simples, sem badge — não são
  classificações com paleta própria, só texto factual.
- **`EntityFormModal`**: 3 seções do "Fluxo principal" passo 4, botão
  "Salvar" desabilitado + spinner durante o envio (regra transversal #5),
  erros de validação inline por campo/linha (regra transversal #4). Seções
  de Contas/Classificação usam o mesmo padrão de "lista repetível com
  botão + linha e ✕ por item" — se um componente equivalente já existir no
  código (verificar antes de criar um novo, ver `CLAUDE.md`, "Não
  duplicar UI").
- **Confirmação de desativação**: leve, um `ConfirmDialog` simples
  ("Desativar [nome]? Ela deixa de aparecer nas listagens padrão, mas o
  cadastro não é perdido.").
- **Confirmação de exclusão**: `ConfirmDialog` com o aviso explícito do
  "Fluxos alternativos" acima — exclusão é irreversível.
- **Estados**: `<Skeleton />` (linhas falsas da tabela durante o
  carregamento, regra transversal #1), `<ErrorMessage retry />` (falha ao
  carregar), `<EmptyState />` (nenhuma Entidade, com a ação primária
  visível).
- **Paginação**: 10 por página (`DEFAULT_PAGE_SIZE`, regra transversal #6).

## Regras de negócio

- `is_admin` é avaliado **no servidor** (Edge Function + RLS via
  `is_current_user_admin()`) em toda ação de escrita — a UI restrita ao
  menu "CONFIGURAÇÕES" é conveniência, não a garantia de segurança
  (Princípio técnico 2), mesmo padrão de `user-management.md`.
- **Desativar vs. Excluir**: Desativar (`is_active = false`) é a ação
  recomendada quando uma Entity deixou de ser relevante, mas pode voltar a
  ser útil no futuro, ou quando já existe histórico/relatório referenciando
  ela — não perde nenhum dado, só some da listagem/enriquecimento padrão
  (ver `author-linking.md`, "Regras de negócio" para o efeito no ranking
  de autores). Excluir é para cadastros genuinamente incorretos (erro de
  digitação, duplicata) — remove tudo em cascade, sem forma de desfazer.
  Mesma dualidade já usada em `auth/user-management.md`
  ("Revogar/Restaurar acesso" vs. "Excluir usuário").
- Uma Entity pode ter **qualquer número** de contas e de classificações
  (0, 1 ou muitas de cada) — sem limite imposto pelo produto.
- O mesmo `tag_type` pode se repetir em várias linhas de classificação de
  uma Entity (ex: duas linhas `power_branch`) — só o par exato
  `tag_type`+`tag_value` não pode duplicar (ver `data-model.md`,
  constraint de `entity_tags`).
- O cadastro é **manual e curado** — não existe nenhuma sincronização
  automática a partir da Brandwatch (nenhum autor vira Entity sozinho);
  ver `author-linking.md` para o único atalho de UX que parte de um autor
  já visto (pré-preenchimento, nunca criação automática).

## Dados envolvidos

- **Lê**: `entities`, `entity_accounts`, `entity_tags` — leitura direta
  pelo client via `supabase-js` + RLS (SELECT é aberto a qualquer
  autenticado, ver `data-model.md`), mesmo padrão de
  `hooks/use-organizations.ts`. Sugestões de valores já usados (para o
  campo Valor da Classificação) também são uma leitura direta, agregando
  `distinct tag_value` por `tag_type` já cadastrado.
- **Escreve**: `entities` (INSERT/UPDATE/DELETE), `entity_accounts`
  (INSERT/DELETE, substituição completa a cada edição), `entity_tags`
  (INSERT/DELETE, substituição completa a cada edição) — todas via as 3
  Edge Functions abaixo, nunca diretamente pelo client (Princípio técnico
  2, mesmo padrão de `communications`).

## Permissões

| Ação | Quem pode |
|---|---|
| Acessar `/admin/entities` | usuário autenticado com `is_admin = true` |
| Ver a lista de Entidades (fora desta tela — ex: enriquecimento em `author-linking.md`) | qualquer usuário autenticado (leitura global, ver `data-model.md`) |
| Criar/editar/desativar/reativar/excluir Entidade | admin |

## Notificações / Feedback ao usuário

| Evento | Feedback |
|---|---|
| Entidade criada | Toast: "Entidade [nome] cadastrada" |
| Entidade atualizada | Toast: "Entidade [nome] atualizada" |
| Entidade desativada/reativada | Toast: "[nome] desativada" / "[nome] reativada" |
| Entidade excluída | Toast: "[nome] foi removida" |
| Erro em qualquer ação | Toast de erro: "Não foi possível salvar. Tente novamente." |

## Dependências técnicas

- Edge Functions (autossuficientes, Princípio técnico 5; client Supabase
  com **chave publicável + JWT do usuário encaminhado**, mesmo padrão de
  exceção usado por `communications` — RLS continua sendo a garantia real
  via `is_current_user_admin()`, a Edge Function existe para checar
  admin cedo, traduzir erro amigável, e substituir
  `entity_accounts`/`entity_tags` numa sequência de chamadas coerente):
  - `create-entity` — valida `type`/`name` obrigatórios; insere `entities`
    e, em seguida, todas as linhas de `entity_accounts`/`entity_tags`
    enviadas; traduz violação de `entity_accounts_unique_handle` para a
    mensagem amigável do "Fluxos alternativos".
  - `update-entity` — mesma validação; atualiza a linha de `entities`;
    apaga todas as `entity_accounts`/`entity_tags` daquela Entity e
    reinsere o conjunto enviado (substituição completa, não diff — ver
    "Fluxo principal" item 6); usada também para `is_active` (Desativar/
    Reativar, envio parcial só desse campo).
  - `delete-entity` — `DELETE` em `entities` (cascade cuida do resto).
  - Todas checam `is_current_user_admin()` no início do handler, antes de
    qualquer escrita — mesmo padrão de checagem explícita já usado pelos
    6 `admin-*` de `auth/user-management.md`, mesmo com RLS já garantindo
    o mesmo do lado do banco (defesa em profundidade, erro mais cedo e
    mais claro que uma falha de RLS genérica).
- Leitura da listagem (`entities`/`entity_accounts`/`entity_tags`,
  sugestões de valores já usados) é feita **diretamente pelo client** via
  `supabase-js` + RLS — sem Edge Function, mesmo padrão de leitura simples
  já usado por `communications`/`use-organizations.ts`.

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [author-linking.md](author-linking.md)
- [../auth/user-management.md](../auth/user-management.md) — padrão de tela admin-only/Edge Function/modal reaproveitado
- [../auth/data-model.md](../auth/data-model.md) — `is_current_user_admin()`
- [../communications/communication-registration.md](../communications/communication-registration.md) — padrão de Edge Function com chave publicável + JWT encaminhado, mesmo estilo de formulário com seções repetíveis
