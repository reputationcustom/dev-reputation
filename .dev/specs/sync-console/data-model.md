---
tipo: data-model
módulo: sync-console
status: pronto
atualizado: 2026-07-15
---

# Data model: sync-console

> 📝 Nenhuma migration foi criada ainda — este documento descreve a
> mudança de schema proposta para quando o módulo for implementado.

## Tabelas existentes, só lidas (não modificadas)

`sync-console` não introduz nenhuma tabela nova de estado — ele lê o que
`bw-sync` já mantém. Schema completo em `foundation/data-model.md` §4
("Operacional — cursores e log"); resumo do que interessa para este
módulo:

### `sync_cursors` (1 linha por par Projeto/Query)

| Coluna | Tipo | Uso neste módulo |
|---|---|---|
| `project_id`/`query_id` | `bigint` | Identifica o par (join com `bw_projects.name`/`bw_queries.name` para exibição) |
| `next_step` | `text` | "Em que fase está agora" — um dos 16 valores de `SYNC_STEPS` |
| `last_synced_at` | `timestamptz` nullable | "Quando rolou" (a última vez que um ciclo completo de 16 fases fechou) — base do cálculo de "próxima execução" |
| `status` | `text` | `idle`\|`error` (ver `last_error`) |
| `last_error` | `text` nullable | Mostrado ao expandir a linha |
| `backfill_completed_at` | `timestamptz` nullable | Não exibido diretamente na v1 (é um detalhe interno do backfill de `mentions`), mas disponível se uma versão futura quiser mostrá-lo |

### `bw_sync_lock` (1 única linha, estado global)

| Coluna | Tipo | Uso neste módulo |
|---|---|---|
| `locked_until` | `timestamptz` nullable | Trava de concorrência ativa (uma invocação em andamento) |
| `rate_limited_until` | `timestamptz` nullable | Backoff reativo pós-429 ativo |
| `last_rate_limit_used` | `integer` nullable | Última leitura do header `x-rate-limit-used` da Brandwatch (0-30) |
| `last_rate_limit_observed_at` | `timestamptz` nullable | Quando essa leitura foi feita — usado para saber se `last_rate_limit_used` ainda é válido (janela de 10min da Brandwatch) ou stale |

### `sync_log` — precisa de 5 colunas novas + 1 mudança de comportamento numa coluna já existente

