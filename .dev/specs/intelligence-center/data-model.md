---
tipo: data-model
módulo: intelligence-center
status: pronto
atualizado: 2026-07-13
---

# Modelo de Dados — Intelligence Center

> `cases` nasce aqui, não num módulo `command-center` separado — ver nota em
> [narratives-exploration.md](narratives-exploration.md), "Ações e
> decisões" (2026-07-13): o requisito real (mostrar ações/responsável/prazo
> por Narrativa) é pequeno o bastante para não justificar um módulo à
> parte, e "Command Center" nunca chegou a ganhar spec própria além dessa
> mesma necessidade. Se checklist/comentários/arquivos/histórico de status
> completos forem pedidos no futuro, viram satélites desta mesma tabela,
> especificados quando o pedido existir — não hoje, por especulação.

## Entidades

### `cases`

**Descrição**: Ação/decisão de resposta vinculada a uma Narrativa — o que
o time de comunicação está fazendo a respeito. Consumida hoje só pela
seção "Ações e decisões" do detalhe de Narrativa
([narratives-exploration.md](narratives-exploration.md)), somente leitura.

| Campo            | Tipo           | Obrigatório | Descrição                                                          |
|-------------------|----------------|-------------|------------------------------------------------------------------------|
| `id`              | `uuid`         | sim         | PK — `gen_random_uuid()`                                                |
| `organization_id` | `uuid`         | sim         | FK → `organizations(id)` — **não** duplicado de `narrative_id`; resolvido via `narratives.organization_id` no momento do INSERT (mesmo padrão satélite de `narrative_signals`, ver `foundation/data-model.md`) |
| `narrative_id`    | `uuid`         | sim         | ✅ **Resolvido (2026-07-13)**: `references narratives(id) on delete cascade` — nunca `bw_category_id`. Confirmado pelo usuário: as tabelas `bw_*` são só espelho/leitura da Brandwatch pra estruturar as tabelas da aplicação (`narratives`, aqui) — `cases` (e qualquer dado de produto) sempre referencia a entidade viva do produto, nunca a tabela de cache diretamente. `on delete cascade` porque hoje não há caminho pra excluir uma Narrativa pela aplicação (ver `foundation/narratives.md`), mas se um dia existir (ex: SQL direto), os Casos daquela Narrativa não devem virar órfãos |
| `title`           | `text`         | sim         | Título da ação                                                          |
| `status`          | `case_status`  | sim         | Enum já reservado em `_index.md` (`open`\|`in_progress`\|`waiting`\|`resolved`\|`archived`). ✅ **Mapeamento pros 3 rótulos do protótipo resolvido (2026-07-13)** — pedido do usuário: "por enquanto manter igual ao protótipo": `open`/`waiting` → **Pendente**; `in_progress` → **Em andamento**; `resolved`/`archived` → **Concluída**. Mapeamento fica só na camada de apresentação (frontend/envelope), a coluna no banco continua com os 5 valores — não simplificar o enum |
| `assignee_id`     | `uuid`         | não         | FK → `user_profiles(id)` (ver `auth/data-model.md`) — `null` = sem responsável atribuído |
| `due_date`        | `date`         | não         | Prazo                                                                    |
| `created_at`      | `timestamptz`  | sim         | `now()`                                                                  |
| `updated_at`      | `timestamptz`  | sim         | Trigger `set_updated_at` (já definida em `foundation`)                  |

**Índices**:
- `cases_narrative_id_idx` em `(narrative_id)` — é como a seção "Ações e decisões" sempre filtra.
- `cases_organization_id_idx` em `(organization_id)`.

**Políticas RLS**:

| Operação | Quem pode           | Condição                                              |
|----------|------------------------|----------------------------------------------------------|
| SELECT   | membro da organização  | `organization_id in (select auth_organization_ids())`    |
| INSERT/UPDATE/DELETE | ninguém via client nesta versão | somente leitura — sem UI de criar/editar Caso ainda (ver nota no topo); popular via SQL direto/backend quando necessário |

## Relacionamentos

```
narratives ──< cases
user_profiles ──< cases.assignee_id (nullable)
```

## Notas para a migration

- Depende de `narratives` (`foundation`) e `user_profiles` (`auth`) já existirem.
- `case_status` (enum) e `case_priority`/`risk_level` (não usados por este
  subconjunto mínimo de `cases`, mas reservados na tabela de renomeação de
  `_index.md` para quando o restante das colunas do "Caso" completo —
  `priority`, `risk_level`, `summary`, `next_action` — forem necessárias).

## ⚠️ Pendência de desenvolvimento (não bloqueia o schema, bloqueia um futuro write path)

`organization_id` é resolvido a partir de `narrative_id` (via `narratives.organization_id`),
não recebido do client — isso só importa de verdade quando `cases` ganhar um caminho de escrita
(hoje é 100% somente leitura, populada via SQL/backend direto). Quando isso acontecer (ex: o
fluxo de aprovação `high`/`critical` do `event-radar`, ver
`../event-radar/schema-integration.md`, ou um CRUD completo de Casos no futuro), a Edge Function
correspondente **deve** derivar `organization_id` no servidor a partir do `narrative_id`
recebido — nunca aceitar `organization_id` direto do payload do client, pelo mesmo motivo já
corrigido em `aggregated-metrics/edge-functions-per-page.md` (isolamento multi-tenant real
depende de nunca confiar em valor vindo do client pra decidir a organização). Registrar esta
regra explicitamente na spec daquele write path quando ela for escrita, não reinventar.
