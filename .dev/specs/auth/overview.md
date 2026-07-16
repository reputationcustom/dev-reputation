---
tipo: module-overview
módulo: auth
status: implementado
atualizado: 2026-07-14
---

# Módulo: Autenticação e Administração de Usuários

> ✅ **Status corrigido 2026-07-14** (premissa do projeto, ver CLAUDE.md
> "Close the loop"): as 4 specs deste módulo (`data-model.md`, `login.md`,
> `password-recovery.md`, `user-management.md`) estão todas
> `implementado` desde 2026-07-13 — este overview ficava `pronto` por
> defasagem de tracking. Ver `CLAUDE.md`, "Módulo auth (Sprint 2)", pro
> detalhe completo.

> Nasce a partir de pedido explícito do usuário (2026-07-13): "Todas as
> funcionalidades só poderão ser utilizadas por usuários logados" +
> administração de usuários restrita a admins, com um admin principal
> (`lidiane.carvalho@gmail.com`) que não pode ser excluído. Até aqui, login
> era tratado como pré-requisito implícito (a base de `organization_members`
> já resolve organização via `auth.uid()`), sem spec própria nem UI — este
> módulo fecha esse gap e é **pré-requisito de todas as páginas do
> produto**, não só das já especificadas em `intelligence-center`.

## Objetivo

Autenticar usuários via Supabase Auth (login por e-mail/senha, recuperação
de senha) e dar a administradores da plataforma uma tela para conceder e
revogar acesso: nenhuma outra funcionalidade do produto — presente ou
futura — é acessível sem sessão válida.

## Funcionalidades

| Funcionalidade      | Descrição resumida                                                          | Status | Spec |
|----------------------|--------------------------------------------------------------------------------|--------|------|
| `login`              | Login por e-mail/senha via Supabase Auth + proteção de rota (middleware)      | pronto | [login.md](login.md) |
| `password-recovery`  | "Esqueci minha senha" + definição de nova senha, via Supabase Auth            | pronto | [password-recovery.md](password-recovery.md) |
| `user-management`    | CRUD de usuários restrito a admins: convidar, revogar, excluir, alternar admin | pronto | [user-management.md](user-management.md) |

> ✅ [data-model.md](data-model.md) já está **implementado** (migration
> `20260713000000_user_profiles_and_principal_admin.sql`) — cria
> `user_profiles` e cadastra o admin principal
> (`lidiane.carvalho@gmail.com`). As três funcionalidades acima (`login`,
> `password-recovery`, `user-management`) são specs `pronto`, ainda sem
> UI/Edge Function implementada.

## Dependências

- **Módulos que este depende**: nenhum — usa só Supabase Auth (nativo) e a
  tabela nova `user_profiles` (ver [data-model.md](data-model.md)), sem
  depender de dado sincronizado da Brandwatch.
- **Módulos que dependem deste**: **todos**. `intelligence-center` (nenhuma
  rota é acessível sem sessão — ver "Proteção de rota" em
  [login.md](login.md); também `cases.assignee_id` passa a
  referenciar `user_profiles`, ver nota em
  [../intelligence-center/narratives-exploration.md](../intelligence-center/narratives-exploration.md)
  "Ações e decisões"), e qualquer módulo futuro que precise saber quem é o
  usuário autenticado ou exibir seu nome.

## Ordem de implementação

Ordem estrita — cada etapa consome a saída da anterior:

1. [data-model.md](data-model.md) → cria `user_profiles` + funções/policies/trigger.
2. [login.md](login.md) → depende só do Supabase Auth nativo + `user_profiles` para
   resolver `is_admin` (visibilidade de menu) — **é o que desbloqueia
   publicar qualquer página protegida**, deve ser implementado antes ou
   junto do pacote backend de `aggregated-metrics` (ver "Sequência de
   implantação — Sprint 2" em `_index.md`).
3. [password-recovery.md](password-recovery.md) → reusa o mesmo layout/estado de
   `login.md`, pode vir logo depois, não bloqueia mais nada.
4. [user-management.md](user-management.md) → depende de `data-model.md` (RLS/
   trigger do admin principal) e do conceito de sessão de `login.md`; não
   bloqueia as páginas de `intelligence-center` — só é necessário antes de
   a Lidi precisar conceder acesso a um segundo usuário real.

## Rotas/Páginas

| Rota              | Página                  | Acesso                                  |
|--------------------|--------------------------|-------------------------------------------|
| `/login`           | `LoginPage`              | público (redireciona se já autenticado)   |
| `/forgot-password`  | `ForgotPasswordPage`     | público                                    |
| `/reset-password`   | `ResetPasswordPage`      | público (só com token de recovery válido) |
| `/admin/users`      | `UserManagementPage`     | autenticado **e** `user_profiles.is_admin = true` |

Todas as demais rotas do produto (`/overview`, `/narratives`, etc. — ver
`intelligence-center/overview.md` e módulos futuros) passam a exigir sessão
válida a partir deste módulo — ver "Proteção de rota" em
[login.md](login.md).

## Dados gerenciados

Ver [data-model.md](data-model.md): tabela nova `user_profiles` (perfil
1:1 com `auth.users`, guarda `is_admin`/`is_principal`/`full_name`).
Nenhuma tabela nova para sessão/token — Supabase Auth gerencia
`auth.users`/`auth.sessions` nativamente, este módulo nunca acessa essas
tabelas diretamente (só via SDK/Admin API).

## Notas para implementação

- **Nunca** consultar `auth.users` diretamente do frontend nem via
  PostgREST — não é exposta e não deveria ser. Toda operação administrativa
  (listar, convidar, revogar, excluir usuários) passa por Edge Functions
  usando `supabase.auth.admin.*` com `SUPABASE_SECRET_KEY` (Princípios
  técnicos 1 e 2 em `_index.md`).
- `is_admin` é um **flag global da plataforma**, não por organização — este
  produto é operado por uma única agência (Lidi) para múltiplos clientes
  (`organizations`); não existe hoje o conceito de "admin do cliente X".
  Se isso mudar, é uma extensão aditiva (`organization_members.role`), não
  uma migration desta tabela.

## Referências relacionadas

- [_index.md](../_index.md) — Princípios técnicos, "Sequência de implantação — Sprint 2".
- [_glossary.md](../_glossary.md)
- [../foundation/data-model.md](../foundation/data-model.md) — `organizations`/`organization_members`/`auth_organization_ids()`.
