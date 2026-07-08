---
tipo: feature-spec
módulo: foundation
funcionalidade: sync-brandwatch
status: pronto
atualizado: 2026-07-07
---

# Sync Brandwatch

## Objetivo

Manter `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`,
`mentions` e `bw_query_metrics_daily` sincronizados com a Brandwatch,
respeitando o rate limit (30 chamadas/10min por Client) e sem depender de
soma local de mentions para números de volume (ver nota de sampling).

## Usuários afetados

Nenhum usuário final interage diretamente — é um job de backend. Analistas e
o Executive Overview consomem o resultado (tabelas já sincronizadas).

## Fluxo principal

1. `pg_cron` invoca a Edge Function `bw-sync` a cada ~20–30 segundos
   (`select net.http_post(url := '<edge-function-url>/bw-sync', ...)`).
2. A função resolve, em round-robin, o próximo par `(project_id, query_id)`
   com sync pendente, olhando `sync_cursors` (o cursor com `last_synced_at`
   mais antigo primeiro).
3. Resolve o access token da Brandwatch da organização dona daquele
   `project_id` via `brandwatch_credentials.access_token_secret_ref`
   (Supabase Vault).
4. Se for a primeira sincronização daquele Project (sem linha em
   `bw_projects`) ou um refresh periódico (> 24h desde `synced_at`): busca
   `projects/summary`, `queries/summary`, `query-groups`, Categories
   (`rulecategories`) e `GET /metrics`, e faz upsert em
   `bw_projects`/`bw_queries`/`bw_query_groups`/`bw_categories`.
5. Busca mentions daquele par via `sinceAdded` = `sync_cursors.last_added_cursor`
   menos buffer de 5 minutos, `orderBy=added&orderDirection=desc`, e faz
   upsert em `mentions` via `idx_mentions_natural_key`
   (`project_id, query_id, resource_id, added`).
6. Busca `data/volume/sentiment/days` para o par (com `category=<id>` para
   cada Category ativa vinculada a alguma Narrativa, ver
   `narratives.md`) e faz upsert em `bw_query_metrics_daily`.
7. Atualiza `sync_cursors` (`last_added_cursor`, `last_synced_at`,
   `status = 'idle'`) e insere uma linha em `sync_log`
   (`status = 'success'`, `rows_processed`).
8. Se qualquer chamada retornar `429`: aplica backoff (usa `retry-after` ou
   janela/limite), tenta até 3 vezes, e se ainda falhar marca
   `sync_cursors.status = 'error'` + `last_error` e `sync_log.status = 'error'`.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| `HTTP 429` da Brandwatch | Backoff (ver best practices da skill `brandwatch-api`), até 3 tentativas; se esgotar, marca erro e tenta o próximo par na invocação seguinte — não trava a fila inteira |
| Token expirado/inválido | `sync_cursors.status = 'error'`, `last_error` com mensagem; **não** derruba a Edge Function para outros pares — cada par falha isoladamente |
| Query removida/pausada na Brandwatch | Mantida em `bw_queries` (histórico), mas sem novo `sync_cursors` de mentions; o refresh periódico de metadados (passo 4) reflete o estado atual |
| Categoria sem mentions no dia | `bw_query_metrics_daily` recebe linha com `total_mentions = 0` (upsert normal, não pula) |
| Query com `sampled = true` | Sincroniza normalmente — `sampled`/`sample_percentage` só é usado como sinal de que os totais devem vir de `bw_query_metrics_daily`, não que o sync deva mudar de comportamento |
| Backfill de Query (campo `added` resetado) | Usa `sourceType=new` no polling para não reprocessar histórico como se fosse novo |

## Regras de negócio

- Nunca chamadas paralelas — uma requisição HTTP por invocação de
  `pg_cron` (a "fila serial" é a própria cadência do cron, ver
  `overview.md`).
- Nunca somar `mentions` localmente para métricas de volume/tendência —
  sempre usar `bw_query_metrics_daily` (alimentado neste job) como fonte de
  números agregados.
- Categories/Tags/`GET /metrics` só são buscados no bootstrap ou refresh
  periódico (≥ 24h), nunca a cada polling de mentions.
- Todo texto de mention é armazenado como veio da API, sem sanitização —
  sanitização para exibição é responsabilidade do frontend (nunca
  `dangerouslySetInnerHTML` direto com `snippet`/`full_text`).

## Dados envolvidos

- **Lê**: `brandwatch_credentials`, `sync_cursors`, `bw_projects`, `bw_queries`, `narratives` (para saber quais `bw_category_id` merecem chart por categoria).
- **Escreve**: `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`, `mentions`, `bw_query_metrics_daily`, `sync_cursors`, `sync_log`.
- Detalhes de schema: ver [data-model.md](data-model.md).

## Permissões

| Ação | Quem pode |
|---|---|
| Executar o sync | Só a Edge Function, via `SUPABASE_SECRET_KEY` (bypassa RLS) |
| Ler o resultado (tabelas de cache) | Membros da organização dona dos dados, via RLS |

## Notificações / Feedback

Não há UI para este job no Sprint 1. Observabilidade via `sync_log`
(consultável por um analista/dev direto no Supabase) — sem alerta
automático no MVP (thresholds de erro de sync ficam para o
`threshold-engine`, Sprint 3, se necessário).

## Dependências técnicas

- Edge Function autossuficiente `supabase/functions/bw-sync/index.ts`
  (Princípio técnico 5, `_index.md`).
- `pg_cron` + `pg_net` (ou equivalente) para HTTP a partir do Postgres.
- Skill `brandwatch-api`: `references/authentication.md`,
  `references/mentions.md`, `references/data-retrieval-charts.md`,
  `references/queries-and-projects.md` (nota de sampling),
  `references/filters.md` (`category=<id>`).

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [narratives.md](narratives.md)
