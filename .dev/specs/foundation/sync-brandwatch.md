---
tipo: feature-spec
módulo: foundation
funcionalidade: sync-brandwatch
status: implementado
atualizado: 2026-07-16
---

# Sync Brandwatch

> ✅ **Status corrigido 2026-07-14** (premissa do projeto, ver CLAUDE.md
> "Close the loop"): `bw-sync` (`supabase/functions/bw-sync/index.ts`,
> ~1950 linhas) em produção, agendada via `pg_cron` desde 2026-07-11 — ver
> `CLAUDE.md`, "Brandwatch sync model", pro histórico completo de
> implementação/bugs corrigidos (fases, rate limit, backfill, etc). Único
> gap real restante é não-bloqueante: cache do token em Vault, ver
> `_pending.md` "Gaps técnicos" #5.

## Objetivo

Manter `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`,
`mentions`, `bw_query_metrics_daily`/`weekly`/`monthly` e
`bw_query_group_metrics_weekly` sincronizados com a Brandwatch, respeitando
o rate limit (30 chamadas/10min por Client) e sem depender de soma local de
mentions para números de volume (ver nota de sampling).

> ✅ **Cadência de captura agendada (2026-07-11)**: "a cada 3 horas as
> rotinas de integração com a Brandwatch sejam executadas para capturar o
> cenário atual" — parâmetro de negócio 100% controlado pelo secret
> `BW_SYNC_INTERVAL_HOURS` (default `3`), sem precisar de nova migration
> para mudar. Ver passo 0.5b abaixo para o mecanismo. Os dados capturados
> (diário/semanal/mensal, sempre vindos de agregados oficiais da
> Brandwatch — nunca somados localmente sobre `mentions`) são armazenados
> como **histórico** (`bw_query_metrics_daily`/`weekly`/`monthly`,
> `narrative_metrics`, `bw_query_topics`, `bw_query_top_authors`,
> `bw_query_x_insights` — uma linha por data/semana/mês, nunca sobrescrita
> nem removida) — ver "Regras de negócio" abaixo para a confirmação
> explícita de que isso já atende o uso futuro como base de dados para IA
> (Sprint 4).

## Usuários afetados

Nenhum usuário final interage diretamente — é um job de backend. Analistas e
o Executive Overview consomem o resultado (tabelas já sincronizadas).

## Execução em fases (2026-07-11)

⚠️ **Bug de produção corrigido**: `HTTP 546`-adjacent (`CPU Time exceeded`,
não o `WORKER_RESOURCE_LIMIT` de memória já corrigido antes) — uma única
invocação, ao processar um par "devido", encadeava mentions (paginado) +
sentimento diário (5 chamadas) + reach/engagement por Category (2 chamadas,
uma delas com **4825 linhas numa resposta só**) + plataforma + (quando
"stale") semanal/mensal + temas + top authors (até 1000 linhas ×
categoryTarget) + SOV — dezenas de milhares de objetos JSON processados
sincronamente, estourando o orçamento de CPU do runtime Deno (tempo de
computação síncrona, diferente de esperar rede).

**Correção**: o trabalho de um par "devido" foi quebrado em fases
(`sync_cursors.next_step`), uma por invocação:

