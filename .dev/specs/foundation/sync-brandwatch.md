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
`mentions`, `bw_query_metrics_daily`/`weekly`/`monthly` e
`bw_query_group_metrics_weekly` sincronizados com a Brandwatch, respeitando
o rate limit (30 chamadas/10min por Client) e sem depender de soma local de
mentions para números de volume (ver nota de sampling).

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
3. Resolve o access token da Brandwatch via `grant_type=api-password`:
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
   segredo. **Implementação atual (2026-07-07): sem cache** — minta um token
   novo em **toda** invocação (`mintBrandwatchAccessToken()` em
   `bw-sync/index.ts`); `brandwatch_credentials.access_token_secret_ref`/
   `token_expires_at` existem na tabela para servir de cache, mas o
   write-back pro Vault ainda é TODO — fica para antes de agendar via
   `pg_cron` de verdade em produção, já que sem cache o mint por si só já
   consome 1 chamada por invocação do orçamento de 30/10min.
4. Se for a primeira sincronização daquele Project (`bw_projects.name` ainda
   é o placeholder do passo 0) ou um refresh periódico (> 24h desde
   `synced_at`): busca `GET /projects/{projectId}` (nome/timezone reais),
   `queries/summary` (todas as Queries do Project, não só a rastreada),
   `query-groups` e `rulecategories` (achatando Category+Subcategories em
   linhas de `bw_categories`, `parent_id` para subcategoria), e faz upsert
   em `bw_projects`/`bw_queries`/`bw_query_groups`/`bw_categories`.
   `GET /metrics` (Global Preset Metrics) **não é buscado nesta leva** — não
   há coluna/uso para esse cache ainda no MVP. **Correção 2026-07-10**: logo
   após o upsert de `bw_categories`, `ensureNarrativesFromCategories()` cria
   automaticamente uma linha em `narratives` (`bw_category_id` = a Category,
   `title` = nome da Category) para cada Category **de topo** (não
   subcategoria) que ainda não tem Narrativa mapeada — idempotente, nunca
   sobrescreve `title`/`stage`/`risk_level` já editados manualmente. Antes
   disso `narratives.md` previa só criação manual (SQL/seed) sem UI, o que na
   prática deixava a tabela sempre vazia sem um seed manual avulso; o design
   "Narrativa = Category" (ver `overview.md`) já suporta esse mapeamento
   direto 1:1, então ele agora é o caminho automático — curadoria manual
   (Categories que não devem virar Narrativa, subcategorias como Narrativa
   própria, sinais adicionais) continua possível por cima, só não é mais
   pré-requisito pra ter dado nenhum na tela.
   **Diagnóstico (2026-07-10)**: se `narratives` continuar vazia mesmo após
   sync bem-sucedido, o log `refreshMetadata:done` traz `categoriesCount` —
   se `0`, é sinal de que o Project na Brandwatch ainda não tem nenhuma
   Category configurada (logado explicitamente como
   `refreshMetadata:no_categories_found`). `bw-sync` só espelha Categories
   que já existem na Brandwatch, não cria — configuração é manual na
   própria Brandwatch (`brandwatch-setup.md`). Lembrar também que o
   refresh de metadata só roda 1x/24h por Project.
