---
tipo: data-model
módulo: auth
status: implementado
atualizado: 2026-07-22
---

# Modelo de Dados — Autenticação e Administração de Usuários

> ✅ **Implementado (2026-07-16)**: bug real corrigido — contas em
> `auth.users` criadas fora do fluxo `admin-invite-user` (ex: direto pelo
> Dashboard) ficavam sem linha em `user_profiles`, causando `406` ao abrir
> `/perfil` (`.single()` sem resultado). Migration
> `20260716000000_auto_create_user_profile.sql` adiciona um trigger
> `handle_new_auth_user()` em `auth.users after insert` que garante a linha
> para qualquer caminho de criação de conta, mais um backfill único para
> contas já existentes. Ver `CLAUDE.md`, "`user_profiles` 406 on `/perfil`
> — root cause and fix" para o detalhe completo.

## Entidades

### `user_profiles`

**Descrição**: Perfil de aplicação 1:1 com `auth.users` (gerenciado pelo
Supabase Auth). Existe para guardar dados que o produto precisa e o
Supabase Auth não modela como coluna própria consultável via RLS: nome de
exibição e o flag de administrador da plataforma. Resolve também a
⚠️ DECISÃO PENDENTE deixada em aberto por
`intelligence-center` (`cases`, ver `intelligence-center/data-model.md` e
`intelligence-center/narratives-exploration.md`, "Ações e decisões") sobre
o que `cases.assignee_id` deveria referenciar — a resposta passa a ser
esta tabela, não `auth.users` direto.

| Campo         | Tipo           | Obrigatório | Descrição                                                        |
|---------------|----------------|-------------|--------------------------------------------------------------------|
| `id`          | `uuid`         | sim         | PK — **igual** a `auth.users.id` (não `gen_random_uuid()`), FK `references auth.users(id) on delete cascade` |
| `full_name`   | `text`         | não         | Nome de exibição; `null` até o usuário (ou o admin, ao convidar) preencher |
| `is_admin`    | `boolean`      | sim         | Default `false`. Concede acesso a `/admin/users` e às Edge Functions administrativas |
| `is_principal`| `boolean`      | sim         | Default `false`. No máximo um punhado de linhas terá `true` (MVP: exatamente uma, ver seed abaixo) — marca a conta que **nunca** pode ser excluída nem perder `is_admin`, ver trigger abaixo |
| `timezone`    | `text`         | sim         | ✅ **Adicionado 2026-07-13** (migration `20260713060000`, regra global "Fuso horário do usuário" em CLAUDE.md). Nome IANA, default `America/Sao_Paulo`. Só controla exibição no frontend — nenhuma data é armazenada em fuso local em nenhuma tabela do produto. Editável pelo próprio usuário em `/perfil`, via a Edge Function `update-my-timezone` (segunda escrita self-service em `user_profiles`, ver `default_organization_id` abaixo — todas as outras são administrativas, ver `user-management.md`) |
| `default_organization_id` | `uuid` | não | ✅ **Adicionado 2026-07-22** (migration `20260722000000`, pedido do usuário: "Permitir o usuário a escolher qual organização é a default"). FK `references organizations(id) on delete set null` — `null` até o usuário escolher explicitamente (o frontend cai de volta pra primeira organização do usuário enquanto for `null`). Editável pelo próprio usuário no seletor de organização do header (`components/intelligence-center/page-header-bar.tsx`), via a Edge Function `update-my-default-organization` (terceira escrita self-service em `user_profiles`) — valida server-side que o usuário é de fato membro da organização enviada (`organization_members`) antes de gravar, nunca confia na lista já filtrada por RLS que o cliente devolve (Princípio técnico 2) |
| `created_at`  | `timestamptz`  | sim         | `now()`                                                            |
| `updated_at`  | `timestamptz`  | sim         | Atualizado via trigger `set_updated_at` (já definida em `foundation`) |

**Constraint**:
```sql
alter table user_profiles
  add constraint user_profiles_principal_implies_admin
  check (not is_principal or is_admin);
```
Uma conta `is_principal = true` sempre tem `is_admin = true` — não existe
"principal não-admin".

**Trigger `protect_principal_account`** (impede excluir ou rebaixar o
admin principal — inclusive por chamada direta à Admin API, não só pela UI
deste módulo, já que `auth.admin.deleteUser()` no GoTrue dispara
`DELETE ... CASCADE` em `auth.users`, que por sua vez dispara `DELETE` em
`user_profiles`, e triggers `BEFORE DELETE` disparam mesmo em deleções por
cascade):

```sql
create or replace function protect_principal_account()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.is_principal then
      raise exception 'não é permitido excluir a conta admin principal (%).', OLD.id;
    end if;
    return OLD;
  end if;
  -- UPDATE: bloqueia rebaixar is_admin ou desmarcar is_principal na conta principal
  if OLD.is_principal and (NEW.is_admin = false or NEW.is_principal = false) then
    raise exception 'não é permitido remover admin/is_principal da conta principal (%).', OLD.id;
  end if;
  return NEW;
end;
$$;

create trigger protect_principal_account_trigger
  before update or delete on user_profiles
  for each row execute function protect_principal_account();
```

