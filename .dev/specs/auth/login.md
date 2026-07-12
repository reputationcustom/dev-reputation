---
tipo: feature-spec
módulo: auth
funcionalidade: login
status: pronto
atualizado: 2026-07-13
---

# Login

## Objetivo

Permitir que um usuário já cadastrado (por um admin, ver
[user-management.md](user-management.md) — não há auto-cadastro no MVP)
acesse o sistema com e-mail e senha, e garantir que **nenhuma outra
página do produto seja acessível sem essa sessão**.

## Usuários afetados

Qualquer usuário com conta já criada por um admin. Visitantes sem conta
não têm como se cadastrar sozinhos (fora de escopo do MVP, ver
`user-management.md`).

## Fluxo principal

1. Usuário não autenticado acessa qualquer rota do produto → middleware
   (ver "Proteção de rota" abaixo) redireciona para `/login?next=<rota
   original>`.
2. Formulário: **E-mail** e **Senha**, botão "Entrar".
3. Submit → `supabase.auth.signInWithPassword({ email, password })` (client
   Supabase do browser, `lib/supabase/client.ts`).
4. Sucesso → sessão persistida via cookies (`@supabase/ssr`) → redireciona
   para `next` (se veio na URL) ou `/overview` (default).
5. A cada requisição subsequente, `lib/supabase/server.ts` (server
   components/middleware) lê a sessão dos cookies — nenhuma chamada extra
   de login é necessária até a sessão expirar.

## Proteção de rota (aplica-se a todo o produto, não só a este módulo)

- `middleware.ts` na raiz do app roda em **toda** requisição, exceto uma
  lista explícita de rotas públicas: `/login`, `/forgot-password`,
  `/reset-password`, mais assets estáticos (`_next/*`, favicon etc.).
- Sem sessão válida → redireciona para `/login?next=<pathname original>`.
- Com sessão válida acessando `/login` diretamente → redireciona para
  `/overview` (não mostra o formulário de novo).
- Esta é a **única** verificação de "usuário logado" do produto — nenhuma
  página individual (`intelligence-center/*.md` ou módulos futuros)
  reimplementa essa checagem; todas assumem sessão válida como
  pré-condição, documentada uma vez aqui (Princípio técnico 2: lógica de
  acesso é backend/middleware, não duplicada por página).
- RLS (`auth_organization_ids()`, `is_current_user_admin()`) continua
  sendo a garantia real de isolamento de **dado** — o middleware só
  garante que existe uma sessão, não decide o que ela pode ver.

## Fluxos alternativos e erros

| Situação                                | Comportamento esperado                                              |
|-------------------------------------------|-------------------------------------------------------------------------|
| Campo e-mail vazio                        | Erro inline: "E-mail obrigatório"                                       |
| Campo senha vazio                         | Erro inline: "Senha obrigatória"                                        |
| E-mail com formato inválido               | Erro inline: "E-mail inválido"                                          |
| Credenciais incorretas                    | Erro geral no form: "E-mail ou senha incorretos" — **não** revelar se o e-mail existe ou não (proteção contra enumeração de contas) |
| Conta revogada/banida (ver `user-management.md`, "Revogar acesso") | Supabase Auth rejeita o login nativamente (`banned_until`) — mesma mensagem genérica acima, não um erro específico de "conta desativada" (evita confirmar pra um atacante que a conta existe mas está banida) |
| Erro de rede/servidor                     | Toast de erro: "Algo deu errado. Tente novamente."                     |
| Usuário já autenticado acessa `/login`    | Redireciona imediatamente para `/overview` (ou `next`), sem exibir form |

## Interface (UI)

- **Tela**: Centralizada vertical e horizontalmente, card com sombra suave
  — mesmo padrão visual de `_design-tokens.md`.
- **Campos**: E-mail (`type=email`, `autocomplete=email`), Senha
  (`type=password`, `autocomplete=current-password`).
- **Botão "Entrar"**: largura total do card; desabilitado durante loading.
- **Estado de loading**: spinner dentro do botão, campos desabilitados.
- **Link**: "Esqueceu a senha?" → `/forgot-password`.
- Sem link de cadastro — não existe auto-cadastro no MVP (ver
  `user-management.md`).

## Regras de negócio

- Senha não é validada no frontend além de "não vazia" — força de senha é
  responsabilidade da criação da conta (`user-management.md`) e da
  recuperação (`password-recovery.md`).
- Limite de tentativas/rate limiting: nativo do Supabase Auth, não
  reimplementado pelo produto.
- Sessão expira conforme configuração do projeto Supabase (JWT + refresh
  token, gerenciado por `@supabase/ssr`), sem lógica própria de expiração
  no frontend.
- Menu/navegação exibe o item "Administração" (`/admin/users`) só quando
  `user_profiles.is_admin = true` do usuário logado — lido uma vez após o
  login, cacheado na sessão do frontend (não é RLS: é só visibilidade de
  UI; o acesso real à rota é validado de novo no servidor, ver
  `user-management.md` "Permissões").

## Dados envolvidos

- **Lê**: `auth.users` (via SDK do Supabase Auth, nunca consulta direta),
  `user_profiles` (para resolver `is_admin`/`full_name` pós-login).
- **Escreve**: nenhuma tabela customizada — sessão gerenciada pelo Supabase
  Auth.

## Permissões

| Ação                     | Quem pode           |
|----------------------------|-----------------------|
| Acessar `/login`          | qualquer visitante    |
| Submeter o formulário      | qualquer visitante    |
| Acessar qualquer outra rota | só sessão autenticada (ver "Proteção de rota") |

## Notificações / Feedback ao usuário

| Evento              | Feedback                                              |
|----------------------|---------------------------------------------------------|
| Login com sucesso    | Sem toast — redirecionamento imediato                   |
| Erro de credencial   | Mensagem vermelha no topo do formulário                  |
| Erro de servidor     | Toast vermelho: "Algo deu errado. Tente novamente."     |

## Dependências técnicas

- `lib/supabase/client.ts` (browser) / `lib/supabase/server.ts` (server
  components, `next/headers`) — já previstos na arquitetura do projeto
  (`_index.md`), este módulo é o primeiro a efetivamente usá-los para auth.
- `middleware.ts` (novo arquivo, raiz do projeto Next.js).
- `user_profiles` (ver [data-model.md](data-model.md)).

## Referências relacionadas

- [overview.md](overview.md)
- [password-recovery.md](password-recovery.md)
- [user-management.md](user-management.md)
- [data-model.md](data-model.md)
