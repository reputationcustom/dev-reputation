---
tipo: module-overview
módulo: finops
status: implementado
atualizado: 2026-08-05
---

# Módulo: FinOps (custo de IA)

> ✅ **Implementado (2026-08-05)** — spec escrita e implementada na mesma
> sessão (pedido direto do usuário: "faça uma página e disponibilize no
> menu de administração com a estimativa de custo... deve ser atualizada
> diariamente... permita tb cadastrar custos extras"). Migration
> `20260805000000_finops_schema.sql` (`ai_usage_log`, `manual_costs`,
> `get_finops_overview()`), 4 Edge Functions (`get-finops-overview`,
> `create-finops-manual-cost`, `update-finops-manual-cost`,
> `delete-finops-manual-cost`), página `/admin/finops` (admin-only, mesmo
> gate de `/admin/users`), item de menu "FinOps" em CONFIGURAÇÕES. Ver
> `data-model.md` para o schema completo e `CLAUDE.md`, "Módulo `finops`",
> para o detalhamento da sessão (incl. a instrumentação retroativa dos 2
> pontos do produto que chamam Claude).

## Objetivo

Painel centralizado de custo de IA da plataforma — "FinOps fácil", nas
palavras do pedido original — combinando duas fontes:

1. **Uso real de IA** (`ai_usage_log`) — nunca uma estimativa. Toda chamada
   a Claude no produto grava, no momento da chamada, os tokens de
   entrada/saída que a própria API da Anthropic reportou em
   `response.usage`, mais o custo em USD calculado com o preço vigente do
   modelo naquele instante.
2. **Custos extras cadastrados manualmente** (`manual_costs`) — qualquer
   gasto fora do que é medido automaticamente (infraestrutura, licenças de
   ferramentas, contratos, etc.), pontual, mensal ou anual.

## Escopo: plataforma inteira, não por organização

Diferente das 5 páginas de `intelligence-center` (organização ativa +
período do header), FinOps é **admin-only e global** — mesmo modelo de
`/admin/users`. Justificativa: o custo de IA é cobrado numa única conta da
Anthropic pela plataforma inteira, não por organização/cliente — não faz
sentido pedir pro admin escolher "qual organização" pra ver esse gasto.

## Onde a IA é chamada hoje (as duas únicas fontes de `ai_usage_log`)

| `source` (enum de texto) | Onde | Modelo | Cadência |
|---|---|---|---|
| `event_radar_agent_orchestrator` | `supabase/functions/event-radar-agent-orchestrator/index.ts` (event-radar 1.4) | Claude Haiku 4.5 (`EVENT_RADAR_AGENT_MODEL`) | `pg_cron` 15min, até `EVENT_RADAR_AGENT_BATCH_SIZE` eventos/tick, capado em `daily_event_cap`=15/organização/dia (1.6) |
| `ai_synthesis_narrative` | `composeLayer1NarrativeText` em `aggregated-metrics-service.ts` (Camada 1 de `ai-synthesis`) | Claude Haiku 4.5 (`AI_SYNTHESIS_MODEL`) | Sob demanda, em background (`scheduleBackground`/`EdgeRuntime.waitUntil`), só quando uma página com 2+ highlights ainda não tem `page_narrative_synthesis` pra aquela chave exata |

Qualquer novo ponto de chamada de IA que o produto ganhar no futuro **deve
gravar em `ai_usage_log`** com o mesmo padrão (`recordAiUsage`, duplicado
por Edge Function — Princípio técnico 5) — sem isso, o painel de FinOps
subestima o gasto real silenciosamente.

## "Atualizada diariamente" — decisão deliberada de não usar grão

## materializado + cron

Ao contrário do padrão já usado no projeto pra métricas do Brandwatch
(`bw_query_metrics_daily`, grão diário materializado via `pg_cron`, porque
reconsultar a API do Brandwatch tem rate limit), aqui **não existe** uma
tabela de resumo diário nem um cron novo. `ai_usage_log` é local,
permanente (sem job de retenção/poda) e o volume esperado é minúsculo
(poucas dezenas de chamadas de IA por dia, no teto) — uma consulta live
agrupada por dia é trivial em performance e sempre exata. "Atualizada
diariamente" (pedido do usuário) é satisfeito por construção: a página lê
direto de `ai_usage_log`, gravado em tempo real a cada chamada de IA —
nunca há atraso de um job noturno. Ver `data-model.md` para o detalhe
completo dessa decisão.

## Previsão de gasto

`get_finops_overview()` projeta o fim do mês assim:

```
avg_daily_ai_cost_usd = gasto_de_ia_no_mês_corrente / dias_decorridos_no_mês
projected_ai_cost_usd = avg_daily_ai_cost_usd × dias_no_mês
custos_extras_do_mês  = soma de manual_costs ativos neste mês (mensal cheio,
                         anual/12, pontual se a data cair no mês corrente)
projected_total_month_usd = projected_ai_cost_usd + custos_extras_do_mês
```

⚠️ Inferência de MVP (nenhum spec prévio define essa fórmula) — documentada
num único lugar (a própria migration) pra ser recalibrada com dado real de
produção, mesmo padrão já usado em `event_radar_config()`/`get_volume_trend`.

## Rotas / Páginas

- `/admin/finops` — único destino, sem período selecionável no header (o
  "período" aqui é sempre "hoje" + "mês corrente", conceitos fixos do
  próprio domínio de custo, não o seletor de período das páginas de
  análise). KPIs (gasto hoje, gasto no mês, custos extras no mês, projeção
  total), gráfico de tendência diária (últimos 30 dias, reaproveita
  `TrendLineChart`), tabela de uso por origem no mês, e a lista de custos
  extras cadastrados com CRUD completo (criar/editar/excluir).
- Item de menu "FinOps" em CONFIGURAÇÕES (`sidebar.tsx`), visível só para
  `is_admin` — mesmo gate de "Administração".

## Fora de escopo (não pedido nesta sessão)

- Conversão de moeda (tudo em USD, o que a Anthropic de fato cobra).
- Histórico de alterações de preço por modelo (uma tabela de preços
  versionada) — `cost_usd` é gravado com o preço vigente no momento da
  chamada; se o preço de um modelo mudar no futuro, chamadas antigas
  mantêm o custo histórico correto e chamadas novas usam o preço
  atualizado (só precisa editar a constante `AI_MODEL_PRICING`, duplicada
  em cada Edge Function que chama Claude).
- Auditoria/histórico de edição de `manual_costs` (edita e sobrescreve,
  sem versionamento) — não pedido.
- Alertas/notificação automática quando a projeção estourar um teto —
  não pedido.