5. Busca mentions daquele par — **sempre** com `startDate`/`endDate` (⚠️
   correção 2026-07-07, encontrado em teste real: a Brandwatch rejeita
   `/data/mentions` sem `startDate`, mesmo no polling, apesar do exemplo de
   "bootstrap" da doc omitir o parâmetro — `"This method requires a start
   date"`). `startDate` = `BRANDWATCH_MENTIONS_START_DATE` (secret da Edge
   Function, `YYYY-MM-DD`, default `2026-01-01` se não configurada — data
   mínima de histórico a considerar), `endDate` = agora.
   **Correção 2026-07-10** (encontrado em teste real + pedido do usuário —
   "sempre a partir de Janeiro/26 até a data atual... ler do banco de dados a
   data do último registro e fazer incremental"): `orderDirection=asc` (não
   `desc`) — caminha cronologicamente do mais antigo (`startDate`) pro mais
   recente, em vez de pegar sempre a leva mais nova e pular o backlog.
   `sinceAdded` é **sempre** enviado, resolvido por
   `resolveMentionsSinceAdded()`.
   ⚠️ **Segunda correção 2026-07-10** (relatado pelo usuário: mentions
   parou de crescer além de ~100 linhas mesmo após corrigir a paginação):
   o bug original (bootstrap com `orderDirection=desc`) já tinha avançado
   `sync_cursors.last_added_cursor` pra perto de "agora" **antes** deste
   fix existir — e o `MAX(added)` já persistido em `mentions` tinha
   exatamente a mesma leva viciada (as mentions mais recentes, não as mais
   antigas). Ou seja, nem o cursor nem o dado já salvo davam pra distinguir
   "já varri tudo" de "o cursor pulou o histórico por um bug antigo". Fix:
   nova coluna `sync_cursors.backfill_completed_at` (migration
   `20260710020000`, que também reseta `last_added_cursor` pra `null` em
   todas as linhas existentes). Enquanto `backfill_completed_at` for
   `null`, o walk confia **só** em `last_added_cursor` (progresso real
   dentro do próprio walk ascendente corrigido) — nunca no fallback de
   `MAX(added)` em `mentions`, que é exatamente o sinal que mascarava o
   bug. Só quando uma página vier menor que `pageSize` pela primeira vez
   (alcançou o presente de verdade) é que `backfill_completed_at` é
   setado — daí em diante, o fallback por `MAX(added)` volta a ser seguro
   (modo de polling incremental normal: buffer de 5 minutos +
   `sourceType=new`). Sem `backfill_completed_at` ainda, sem buffer nem
   `sourceType=new` (queremos pegar backfill genuíno, não só o que é
   "novo").
   **Correção 2026-07-10** (pedido do usuário: "garanta que a busca está
   utilizando o retorno máximo de linhas" + "a tabela de menções só conta
   pouco mais de 100 menções, o que não condiz com a realidade"): duas
   causas somadas. `pageSize` estava em `100`; e cada invocação buscava só
   **uma página** — com invocações ainda manuais (sem `pg_cron` real
   agendado), isso levava um clique por ~100 mentions. `bw-sync` passou a
   **paginar dentro da mesma invocação**, avançando `sinceAdded` a cada
   página (sem buffer de 5 minutos entre páginas do mesmo loop — o buffer
   só importa *entre* invocações, por causa do delay de indexação
   assíncrona da Brandwatch), até uma página vir menor que `pageSize`
   (alcançou o presente) ou até esgotar `MAX_MENTIONS_PAGES_PER_INVOCATION`
   páginas.
   ⚠️ **Segunda correção 2026-07-10** (relatado pelo usuário em produção:
   `HTTP 546 WORKER_RESOURCE_LIMIT`, "está dando erro de memória
   excedida"): o primeiro ajuste usou `pageSize = 5000` (o máximo
   documentado pela Brandwatch) com `MAX_MENTIONS_PAGES_PER_INVOCATION =
   20` — até 100k mentions por invocação, pesado demais pro runtime de uma
   Edge Function (cada mention carrega um payload relativamente grande:
   `raw` completo + arrays de engajamento/classificações; serializar 5000
   delas de uma vez pro upsert do Supabase estourava memória/CPU do
   isolate Deno). Reduzido para `MENTIONS_PAGE_SIZE = 1000` e
   `MAX_MENTIONS_PAGES_PER_INVOCATION = 10` (até 10k
   mentions/invocação — ainda 10x o valor original, bem mais seguro).
   Adicionado também `MENTIONS_LOOP_BUDGET_MS = 20000`: o loop para
   voluntariamente se o tempo decorrido da invocação passar desse teto,
   **antes** de o runtime matar a invocação à força — importante porque um
   kill por `WORKER_RESOURCE_LIMIT` não é capturável pelo `try/catch` do
   handler, então `sync_cursors` nunca seria atualizado e o mesmo par
   tentaria (e provavelmente falharia) de novo indefinidamente. Parando
   voluntariamente, o progresso feito até ali é persistido normalmente e a
   invocação seguinte continua de onde parou.
   **Antes do upsert**,
   garante que a partição mensal de `mentions` existe para cada mês presente
   no lote (⚠️ correção 2026-07-10, encontrado em teste real: a migration de
   fundação só pré-cria as partições do mês do deploy e do seguinte —
   histórico anterior, como `2026-01`, quebrava com `"no partition of
   relation \"mentions\" found for row"`). `bw-sync` chama
   `ensureMentionPartitions()`, que faz RPC pra `create_mentions_partition()`
   (agora `security definer`, migration `20260710000000`) por mês distinto
   do lote — não depende de `pg_cron` pré-criando partições futuras com
   antecedência. Faz upsert em `mentions` via `idx_mentions_natural_key`
   (`query_id, resource_id, mention_date`).
   Campos mapeados: `resourceId→resource_id`, `categories→category_ids`,
   `tags→tag_names`, `sentiment`, `author`, `reachEstimate→reach_estimate`,
   `domain`, `snippet`, `added`, `date→mention_date`, e o objeto completo em
   `raw`. **`full_text` fica `null` nesta leva** — buscar via
   `/data/mentions/fulltext` dobraria as chamadas por poll; decisão
   deliberada, revisar se o produto precisar de texto completo (ex:
   matching de narrativa por `keyword` em fontes sem restrição).
   **Ampliação 2026-07-10** (pedido do usuário: garantir que tudo
   necessário pra visões estilo "Relatório de Insights" — mockup
   `mockup_governo_sp_narrativas.pdf` — já é capturado; nomes confirmados
   direto em `developers.brandwatch.com/docs/
   mention-metadata-field-definitions`, não só o resumo curado da skill):
   `gender`, `countryCode/region/city/continentCode`,
   `contentSource→content_source` (substitui `pageType`, deprecated pela
   Brandwatch), `language`, `impressions`, `impact`, `classifications`
   (array bruto, inclui emoção — `emotion` é derivado best-effort em
   `bw-sync`, não campo direto), `insightsHashtag→insights_hashtag`,
   `insightsMentioned→insights_mentioned`, `replyTo→reply_to`,
   `retweetOf→retweet_of`, e `engagement` (jsonb compacto só com as chaves
   de engajamento por plataforma presentes na mention — Brandwatch não tem
   campo genérico de engajamento, é por rede: `twitterFollowers/
   twitterLikeCount/twitterRetweets/twitterReplyCount`,
   `instagramFollowerCount/instagramLikeCount/instagramCommentCount`,
   `facebookLikes/Comments/Shares`, `tiktokLikes/Comments/Shares`,
   `blueskyFollowers/Likes/Replies/Reposts`,
   `linkedinLikes/Comments/Shares/Impressions`). Ver `data-model.md` §3.
6. Busca `data/volume/sentiment/days` para o par (`category` omitido = Query
   inteira, mais uma chamada por Category **vinculada a alguma
   `narratives.bw_category_id`** neste Project — não todas as Categories do
   Project) e faz upsert em `bw_query_metrics_daily`. Roda em **toda**
   invocação — é o dado mais volátil depois de mentions.
   ⚠️ **Correção 2026-07-10** (pedido do usuário: "as métricas não estão
   sendo trazidas corretamente" / "Data início 01/01/2026 até a data de
   hj"): este e todos os passos 6.x abaixo chamavam `data/volume/...` com
   `startDate`/`endDate` fixos numa janela de 7 dias (`sevenDaysAgo`/`now`),
   ignorando `BRANDWATCH_MENTIONS_START_DATE` — nenhuma das tabelas de
   agregado tinha dado mais antigo que uma semana. Corrigido: `startDate` =
   `metricsStartDate` (mesma config de `getMentionsStartDate()`) em todos
   os passos 6.x. Esses endpoints de chart devolvem todos os buckets do
   range pedido numa única chamada — alargar a janela não custa chamada
   extra de rate limit, só passa a cobrir o histórico configurado de
   verdade.
6.1. Mesma lógica para `data/volume/sentiment/weeks`/`.../months`, upsert em
   `bw_query_metrics_weekly`/`bw_query_metrics_monthly` — mas só quando não
   existir linha "fresca" (semanal: sem `synced_at` nos últimos 7 dias;
   mensal: 30 dias). Esse throttle é o que mantém o consumo de rate limit
   sob controle apesar de mais 2 tipos de métrica — sem ele, cada invocação
   (~20-30s) gastaria chamadas em dados que só mudam semanalmente/mensalmente.
6.2. Se a Query pertence a algum `bw_query_groups.query_ids`, e não existe
   linha "fresca" (7 dias) em `bw_query_group_metrics_weekly` para aquele
   grupo: busca `data/volume/queries/weeks?queryGroupId=...` e faz upsert
   (uma linha por Query dentro do grupo, por semana) — Share of Voice para
   o card do Executive Overview.
   ⚠️ **Correção 2026-07-10**: chamava originalmente
   `data/volume/queryGroups/weeks?queryGroupId=...`, assumindo (sem
   confirmação) um item por Query dentro do grupo. O exemplo real
   confirmado em `developers.brandwatch.com/docs/basic-charts` mostra o
   oposto: a dimensão `queryGroups` devolve **um item por Query Group
   inteiro**, volume agregado do grupo todo — não o breakdown
   candidato × concorrente que este passo precisa. Trocado para a dimensão
   `queries` (válida conforme `chart-dimensions-and-aggregates`), usando o
   grupo como filtro/escopo. Ainda não 100% confirmado contra um payload
   real (a doc não mostra um exemplo com os dois parâmetros juntos) — ver
   ressalva em `bw-sync/index.ts`, `syncQueryGroupSov()`.
6.3. Breakdown diário de volume por plataforma: busca `data/volume/
   pageTypes/days` (dimensão de chart `pageTypes`, plural — distinta do
   campo de mention `pageType`, deprecated) e faz upsert em
   `bw_query_metrics_daily_by_platform`. Roda em **toda** invocação, mesmo
   throttle do passo 6 (só query inteira, sem quebra por Narrativa).
   Adicionado 2026-07-10.
6.4. Temas: se não existir linha "fresca" (7 dias) em `bw_query_topics`
   para o par (e cada `categoryTarget`, mesmo padrão do passo 6.1): busca
   `data/topics?extract=words,phrases,hashtags,entities,people,places,
   organisations&metrics=volume,percentageVolume,sentiment,trending` e faz
   upsert em `bw_query_topics`. Este é o mecanismo nativo da Brandwatch
   mais próximo de "clusters temáticos com sentimento/volume/trending" do
   mockup de referência — ver investigação sobre "Iris" em `_index.md`
   ("Fora de escopo do MVP"): não existe uma Iris API separada, este é o
   que a Consumer Research API
   realmente oferece pra tematização automática, sem precisar de
   embeddings/clusterização próprios. Resposta usa a chave `topics` (não
   `results`, diferente dos outros endpoints de chart) — confirmado.
   Adicionado 2026-07-10.
6.5. Ranking de autores: se não existir linha "fresca" (7 dias) em
   `bw_query_top_authors` para o par (só nível de Query inteira, o
   endpoint não filtra por Category): busca `data/volume/
   topauthors/queries?limit=100` e faz upsert. Endpoint nativo de "Top
   Authors" — melhor do que calcular localmente por SQL sobre a amostra de
   `mentions` sincronizada (que a skill `brandwatch-api` recomendava como
   fallback, mas fica sujeito ao sampling de Queries de alto volume).
   Envelope de resposta confirmado: `results[].data.{authorName,
   authorGender, authorVolume, reachEstimate, impact, sentiment, twitter*/
   facebook*/reddit* fields}`. Adicionado 2026-07-10.
7. Atualiza `sync_cursors` (`last_added_cursor`, `last_synced_at`,
   `status = 'idle'`, `last_error = null`) e insere uma linha em `sync_log`
   (`status = 'success'`, `rows_processed` = mentions upsertadas).
8. Se qualquer chamada retornar `429`: aplica backoff (usa `retry-after` ou
   fallback de 20s), tenta até 3 vezes, e se ainda falhar marca
   `sync_cursors.status = 'error'` + `last_error` e `sync_log.status = 'error'`
   — a Edge Function sempre responde HTTP 200 mesmo em erro (o erro fica no
   corpo da resposta), para uma eventual invocação futura via `pg_cron` não
   ser interpretada como falha de infraestrutura.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| `HTTP 429` da Brandwatch | Backoff (ver best practices da skill `brandwatch-api`), até 3 tentativas; se esgotar, marca erro e tenta o próximo par na invocação seguinte — não trava a fila inteira |
| Token expirado/inválido | `sync_cursors.status = 'error'`, `last_error` com mensagem; **não** derruba a Edge Function para outros pares — cada par falha isoladamente |
| Query removida/pausada na Brandwatch | Mantida em `bw_queries` (histórico), mas sem novo `sync_cursors` de mentions; o refresh periódico de metadados (passo 4) reflete o estado atual |
| Project sem Query Group configurado (⚠️ correção 2026-07-07, encontrado em teste real) | `GET /projects/{id}/query-groups` responde `404` em vez de `{results: []}` quando não há nenhum grupo — tratado como "nenhum grupo" (loga e segue o bootstrap normalmente), não como falha; passo 6.2 (SOV) simplesmente não roda para aquele Project. Query Group é opcional por design (só necessário pro card de SOV, ver `brandwatch-setup.md` §4) |
| Categoria/Query sem mentions no período | Se a Brandwatch retornar `results` vazio para o chart, nenhuma linha é escrita naquele ciclo (em vez de forçar `total_mentions = 0`) — a API normalmente zero-preenche os dias/semanas/meses do range solicitado, então isso só deve ocorrer se o range inteiro não tiver dado nenhum |
| Query com `sampled = true` | Sincroniza normalmente — `sampled`/`sample_percentage` só é usado como sinal de que os totais devem vir de `bw_query_metrics_daily`/`weekly`/`monthly`, não que o sync deva mudar de comportamento |
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

- **Lê**: `brandwatch_credentials`, `sync_cursors`, `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`, `narratives` (para saber quais `bw_category_id` merecem chart por categoria).
- **Escreve**: `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`, `mentions`, `bw_query_metrics_daily`/`weekly`/`monthly`, `bw_query_group_metrics_weekly`, `sync_cursors`, `sync_log`.
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