| Fase (`next_step`) | Cobre os passos numerados abaixo |
|---|---|
| `metadata` | Passo 3 (bootstrap/refresh condicional) |
| `mentions` | Passo 5 (polling paginado) |
| `daily_metrics` | Passos 6, 6.3, 6.3b, 6.3d (sentimento diário + reach/engagement/autores únicos/impressões/**net sentiment** por Narrativa e Query inteira + plataforma incl. autores/engajamento/sentimento líquido por plataforma — sempre rodam, não são "stale-gated", mas cada chamada agora é guardada por `hasBrandwatchCallBudget()`, ver nota logo abaixo) |
| `hourly_metrics` | ✅ Passo 6.3e — **implementado 2026-07-13, migration `20260713040000`**: volume/sentimento/net sentiment em grão horário (`bw_query_metrics_hourly`), janela móvel de 30 dias buscada a cada invocação — sempre roda, não é "stale-gated" (é o oposto do throttle semanal: precisa estar sempre fresco pra detecção de curto prazo). Sem job de retenção/limpeza — mesma filosofia de histórico acumulando indefinidamente já aplicada a `daily`/`weekly`/`monthly` (ver `data-model.md`) |
| `weekly_monthly` | Passo 6.1 (semanal/mensal, throttle 7/30 dias) |
| `topics` | Passo 6.4 (temas — endpoint novo `data/topics` + endpoint legado `data/volume/topics/queries`, throttle 7 dias) |
| `platform_by_narrative` | Passo 6.3c (breakdown de plataforma por Narrativa, throttle 7 dias) |
| `x_insights` | Passo 6.4b (hashtags/emojis/URLs/autores citados de X, throttle 7 dias) |
| `top_authors` | Passo 6.5 (ranking geral de autores, throttle 7 dias) |
| `top_tweeters` | ✅ Passo 6.5b — **novo** (2026-07-12): ranking específico de autores de X (`data/volume/toptweeters/queries`, `bw_query_top_tweeters`), distinto de `top_authors` — throttle 7 dias |
| `author_enrichment` | Passo 6.7 (impressões + temas dos top 10 autores de `bw_query_top_authors`, throttle 7 dias) |
| `top_sites` | Passo 6.8 (ranking de sites/domínios de onde as mentions vêm, throttle 7 dias) |
| `top_shared_sites` | ✅ Passo 6.8b — **novo** (2026-07-12): ranking de domínios mais compartilhados/linkados dentro do conteúdo das mentions (`data/sharedsites`, `bw_query_top_shared_sites`), distinto de `top_sites` — throttle 7 dias |
| `demographics` | Passo 6.6 (demografia — gender/localização + sentimento líquido por localização, throttle 7 dias) |
| `full_text_enrichment` | ✅ Passo 5 (nota) — **implementado 2026-07-13**: busca seletiva de `full_text` (top-N por engajamento/`reach_estimate`, por Narrativa/dia, só fontes não-redigidas), throttle "1 Narrativa×dia pendente por invocação" (ver nota própria abaixo) |
| `sov` | Passo 6.2 (Share of Voice de Query Group + reach por candidato, throttle 7 dias) |

Todas as 16 fases acima estão ✅ **implementadas** — incluindo a coluna
`net_sentiment` dentro de `daily_metrics` (passo 6.3d, migration
`20260713030000`, 2026-07-13), `hourly_metrics` (passo 6.3e, migration
`20260713040000`) e `full_text_enrichment` (passo 5, mesma data). Nenhuma
fase fica mais só "especificada" — ver `.dev/specs/_pending.md`, seção
"Gaps técnicos" de `foundation`, que ficou vazia depois desta rodada
(token caching do Vault continua deferido à parte, não é uma fase de
`SYNC_STEPS`).
`x_insights`,
`top_sites`, `demographics` (mais `reach_estimate` em `sov`) foram
priorizadas depois de validar o modelo de dados contra um export real de
dashboard Brandwatch (ver "Validação contra dashboard real" mais abaixo);
`top_tweeters`/`top_shared_sites` foram adicionadas em 2026-07-12 (migration
`20260712040000`) a partir de uma auditoria pedida pelo usuário contra a
doc oficial da Brandwatch, que encontrou dois endpoints genuinamente
distintos (não cobertos por engano como "a mesma coisa" que `top_authors`/
`top_sites`) — ver `data-model.md` §5 pro racional completo de cada um.

Cada invocação lê `next_step` do par escolhido, executa **só essa fase**, e
avança o cursor pra próxima. Fases "stale-gated" (`weekly_monthly`,
`topics`, `x_insights`, `top_authors`, `top_tweeters`, `author_enrichment`,
`top_sites`, `top_shared_sites`, `demographics`, `full_text_enrichment`,
`sov`) percorrem os
`categoryTargets`/candidatos/dimensões e param no **primeiro** que
precisar de trabalho real — os demais
continuam "stale" e são retomados numa invocação futura da mesma fase, não
na mesma invocação (é isso que limita o pico de CPU; verificações de
frescor que não acham nada pra fazer são baratas e não avançam por si só o
"orçamento" de CPU, só avançam pra próxima fase dentro da mesma
invocação). O ciclo completo (as 16 fases) só fecha — e só então
`sync_cursors.last_synced_at` avança, rearmando o gate de
`BW_SYNC_INTERVAL_HOURS` do passo 0.5b — quando a última fase (`sov`) roda
(ou é pulada por não ter trabalho).

⚠️ **Bug de produção corrigido (2026-07-13)**: `daily_metrics`
(`runDailyMetricsStep()`) era a única fase sem nenhum
`hasBrandwatchCallBudget()` — sempre fez 1 chamada de sentimento **por
categoryTarget** (query inteira + cada Narrativa) mais 10 chamadas fixas de
agregado (`reachEstimate`/`engagementScore`/`unique_authors`/`impressions`/
`net_sentiment` × dimensões `categories`+`queries`) mais 4 de plataforma.
Com Narrativas suficientes (relatado em produção: `429` em
`netSentiment/queries/days`, a última chamada da sequência, 3 tentativas
de retry esgotadas, invocação inteira falhando), essa soma sozinha estoura
o teto real da Brandwatch (30 chamadas/10min) **numa única invocação**,
antes mesmo de considerar chamadas de invocações anteriores na mesma
janela. Corrigido: cada chamada da fase agora é guardada por
`hasBrandwatchCallBudget()`, mesmo padrão já usado em toda fase
"stale-gated" — assim que o orçamento acaba, a fase para (retorna
`didWork: true`, fecha a invocação) e o que ficou pra trás é retomado no
próximo ciclo completo desta mesma fase (idempotente, sem perda de dado,
só atraso).

⚠️ **Trade-off aceito**: como as fases "stale-gated" agora processam no
máximo um `categoryTarget`/grupo/dimensão por invocação (em vez de todos
numa passada), popular **todos** os `categoryTargets`/dimensões de uma
Narrativa recém-criada pode levar vários ciclos completos (cada ciclo =
`BW_SYNC_INTERVAL_HOURS`) em vez de um só. Aceito em troca de nunca mais
estourar o orçamento de CPU — ver `data-model.md` §4 (`sync_cursors`).

**Estado vive inteiro no Postgres, nunca em memória do isolate** — por
isso uma invocação **manual** (clique em "Invoke" no Dashboard do
Supabase, útil durante testes) se comporta exatamente como um tick do
heartbeat de 15min: lê `next_step` do par mais "devido", roda essa fase,
grava o próximo passo. Não há modo de teste separado nem estado
in-memory que se perca entre invocações — clicar várias vezes seguidas
avança o ciclo normalmente, uma fase por clique.

**Complementar**: `syncCategoryDailyAggregate()` (reach/engagement, a
chamada que devolveu 4825 linhas) também passou a fazer upsert em lotes de
1000 linhas (`chunkArray()`) em vez de uma única chamada com todas as
linhas — reduz o pico de serialização síncrona de um corpo de requisição
gigante, complementar à quebra em fases.

## Validação contra dashboard real (2026-07-11)

O usuário forneceu um export real em PDF de um dashboard Brandwatch
("Candidatos | Overview") comparando 6 candidatos dentro de um Query
Group, com paineis de volume/reach/sentimento/demografia/temas/autores/
sites. Usado para validar o modelo de dados deste módulo contra o que a
Brandwatch realmente entrega, painel a painel — resultado:

- **A maior parte já era coberta** pelo que `foundation` já sincronizava
  ou já estava spec'd (`bw_query_metrics_daily`/`by_platform`,
  `bw_query_group_metrics_weekly`, `bw_query_top_authors`,
  `bw_query_topics`) — sem gap novo.
- **Achado mais importante**: o painel "Iris detected N peaks" (picos de
  volume com driver nomeado — "540% aumento, causado por: 10 reposts
  deste Post") **não tem endpoint público documentado** (pesquisado a
  fundo: `chart-dimensions-and-aggregates`, `basic-charts`, índice
  completo da doc — sem menção a "Iris", "peak", "spike", "anomaly",
  "driver"). Confirma e reforça a investigação já registrada em
  `_index.md` ("Fora de escopo do MVP") — Iris é a camada de IA que roda
  **dentro do produto BWX/dashboard** da Brandwatch, não uma API que
  `bw-sync` possa consumir. **Esse card específico não é replicável** via
  Consumer Research API — limitação estrutural, não gap de implementação.
- **Gaps novos confirmados e priorizados nesta leva**: `bw_query_x_insights`,
  `bw_query_demographics_daily` (ambos já spec'd antes, mas sem migration
  até esta validação confirmar o valor real pra UI), `bw_query_top_sites`
  (novo), `reach_estimate` em `bw_query_group_metrics_weekly` (novo),
  `tweets`/`retweets`/`account_type`/`country_code`/`country_name` em
  `bw_query_top_authors` (extração de campos já capturados).
- **Itens em aberto, sem conclusão ainda**:
  - ✅ **"Post Type" — pendência retirada (2026-07-13)**: a informação em
    si (`mentions.mention_role`, por mention individual) já é capturada
    sem gap — usada no grafo de disseminação (`intelligence-center/narratives-exploration.md`),
    não num painel agregado. Um painel comparando candidatos por % de
    retweet/reply/original continuaria sem dimensão de chart oficial
    (só `mention_role` por mention, somar seria sobre `mentions`
    amostrada), mas deixou de ser uma pendência registrada por não ser um
    caso de uso pedido — ver `_index.md`, "Fora de escopo do MVP".
  - ✅ **"Most Karma" (Reddit) em Top Authors — confirmado (2026-07-12)**:
    auditoria direta contra `developers.brandwatch.com/docs/top-authors`
    confirma os campos `redditAwardeeKarma`/`redditAwarderKarma`/
    `redditKarma` no payload de `data/volume/topauthors/queries`. Já
    capturados sem código novo — vivem dentro de
    `bw_query_top_authors.platform_stats` (objeto bruto inteiro, mesmo
    raciocínio de `mentions.engagement`). Se a UI precisar exibir "karma"
    como coluna própria (não só dentro do jsonb), é só uma extração de
    campo já presente, sem chamada nova — mesmo padrão já usado pra
    `tweets`/`retweets`/`account_type`/`country_code`/`country_name`.
  - **"Análise de Imagem"**: o único recurso parecido na API é "Objects &
    Logos" (`images/objects`/`images/logos`) — mas isso é um mecanismo de
    **lookup pra configurar filtro de Query** (achar IDs de logo/objeto
    pra usar como filtro na criação de uma Query), não um analytics de "o
    que aparece nas imagens das mentions". Não é o mesmo tipo de dado
    sincronizável que as demais tabelas deste módulo — precisa de decisão
    de produto sobre se isso é relevante antes de investir mais.
  - **Painel "Custom"**: sem conteúdo visível no export fornecido, não dá
    pra saber o que cobre.

## Correção de escopo do SOV (2026-07-11)

Pedido do usuário: "O SOV corresponde a: Menções da Narrativa / Total de
Menções. Verifique se estamos seguindo esse conceito... Se houver alguma
divergência, corrija." Exemplo dado (monitoramento eleitoral, 200 mil
menções totais, distribuídas em 5 Narrativas — Saúde 40%/Educação 22%/
Segurança 18%/Economia 12%/Mobilidade 8% — somando 100%).

**Havia divergência real**: `public.narratives_overview.sov_percent`
dividia pelo total de **todas as Narrativas da organização inteira**
(agrupado só por `organization_id`), não pelo total da **mesma Query**
(candidato/monitoramento) que as Narrativas pertencem. Correto só na
coincidência de a organização ter uma única Query — divergente assim que
o Project tem mais de uma (confirmado como cenário real na validação
contra dashboard, seção acima — 6 candidatos, 6 Queries).

Causa raiz, mais funda que a view: `fetchNarrativeCategoryIds()` — chamada
no início de cada invocação pra montar `categoryTargets` (usado por todos
os passos 6.x que quebram por Narrativa) — devolvia **todas** as
Narrativas do Project pra **qualquer** Query sendo sincronizada, sem saber
a qual Query cada Category pertence. Além de desperdiçar orçamento (uma
Query filtrando por Categories de candidatos alheios em todo passo 6.x),
permitia que `refresh_narrative_metrics()` (join só por `category_id`, sem
`query_id`) juntasse `total_mentions` da Query errada pra uma Narrativa.

**Correção** (migration `20260711080000`): `bw_categories` ganha
`query_ids` (Brandwatch já devolve isso em `GET .../rulecategories` —
campo `queryIds`, confirmado em
`developers.brandwatch.com/docs/retrieving-categories` — sem chamada
nova); `fetchNarrativeCategoryIds()` passa a filtrar por Query (só
Categories cujo `query_ids` contém a Query sendo sincronizada);
`narrative_metrics` ganha `query_id` (preenchido só quando a Category tem
exatamente 1 Query associada); a view recalcula `sov_percent` agrupando
por `query_id`. Ver `data-model.md` "Camada de reporting" pro detalhe
completo do SQL.

**SOV por plataforma e por autor** (mesmo pedido do usuário: "importante
que tenhamos share of voice por plataforma, por narrativa e por
autores"): por autor já era respondível com dado existente
(`bw_query_top_authors.volume` ÷ `bw_query_metrics_daily.total_mentions`,
sem tabela nova). Por plataforma **não** era — `bw_query_metrics_daily_by_platform`
só tinha o breakdown da Query inteira, sem quebra por Narrativa. Ganhou
`category_id`/`category_id_key` (migration `20260711090000`) + fase
própria `platform_by_narrative` (passo 6.3c abaixo) — ver `data-model.md`
§5 pro racional completo.

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
0.5. **Lock de concorrência** (⚠️ correção 2026-07-10/11, encontrado em
   teste real: HTTP 429 em cascata em duas chamadas diferentes — sinal de
   duas invocações de `bw-sync` rodando ao mesmo tempo e disputando o
   mesmo orçamento de 30 chamadas/10min do Client, já que o rate limit é
   por Client, não por invocação). Antes de qualquer chamada à Brandwatch,
   a função reivindica um lock via `try_acquire_bw_sync_lock()` (linha
   única em `bw_sync_lock`, reivindicada por `UPDATE` atômico — não
   advisory lock, que não é confiável via PostgREST/pooling de conexão).
   Se outra invocação já tiver o lock, a atual encerra imediatamente
   (`HTTP 200, ok: true`) sem tentar nada. Lock expira sozinho em 5min
   mesmo sem `release_bw_sync_lock()` explícito, pra não travar pra sempre
   se uma invocação morrer no meio do caminho.
0.5b. **Gate de intervalo de negócio** (✅ adicionado 2026-07-11, pedido do
   usuário — ver migration `20260711020000`). Roda **antes** do lock acima
   (checagem barata, sem chamar a Brandwatch): depois da semeadura do passo
   0 (que também passou a rodar antes do lock, pelo mesmo motivo), a função
   calcula `dueCutoff = now() - BW_SYNC_INTERVAL_HOURS horas` (secret da
   Edge Function, default `3`) e conta quantos `sync_cursors` têm
   `last_synced_at is null or last_synced_at < dueCutoff` (ou seja, "devidos"
   pra nova sincronização). Se zero, a invocação encerra imediatamente
   (`HTTP 200, ok: true, skipped: true`) sem mintar token nem chamar a
   Brandwatch. Isso é o que torna o "a cada 3 horas" um parâmetro de
   ambiente de verdade — mudar `BW_SYNC_INTERVAL_HOURS` (`supabase secrets
   set`) muda o comportamento na invocação seguinte, sem nova migration.
0.5c. **Gate de rate limit** (✅ adicionado 2026-07-16, correção de bug de
   produção — ver item 8 abaixo). Roda depois do gate 0.5b e antes do
   lock 0.5 (mesma ordem em código: checagem barata, sem chamar a
   Brandwatch). Lê `bw_sync_lock.rate_limited_until` — se estiver no
   futuro (setado por `mark_bw_rate_limited()` numa invocação anterior que
   esgotou retry num `429`), a invocação encerra imediatamente (`HTTP 200,
   ok: true, skipped: true, reason: "brandwatch_rate_limited"`) sem mintar
   token nem reivindicar o lock.
1. `pg_cron` invoca a Edge Function `bw-sync` a cada **15 minutos** — um
   heartbeat fixo e barato (cadência de infraestrutura, não o parâmetro de
   negócio; só precisa ser frequente o bastante relativo aos
   `BW_SYNC_INTERVAL_HOURS` configurados pra não gerar atraso perceptível
   — ver migration `20260711020000`, `select net.http_post(url := ...)`,
   `verify_jwt = false` pra esta function já que só é acionada por
   `pg_cron`/manualmente). A maioria dos heartbeats não faz nenhum trabalho
   — sai no gate do passo 0.5b. ⚠️ **Histórico**: até 2026-07-11, `bw-sync`
   nunca teve `pg_cron` agendado de verdade (só invocação manual) — o
   bloqueio documentado (mint de token gastando parte do orçamento de
   30/10min a cada invocação, relevante numa cadência de ~20-30s) deixou de
   valer nesse desenho, porque o gate do passo 0.5b faz o mint só acontecer
   quando algum par está de fato devido (a cada `BW_SYNC_INTERVAL_HOURS`
   por par, não a cada heartbeat) — sem precisar implementar o cache de
   token no Vault antes (continua um TODO separado, só que não bloqueante).
2. A função resolve, em round-robin, o próximo par `(project_id, query_id)`
   **devido** (mesmo filtro do passo 0.5b, reaplicado aqui) com sync
   pendente, olhando `sync_cursors` (dentre os devidos, o cursor com
   `last_synced_at` mais antigo primeiro). ⚠️ **Trade-off aceito**: uma
   invocação processa só um par — se houver múltiplos pares devidos ao
   mesmo tempo (ex: várias Queries), cada um é pego num heartbeat de 15min
   subsequente, não todos de uma vez. Com heartbeat de 15min e um punhado
   de pares (cenário típico de MVP — 1 Project, poucas Queries), o atraso
   entre pares no mesmo ciclo é de no máximo alguns múltiplos de 15min —
   desprezível frente a uma cadência de negócio de horas. O
   **backfill histórico de mentions** (`BRANDWATCH_MENTIONS_START_DATE` até
   hoje) também passa a avançar só quando o par está devido, não
   continuamente — logo mais lento em tempo relógio do que seria numa
   cadência de segundos, mas aceitável: a prioridade explícita do pedido é
   "capturar o cenário atual" a cada intervalo, não velocidade de backfill.
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
   novo em **toda** invocação que passa do gate do passo 0.5b
   (`mintBrandwatchAccessToken()` em `bw-sync/index.ts`);
   `brandwatch_credentials.access_token_secret_ref`/`token_expires_at`
   existem na tabela para servir de cache, mas o write-back pro Vault
   ainda é TODO. ✅ **Deixou de bloquear o agendamento via `pg_cron`
   (2026-07-11)**: o gate do passo 0.5b faz o mint só acontecer quando algum
   par está devido (a cada `BW_SYNC_INTERVAL_HOURS` por par, não a cada
   heartbeat de 15min) — a essa cadência o mint sem cache é irrelevante para
   o orçamento de 30/10min. O cache continua valendo a pena (evita 1
   chamada por par devido), só não é mais pré-requisito.
4. Se for a primeira sincronização daquele Project (`bw_projects.name` ainda
   é o placeholder do passo 0), `bw_categories` estiver vazia, ou um refresh
   periódico (> 1h desde `synced_at` — reduzido de 24h, ver correção
   abaixo): busca `GET /projects/{projectId}` (nome/timezone reais),
   `queries/summary` (todas as Queries do Project, não só a rastreada),
   `query-groups` e `rulecategories` (achatando Category+Subcategories em
   linhas de `bw_categories`, `parent_id` para subcategoria), e faz upsert
   em `bw_projects`/`bw_queries`/`bw_query_groups`/`bw_categories`. ✅
   **Correção 2026-07-11** (bug de escopo do SOV, ver seção acima):
   `bw_categories.query_ids` também é populado a partir do campo
   `queryIds` que `rulecategories` já devolve — sem chamada nova, só um
   campo a mais mapeado da mesma resposta.
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
   própria Brandwatch (`brandwatch-setup.md`). **Se o Project ID
   configurado em `BRANDWATCH_PROJECT_ID` não for o mesmo Project onde as
   Categories foram criadas na Brandwatch, a sincronização nunca vai
   encontrá-las** — checar isso é o primeiro passo se `categoriesCount`
   continuar `0` mesmo com Categories visíveis na UI da Brandwatch.
   ⚠️ **Correção 2026-07-10, mesmo dia** (relatado pelo usuário: "em
   categorias, não está refletindo as categorias existentes na
   brandwatch" — o throttle de 24h não refletia Categories
   adicionadas/editadas na Brandwatch depois do último refresh bem
   sucedido, só o caso de "zero Categories" tinha um bypass). Reduzido de
   24h pra **1h** — ainda barato de rate limit (no máximo ~4 chamadas
   extras/hora por Project). **Não deleta** Categories que sumiram da
   Brandwatch — só adiciona/atualiza (`upsert`). Deletar seria arriscado:
   `bw_query_metrics_daily`/`bw_query_topics`/`bw_query_top_authors` têm
   `on delete cascade` pra `bw_categories` (apagaria histórico de
   métricas), e `narratives.bw_category_id` **não** tem `on delete
   cascade` (a deleção falharia com violação de FK se a Category já virou
   Narrativa). Uma Category removida/renomeada na Brandwatch fica órfã em
   `bw_categories` até limpeza manual — mais seguro que apagar dado
   histórico às cegas. ✅ **`status` implementado (2026-07-16, migration
   `20260716010000`)**: em vez de só ficar "órfã" silenciosamente, toda
   Category/Subcategory do Project que não veio no `rulecategories` desta
   checagem (a cada refresh de metadata, mesmo throttle de 1h acima) é
   marcada `status = 'inactive'` — ainda não deletada (mesmos motivos de
   FK/histórico acima), mas para de contar como "ativa" pro resto do
   sistema: `fetchNarrativeCategoryIds()` (passo 6 abaixo) para de
   sincronizar novo dado pra ela, e `get_narratives_table`/
   `get_theme_breakdown` (aggregated-metrics) param de listá-la. Reaparece
   automaticamente como `active` se a Category voltar a existir num
   `rulecategories` futuro.
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
   ⚠️ **Correção 2026-07-10/11, mesmo incidente de HTTP 429 do passo 0.5**:
   além de duas invocações concorrentes, uma única invocação sozinha já
   podia se aproximar ou passar de 30 chamadas — o número de passos cresceu
   bastante (mentions paginado + diário + reach/engajamento + plataforma +
   semanal/mensal + temas + top autores × `categoryTargets` + SOV).
   `brandwatchCallCount` (reiniciado no topo de cada invocação, nunca
   reaproveitado entre invocações mesmo em warm start do isolate) conta
   toda tentativa real de chamada (inclusive as que tomam 429, já que
   também consomem o orçamento do Client). `BRANDWATCH_CALL_BUDGET = 25`
   deixa margem sob 30 pro mint de token (que não passa por
   `callBrandwatch()`). O loop de mentions e o loop de `categoryTargets`
   (semanal/mensal/temas/top-autores/SOV) param assim que o orçamento
   acaba — o que sobrar continua "stale"/incompleto e é retomado
   naturalmente na invocação seguinte, sem lógica extra de retomada.
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
   ✅ **Busca seletiva implementada (2026-07-13, sem migration — `full_text`
   já existia como coluna)**: fase própria `full_text_enrichment`
   (`runFullTextEnrichmentStep()`, entre `demographics` e `sov` em
   `SYNC_STEPS`), fora do poll principal de mentions pra não competir pelo
   mesmo orçamento por invocação. Critérios, todos aplicados via SQL sobre
   `mentions` já sincronizadas localmente (nenhuma chamada nova só pra
   decidir o que buscar): (a) fonte não-redigida (`content_source` fora de
   `twitter`/`reddit`/`linkedin`/`news` — mesma lista de 4 fontes
   restringidas por `data-restrictions-compliance.md`; `content_source`
   ainda `null` — mentions de antes da migration `20260710010000` — é
   tratado como elegível por padrão, não excluído preventivamente); (b) já
   vinculada a uma Narrativa (`bw_category_id`, via `categoryTargets`); (c)
   `full_text is null` ainda. `findPendingFullTextDay()` acha o dia mais
   recente com pelo menos 1 mention pendente pra uma Narrativa; se achar,
   `enrichFullTextForNarrativeDay()` seleciona as top-N (`FULL_TEXT_ENRICHMENT_TOP_N
   = 8`) por `reach_estimate` **localmente** (não uma nova chamada agregada
   — é só ordenar o que já foi sincronizado, não uma estatística sobre a
   amostra) e busca `/data/mentions/fulltext?category=<id>&startDate=<dia
   00h>&endDate=<dia+1>` (janela de 1 dia + filtro de Category, escopo
   estreito o bastante pra não perder as mentions-alvo em uma única
   página), casando `resourceId`→`fullText` do payload contra o conjunto-alvo
   antes de atualizar. Throttle: no máximo 1 Narrativa×dia por invocação
   (mesmo padrão "para no primeiro que precisar de trabalho" das demais
   fases stale-gated) — bounded por Narrativa×dia, não por mention
   individual, como planejado.
   ⚠️ Nomes de campo não confirmados contra um payload real: `fullText`
   (resposta de `/data/mentions/fulltext`) e os valores exatos de
   `content_source` pra `reddit`/`linkedin` — inferidos da mesma convenção
   já usada em `contentSource`/`pageType` noutros pontos deste arquivo.
   Revisar contra logs `[bw-sync] enrichFullTextForNarrativeDay:*` reais
   após o deploy. Ver `data-model.md` §3 pro racional completo.
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
   `narratives.bw_category_id` e associada a esta Query** — não toda
   Category do Project, ver correção de escopo do SOV acima) e faz upsert
   em `bw_query_metrics_daily`. Roda em **toda** invocação — é o dado mais
   volátil depois de mentions.
   ⚠️ **Correção 2026-07-11** (bug de escopo do SOV, ver seção acima): até
   `fetchNarrativeCategoryIds()` ganhar o filtro por Query, este passo
   incluía Categories de **qualquer** Query do Project como
   `categoryTarget`, não só as da Query sendo sincronizada — desperdício de
   orçamento e risco de `refresh_narrative_metrics()` juntar dado da Query
   errada. Corrigido via `bw_categories.query_ids`.
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
   ✅ **Correção 2026-07-19** (pedido do usuário: já existe base histórica
   sincronizada, não faz sentido `metricsStartDate` continuar sempre igual
   a `BRANDWATCH_MENTIONS_START_DATE` — "buscar dados incrementais, do dia
   atual em diante"): a correção acima resolveu o problema de 2026-07-10
   (histórico realmente populado), mas deixou todo par "maduro" pedindo e
   re-upsertando o histórico completo (Jan/26 → hoje) em **toda**
   invocação, mesmo depois de já ter sido sincronizado — desperdício de
   payload/CPU/upsert crescente com o tempo, mesma classe de risco que já
   causou `WORKER_RESOURCE_LIMIT` no polling de mentions (ver
   `data-model.md`). `getMetricsStartDate(backfill_completed_at)` agora
   decide por par: enquanto o backfill histórico de mentions daquele par
   não terminou (`sync_cursors.backfill_completed_at` null), mantém o
   range completo (`getMentionsStartDate()`) — os agregados ainda
   dependem disso pra se popular ao longo do backfill. Uma vez que o
   backfill termina, todos os passos 6.x passam a pedir só uma **janela
   móvel** (`now() - BW_METRICS_INCREMENTAL_WINDOW_DAYS`, secret opcional,
   default 30 dias) — mesmo padrão já usado pelo passo 6.3e
   (`HOURLY_METRICS_WINDOW_MS`), só que configurável e não hardcoded.
   Trade-off aceito: uma correção da Brandwatch a um bucket **fora** dessa
   janela deixa de ser recapturada — histórico já sincronizado antes da
   janela passa a ser efetivamente definitivo. Ver `bw-sync/index.ts`,
   `getMetricsStartDate()`, pelo racional completo.
6.1. Mesma lógica para `data/volume/sentiment/weeks`/`.../months`, upsert em
   `bw_query_metrics_weekly`/`bw_query_metrics_monthly` — mas só quando não
   existir linha "fresca" (semanal: sem `synced_at` nos últimos 7 dias;
   mensal: 30 dias). Esse throttle é o que mantém o consumo de rate limit
   sob controle apesar de mais 2 tipos de métrica — sem ele, toda vez que um
   par estivesse devido (ver passo 0.5b) gastaria chamadas em dados que só
   mudam semanalmente/mensalmente, mesmo que o par já tivesse sido
   sincronizado há pouco.
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
   ✅ **Ampliação 2026-07-11** (validação contra export real de dashboard
   Brandwatch — "Reach Over Time" comparando candidatos dentro do mesmo
   Query Group): mesma chamada ganha um segundo aggregate,
   `data/reachEstimate/queries/weeks?queryGroupId=...` — upsert parcial
   (só `reach_estimate`) na mesma linha de `bw_query_group_metrics_weekly`.
   Mesma dimensão `queries` já usada acima, só trocando `volume` por
   `reachEstimate` — herda a mesma ressalva de "não 100% confirmado".
6.3. Breakdown diário de volume por plataforma: busca `data/volume/
   pageTypes/days` (dimensão de chart `pageTypes`, plural — distinta do
   campo de mention `pageType`, deprecated) e faz upsert em
   `bw_query_metrics_daily_by_platform`. Roda em **toda** invocação, mesmo
   throttle do passo 6 (só query inteira, sem quebra por Narrativa).
   Adicionado 2026-07-10.
6.3b. Alcance e engajamento por Narrativa, **não amostrados**: busca
   `data/reachEstimate/categories/days` e `data/engagementScore/
   categories/days` — a dimensão `categories` devolve o breakdown de
   **todas** as Categories numa única chamada por aggregate (2 chamadas
   totais, não uma por Narrativa), e faz upsert parcial (só essas 2
   colunas) em `bw_query_metrics_daily`. Roda em **toda** invocação, mesmo
   throttle do diário. ⚠️ Correção 2026-07-10 (pedido do usuário: "como as
   menções trazidas na integração são apenas amostras, é importante que...
   o alcance [e] o engajamento... sejam buscados diferentemente na
   brandwatch") — antes, `reach_estimated`/`engagement_total` em
   `narrative_metrics` vinham de somar `mentions.reach_estimate`/
   `engagement` localmente, que é amostrado em Queries de alto volume.
   Formato de resposta inferido pelo padrão geral (`results[].id`/
   `values[]`, mesmo shape de `data/volume/sentiment/days`), não
   confirmado com um payload de exemplo específico pra esses 2 aggregates
   — mesma categoria de risco já assumida pra `syncPlatformMetrics`.
   ⚠️ **Correção 2026-07-10, encontrado em teste real**: a dimensão
   `categories` devolveu IDs de Category fora do que `bw_categories` tinha
   cacheado (Categories fora do escopo de `rulecategories`, ou
   dessincronizadas desde o último refresh de metadata), quebrando o
   upsert com violação de FK (`bw_query_metrics_daily.category_id →
   bw_categories.id`). `syncCategoryDailyAggregate()` agora busca os IDs
   conhecidos de `bw_categories` primeiro e descarta (com log
   `syncCategoryDailyAggregate:unknown_categories_skipped`) qualquer
   Category fora desse conjunto, em vez de derrubar a invocação inteira.
6.3c. ✅ **Breakdown de plataforma por Narrativa** (implementado 2026-07-11,
   pedido do usuário: "importante que tenhamos share of voice por
   plataforma... por narrativa"): mesmo throttle semanal de
   `weekly_monthly`/`topics`, reusa `syncPlatformMetrics()` do passo 6.3
   (mesmo endpoint, `data/volume/pageTypes/days`), agora com filtro
   `category=<id>` — para no primeiro `categoryTarget` (excluindo `null`,
   já coberto pelo passo 6.3 todo ciclo) sem linha "fresca" em
   `bw_query_metrics_daily_by_platform`. Fase própria (`platform_by_narrative`),
   não faz parte do passo 6.3 (que roda toda invocação sem quebra por
   Narrativa) pra não reintroduzir o risco de CPU corrigido na "Execução em
   fases".
6.3d. ✅ **Sentimento líquido (`netSentiment`) por Narrativa e por Query
   inteira — implementado 2026-07-13, migration `20260713030000`** (revisão pedida pelo usuário: "verifique
   se na foundation os dados de net sentiment estão vindo da brandwatch").
   Mesmo mecanismo do passo 6.3b: `data/netSentiment/categories/days`
   (todas as Narrativas numa chamada, via `syncCategoryDailyAggregate()`
   passando `"netSentiment"` como aggregate) + `data/netSentiment/queries/days`
   (Query inteira, `category_id is null`, via `syncQueryDailyAggregate()` —
   mesma função que já cobre esse gap para `unique_authors`/`impressions`,
   ver `data-model.md`). Upsert parcial (só `net_sentiment`) em
   `bw_query_metrics_daily`. Roda em **toda** invocação, mesmo throttle do
   passo 6.3b — é o mesmo tipo de agregado (chart oficial, não amostrado),
   só um aggregate a mais na mesma dimensão já coberta. Já havia sido
   marcado "✅ coberto" por engano na auditoria de `data-model.md`
   (`chart-dimensions-and-aggregates`) — o que já existia era só pras
   dimensões `pageTypes`/localização (`bw_query_metrics_daily_by_platform`/
   `bw_query_demographics_daily`), não pra `categories`/`queries`; corrigido
   nesta revisão.
6.3e. ⚠️ **Volume/sentimento em grão horário — especificado 2026-07-13,
   ainda sem migration** (resolve gap registrado em `event-radar/detection-engine.md`). Mesmo
   mecanismo do passo 6, trocando a dimensão de tempo `days` por `hours`:
   `data/volume/sentiment/hours` (volume + split de sentimento) e
   `data/netSentiment/categories/hours` + `data/netSentiment/queries/hours`
   (mesmo padrão do passo 6.3d). Upsert em `bw_query_metrics_hourly`,
   **restrito a uma janela móvel de 30 dias** (`startDate = now() - 30d`) —
   diferente de todo o resto deste sync, que cobre o histórico completo
   desde `BRANDWATCH_MENTIONS_START_DATE`; aqui o propósito é só detecção
   de curto prazo (`event-radar`) e Velocidade (`aggregated-metrics`), não
   histórico/BI. 30 dias (não só 72h) porque cobre também a janela "Hora
   atual vs. média das últimas 4 semanas" sem uma segunda chamada — ver
   `foundation/data-model.md`, `bw_query_metrics_hourly`, "Janela de
   captura". Roda em **toda** invocação (não é "stale-gated" — o oposto do
   throttle semanal: o valor de existir é justamente estar sempre fresco).
   Orçamento: +3 chamadas por invocação (volume/sentiment + 2×
   netSentiment), dentro do `BRANDWATCH_CALL_BUDGET = 25` já existente
   (ver "Fluxo principal", `brandwatchCallCount`).
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
   ⚠️ **Correção 2026-07-10, revertida 2026-07-11**: chegou a existir aqui
   uma chamada pra `refresh_topic_engagement_reach()` (cruzava
   `topic_type='hashtags'` contra `mentions` pra estimar engajamento/
   alcance por tópico). Removida — o usuário fixou a premissa de nunca
   calcular localmente sobre `mentions` (amostrada) pra preencher o que a
   Brandwatch não expõe como agregado oficial (ver `data-model.md`,
   `narrative_metrics`). `data/topics` genuinamente não tem essa métrica;
   `bw_query_topics` fica só com o que o endpoint de fato devolve.
   ✅ **Correção 2026-07-12 (auditoria pedida pelo usuário contra
   `developers.brandwatch.com/docs/topics` vs. `/docs/data-topics`)**: uma
   revisão de spec anterior (2026-07-11) tinha planejado mapear `days`/
   `pageType` do payload de `data/topics` acima em
   `bw_query_topics.daily_series`/`page_type_breakdown` — **esses dois
   campos não existem na resposta de `data/topics`** (o endpoint "Topics
   (New)" chamado acima). Eles pertencem a um endpoint genuinamente
   diferente, `data/volume/topics/queries` ("Topics", legado — mesmo nome
   de produto, payload diferente). Nunca chegou a ser implementado com o
   mapeamento errado (achado antes de virar código), então não houve
   corrupção de dado — só a spec estava certa sobre a existência dos
   campos e errada sobre de onde vinham. Corrigido com uma chamada própria
   (passo 6.4c abaixo).
6.4c. ✅ **Topics legado** (implementado 2026-07-12, migration
   `20260712040000`, `syncLegacyTopicsData()`): chamada complementar a
   `data/volume/topics/queries?orderBy=burst` (mesmo par/`categoryTarget`
   do passo 6.4, throttle de frescor compartilhado com `bw_query_topics`),
   armazenada nas mesmas linhas com `topic_type = 'legacy_mixed'` (a
   Brandwatch não deixa escolher `extract` nesse endpoint — devolve uma
   mistura de tipos de tópico já rankeados por `burst`, por isso não reusa
   os `topic_type` de `words`/`phrases`/etc. do endpoint novo). Mapeia
   `days→daily_series` (série diária de volume, `[{date, volume}]`) e
   `pageType→page_type_breakdown` (volume por canal:
   `blog`/`facebook`/`forum`/`general`/`image`/`instagram`/`news`/
   `review`/`twitter`/`video`) — o insumo que faltava pra reconstruir picos
   de volume por Narrativa (ex: "03/02 · Operação policial na Baixada
   Santista" do mockup de referência) sem violar a premissa de nunca
   calcular localmente sobre `mentions` (é dado agregado oficial do
   próprio endpoint). `burst` é uma métrica de tendência própria desse
   endpoint, em escala diferente de `trending` (do endpoint novo, passo
   6.4) — nunca comparar os dois diretamente. Ver `data-model.md` §5.
6.4b. ✅ **X (Twitter) Insights** (implementado 2026-07-11, priorizado
   depois de validar contra um export real de dashboard Brandwatch — "X
   Themes": Top Stories/Hashtags/Posters/Emojis, exatamente este shape de
   dado), sinal textual específico de X que complementa os Temas do passo
   6.4 (tematização geral, mas sem o componente de hashtag/emoji/URL/autor
   citado com sentimento próprio): na fase `x_insights` (ver "Execução em
   fases"), para o primeiro `categoryTarget` sem linha "fresca" (7 dias) em
   `bw_query_x_insights` — busca em sequência os 4 endpoints de "X
   (Twitter) Insights" confirmados em
   `developers.brandwatch.com/docs/twitter-insights` (`data/hashtags`,
   `data/emoticons`, `data/urls`, `data/mentionedauthors` — todos exigem
   `queryId`/`queryGroupId` + `startDate`/`endDate`) e faz upsert em
   `bw_query_x_insights` com `insight_type` correspondente
   (`hashtag`/`emoticon`/`url`/`mentioned_author`). Não amostrado —
   mesma família sampling-safe de `bw_query_topics`/`bw_query_top_authors`.
   **Salvaguarda de orçamento**: só roda para `categoryTarget`s com volume
   relevante em `page_type = 'twitter'` (já disponível em
   `bw_query_metrics_daily_by_platform`, passo 6.3, sem chamada extra pra
   checar isso) — Narrativa/Query sem presença relevante em X não gasta as
   4 chamadas à toa, e para no primeiro `categoryTarget` que precisar de
   trabalho (mesmo padrão de `weekly_monthly`/`topics`/`top_authors` na
   arquitetura de fases — os demais continuam "stale" pra próxima
   invocação desta mesma fase).
6.5. Ranking de autores: se não existir linha "fresca" (7 dias) em
   `bw_query_top_authors` para o par **e `categoryTarget`** (query inteira
   + cada Narrativa — ver correção abaixo): busca `data/volume/
   topauthors/queries?limit=1000` (máximo do endpoint, desde
   `20260710050000` — era `limit=100`; ver correção logo abaixo) (com
   `category=<id>` quando aplicável) e faz upsert. Endpoint nativo de "Top
   Authors" — melhor do que calcular
   localmente por SQL sobre a amostra de `mentions` sincronizada (que a
   skill `brandwatch-api` recomendava como fallback, mas fica sujeito ao
   sampling de Queries de alto volume). Envelope de resposta confirmado:
   `results[].data.{authorName, authorGender, authorVolume, reachEstimate,
   impact, sentiment, twitter*/facebook*/reddit* fields}`. Adicionado
   2026-07-10.
   ⚠️ **Correção 2026-07-10, mesmo dia** (pedido do usuário: "influência do
   autor" também precisa ser por Narrativa): passou de uma chamada única
   por invocação (só query inteira) pra uma chamada por `categoryTarget`,
   usando `category=<id>` como filtro — mesma convenção já comprovada em
   `data/volume/sentiment/days`. ⚠️ Não há exemplo específico confirmando
   esse filtro **neste** endpoint — apoiado na afirmação genérica de
   `filters.md` de que filtros valem pra qualquer chamada de Data
   Retrieval (charts). `bw_query_top_authors` ganhou `category_id`/
   `category_id_key` (migration `20260710040000`) pra não colidir a linha
   por Narrativa com a linha da Query inteira.
   ⚠️ **Correção 2026-07-10, mesmo dia** (pedido do usuário: "capturar
   todos os top autores que tiverem mais de 100000 seguidores e considerar
   que são os mais influentes"): `limit` subiu de `100` pro máximo
   (`1000`) — cobertura melhor, mas não garantida (Brandwatch ordena por
   volume/relevância, não seguidores). `bw_query_top_authors` ganhou
   `followers`/`is_influential` (`>= 100000`, migration `20260710050000`),
   ambos direto do envelope do endpoint (agregado oficial, não amostrado).
   `mentions` ganhou `mention_role` (`original`/`reply`/`retweet`, derivado
   de `reply_to`/`retweet_of` — classificação de uma mention já capturada,
   não uma soma sobre a amostra, então não conflita com a premissa abaixo).
   ⚠️ **Revertido 2026-07-11**: chegou a existir uma função
   `influential_author_activity()` cruzando `bw_query_top_authors` com
   `mentions` pra computar participação (`original_count`/`reply_count`/
   `retweet_count`) e alcance (`total_reach`/`max_reach`) por autor
   influente — removida, porque essas 5 colunas eram soma/contagem sobre
   `mentions` (amostrada), a mesma categoria de problema que o usuário
   pediu pra eliminar do projeto inteiro: "não faça cálculo local
   confiando na mentions, pois não reflete a realidade... isso deve ser
   premissa". `reach_estimate`/`impact`/`platform_stats` já em
   `bw_query_top_authors` (agregado oficial) respondem "alcance dos
   autores influentes" sem precisar de nenhuma função — ver `data-model.md`
   §5.
   ⚠️ **Bug de produção corrigido 2026-07-11**: `ON CONFLICT DO UPDATE
   command cannot affect row a second time` — a resposta de
   `data/volume/topauthors/queries` trouxe o mesmo autor mais de uma vez,
   e o upsert (uma única instrução SQL cobrindo todas as linhas da
   resposta) não consegue aplicar `DO UPDATE` duas vezes na mesma linha
   dentro da mesma instrução. `syncTopAuthors()` agora deduplica por
   `author` antes do upsert (`dedupeByKey()`, mantém a primeira ocorrência
   — a resposta já vem ordenada por volume/relevância). Mesma correção
   aplicada preventivamente em `syncTopicsData()` (passo 6.4, dedup por
   `topic_type::label`) — mesma classe de risco, ainda não observada em
   produção mas estruturalmente idêntica.
   ✅ **Ampliação 2026-07-11** (validação contra export real de dashboard
   Brandwatch — "Top X Authors | Government Verification"/"Business
   Verification", "Top Authors | Estados"/"Cidades"): `tweets`/`retweets`/
   `account_type`/`country_code`/`country_name` extraídos como colunas
   tipadas de `platform_stats` (campos já presentes na resposta —
   `twitterTweets`/`twitterRetweets`/`authorAccountType`/`countryCode`/
   `countryName` — nenhuma chamada nova).
6.6. ✅ **Demografia** (implementado 2026-07-11, pedido do usuário: "análise
   demográfica de tudo que vem do X" — priorizado depois de validar contra
   um export real de dashboard Brandwatch, "X Demographics": gender split
   + trend diário, top interests, top professions, top countries): mesmo
   throttle semanal dos passos acima, buscando `data/volume/{dimension}/days`
   para cada uma das 8 dimensões demográficas confirmadas em
   `developers.brandwatch.com/docs/chart-dimensions-and-aggregates`
   (`gender`, `accountTypes`, `interest`, `profession` — só X/Twitter;
   `countries`, `continents`, `cities`, `regions` — sem restrição de
   plataforma) e upsert em `bw_query_demographics_daily` (ver
   `data-model.md` §5). **Salvaguarda de orçamento**: as 4 dimensões
   específicas de X só rodam para Queries com `bw_queries.type = 'twitter'`
   (ou volume relevante em `page_type = 'twitter'`, mesmo sinal já usado em
   `bw_query_x_insights`) — não gastar chamada em Query sem presença em X;
   as 4 de localização rodam pra qualquer Query. Itera **uma dimensão por
   invocação** (para na primeira que precisar de trabalho real, mesmo
   padrão de 6.1/6.4/6.5) — nunca as 8 de uma vez, pra não reintroduzir o
   estouro de CPU corrigido na "Execução em fases" acima. Escopo inicial:
   só nível de Query inteira, sem quebra por Narrativa (mesmo escopo hoje
   de `bw_query_metrics_daily_by_platform`).
6.7. ✅ **Enriquecimento por autor — impressões e temas (2026-07-11,
   pedido do usuário: "incluir no MVP e garantir que temos informações
   suficientes")**. Roda logo após o passo 6.5 (`author_enrichment` vem
   antes de `demographics`/`sov` em `SYNC_STEPS`) — depende de
   `bw_query_top_authors` já ter os top autores da Query inteira
   (`category_id is null`) da semana corrente.
   **Conclusão revertida no mesmo dia**: a primeira leitura desta spec
   tinha marcado "impressões por autor" e "temas por autor" como sem fonte
   oficial — corrigido após pesquisa mais a fundo. Achado: `impressions` é
   um agregado de chart oficial confirmado em
   `developers.brandwatch.com/docs/chart-dimensions-and-aggregates` (mesma
   tabela que já confirmou `reachEstimate`/`engagementScore`), e o filtro
   `author=<handle>` é documentado em `available-filters.md` como válido
   em "Mention ou Data Retrieval calls" — mesmo nível de evidência
   genérica já aceito neste projeto pro filtro `category=<id>` usado nos
   passos 6.1/6.4/6.5.
   Pega os **top 10 autores por `volume`** de `bw_query_top_authors`
   (`category_id is null`, `metric_week` corrente) ainda sem
   `impressions` preenchido para a semana, itera **um autor por
   invocação** (para no primeiro que precisar de trabalho — mesmo padrão
   das demais fases stale-gated) e, pra esse autor:
   - `data/impressions/queries/days?queryId=<id>&author=<handle>&startDate&endDate`
     — mesmo padrão de dimensão `queries` já usado em `syncQueryGroupSov()`
     (`data/volume/queries/weeks?queryGroupId=X`), só trocando o agregado
     (`impressions`) e o filtro de escopo (`author` em vez de
     `queryGroupId`). Soma os valores diários da série (cada um já um
     número oficial não-amostrado da Brandwatch) e grava em
     `bw_query_top_authors.impressions` pra aquele autor/semana — **não**
     é o mesmo tipo de cálculo que a premissa de sampling proíbe, porque
     quem agrega é o motor de agregados da própria Brandwatch, filtrado
     por autor, não uma soma nossa sobre `mentions`.
   - `data/topics?queryId=<id>&author=<handle>&extract=...&metrics=...`
     (mesmos parâmetros do passo 6.4, só com `author` adicionado) — upsert
     em `bw_query_author_topics` (dedup por `topic_type::label`, mesma
     correção do passo 6.5).
   ⚠️ Não confirmado com um payload de exemplo específico combinando
   `impressions`/`queries`/`author`, nem `topics`/`author` — mesma
   categoria de risco já aceita pras demais combinações de filtro análogas
   neste projeto. **Salvaguarda de orçamento**: 2 chamadas por autor
   enriquecido, só top 10 da Query inteira (não todo autor já visto, sem
   quebra por Narrativa ainda) — ver `data-model.md` §5.
6.8. ✅ **Ranking de sites/domínios** (implementado 2026-07-11, gap
   identificado validando o modelo de dados contra um export real de
   dashboard Brandwatch, "Top Site" — distinto de "Top Authors": rankeia
   domínios/sites, não contas de redes sociais): mesmo throttle semanal
   por `categoryTarget` de `bw_query_top_authors`, busca `data/volume/
   topsites/queries?limit=1000` (mesmo `limit` máximo já usado em Top
   Authors) e faz upsert em `bw_query_top_sites` (ver `data-model.md` §5).
   Mesma correção de dedup (`dedupeByKey()` por `domain`) aplicada
   preventivamente, mesma classe de risco de Top Authors/Temas.
7. Atualiza `sync_cursors` ao final de **cada fase** (não só ao final de
   tudo — ver "Execução em fases" acima): sempre `next_step` (avança pra
   próxima fase) + `status = 'idle'` + `last_error = null`; `last_added_cursor`/
   `backfill_completed_at` só quando a fase é `mentions`; `last_synced_at`
   só quando a fase que rodou era a última do ciclo (`sov`) — é isso que
   rearma o gate do passo 0.5b. Insere uma linha em `sync_log` por fase
   executada (`status = 'success'`, `rows_processed` = mentions upsertadas
   nesta fase, `0` nas demais).
8. Se qualquer chamada retornar `429`: aplica backoff (usa `retry-after` ou
   fallback de 20s), tenta até 3 vezes, e se ainda falhar marca
   `sync_cursors.status = 'error'` + `last_error` e `sync_log.status = 'error'`
   — a Edge Function sempre responde HTTP 200 mesmo em erro (o erro fica no
   corpo da resposta), para uma eventual invocação futura via `pg_cron` não
   ser interpretada como falha de infraestrutura. ✅ **Correção de bug de
   produção (2026-07-16, migration `20260716020000`)**: esgotar as 3
   tentativas também grava `bw_sync_lock.rate_limited_until = now() +
   10min` (`mark_bw_rate_limited()`) — a janela real do rate limit da
   Brandwatch (30 chamadas/10min por Client, não por par/invocação). Sem
   isso, uma invocação nova começava com seu orçamento local
   (`hasBrandwatchCallBudget()`) "cheio" e tomava 429 já na primeira
   chamada, porque esse orçamento não tem memória de quanto invocações
   anteriores recentes já gastaram do teto real. Ver o novo passo 0.5c
   acima — checa `rate_limited_until` antes de mintar token ou
   reivindicar o lock do passo 0.5, e sai cedo (mesmo padrão do gate de
   `BW_SYNC_INTERVAL_HOURS`) se o backoff ainda está ativo.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| `HTTP 429` da Brandwatch | Backoff (ver best practices da skill `brandwatch-api`), até 3 tentativas; se esgotar, marca erro, grava `rate_limited_until` (10min, ver passo 8/0.5c) e tenta o próximo par na invocação seguinte — não trava a fila inteira |
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
- ✅ **Confirmado (2026-07-11, pedido do usuário)**: "os dados da integração
  são diários, semanais e mensais... armazenando no banco de dados como
  histórico e possibilidade de utilização em IA" — já é o comportamento de
  todas as tabelas de agregado deste módulo, sem mudança de código
  necessária. `bw_query_metrics_daily`/`weekly`/`monthly`,
  `bw_query_group_metrics_weekly`, `bw_query_metrics_daily_by_platform`,
  `bw_query_topics`, `bw_query_top_authors`, `bw_query_x_insights` e
  `narrative_metrics` são todas upsertadas por chave única que **inclui a
  data/semana/mês** (`metric_date`/`metric_week`/`metric_month`) — cada
  período gera sua própria linha, nunca sobrescrita por um sync
  subsequente do mesmo par (só corrigida se o **mesmo** período for
  ressincronizado, upsert idempotente). Não existe rotina de retenção/
  limpeza (nenhuma linha é deletada por idade) — o histórico cresce
  indefinidamente por design, exatamente para servir de base a um uso
  futuro por IA (Sprint 4, `executive-reports`, ver `_index.md` "Fora de
  escopo do MVP").

## Dados envolvidos

- **Lê**: `brandwatch_credentials`, `sync_cursors`, `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`, `narratives` (para saber quais `bw_category_id` merecem chart por categoria).
- **Escreve**: `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`, `mentions`, `bw_query_metrics_daily`/`weekly`/`monthly`, `bw_query_metrics_daily_by_platform`, `bw_query_topics`, `bw_query_top_authors`, `bw_query_author_topics`, `bw_query_x_insights`, `bw_query_demographics_daily`, `bw_query_top_sites`, `bw_query_group_metrics_weekly`, `sync_cursors`, `sync_log`.
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
- `pg_cron` + `pg_net` para HTTP a partir do Postgres (migration
  `20260711020000`, heartbeat `bw-sync-heartbeat` a cada 15min via
  `net.http_post`, URL hardcoded na migration — não é segredo, mesmo valor
  já exposto via `NEXT_PUBLIC_SUPABASE_URL`, então sem passo manual
  pós-deploy). Function roda com `verify_jwt = false`
  (`supabase/config.toml`) — sem Authorization header no cron job.
- `BW_SYNC_INTERVAL_HOURS` (secret da Edge Function, default `3`) — o
  parâmetro de negócio de cadência de captura (ver "Objetivo" acima e passo
  0.5b).
- Skill `brandwatch-api`: `references/authentication.md`,
  `references/mentions.md`, `references/data-retrieval-charts.md`,
  `references/queries-and-projects.md` (nota de sampling),
  `references/filters.md` (`category=<id>`).

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [narratives.md](narratives.md)
