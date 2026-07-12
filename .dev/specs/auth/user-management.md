---
tipo: feature-spec
módulo: auth
funcionalidade: user-management
status: implementado
atualizado: 2026-07-13
---

# Administração de Usuários

> ✅ **Implementado (2026-07-13)**: `app/admin/users/` (gate de `is_admin`
> no Server Component, tabela + modais em Client Components) + as 6 Edge
> Functions em `supabase/functions/admin-*`. Uma decisão tomada durante a
> implementação, sobre a ⚠️ DECISÃO PENDENTE de "Regras de negócio"
> (banimento do admin principal não coberto pelo trigger de banco): optei
> por **implementar o reforço recomendado** — `admin-revoke-user-access`
> agora bloqueia `revoke: true` quando `user_profiles.is_principal`, além
> da UI já ocultar a ação nessa linha. Custo baixo (uma query a mais) pelo
> ganho de fechar o gap descrito no próprio spec; ver o comentário no topo
> do arquivo da function. Ver `CLAUDE.md` "Módulo auth (Sprint 2)" para o
> resto do detalhe de implementação (padrão de autenticação das Edge
> Functions, toasts sem biblioteca externa, etc).

## Objetivo

Dar a administradores da plataforma (`user_profiles.is_admin = true`) uma
tela para conceder e revogar acesso ao produto: não existe auto-cadastro
no MVP — **só um admin pode criar/liberar acesso a um novo usuário**
(pedido explícito do usuário, 2026-07-13).

## Usuários afetados

Exclusivamente usuários com `user_profiles.is_admin = true`. Qualquer
outro usuário autenticado que tente acessar `/admin/users` é bloqueado
(ver "Permissões").

## Fluxo principal

1. Admin acessa `/admin/users` (item de menu "Administração", só visível
   para admins — ver `login.md`, "Regras de negócio").
2. Tabela com todos os usuários da plataforma: **Nome**, **E-mail**,
   **Organizações**, **Admin** (toggle), **Status** (Ativo/Revogado),
   **Ações**.
3. Botão "Convidar usuário" → abre modal: **E-mail** (obrigatório),
   **Nome** (opcional), **Organizações** (multi-select de `organizations`),
   **É administrador?** (toggle, default desligado).
