---
tipo: module-overview
módulo: command-center
status: rascunho
atualizado: 2026-07-12
---

# Módulo: Command Center (Sprint 2)

> Primeira spec deste módulo (`_index.md` ainda listava "—" na coluna
> Specs). Nasce de uma necessidade pontual: a seção "Ações e decisões" do
> detalhe de Narrativa
> ([intelligence-center/narratives-exploration.md](../intelligence-center/narratives-exploration.md))
> precisa de `cases` para mostrar dado real. Pedido do usuário (2026-07-12):
> "Detalhe o que está faltando para se encaixar no protótipo" — esta spec
> cobre **só o necessário pra essa seção específica**, não o Command Center
> completo (CRUD de Casos, checklist, comentários, arquivos, histórico de
> status) — esse continua `rascunho`/Sprint 2, sem spec de features
> própria ainda.

## O que falta para a seção "Ações e decisões" funcionar

O protótipo mostra, por Narrativa: uma lista de ações/recomendações com
**título, status (Concluída/Em andamento/Pendente), responsável e prazo**.
Mapeado contra o glossário (`_glossary.md`, entidade "Caso"), isso é um
subconjunto de `cases`:

| Campo do protótipo | Coluna de `cases` (ver `_glossary.md`) |
|---|---|
| Título da ação | `title` |
| Status (Concluída/Em andamento/Pendente) | `status` (`case_status`: `open`\|`in_progress`\|`waiting`\|`resolved`\|`archived` — mapeamento de rótulo pro produto fica em aberto, ver abaixo) |
| Responsável | `assignee_id` |
| Prazo | `due_date` |

**O que ainda não existe e bloqueia isso**:

1. **Tabela `cases` em si** — nenhuma migration criou `cases`/satélites
   ainda (o schema anexo do Dia 1 tinha `casos` em português; a tradução
   pra inglês já está mapeada em `_index.md` mas não aplicada em migration
   real).
2. **Vínculo `cases.narrative_id`** — nem o glossário nem o schema anexo
   fecham explicitamente essa FK (a definição de Caso diz "pode estar
   vinculado a 0 ou 1 Category/Narrativa Brandwatch", mas isso soa como
   vínculo direto a `bw_category_id`, não a `narratives.id`). ⚠️ DECISÃO
   PENDENTE: `cases.narrative_id` deveria referenciar `narratives(id)`
   diretamente (recomendado — mantém a FK dentro do próprio produto, sem
   depender de `bw_category_id` estar preenchido) ou `bw_category_id`
   (mais fraco — Narrativas sem Category vinculada nunca teriam Casos)?
   Esta spec assume a primeira opção (`narrative_id uuid references
   narratives(id)`) como recomendação, não como decisão fechada.
3. **`assignee_id`** — referencia quem? `_index.md` menciona
   `organization_members` para associação usuário↔organização, mas não
   existe uma tabela de "perfil de usuário" com nome exibível ainda (só
   `auth.users`, sem nome/avatar próprios do produto). ⚠️ DECISÃO
   PENDENTE: `assignee_id uuid references auth.users(id)` (mínimo viável,
   nome exibido via metadata do Supabase Auth) ou uma tabela `user_profiles`
   própria? Não decidir silenciosamente — impacta todo o resto do Command
   Center, não só esta seção.
4. **Mapeamento de rótulo de Status** — o protótipo usa 3 rótulos
   (Concluída/Em andamento/Pendente), mas `case_status` tem 5 valores
   (`open`/`in_progress`/`waiting`/`resolved`/`archived`, ver `_index.md`
   nota de nomenclatura). ⚠️ DECISÃO PENDENTE: mapeamento exato (ex:
   `open`+`waiting` → "Pendente"? `archived` aparece na UI ou fica oculto?)
   fica para quando a spec de feature completa do Command Center for
   escrita.

## Escopo explicitamente fora desta spec

Checklist (`case_checklist_items`), comentários (`case_comments`), arquivos
(`case_files`), histórico de status (`case_status_history`), criação/edição
de Casos pela UI, atribuição de responsável, notificações — tudo isso é o
Command Center completo, que precisa da sua própria spec de feature
(`command-center/case-management.md` ou similar) antes de ser implementado.
Esta spec **não** desbloqueia essas partes.

## Recomendação para destravar "Ações e decisões" sem esperar o Command Center inteiro

Dado que as 4 pendências acima são decisões de produto (não technical
blockers), a rota mais rápida para a seção do protótipo funcionar com dado
real, sem abrir todo o escopo do Command Center agora, é:

1. Decidir as 4 pendências acima (idealmente numa mesma resposta do
   usuário, já que são pequenas).
2. Criar só `cases` com as colunas mínimas da tabela acima + `narrative_id`
   + `organization_id` (resolvido via `narratives.organization_id`, mesmo
   padrão satélite de `narrative_signals`) + RLS `org_isolation_cases`.
3. A seção "Ações e decisões" vira **só leitura** (lista simples,
   ordenada por `due_date`) — sem criar/editar Casos pela UI ainda (isso
   fica pro Command Center completo).

Sem essa decisão, `narratives-exploration.md` mantém `<EmptyState />`
("Nenhuma ação registrada ainda") nessa seção — não é um bloqueador do
resto da página.

## Referências relacionadas

- [intelligence-center/narratives-exploration.md](../intelligence-center/narratives-exploration.md)
- [_glossary.md](../_glossary.md) — entidade "Caso"
- [_index.md](../_index.md) — tabela de renomeação do schema anexo (`casos` → `cases`)
