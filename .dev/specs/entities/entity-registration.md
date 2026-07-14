---
tipo: feature-spec
módulo: entities
funcionalidade: entity-registration
status: pronto
atualizado: 2026-07-13
---

# Cadastro de Entidades (CRUD)

> ✅ **Campos reorganizados (2026-07-13)**, pedido do usuário: "renomeie o
> campo descrição para cargo, inclua um novo campo chamado partido, crie
> um campo chamado ideologia... e reorganize os dados nessas novas
> colunas." O formulário abaixo já reflete o schema atualizado
> (`data-model.md`, migration `20260731050000`) — `Descrição` (textarea
> livre) deixou de existir como campo próprio; `Cargo`/`Partido`/
> `Ideologia` são campos estruturados de "Dados básicos", não mais linhas
> de "Classificação" (`entity_tags`). Este arquivo continua `pronto`, não
> implementado — a UI/Edge Functions descritas abaixo ainda não têm
> código.

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
   português do enum `entity_type`), **Influência** (badge, quando
   avaliada — "—" quando `null`), **Contas** (contagem — ex: "2 contas" —
   ou "Nenhuma"), **Status** (Ativa/Inativa), **Ações**.
3. Filtros acima da tabela: **Busca por nome** (texto livre, client-side
   sobre a lista já carregada), **Tipo** (todos os valores de
   `entity_type`), **Mostrar inativas** (toggle, desligado por padrão).
4. Botão "Nova Entidade" → abre o modal `EntityFormModal`, com 3 seções:
   - **Dados básicos**: Tipo (obrigatório, select com os 7 valores de
     `entity_type`), Nome (obrigatório), Descrição (opcional, textarea),
     URL da foto (opcional), Nível de influência sobre o candidato
     (opcional, select com os 4 níveis — ver `data-model.md`,
     `influence_level`).
   - **Contas nas redes** (repetível, 0 ou mais linhas): Plataforma (texto
     livre com sugestões das plataformas já conhecidas —
     twitter/instagram/facebook/tiktok/reddit/linkedin/news/blog),
     Usuário/handle (obrigatório se a linha existir — exatamente como
     aparece na Brandwatch, sem `@` a menos que a Brandwatch use `@`),
     URL do perfil (opcional). Botão "+ Adicionar conta" adiciona uma
     linha vazia; cada linha tem um "✕" para remover.
   - **Classificação** (repetível, 0 ou mais linhas): Dimensão (`tag_type`
     — select com o vocabulário sugerido de `data-model.md` **mais** um
     campo "Outra dimensão..." que aceita texto livre, já que
     `entity_tags` é extensível por design), Valor (`tag_value`, texto
     livre, com sugestões quando a dimensão escolhida já tem valores
     usados por outras Entities — ex: digitar "party" sugere as siglas já
     cadastradas). Botão "+ Adicionar classificação"/"✕" por linha, mesmo
     padrão da seção de contas.
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
  (`InfluenceBadge`), não reaproveitar `RiskBadge` diretamente.
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