4. Submit do modal → Edge Function `admin-invite-user` (ver "Dependências
   técnicas"):
   - `supabase.auth.admin.inviteUserByEmail(email)` — cria a conta em
     `auth.users` **sem senha** e dispara e-mail de convite nativo do
     Supabase Auth (o usuário define a própria senha ao aceitar,
     reaproveitando o fluxo de `password-recovery.md` por baixo — mesmo
     mecanismo de token de recovery).
   - Cria `user_profiles` (`full_name`, `is_admin` conforme o toggle).
   - Cria uma linha em `organization_members` por organização selecionada.
5. Toggle "Admin" numa linha da tabela → Edge Function
   `admin-set-user-role` atualiza `user_profiles.is_admin` daquele usuário
   — **desabilitado/oculto** na linha do admin principal (ver "Regras de
   negócio").
6. Ação "Revogar acesso" (menu de ações da linha) → Edge Function
   `admin-revoke-user-access`: `auth.admin.updateUserById(id, {
   ban_duration: '876000h' })` (~100 anos, efetivamente indefinido — não
   existe "unban" nativo com duração menor sem reconceder explicitamente).
   Linha muda para Status "Revogado"; usuário não consegue mais logar (ver
   `login.md`, "Conta revogada/banida").
7. Ação "Restaurar acesso" (só aparece para usuários revogados) →
   `admin-revoke-user-access` com `ban_duration: 'none'` — reativa.
8. Ação "Excluir usuário" (menu de ações, com confirmação) → Edge Function
   `admin-delete-user`: `auth.admin.deleteUser(id)` — remoção permanente
   (cascade em `user_profiles`/`organization_members`, ver
   `data-model.md`). **Bloqueada** para o admin principal (ver "Regras de
   negócio").
9. Ação "Editar organizações" (menu de ações de qualquer linha, incl. a do
   admin principal — só a exclusão/rebaixamento dele é bloqueada, o
   vínculo com organizações não) → abre o mesmo multi-select de
   `organizations` do convite, pré-preenchido com as organizações atuais
   do usuário. Submit → Edge Function `admin-update-user-organizations`:
   calcula o diff (organizações marcadas que não existiam → INSERT em
   `organization_members`; organizações desmarcadas que existiam →
   DELETE) — nunca substitui a tabela inteira às cegas. **Um usuário pode
   pertencer a 1 ou mais organizações simultaneamente** (já era o desenho
   de `organization_members`, N:N, desde `foundation` — esta tela é a
   primeira UI que efetivamente popula/edita isso; até aqui só era
   possível via SQL direto, ver `foundation/overview.md`, "Fora do MVP, só
   a estrutura").

## Fluxos alternativos e erros

| Situação                                             | Comportamento esperado                                                     |
|----------------------------------------------------------|----------------------------------------------------------------------------------|
| Usuário não-admin tenta acessar `/admin/users`           | Middleware/servidor redireciona (ex: para `/overview`) — a rota nunca renderiza para não-admin, mesmo digitando a URL direto |
| Convite para e-mail já cadastrado                        | Erro no modal: "Este e-mail já está cadastrado"                                  |
| Convite sem nenhuma organização selecionada              | Erro no modal: "Selecione ao menos uma organização" — usuário sem organização não vê dado nenhum (ver `foundation/executive-overview.md`, "Fluxos alternativos"), então é bloqueado na criação, não só avisado |
| Toggle "Admin" na linha do admin principal               | Controle desabilitado (não clicável), com tooltip "Não é possível alterar o admin principal" |
| Tentativa de excluir o admin principal                    | Ação "Excluir usuário" **não aparece** no menu dessa linha (nem chega a chamar a Edge Function — mas o backend também bloqueia via `protect_principal_account_trigger`, defesa em profundidade, ver `data-model.md`) |
| Tentativa de revogar acesso do admin principal            | Mesma UI: ação "Revogar acesso" não aparece nessa linha (⚠️ ver nota abaixo — banir não é bloqueado pelo trigger de banco, só pela UI, é um gap deliberado ou uma ⚠️ DECISÃO PENDENTE, ver "Regras de negócio") |
| "Editar organizações" desmarcando a última organização de um usuário | Erro no modal: "Selecione ao menos uma organização" — mesma regra do convite, não salva o diff |
| Falha na Edge Function (erro de rede/Supabase)            | Toast de erro: "Algo deu errado. Tente novamente."                              |

## Interface (UI)

- **Tabela**: colunas Nome, E-mail, Organizações (chips — 1 chip por
  organização, `+N` quando não couber todas na largura da coluna), Admin
  (toggle), Status (badge Ativo/Revogado), Ações (menu ⋮ — Editar
  organizações, Revogar/Restaurar acesso, Excluir usuário). Linha do
  admin principal tem um badge extra "Principal" ao lado do nome.
- **Modal "Convidar usuário"**: campos descritos no Fluxo principal, botão
  "Enviar convite" desabilitado durante loading.
- **Modal "Editar organizações"** (mesmo componente de multi-select do
  convite, reaproveitado — não duplicar UI): título "Organizações de
  [nome]", multi-select pré-preenchido, botão "Salvar" desabilitado
  durante loading e quando nenhuma organização estiver marcada (mesma
  regra do convite — usuário sem organização não vê dado nenhum).
- **Confirmação de exclusão**: modal de confirmação explícita ("Tem
  certeza que deseja excluir [nome]? Esta ação não pode ser desfeita.")
  antes de chamar `admin-delete-user` — exclusão é irreversível.
- **Estados**: `<Spinner />` (loading da tabela), `<ErrorMessage retry />`
  (falha ao carregar), `<EmptyState />` (nunca deveria ocorrer — sempre há
  ao menos o admin principal).

## Regras de negócio

- `is_admin` é avaliado **no servidor** (Edge Function + RLS via
  `is_current_user_admin()`) em toda ação administrativa — o toggle
  desabilitado na UI é conveniência, não a garantia de segurança
  (Princípio técnico 2).
- Admin principal (`is_principal = true`): não pode ser excluído nem
  perder `is_admin` — garantido por `protect_principal_account_trigger`
  (`data-model.md`), a prova de bypass mesmo por chamada direta à Admin
  API.
  ⚠️ **DECISÃO PENDENTE**: o trigger de banco cobre exclusão/rebaixamento
  de admin, mas **não** cobre banimento (`updateUserById({ban_duration})`)
  — tecnicamente um admin (não-principal, mas com acesso à Edge Function)
  poderia banir a conta principal, já que ban é um campo em `auth.users`,
  fora do alcance do trigger em `user_profiles`. Mitigado nesta versão só
  na camada de UI (ação oculta) e pode ser reforçado na própria Edge
  Function `admin-revoke-user-access` (checar `is_principal` antes de
  chamar `updateUserById`) — recomendado, mas não decidido como
  obrigatório: se o único admin capaz de chamar essa função já é
  confiável (é um admin), o risco é baixo neste MVP de agência única.
- Convite, não criação direta de senha: a Edge Function nunca define ou vê
  a senha de um novo usuário (usa `inviteUserByEmail`, não
  `createUser({password})`) — evita que qualquer pessoa (mesmo um admin)
  conheça a senha de outra conta, mesmo que temporariamente.
- Um usuário sem nenhuma organização associada consegue logar, mas cai no
  estado vazio já especificado ("Você ainda não tem acesso a nenhuma
  organização", `foundation/executive-overview.md`) — por isso o convite
  exige ao menos uma organização (ver "Fluxos alternativos").

## Dados envolvidos

- **Lê**: `user_profiles`, `organization_members`, `organizations` (para o
  multi-select), lista de usuários via `auth.admin.listUsers()` (Edge
  Function, nunca do client).
- **Escreve**: `user_profiles` (INSERT/UPDATE), `organization_members`
  (INSERT ao convidar e ao editar organizações; DELETE ao remover
  organização de um usuário existente), `auth.users` (via Admin API:
  convite/ban/delete, nunca `UPDATE`/`DELETE` SQL direto).

## Permissões

| Ação                              | Quem pode                          |
|--------------------------------------|---------------------------------------|
| Acessar `/admin/users`              | usuário autenticado com `is_admin = true` |
| Convidar usuário                    | admin                                  |
| Alternar `is_admin` de outro usuário | admin (exceto na linha do admin principal) |
| Editar organizações de um usuário    | admin (incl. na linha do admin principal — só exclusão/rebaixamento de admin são bloqueados para ele, não o vínculo com organizações) |
| Revogar/restaurar acesso            | admin (exceto na linha do admin principal, ver nota) |
| Excluir usuário                     | admin (exceto o admin principal — bloqueado em UI e banco) |

## Notificações / Feedback ao usuário

| Evento                        | Feedback                                                   |
|-----------------------------------|------------------------------------------------------------------|
| Convite enviado                   | Toast: "Convite enviado para [e-mail]"                            |
| Admin alternado                   | ✅ **Alterado 2026-07-13** (regra global "Regras transversais de UX" #3 em CLAUDE.md: toda ação com efeito colateral produz toast): toast de sucesso além do toggle otimista — texto original desta linha ("sem toast") ficou superado pela regra global, que tem precedência |
| Acesso revogado/restaurado        | Toast: "Acesso revogado para [nome]" / "Acesso restaurado para [nome]" |
| Organizações atualizadas          | Toast: "Organizações de [nome] atualizadas"                       |
| Usuário excluído                  | Toast: "[nome] foi removido"                                      |
| Erro em qualquer ação             | Toast de erro: "Algo deu errado. Tente novamente."                |

## Dependências técnicas

- Edge Functions (todas autossuficientes, Princípio técnico 5, todas
  exigindo `is_current_user_admin()` no início do handler antes de
  qualquer chamada à Admin API):
  - `admin-invite-user`
  - `admin-set-user-role`
  - `admin-update-user-organizations` (calcula o diff de
    `organization_members`, ver "Fluxo principal" passo 9)
  - `admin-revoke-user-access`
  - `admin-delete-user`
  - `admin-list-users` (combina `auth.admin.listUsers()` +
    `user_profiles` + `organization_members`/`organizations` numa
    resposta só, pro frontend não fazer 3 chamadas)
- `SUPABASE_SECRET_KEY` em todas — são as únicas Edge Functions do produto
  que chamam `supabase.auth.admin.*`.

## Referências relacionadas

- [overview.md](overview.md)
- [login.md](login.md)
- [password-recovery.md](password-recovery.md)
- [data-model.md](data-model.md)
- [../intelligence-center/narratives-exploration.md](../intelligence-center/narratives-exploration.md) — "Ações e decisões" (`cases.assignee_id` referencia `user_profiles`)