Hoje `sync_log` já grava uma linha por fase executada (ver
`bw-sync/index.ts`, dispatcher, inserts de sucesso/erro), mas **não
registra qual fase foi**, nem duração, nem se foi automática ou manual —
insuficiente para a tela de histórico que este módulo precisa (o pedido
original inclui "quando rolou... em que passo que está", que exige saber
qual fase cada linha representa; um pedido de follow-up do usuário
acrescentou "verificar todas as execuções que ocorreram e quantos
registros foram sincronizados em cada etapa").

| Coluna nova | Tipo | Notas |
|---|---|---|
| `step` | `text` nullable | Nome da fase executada, um dos 16 valores de `SYNC_STEPS` (`bw-sync/index.ts`). Nullable porque linhas históricas anteriores a esta migration não têm esse dado e não são retroativamente preenchidas |
| `duration_ms` | `integer` nullable | Duração da execução daquela fase, em milissegundos. Mesma ressalva de nullable |
| `stop_reason` | `text` nullable | Só populado em execuções **automáticas** (cron) — mesmo vocabulário do dispatcher: `cycle_complete`\|`stay_on_step`\|`call_budget_exhausted`\|`time_budget_exhausted` (ver `sync-brandwatch.md`, "Sincronismo entre fases"). `null` numa execução manual, que sempre roda exatamente 1 fase e nunca decide uma "próxima" |
| `trigger_source` | `text not null default 'cron'` | `check (trigger_source in ('cron', 'manual'))`. `'cron'` = heartbeat `pg_cron` de sempre; `'manual'` = admin, via `manual-step-execution.md` |
| `triggered_by_user_id` | `uuid references auth.users(id) on delete set null` | Só preenchido quando `trigger_source = 'manual'` |

**⚠️ Gap real encontrado na coluna já existente `rows_processed`** (não é
uma coluna nova, mas precisa de uma mudança de comportamento no código
para o pedido "quantos registros foram sincronizados em cada etapa" ser
atendido de verdade): hoje o dispatcher grava
`rows_processed: result.mentionsCount ?? 0` (`bw-sync/index.ts`, inserts
de sucesso/erro) — `mentionsCount` só é populado pelo `StepResult` da
fase `mentions`; as outras 15 fases nunca preenchem esse campo, então
`rows_processed` já é sempre `0` para elas hoje, mesmo quando sincronizam
dezenas/centenas de linhas reais. Necessário generalizar:

- `StepResult` (`bw-sync/index.ts`) ganha um campo genérico
  `recordsSynced?: number`, substituindo o uso específico de
  `mentionsCount` para esse propósito (`mentionsCount` pode continuar
  existindo separadamente se outro trecho do código já depende dele por
  esse nome — o ponto é que **toda** função `run<Fase>Step()` passa a
  devolver quantas linhas de fato upsertou/afetou nesta invocação, não só
  `runMentionsStep`).
- Cada runner já sabe esse número — é o tamanho do array que ele passa
  para `.upsert(...)` (ou a soma, quando uma fase faz mais de um upsert
  na mesma passagem, ex: `daily_metrics` grava em `bw_query_metrics_daily`
  *e* na tabela de sentimento na mesma invocação). Convenção sugerida por
  fase (a confirmar linha a linha no momento da implementação, olhando
  cada runner):

  | Fase | O que conta como "registro sincronizado" |
  |---|---|
  | `metadata` | Categorias/Subcategorias upsertadas em `bw_categories` |
  | `mentions` | Mentions upsertadas (já existia como `mentionsCount`) |
  | `daily_metrics` | Linhas upsertadas em `bw_query_metrics_daily` (+ sentimento) |
  | `hourly_metrics` | Linhas upsertadas em `bw_query_metrics_hourly` |
  | `weekly_monthly` | Linhas upsertadas em `bw_query_metrics_weekly`/`monthly` |
  | `topics` | Linhas upsertadas em `bw_query_topics` |
  | `platform_by_narrative` | Linhas upsertadas em `bw_query_metrics_daily_by_platform` |
  | `x_insights` | Linhas upsertadas em `bw_query_x_insights` |
  | `top_authors`/`top_tweeters` | Linhas upsertadas em `bw_query_top_authors`/`bw_query_top_tweeters` |
  | `author_enrichment` | Autores enriquecidos (linhas em `bw_query_author_topics` + `bw_query_top_authors.impressions` atualizado) |
  | `top_sites`/`top_shared_sites` | Linhas upsertadas nas respectivas tabelas |
  | `demographics` | Linhas upsertadas em `bw_query_demographics_daily` |
  | `full_text_enrichment` | Mentions com `full_text` preenchido nesta passagem |
  | `sov` | Linhas upsertadas em `bw_query_group_metrics_weekly` |
- O dispatcher passa a gravar `rows_processed: result.recordsSynced ?? 0`
  para **qualquer** fase, cron ou manual — não mais um cálculo
  específico da fase `mentions`.
- Sem isso, a tela de histórico deste módulo mostraria "0 registros" para
  15 das 16 fases mesmo quando elas sincronizaram dado real — o pedido
  do usuário de conseguir ver "quantos registros foram sincronizados em
  cada etapa" não seria atendido de fato, só a coluna existiria vazia.

**Índice novo**, pela mesma razão já documentada mais de uma vez neste
projeto (`CLAUDE.md`, "Migration hygiene" — uma tabela que "acumula
indefinidamente" sem job de retenção precisa de um índice cujo primeiro
campo bata com o filtro real, ou uma consulta que hoje é rápida degrada
silenciosamente conforme a tabela cresce; foi a causa raiz de pelo menos
2 incidentes reais já documentados — `bw_query_metrics_daily*`/
`event-radar`'s `run_event_detection()` statement timeout):

```sql
create index sync_log_project_query_created_idx
  on sync_log (project_id, query_id, created_at desc);
```

`sync_log` não tem hoje nenhum job de retenção/poda — mesma decisão já
aceita para toda tabela histórica deste projeto (acumula por design). A
tela de histórico (`get-sync-console-history`) nunca precisa "limitar
quantas linhas existem" para se manter rápida — ela já é paginada desde
o desenho (ver "Edge Functions novas" abaixo), então o volume total da
tabela não é um problema de performance da UI, só de quantas páginas
existem para navegar.

### Migração proposta (esboço, a confirmar no momento da implementação)

```sql
alter table sync_log
  add column if not exists step text,
  add column if not exists duration_ms integer,
  add column if not exists stop_reason text,
  add column if not exists trigger_source text not null default 'cron',
  add column if not exists triggered_by_user_id uuid references auth.users(id) on delete set null;

alter table sync_log
  add constraint sync_log_trigger_source_check
  check (trigger_source in ('cron', 'manual'));

create index if not exists sync_log_project_query_created_idx
  on sync_log (project_id, query_id, created_at desc);
```

RLS: `sync_log` já é `enable row level security` sem nenhuma policy
(deny-all) desde `foundation` — nenhuma mudança necessária, as 2 Edge
Functions novas abaixo usam a chave secreta (`SUPABASE_SECRET_KEY`), que
já bypassa RLS.

## Mudança em `bw-sync` (não é uma tabela nova, mas é uma mudança de schema de comportamento)

A execução manual de uma fase específica (`manual-step-execution.md`)
precisa rodar exatamente a mesma função `run<Fase>Step()` que o
dispatcher automático já usa — nunca uma segunda implementação da mesma
lógica em outra Edge Function. Duas alternativas foram consideradas:

1. **Duplicar as 16 funções runner numa nova Edge Function** —
   rejeitada. Violaria a própria razão de ser do Princípio técnico 5
   ("Edge Functions são autossuficientes... duplicar código auxiliar por
   função") na direção errada: aqui não estamos falando de um helper
   pequeno e estável, mas da lógica central de 16 fases que já mudou
   dezenas de vezes ao longo do histórico deste projeto (ver `CLAUDE.md`,
   praticamente toda a seção "Brandwatch sync model") — duplicá-la
   criaria exatamente a classe de bug de propagação já documentada
   várias vezes neste projeto para os outros arquivos que precisam ser
   copiados manualmente (`aggregated-metrics-service.ts` nas 8 Edge
   Functions `get-page-*`), só que para o arquivo mais crítico e mais
   instável do projeto.
2. **Adicionar um novo modo de invocação dentro do próprio `bw-sync`** —
   escolhida. `bw-sync/index.ts` ganha um novo campo opcional no corpo da
   requisição, `manualStep: { projectId, queryId, step, triggeredByUserId }`.
   Quando presente, o handler pula a lógica normal de "escolher o par
   mais atrasado" e o `next_step` do cursor, e vai direto para a `switch`
   que já existe no dispatcher, rodando **só** a função runner
   correspondente a `step` para o par informado — reaproveitando 100% do
   código já existente (montagem de contexto: token Brandwatch,
   `organizationId`, `categoryTargets`, `metricsStartDate`, `now`).

**Isso não viola o invariante já documentado "`bw-sync` é acionada só por
`pg_cron`, nunca pelo frontend"** (`supabase/config.toml`, comentário
acima de `[functions.bw-sync]`) — o navegador continua nunca chamando
`bw-sync` diretamente. Quem chama `bw-sync` com `manualStep` é a nova
Edge Function `trigger-sync-step` (ver abaixo), server-to-server (mesmo
tipo de chamada de rede confiável que `net.http_post` do `pg_cron` já
faz hoje), depois de ela mesma já ter validado que quem pediu é um admin
autenticado. `bw-sync` continua com `verify_jwt = false` (obrigatório
para o heartbeat sem cabeçalho de Authorization) — a autorização de quem
pode disparar uma execução manual acontece inteiramente em
`trigger-sync-step`, antes de `bw-sync` ser chamada.

**Regras que a execução manual precisa respeitar dentro de `bw-sync`,
sem exceção** (detalhado em `manual-step-execution.md`, "Regras de
negócio"):
- Ainda tenta adquirir `bw_sync_lock` (nunca roda em paralelo com uma
  invocação automática ou outra manual).
- Ainda respeita os gates de orçamento de chamadas Brandwatch (local e o
  proativo via `x-rate-limit-used`) — nunca é um "bypass de emergência"
  do teto de 30 chamadas/10min.
- **Nunca escreve em `sync_cursors.next_step`/`last_synced_at`** — uma
  execução manual é sempre um desvio observável (fica registrado em
  `sync_log` com `trigger_source = 'manual'`), nunca uma alteração da
  rotação automática das 16 fases. Ver a justificativa completa em
  `manual-step-execution.md`.
- Grava em `sync_log` como qualquer outra execução, só que com
  `trigger_source = 'manual'`/`triggered_by_user_id` preenchidos e
  `stop_reason` sempre `null` (não há "próxima fase" a decidir numa
  execução de 1 fase só) — `rows_processed` vem do mesmo `recordsSynced`
  generalizado que toda fase já devolve (ver "Gap real... `rows_processed`"
  acima), então uma execução manual de `topics` aparece no histórico com
  a contagem real de linhas que aquela chamada upsertou, igual a uma
  execução automática da mesma fase.

## Edge Functions novas

Todas autossuficientes (Princípio técnico 5), mesmo padrão de auth já
usado por `finops`/`admin-*` — Bearer token → `supabaseAdmin.auth.getUser(token)`
→ checar `user_profiles.is_admin` → só então prosseguir (não o padrão
`get-page-*` de chave publicável + JWT encaminhado, já que este é um
recurso admin-only da plataforma, não escopado por organização).

- **`get-sync-console-status`** — só leitura, só o **estado atual** (sem
  histórico embutido — ver `get-sync-console-history` abaixo para isso).
  Lê `sync_cursors` (join `bw_projects`/`bw_queries` para nome de
  exibição) e `bw_sync_lock` (única linha). Calcula "próxima execução
  prevista" em TypeScript a partir de `last_synced_at` + o secret
  `BW_SYNC_INTERVAL_HOURS` (lido via `Deno.env.get`, mesma leitura que
  `bw-sync` já faz — `getSyncIntervalHours()`, default `3`) — não precisa
  de uma function SQL dedicada, mesmo padrão já usado por
  `admin-list-users` (combina múltiplas fontes numa única resposta, sem
  RPC intermediária), diferente do padrão de `get_finops_overview`
  (`jsonb` via RPC) — aqui não há necessidade de um cálculo agregado
  pesado o bastante para justificar mover para o Postgres.
- **`get-sync-console-history`** — nova, dedicada ao pedido "verificar
  todas as execuções que ocorreram" (`pipeline-monitoring.md`, "Histórico
  de execuções"). Só leitura, paginada — recebe
  `{ page, pageSize, projectId?, queryId? }` (mesmo padrão de paginação
  já usado no resto do produto, `DEFAULT_PAGE_SIZE = 10`,
  `components/ui/pagination.tsx`). Quando `projectId`/`queryId` são
  informados, escopa a **um** par (usa o índice novo
  `sync_log_project_query_created_idx`); quando omitidos, devolve o
  histórico de **todos** os pares combinados, ordenado por
  `created_at desc` (usa o índice já existente `idx_sync_log_created_at`,
  `foundation/data-model.md` — nenhum índice novo necessário para esse
  caso). Devolve `{ items: [...], totalCount }` — cada item já vem com
  `projectName`/`queryName` (join `bw_projects`/`bw_queries`) e, quando
  `trigger_source = 'manual'`, o nome de quem disparou (`left join
  user_profiles on triggered_by_user_id`, direto — a chave secreta já
  bypassa RLS, sem precisar de uma function auxiliar tipo
  `list-organization-members`, já que este recurso é admin-only e global,
  não escopado por organização). Nunca capado a uma janela fixa — é
  literalmente "todas as execuções", só paginado para não devolver a
  tabela inteira de uma vez.
- **`trigger-sync-step`** — recebe `{ projectId, queryId, step }`, valida
  `is_admin`, valida que `step` é um dos 16 valores de `SYNC_STEPS`
  (nunca confia só na validação client-side do `<select>`, Princípio
  técnico 2), valida que o par existe em `sync_cursors`, e faz uma
  chamada `fetch()` server-to-server para a URL da própria `bw-sync`
  (`${Deno.env.get('SUPABASE_URL')}/functions/v1/bw-sync`) com o corpo
  `{ manualStep: { projectId, queryId, step, triggeredByUserId: <id do admin> } }`.
  Aguarda a resposta e repassa o resultado (sucesso/erro) para o
  cliente — a chamada é síncrona do ponto de vista do admin (ele clica
  "Executar" e espera o resultado, como o botão "Analisar com IA" já
  faz em `ai-synthesis.md`), não fire-and-forget.
