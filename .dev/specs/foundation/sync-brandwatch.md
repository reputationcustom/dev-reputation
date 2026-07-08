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

0. **Semeadura inicial de `sync_cursors`** (⚠️ correção 2026-07-07 — gap
   identificado após a primeira versão desta spec): `sync_cursors` nasce
   vazia e nada mais a populava — o passo 2 (round-robin) não tem o que
   processar sem isto, então o sync nunca começaria sozinho. Antes do
   round-robin, a função garante (upsert idempotente, `on conflict do
   nothing`) que existam linhas placeholder em `bw_projects`/`bw_queries` e o
   par correspondente em `sync_cursors`, a partir de
   `BRANDWATCH_PROJECT_ID`/`BRANDWATCH_QUERY_IDS` (secrets da Edge Function,
   `QUERY_IDS` aceita lista separada por vírgula). MVP de Client único: não
   descobre automaticamente todos os projects/queries da conta via
   `projects/summary` (isso seria bootstrap completo, ver passo 4) — as IDs
   já são conhecidas manualmente (anotadas durante o checklist de
   `brandwatch-setup.md`), por isso vêm de env var em vez de descoberta
   dinâmica. `name`/demais campos das linhas placeholder são sobrescritos
   pelo bootstrap de metadata real do passo 4 (mesmo par, upsert, sem apagar
   histórico).
1. `pg_cron` invoca a Edge Function `bw-sync` a cada ~20–30 segundos
   (`select net.http_post(url := '<edge-function-url>/bw-sync', ...)`).
2. A função resolve, em round-robin, o próximo par `(project_id, query_id)`
   com sync pendente, olhando `sync_cursors` (o cursor com `last_synced_at`
   mais antigo primeiro).
3. Resolve o access token da Brandwatch: checa
   `brandwatch_credentials.token_expires_at` (com margem de segurança, ex:
   5min antes de expirar) para o `organization_id` dono daquele `project_id`.
   Se houver cache válido, lê o token de `access_token_secret_ref` (Supabase
   Vault). Se **não houver cache ou estiver expirado** — o cenário normal no
   MVP, ver ⚠️ correção em `brandwatch-setup.md` §1 —, minta um novo token
   via `grant_type=api-password`:
   ```
   POST https://api.brandwatch.com/oauth/token
     ?grant_type=api-password&client_id=brandwatch-api-client
     &platform_client_id=<BRANDWATCH_PLATFORM_CLIENT_ID>
     &username=<BRANDWATCH_USERNAME>
   Body (x-www-form-urlencoded): password=<BRANDWATCH_PASSWORD>
   ```
   `BRANDWATCH_USERNAME`/`BRANDWATCH_PASSWORD`/`BRANDWATCH_PLATFORM_CLIENT_ID`
   são **secrets da própria Edge Function** (`Deno.env.get`, nunca no
   frontend/Next.js — Princípio técnico 1), não colunas de
   `brandwatch_credentials` neste MVP (assume um único Client Brandwatch).
   `client_id=brandwatch-api-client` é um literal fixo da Brandwatch, não é
   segredo. Depois de mintar, grava o novo token no Vault (atualiza o secret
   referenciado por `access_token_secret_ref`, criando a referência se for a
   primeira vez) e atualiza `brandwatch_credentials.token_expires_at` — isso
   evita gastar parte do rate limit de 30 chamadas/10min renovando o token a
   cada invocação (~20-30s).
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

Não há UI para este job no Sprint 1. Observabilidade final via `sync_log`
(consultável por um analista/dev direto no Supabase) — sem alerta
automático no MVP (thresholds de erro de sync ficam para o
`threshold-engine`, Sprint 3, se necessário). **Enquanto o passo 7
(gravação em `sync_log`) não está implementado**, a função loga cada etapa
via `console.log`/`console.error` (prefixo `[bw-sync]`), visível em
Dashboard → Edge Functions → Logs — nunca loga `password`/`access_token`,
só metadados (tamanho do token, expiração, ids do par processado).

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