> ⚠️ **Achado do Security Advisor, corrigido 2026-07-13** (migration
> `20260713070000`, ver CLAUDE.md "Database security (Security Advisor)"):
> a versão original desta function (migration `20260713000000`) não tinha
> `set search_path`, vulnerável a search-path hijacking — o bloco SQL acima
> já reflete a versão corrigida (`alter function ... set search_path =
> public`, aplicado sem recriar o corpo da function).

**Índices**:
- PK já cobre lookup por `id` (o caso mais comum: `id = auth.uid()`).
- `user_profiles_is_admin_idx` em `(is_admin)` where `is_admin = true` —
  suporta a listagem de admins na tela de administração sem scan completo.

**Função auxiliar `is_current_user_admin()`** (mesmo padrão de
`auth_organization_ids()` em `foundation/data-model.md` — `security
definer`/`stable`, evita recursão de RLS ao ler a própria tabela com RLS
ativa):

```sql
create or replace function is_current_user_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_admin from user_profiles where id = auth.uid()),
    false
  )
$$;
```

**Políticas RLS**:

| Operação  | Quem pode                          | Condição                                              |
|-----------|--------------------------------------|--------------------------------------------------------|
| SELECT    | o próprio usuário                    | `id = auth.uid()`                                       |
| SELECT    | qualquer admin                       | `is_current_user_admin()` — necessário pra popular a tabela de `/admin/users` |
| INSERT    | ninguém via client                   | sem policy — só a Edge Function `admin-invite-user` (via `SUPABASE_SECRET_KEY`, bypassa RLS) cria linhas |
| UPDATE    | ninguém via client                   | sem policy — só Edge Functions escrevem (via `SUPABASE_SECRET_KEY`, bypassa RLS), sempre passando pelo trigger `protect_principal_account_trigger`: `admin-set-user-role` (administrativa, qualquer linha), ✅ `update-my-timezone` (adicionada 2026-07-13, self-service — só a própria linha, `id = auth.getUser(token).id`, nunca um `user_id` recebido no body) e ✅ `update-my-default-organization` (adicionada 2026-07-22, mesmo padrão self-service, mais uma validação extra de pertencimento a `organization_members` antes de gravar) |
| DELETE    | ninguém via client                   | sem policy — exclusão de usuário é uma operação de Admin API (`auth.admin.deleteUser`), nunca um `DELETE` direto na tabela |

> Nenhuma policy de INSERT/UPDATE/DELETE para o client é proposital, não
> esquecimento — toda escrita em `user_profiles` passa por uma Edge
> Function (Princípio técnico 2: sem lógica de negócio no frontend), seja
> ela uma decisão administrativa (`admin-*`) ou self-service restrita à
> própria linha (`update-my-timezone`). Um usuário comum só lê a própria
> linha diretamente (ex: pra saber seu `full_name`/`is_admin` e decidir se
> mostra o item de menu "Administração").

## Relacionamentos

```
auth.users (Supabase Auth) ──1:1── user_profiles
auth.users                 ──< organization_members  (já existente, foundation)
user_profiles              ──< cases.assignee_id      (intelligence-center — ver nota abaixo)
```

## Nota para `intelligence-center`/`cases` (resolve pendência registrada em `narratives-exploration.md`)

Com `user_profiles` existindo, a ⚠️ DECISÃO PENDENTE #3 de "Ações e
decisões" (`assignee_id` referencia `auth.users` direto ou uma tabela de
perfil própria?) fica **resolvida**: `cases.assignee_id uuid references
user_profiles(id)` — dá nome de exibição (`full_name`) sem depender de
metadata do Supabase Auth. Já aplicado em
[../intelligence-center/data-model.md](../intelligence-center/data-model.md).

## Seed — admin principal

> ✅ Cadastrado nesta revisão (2026-07-13), pedido explícito do usuário:
> "Cadastre 1 admin como principal que não pode ser excluído da solução:
> lidiane.carvalho@gmail.com senha: 12345". A conta **já existia** (bootstrap
> original, migration `20260707020000`, senha `lidi0311`) — esta migration
> **atualiza a senha** para o valor pedido e insere a linha em
> `user_profiles` com `is_admin = true, is_principal = true`.
>
> ⚠️ **Nota de segurança, mesmo padrão de aviso já usado em
> `20260707020000_bootstrap_admin_user.sql`**: `12345` é uma senha
> propositalmente fraca, pedida para o bootstrap. Recomendo trocá-la (via
> `password-recovery.md`, já especificado neste módulo) assim que o
> primeiro acesso real for confirmado — o hash fica no histórico do git,
> reversível por força bruta se nunca for trocada.

Ver migration `20260713000000_user_profiles_and_principal_admin.sql`
(cria `user_profiles` + trigger/constraint/policies acima, atualiza a
senha do usuário existente, insere o `user_profiles` do principal).

## Notas para a migration

- Depende de `organizations`/`organization_members`/`set_updated_at`
  (`foundation`, migration `20260707000000`) já existirem — roda depois.
- `on delete cascade` em `user_profiles.id → auth.users.id` é intencional:
  se uma conta não-principal for excluída via Admin API, o perfil some
  junto, sem linha órfã. Contas `is_principal` nunca chegam a esse ponto
  (trigger bloqueia antes).
