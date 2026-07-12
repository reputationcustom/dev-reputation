---
tipo: feature-spec
módulo: auth
funcionalidade: password-recovery
status: implementado
atualizado: 2026-07-13
---

# Recuperação de Senha

> ✅ **Implementado (2026-07-13)**: `app/forgot-password/` +
> `app/reset-password/`. Único acréscimo além do texto do spec: após
> `updateUser({ password })` bem-sucedido, o formulário chama
> `supabase.auth.signOut()` antes de redirecionar para `/login` — necessário
> para cumprir literalmente "não faz login automático" (a sessão de
> recuperação usada por `updateUser` já deixa o usuário autenticado, então
> sem esse `signOut()` explícito ele continuaria logado).
>
> ✅ **Ajustado 2026-07-13** (regra global "Falha de comunicação com o
> backend" em CLAUDE.md): a checagem de sessão de `/reset-password` no
> mount (`supabase.auth.getSession()`) ignorava o campo `error` do retorno
> e tratava qualquer ausência de sessão — inclusive uma falha de
> rede/backend genuína — como "link expirado ou inválido". Corrigido com um
> 4º estado (`SessionState`: `checking`/`valid`/`invalid`/`error`) distinto
> do estado "link inválido" original do spec — `error` mostra
> `BACKEND_ERROR_MESSAGE` + "Tentar novamente" (re-executa a checagem),
> nunca a mensagem de link expirado quando o problema foi de conectividade.

## Objetivo

Permitir que um usuário que esqueceu a senha (ou precise trocar a senha
de bootstrap fraca, ver `data-model.md` "Seed — admin principal") a
redefina sozinho, via e-mail, sem intervenção de um admin.

## Usuários afetados

Qualquer usuário com conta já criada (visitantes não têm conta a
recuperar — mesmo universo de `login.md`).

## Fluxo principal

1. Usuário acessa `/forgot-password` (a partir do link em `/login`).
2. Formulário: campo **E-mail**, botão "Enviar instruções".
3. Submit → `supabase.auth.resetPasswordForEmail(email, { redirectTo:
   '<app-url>/reset-password' })`.
4. Tela muda para estado de confirmação (ver "Interface" abaixo) —
   **sempre** a mesma mensagem, exista ou não o e-mail (ver "Regras de
   negócio").
5. Usuário recebe e-mail (template padrão do Supabase Auth, sem
   customização de conteúdo no MVP) com link de recuperação.
6. Ao clicar, é redirecionado para `/reset-password` com uma sessão de
   recuperação temporária (gerenciada pelo Supabase Auth via o token na
   URL — o SDK client-side troca isso por uma sessão válida
   automaticamente).
7. Formulário: **Nova senha** + **Confirmar nova senha**, botão "Redefinir
   senha".
8. Submit → `supabase.auth.updateUser({ password })`.
9. Sucesso → redireciona para `/login` com mensagem "Senha redefinida,
   faça login com a nova senha" (não faz login automático — força
   reautenticação explícita).

## Fluxos alternativos e erros

| Situação                                    | Comportamento esperado                                                    |
|------------------------------------------------|-------------------------------------------------------------------------------|
| E-mail não cadastrado                          | Mesma mensagem de sucesso genérica do fluxo normal — **nunca** revelar se o e-mail existe (proteção contra enumeração, mesma regra de `login.md`) |
| Campo e-mail vazio/inválido (`/forgot-password`) | Erro inline: "E-mail obrigatório"/"E-mail inválido"                          |
| Link de recuperação expirado ou já usado         | `/reset-password` mostra erro: "Link expirado ou inválido. Solicite um novo." com link de volta a `/forgot-password` |
| Nova senha muito curta (< 6 caracteres, mínimo padrão do Supabase Auth) | Erro inline: "Senha deve ter pelo menos 6 caracteres"                        |
| Confirmação não bate com a nova senha            | Erro inline: "As senhas não coincidem"                                       |
| Erro de rede/servidor                            | Toast de erro: "Algo deu errado. Tente novamente."                          |

## Interface (UI)

### `/forgot-password`

- Mesmo padrão visual de card centralizado de `login.md`.
- **Estado inicial**: campo e-mail + botão "Enviar instruções" + link
  "Voltar para o login".
- **Estado de confirmação** (pós-submit, sempre exibido independente do
  e-mail existir): "Se esse e-mail estiver cadastrado, você receberá
  instruções para redefinir sua senha em alguns minutos." + link "Voltar
  para o login".

### `/reset-password`

- Mesmo padrão de card.
- Campos: Nova senha, Confirmar nova senha (ambos `type=password`).
- **Estado de erro** (link inválido/expirado): substitui o formulário por
  mensagem de erro + link para `/forgot-password` (ver tabela acima).
- **Estado de loading**: spinner no botão, campos desabilitados.

## Regras de negócio

- **Nunca revelar se um e-mail existe** na base — tanto no fluxo normal
  quanto num e-mail não cadastrado, a resposta da tela é idêntica. Isso é
  uma decisão de segurança, não um detalhe visual — não alterar sem
  avaliar o trade-off de enumeração de contas.
- Validação de senha (mínimo 6 caracteres) é a validação nativa do
  Supabase Auth — o frontend replica a mensagem, mas quem garante a regra
  é o backend do Supabase, não uma checagem só client-side.
- Link de recuperação tem validade curta (padrão do Supabase Auth, não
  configurado por este produto) — não é responsabilidade do frontend
  controlar expiração, só tratar o erro que o SDK retorna.

## Dados envolvidos

- **Lê/Escreve**: nenhuma tabela customizada — inteiramente via Supabase
  Auth SDK (`resetPasswordForEmail`/`updateUser`), mesmo padrão de
  `login.md`.

## Permissões

| Ação                              | Quem pode                                          |
|--------------------------------------|-------------------------------------------------------|
| Acessar `/forgot-password`          | qualquer visitante                                    |
| Acessar `/reset-password`           | qualquer um com um link de recuperação válido (token na URL) |

## Notificações / Feedback ao usuário

| Evento                          | Feedback                                                        |
|-------------------------------------|----------------------------------------------------------------------|
| Instruções enviadas                 | Estado de confirmação inline (ver "Interface"), sem toast            |
| Senha redefinida com sucesso        | Redireciona para `/login` com mensagem de sucesso (toast ou banner)  |
| Link inválido/expirado              | Erro inline substituindo o formulário                                |

## Dependências técnicas

- Mesmos clients Supabase de `login.md` (`lib/supabase/client.ts`).
- Configuração de e-mail do Supabase Auth (template de recuperação,
  domínio de redirect) — configuração de projeto, fora do escopo desta
  spec (feita uma vez no Supabase Dashboard, não é código do app).

## Referências relacionadas

- [overview.md](overview.md)
- [login.md](login.md)
- [data-model.md](data-model.md) — "Seed — admin principal" (senha de
  bootstrap deve ser trocada via este fluxo)
