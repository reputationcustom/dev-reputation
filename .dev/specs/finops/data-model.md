---
tipo: data-model
módulo: finops
status: implementado
atualizado: 2026-08-05
---

# Data model: finops

> ✅ **Implementado (2026-08-05)** — migration `20260805000000_finops_schema.sql`.

## `ai_usage_log`

Uma linha por chamada real a Claude — nunca uma estimativa. Gravado no
momento da chamada, a partir do `response.usage.input_tokens`/
`output_tokens` que a própria API da Anthropic retorna.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `source` | `text` | `check in ('event_radar_agent_orchestrator', 'ai_synthesis_narrative')` — texto, não enum, pelo mesmo motivo de `communication_types`: se um terceiro ponto de chamada de IA aparecer no futuro, um novo valor de `check` é mais barato de adicionar que um enum (`alter type ... add value`, que não pode rodar dentro de uma transação em algumas versões do Postgres) |
| `model` | `text` | Ex: `claude-haiku-4-5` — nunca hardcoded no schema, vem do parâmetro real usado na chamada |
| `input_tokens` | `integer` | `check >= 0` |
| `output_tokens` | `integer` | `check >= 0` |
| `cost_usd` | `numeric(12,6)` | Calculado no momento da gravação com o preço vigente (`AI_MODEL_PRICING`, duplicado em cada Edge Function que chama Claude — Princípio técnico 5). Preserva o custo histórico correto mesmo que o preço do modelo mude depois — não precisa de uma tabela de preços versionada |
| `organization_id` | `uuid` nullable | `references organizations(id) on delete set null` — reservado pra uma futura quebra por organização; o painel de hoje soma tudo (plataforma inteira) |
| `reference_id` | `text` nullable | Rastreabilidade livre (ex: `radar_staging_events.id`, ou `"<page>:<period_start>..<period_end>"` pra `ai_synthesis_narrative`) — nunca usado em filtro/agregação, só depuração |
| `created_at`/`updated_at` | `timestamptz` | Padrão do projeto (Princípio técnico 4) — `updated_at` existe pela regra geral, mas a linha nunca é de fato atualizada (log append-only) |

RLS: `enable row level security` + `create policy "ai_usage_log: sem
acesso direto" ... for all using (false)` — nem o client autenticado nem
`anon` leem/escrevem direto; só `service_role` (via as Edge Functions que
gravam uso e via `get-finops-overview`, que lê) bypassa RLS. Mesmo padrão
já usado por `bw_sync_lock`/`sync_cursors`/`sync_log`.

**Por que sem tabela de resumo diário materializada**: o padrão já usado
no projeto pra grão diário (`bw_query_metrics_daily`, `narrative_metrics`)
existe pra evitar reconsultar uma API externa com rate limit
(Brandwatch). Nenhuma dessas duas razões (rate limit externo, custo de
reconsulta) se aplica aqui — `ai_usage_log` é local, permanente (sem job
de retenção/poda) e o volume esperado é minúsculo (poucas dezenas de
chamadas de IA por dia, no teto — ver `daily_event_cap`=15/organização/dia
do event-radar 1.6). Uma consulta live agrupada por dia sobre
`ai_usage_log` (dentro de `get_finops_overview()`) é trivial em
performance e sempre exata, sem o custo de manter um job/tabela extra em
sincronia. "Atualizada diariamente" (pedido do usuário) é satisfeito por
construção — a página lê direto do log, gravado em tempo real.

## `manual_costs`

Custos extras cadastrados manualmente pelo admin, fora do que
`ai_usage_log` cobre automaticamente.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `description` | `text` | Obrigatória |
| `amount_usd` | `numeric(12,2)` | `check >= 0` |
| `recurrence` | `finops_cost_recurrence` (enum: `one_time`\|`monthly`\|`annual`) | Enum, não tabela de referência tipo `communication_types` — são 3 valores estruturais, não se espera que cresçam (diferente de tipos de comunicação, que o usuário já pediu explicitamente pra vir de uma tabela editável) |
| `effective_date` | `date` | `one_time`: a data em que o custo é/foi incorrido. `monthly`/`annual`: data de início da recorrência |
| `end_date` | `date` nullable | Quando um custo recorrente deixa de valer — `null` = ainda em vigor. `check (end_date is null or end_date >= effective_date)` |
| `created_by` | `uuid` nullable | `references user_profiles(id) on delete set null` |
| `created_at`/`updated_at` | `timestamptz` | Padrão do projeto |

RLS: mesmo padrão de `ai_usage_log` — deny-all, CRUD só via as 3 Edge
Functions dedicadas (`create`/`update`/`delete-finops-manual-cost`), cada
uma checando `user_profiles.is_admin` no handler antes de tocar a tabela
(mesmo padrão de `admin-invite-user`/`admin-set-user-role`/etc.).

## `get_finops_overview(p_trend_days integer default 30)`

`returns jsonb` — mesmo padrão de `get_dissemination_graph`
(aggregated-metrics/sql-aggregation.md): a forma mais simples de um único
RPC devolver vários blocos heterogêneos numa chamada só (hoje/mês
corrente/projeção/tendência diária/custos extras), sem inventar 5 RPCs
separados pra uma única tela.

Blocos do JSON retornado:

- `today`: `{ cost_usd, call_count }` — soma de `ai_usage_log` do dia UTC
  corrente (live, nunca de um snapshot).
- `month_to_date`: `{ cost_usd, by_source: [{source, cost_usd,
  input_tokens, output_tokens, call_count}] }` — soma do mês UTC corrente
  até hoje, por origem.
- `projection`: `{ avg_daily_ai_cost_usd, projected_ai_cost_usd,
  manual_costs_this_month_usd, projected_total_month_usd, days_elapsed,
  days_in_month }` — ver `overview.md`, "Previsão de gasto", pra fórmula
  completa.
- `daily_trend`: `[{date, cost_usd}]` — série completa dos últimos
  `p_trend_days` dias (default 30), preenchida com `generate_series` +
  `coalesce(..., 0)` pra nunca ter buraco num dia sem uso de IA (o gráfico
  não fica com um "furo" silencioso).
- `manual_costs`: lista completa de `manual_costs`, ordenada por
  `effective_date desc`.

`security invoker` (default), `stable`, `set search_path = public` — só
chamado pela Edge Function `get-finops-overview` (chave secreta,
`service_role` já bypassa RLS independente do modo da function).

## Edge Functions

Todas autossuficientes (Princípio técnico 5), mesmo padrão de auth dos
`admin-*` (Bearer token → `supabaseAdmin.auth.getUser(token)` → checar
`user_profiles.is_admin` → só então prosseguir) — não o padrão de
`get-page-*` (chave publicável + JWT encaminhado), já que este é um
recurso admin-only da plataforma, não escopado por organização.

- `get-finops-overview` — só leitura, chama `get_finops_overview(30)`.
- `create-finops-manual-cost` / `update-finops-manual-cost` /
  `delete-finops-manual-cost` — CRUD de `manual_costs`, validação de
  negócio no handler (descrição não-vazia, valor ≥ 0, recorrência válida,
  datas no formato `YYYY-MM-DD`, `end_date >= effective_date`) — reforçada
  pelos `CHECK` constraints da tabela, nunca confiando só no client
  (Princípio técnico 2).

## Instrumentação nos 2 pontos de chamada de IA

`recordAiUsage(supabase, params)` — função auxiliar duplicada (Princípio
técnico 5) em `event-radar-agent-orchestrator/index.ts` e em
`aggregated-metrics-service.ts` (propagada nas 7 Edge Functions
`get-page-*`/`get-narrative-detail` que carregam cópia inline). Grava
**sempre**, logo após receber a resposta da API da Anthropic — antes de
qualquer verificação de `stop_reason`/parse/gravação subsequente — porque
o uso já foi cobrado pela Anthropic naquele ponto, independente do que
acontece depois (refusal, erro de parse, falha ao gravar em
`feed_events`/`page_narrative_synthesis`). Uma falha ao gravar em
`ai_usage_log` em si só loga o erro (`console.error`) e nunca derruba o
fluxo principal — o painel de FinOps é observabilidade, não deve nunca
quebrar a funcionalidade que está observando.
