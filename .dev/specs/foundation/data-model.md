---
tipo: data-model
módulo: foundation
status: pronto
atualizado: 2026-07-11
---

# Modelo de Dados — Foundation

Cobre a migration inicial do projeto. Corrige, sobre o schema anexo
(`20260706_reputation_os_schema.sql`), todos os ajustes já decididos em
`overview.md`: nomenclatura 100% inglês, multi-tenancy por
`organization_members`, RLS ausente em tabelas de cache, sampling de
mentions, camada de reporting. Ver [overview.md](overview.md) para o
raciocínio por trás de cada decisão — este arquivo é a estrutura final.

## Extensões

```sql
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "btree_gin";  -- índices GIN combinados
```

## Enums

```sql
create type sentiment_type as enum ('positive', 'negative', 'neutral');

-- Consolidação: o schema anexo tinha risco_nivel (Caso) e caso_prioridade
-- como dois enums com o mesmo domínio de 4 valores (baixo/médio/alto/crítico
-- vs. baixa/media/alta/critica — só concordância de gênero em português).
-- Vira um único enum em inglês, reusado por risk_level e priority em
-- qualquer tabela (narratives agora, cases no Sprint 2) — evita duplicar um
-- domínio idêntico com dois nomes.
create type severity_level as enum ('low', 'medium', 'high', 'critical');

-- Novo, sem reuso — ciclo de vida da Narrativa.
create type narrative_stage as enum ('emerging', 'growing', 'stable', 'crisis', 'declining', 'closed');
```

> `severity_level` é criado aqui porque `narratives` precisa dele primeiro;
> `command-center` (Sprint 2) reutiliza o mesmo tipo para `cases.risk_level`
> e `cases.priority`, sem recriar.

## Função utilitária: `set_updated_at`

Princípio técnico 4 (`_index.md`) — toda tabela com coluna `updated_at`
precisa desta trigger. Criada uma vez aqui, reusada por todos os módulos
futuros.

```sql
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

## Função utilitária: `auth_organization_ids()`

Já detalhada em `overview.md` — resolve as organizações do usuário autenticado
via `organization_members`, evitando recursão de RLS e permitindo cache por
statement (`stable`).

```sql
create or replace function auth_organization_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id from organization_members where user_id = auth.uid()
$$;
```

---

## 1. Multi-tenancy

### `organizations`

| Campo        | Tipo          | Obrigatório | Descrição                          |
|--------------|---------------|-------------|-------------------------------------|
| `id`         | `uuid`        | sim         | PK — `gen_random_uuid()`            |
| `name`       | `text`        | sim         |                                      |
| `created_at` | `timestamptz` | sim         | `now()`                             |
| `updated_at` | `timestamptz` | sim         | `now()`, mantido por `set_updated_at`|

**Políticas RLS**: `enable row level security`.

| Operação | Quem pode | Condição |
|---|---|---|
| SELECT | membro da organização | `id in (select auth_organization_ids())` |

> Sem policy de INSERT/UPDATE/DELETE — criação/edição de organização é
> operação de backend (`SUPABASE_SECRET_KEY`), sem UI no MVP (ver
> `organization_members` abaixo).

### `organization_members`

| Campo             | Tipo          | Obrigatório | Descrição                     |
|--------------------|---------------|-------------|---------------------------------|
| `id`               | `uuid`        | sim         | PK                              |
| `organization_id`  | `uuid`        | sim         | FK → `organizations(id)` ON DELETE CASCADE |
| `user_id`          | `uuid`        | sim         | FK → `auth.users(id)` ON DELETE CASCADE |
| `created_at`       | `timestamptz` | sim         | `now()`                         |

**Índices**: `(user_id)`, `(organization_id)`, unique `(organization_id, user_id)`.

**Políticas RLS**: `enable row level security`.

| Operação | Quem pode | Condição |
|---|---|---|
| SELECT | o próprio usuário | `user_id = (select auth.uid())` |

> Sem `updated_at`/trigger — registro de associação é criado ou removido,
> nunca editado (sem coluna de papel/role no MVP, ver `overview.md`).
> Sem policy de INSERT/DELETE — gestão de membros é manual/backend no MVP.

### `brandwatch_credentials`

| Campo                     | Tipo          | Obrigatório | Descrição |
|----------------------------|---------------|-------------|-----------|
| `id`                       | `uuid`        | sim | PK |
| `organization_id`          | `uuid`        | sim | FK → `organizations(id)` ON DELETE CASCADE |
| `bw_client_id`             | `text`        | não | Client Brandwatch (rate limit é por aqui) |
| `bw_platform_client_id`    | `text`        | não | organization switching, se aplicável |
| `access_token_secret_ref`  | `text`        | não | referência ao secret (Supabase Vault) — nunca o token em texto puro |
| `token_expires_at`         | `timestamptz` | não | |
| `created_at`               | `timestamptz` | sim | `now()` |
| `updated_at`                | `timestamptz` | sim | `now()`, mantido por `set_updated_at` |

> ⚠️ **Correção (2026-07-07, ver `brandwatch-setup.md` §1)**: `access_token_secret_ref`
> e `token_expires_at` passaram de "obrigatório" para "não obrigatório" —
> deixaram de ser preenchidos manualmente no cadastro da credencial e viraram
> um **cache** do token que a Edge Function `bw-sync` minta em runtime via
> `grant_type=api-password`, usando `BRANDWATCH_USERNAME`/`BRANDWATCH_PASSWORD`/
> `BRANDWATCH_PLATFORM_CLIENT_ID` como **secrets da própria Edge Function**
> (não colunas desta tabela — MVP assume um único Client Brandwatch). A linha
> em `brandwatch_credentials` pode existir só com `organization_id` +
> `bw_client_id`, sem token, até a primeira execução do sync popular o cache.
> Migration correspondente: `20260707010000_brandwatch_credentials_optional_token.sql`.

**Políticas RLS**: `org_isolation_brandwatch_credentials` — `organization_id in (select auth_organization_ids())`.

---

## 2. Espelho da Brandwatch (cache — só o `sync-brandwatch` escreve)

### `bw_projects`

| Campo             | Tipo          | Obrigatório | Descrição |
|--------------------|---------------|-------------|-----------|
| `id`               | `bigint`      | sim | PK — mesmo id do `projectId` na Brandwatch |
| `organization_id`  | `uuid`        | sim | FK → `organizations(id)` ON DELETE CASCADE |
| `name`             | `text`        | sim | |
| `description`      | `text`        | não | |
| `timezone`         | `text`        | não | |
| `synced_at`        | `timestamptz` | sim | `now()` |

**Políticas RLS**: `org_isolation_bw_projects` — `organization_id in (select auth_organization_ids())`.

> Sem `created_at`/`updated_at`/trigger — é linha de cache, sobrescrita por
> upsert a cada sync; `synced_at` já cumpre esse papel.

### `bw_queries`

| Campo                | Tipo          | Obrigatório | Descrição |
|------------------------|---------------|-------------|-----------|
| `id`                   | `bigint`      | sim | PK — `queryId` da Brandwatch |
| `project_id`           | `bigint`      | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `name`                 | `text`        | sim | |
| `boolean_query`        | `text`        | não | |
| `type`                 | `text`        | sim | `monitor` \| `twitter` \| `publicfacebook` \| `instagram`; default `monitor` |
| `content_sources`      | `text[]`      | não | default `'{}'` |
| `languages`            | `text[]`      | não | default `'{}'` |
| `start_date`           | `date`        | não | |
| `sampled`              | `boolean`     | não | campo da Brandwatch — ver nota de sampling |
| `sample_percentage`    | `numeric`     | não | idem |
| `synced_at`            | `timestamptz` | sim | `now()` |

**Índices**: `(project_id)`.

**Políticas RLS**: `org_isolation_bw_queries` — deriva organização via `project_id` (mesmo padrão de `entity_accounts`):
```sql
organization_id in (select auth_organization_ids())
```
usando join implícito por `project_id in (select id from bw_projects where organization_id in (select auth_organization_ids()))`, ou (mais simples e igualmente correto) duplicar `organization_id` como coluna direta em `bw_queries` — **decisão**: manter só `project_id` e resolver via subquery, para não duplicar a coluna `organization_id` em toda tabela satélite (consistente com o padrão já usado em `entity_accounts`/`entity_tags`).

### `bw_query_groups`

| Campo         | Tipo          | Obrigatório | Descrição |
|-----------------|---------------|-------------|-----------|
| `id`            | `bigint`      | sim | PK |
| `project_id`    | `bigint`      | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `name`          | `text`        | sim | |
| `query_ids`     | `bigint[]`    | sim | default `'{}'` |
| `synced_at`     | `timestamptz` | sim | `now()` |

**RLS**: mesmo padrão via `project_id`.

### `bw_categories`

| Campo           | Tipo          | Obrigatório | Descrição |
|------------------|---------------|-------------|-----------|
| `id`             | `bigint`      | sim | PK |
| `project_id`     | `bigint`      | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `parent_id`      | `bigint`      | não | FK → `bw_categories(id)` ON DELETE CASCADE; `null` = Category raiz |
| `name`           | `text`        | sim | |
| `matching_type`  | `text`        | não | `manual` \| `keywords` |
| `synced_at`      | `timestamptz` | sim | `now()` |

**Índices**: `(project_id)`, `(parent_id)`.

**RLS**: mesmo padrão via `project_id`.

---

## 3. Mentions (particionada por mês)

Campos originais (sem alteração): `organization_id`, `project_id`,
`query_id`, `resource_id`, `category_ids bigint[]`, `tag_names text[]`,
`sentiment`, `author`, `author_handle_normalized` (gerada,
`lower(author)`), `reach_estimate`, `domain`, `snippet`, `full_text`,
`added`, `mention_date`, `raw jsonb`.

> ⚠️ **`full_text` deixa de ser sempre `null` — busca seletiva planejada
> (2026-07-11, revisão de spec pré-implementação)**: a decisão original
> (`full_text = null` geral, ver `sync-brandwatch.md` passo 5) continua
> certa como *default* — buscar `/data/mentions/fulltext` pra toda mention
> dobraria as chamadas de todo poll, o que não se sustenta no orçamento de
> 25/invocação. Mas `snippet` sozinho pode não ser suficiente insumo de
> texto pra síntese de Narrativa (Sprint 4) nas fontes que **não** são
> redigidas pela Brandwatch (Facebook/Instagram/YouTube/TikTok/fóruns —
> diferente de X/Reddit/LinkedIn, ver "Validação de viabilidade" em
> `overview.md`). Plano: `bw-sync` busca `full_text` **seletivamente**, só
> para mentions de fonte não-redigida já vinculadas a uma Narrativa
> (`bw_category_id` resolvido ou casada via `narrative_signals`/
> `narrative_matched_mentions()`), limitado a top-N (5–10) por
> engajamento/`reach_estimate` por Narrativa/dia — ver `sync-brandwatch.md`
> passo 5 (nota). Baixo custo incremental de chamadas (bounded por
> Narrativa×dia, não por mention), ainda sem migration/código
> correspondente.

> ✅ **Decisão fechada (2026-07-10)**: a ⚠️ DECISÃO PENDENTE sobre campos de
> engajamento (likes/shares/comentários) foi resolvida — pesquisa direta em
> `developers.brandwatch.com/docs/mention-metadata-field-definitions`
> (não só o resumo curado da skill `brandwatch-api`) confirmou que
> engajamento **não tem campo genérico**, é específico por plataforma
> (`twitterFollowers/twitterLikeCount/twitterRetweets/twitterReplyCount`,
> `instagramFollowerCount/instagramLikeCount/instagramCommentCount`,
> `facebookLikes/Comments/Shares`, `tiktokLikes/Comments/Shares`,
> `blueskyFollowers/Likes/Replies/Reposts`,
> `linkedinLikes/Comments/Shares/Impressions`). Migration `20260710010000`
> adiciona `engagement jsonb not null default '{}'` — subconjunto extraído
> do raw só com as chaves de engajamento presentes na mention (não uma
> coluna tipada por campo — ~20 campos possíveis, sem consumidor ainda que
> justifique tipar todos; `impact`/`reach_estimate`, já tipados, cobrem
> ranking cross-platform).

**Colunas adicionadas em `20260710010000`** (pedido do usuário: garantir
que todo dado necessário pra visões estilo "Relatório de Insights" —
mockup `mockup_governo_sp_narrativas.pdf` — está sendo capturado; nomes
confirmados contra `mention-metadata-field-definitions`, não inferidos):

| Campo | Tipo | Origem/nota |
|---|---|---|
| `gender` | `text` | `gender` — "X specific metric" |
| `country_code`/`region`/`city`/`continent_code` | `text` | `countryCode`/`region`/`city`/`continentCode` |
| `content_source` | `text` | `contentSource` — **substitui** `pageType`, que a Brandwatch marca como deprecated no objeto de mention |
| `language` | `text` | `language` |
| `impressions` | `integer` | `impressions` — só X, `0` nas demais fontes |
| `impact` | `numeric` | `impact` — métrica logarítmica 0–100, cross-platform (referência de ranking de influência) |
| `classifications` | `jsonb` | array bruto `{classifierId, labelId, name, trainingId, confidence}` — inclui emoção |
| `emotion` | `text` | derivado em `bw-sync` (não é campo direto da API): primeiro classifier de emoção em `classifications`, best-effort |
| `insights_hashtag` | `text[]` | `insightsHashtag` — específico de X/Instagram |
| `insights_mentioned` | `text[]` | `insightsMentioned` — específico de X/Instagram |
| `reply_to` / `retweet_of` | `text` | `replyTo`/`retweetOf` (URLs) |
| `engagement` | `jsonb` | ver nota acima |
| `mention_role` | `text` | gerada, `'retweet'` se `retweet_of` preenchido, senão `'reply'` se `reply_to` preenchido, senão `'original'` — adicionado `20260710050000` |

> ⚠️ **Limitação de `emotion` documentada (2026-07-11, revisão de spec)**:
> `emotion` **não** é um campo direto da API — é derivado em `bw-sync`
> varrendo `classifications` (array bruto por mention) em busca do primeiro
> classifier cujo `name` bate com `emotions:...`, sempre olhando **uma
> mention por vez**. Isso o coloca na mesma categoria de `mention_role`
> (classificação de uma linha já capturada a partir dos próprios campos
> dela, não uma soma/contagem sobre a amostra) — **não** viola a premissa
> "nunca calcular localmente sobre `mentions` amostrada" fixada acima,
> desde que nada agregue `emotion` por Narrativa/Category somando sobre
> `mentions` (isso sim repetiria o erro já revertido de
> `unique_authors`/`repost_count`/`comment_count` — ver `narrative_metrics`
> abaixo). Nenhum agregado oficial da Brandwatch por Category expõe
> emoção (`data/topics` só tem `volume, percentageVolume, sentiment, gender,
> trending, timeSeries` como `metrics`), então uma futura feature de
> "emoção dominante da Narrativa" **não tem fonte não-amostrada disponível**
> — se um dia for pedida, cai na mesma decisão já tomada para
> `unique_authors`/`repost_count`/`comment_count`: sem alternativa oficial,
> não computar.
> ⚠️ **Segunda limitação, não confirmada na documentação pública da API**
> (`developers.brandwatch.com/docs/mention-metadata-field-definitions` não
> documenta o classificador de emoção nem restrição de idioma — a busca foi
> direta na doc, não achado): o classificador de "Emotion" da Brandwatch é
> conhecido por cobrir só mentions em **inglês**. Como o produto é 100%
> PT-BR, a expectativa realista é que `emotion` venha vazio/esparso na
> maior parte das mentions, não apenas "menos confiável" — é uma limitação
> de cobertura, não de precisão. Tratar como **não confirmado
> oficialmente** até validar contra dados reais sincronizados (checar
> `select count(*) filter (where emotion is not null) from mentions` depois
> de um backfill representativo).
> ✅ **Decisão de escopo (2026-07-11)**: `emotion` **permanece** como sinal
> best-effort, rotulado como tal sempre que exibido — nunca com o mesmo peso
> visual/estatístico de `sentiment` (que é agregado oficial, não amostrado,
> via `bw_query_metrics_daily`). Qualquer UI futura (Sprint 4,
> `executive-reports`) que mostrar "emoção" precisa deixar claro que é
> best-effort/cobertura parcial (ex: badge, não gráfico com a mesma
> confiança de sentimento) — não tirar do escopo, mas nunca apresentar como
> equivalente a sentimento.

Índices: `idx_mentions_content_source`, `idx_mentions_classifications`
(gin), `idx_mentions_insights_hashtag` (gin), `idx_mentions_mention_role`.

> ✅ **Ampliação (2026-07-10, migration `20260710050000`)**: pedido do
> usuário — "é necessário identificar quem iniciou um post, quem
> repostou, quem se engajou e quem teve maior participação". `mention_role`
> responde "quem iniciou" (`mention_role = 'original'`, `mentions.author`)
> e "quem repostou" (`mention_role = 'retweet'`, `mentions.author` = quem
> fez o repost). **Limitação real, não contornável pela API**: `retweet_of`
> só traz a **URL** do post original (`replyTo`/`retweetOf` da Brandwatch),
> não o autor original — reconstruir "quem foi retuitado" exigiria
> resolver essa URL contra outra mention própria da mesma Query, o que não
> é garantido (o post original pode nunca ter sido capturado pela Query).
> "Quem se engajou" = qualquer autor com mention (`original`/`reply`/
> `retweet`) associada à Narrativa/Query — a Brandwatch **não expõe
> curtidas individuais atribuíveis a uma pessoa**, só contagem agregada
> (`mentions.engagement->>'twitterLikeCount'` etc., recebida pela mention,
> nunca uma lista de quem curtiu). "Maior participação" (comentários e/ou
> repost) é respondido por `influential_author_activity()` — ver §6.

**Índice adicional necessário** (ausente no schema anexo, precisa para
`narrative_matched_mentions()` abaixo, sinal `signal_type = 'domain'`):
```sql
create index idx_mentions_domain on mentions (domain);
```

---

## 4. Operacional — cursores e log

### `sync_cursors` / `sync_log`

Campos idênticos ao schema anexo. **Políticas RLS**: `enable row level
security` em ambas, **sem nenhuma policy** (deny-all para `anon`/
`authenticated` — só `SUPABASE_SECRET_KEY`, que bypassa RLS, acessa).

> ✅ **Correção (2026-07-10)**: `sync_cursors` ganha
> `backfill_completed_at timestamptz null` (migration `20260710020000`).
> Motivo: um bug já corrigido (bootstrap buscava mentions mais recentes
> primeiro) tinha avançado `last_added_cursor` pra perto de "agora" antes
> do walk ascendente correto existir — e o `MAX(added)` já persistido em
> `mentions` tinha exatamente a mesma leva viciada, então nenhum dos dois
> sinais dava pra distinguir "já varri todo o histórico" de "o cursor
> pulou o histórico por um bug". Enquanto `backfill_completed_at` for
> `null`, `bw-sync` confia só em `last_added_cursor` (progresso real do
> walk ascendente) e nunca cai pro fallback de `MAX(added)` em `mentions`;
> a migration também reseta `last_added_cursor` pra `null` em todas as
> linhas existentes, forçando um walk completo desde
> `BRANDWATCH_MENTIONS_START_DATE` na invocação seguinte (seguro — upsert
> de mentions é idempotente). `backfill_completed_at` é setado na primeira
> vez que o walk alcança o presente e nunca mais é limpo depois disso; só
> a partir daí o fallback por `MAX(added)` volta a ser usado (modo de
> polling incremental normal). Ver `resolveMentionsSinceAdded()` em
> `bw-sync/index.ts`.

> ✅ **`last_synced_at` também vira o sinal de "devido" (2026-07-11,
> migration `20260711020000`)**: sem coluna nova — o gate de intervalo do
> passo 0.5b de `sync-brandwatch.md` filtra `sync_cursors` por
> `last_synced_at is null or last_synced_at < now() - BW_SYNC_INTERVAL_HOURS`,
> reusando exatamente o campo que o round-robin já ordenava por. Nenhuma
> tabela nova precisou existir só para rastrear "quando cada par foi
> sincronizado pela última vez".
>
> O heartbeat de `pg_cron` que aciona esse gate (`bw-sync-heartbeat`,
> migration `20260711020000`) também não precisou de tabela nova pra saber
> a URL da Edge Function — a URL vai hardcoded na própria migration (não é
> segredo, é o mesmo valor já exposto a qualquer client via
> `NEXT_PUBLIC_SUPABASE_URL`; Princípio técnico 1 é sobre credenciais, não
> sobre o identificador público do projeto), então a migration é
> autossuficiente, sem passo manual pós-deploy.

---

## 5. Agregados oficiais da Brandwatch (sampling-safe)

### `bw_query_metrics_daily`

| Campo                  | Tipo          | Obrigatório | Descrição |
|--------------------------|---------------|-------------|-----------|
| `id`                     | `uuid`        | sim | PK |
| `project_id`             | `bigint`      | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id`               | `bigint`      | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `category_id`            | `bigint`      | não | FK → `bw_categories(id)` ON DELETE CASCADE; `null` = agregado da Query inteira |
| `metric_date`            | `date`        | sim | |
| `total_mentions`         | `integer`     | sim | default `0` — do endpoint de chart, **não** contagem local |
| `sentiment_positive`     | `integer`     | sim | default `0` |
| `sentiment_neutral`      | `integer`     | sim | default `0` |
| `sentiment_negative`     | `integer`     | sim | default `0` |
| `reach_estimate`         | `integer`     | não | agregado oficial, `data/reachEstimate/categories/days` — adicionado `20260710040000` |
| `engagement_score`       | `numeric`     | não | agregado oficial, `data/engagementScore/categories/days` — adicionado `20260710040000` |
| `synced_at`              | `timestamptz` | sim | `now()` |

**Índices**: unique `(project_id, query_id, category_id_key, metric_date)`.

> ✅ **Ampliação (2026-07-10, migration `20260710040000`)**: pedido do
> usuário — "como as menções trazidas na integração são apenas amostras, é
> importante que... o alcance [e] o engajamento... sejam buscados
> diferentemente na brandwatch". `reach_estimate`/`engagement_score` vêm da
> dimensão de chart `categories` (confirmada em
> `chart-dimensions-and-aggregates`, mesma família de `data/volume/
> sentiment/days` já usada pra `total_mentions`/sentimento) — **uma
> chamada cobre todas as Categories de uma vez**, não amostrada. Substitui
> o que antes era soma local sobre `mentions` (amostrada em Queries de alto
> volume) em `refresh_narrative_metrics()` — ver `narrative_metrics`
> abaixo. `bw-sync` faz upsert **parcial** nessas 2 colunas (só elas no
> payload — o upsert do Supabase só atualiza as colunas presentes no
> conflito, nunca zera `total_mentions`/sentimento já sincronizados por
> outra chamada pro mesmo `(project_id, query_id, category_id, metric_date)`).

> ⚠️ **Correção (2026-07-07)**: a unique constraint original era
> `(project_id, query_id, category_id, metric_date)` — mas `category_id` é
> nullable, e SQL trata `NULL <> NULL`, então a linha "agregado da Query
> inteira" (`category_id null`) nunca deduplicava de verdade (cada sync
> inseria uma linha nova em vez de fazer upsert). Corrigido com uma coluna
> gerada `category_id_key bigint generated always as (coalesce(category_id, 0))
> stored`, e a unique constraint passou a usar essa coluna em vez de
> `category_id` diretamente (migration `20260707030000`, aditiva — não
> remove a constraint antiga). O mesmo padrão já nasce correto em
> `bw_query_metrics_weekly`/`bw_query_metrics_monthly` abaixo.

**Políticas RLS**: `org_isolation_bw_query_metrics_daily` — via `project_id`
(mesmo padrão de `bw_queries`).

### `bw_query_metrics_weekly` / `bw_query_metrics_monthly`

Mesma estrutura de `bw_query_metrics_daily`, trocando `metric_date` por
`metric_week`/`metric_month` — populadas por `data/volume/sentiment/weeks`/
`.../months` (ver `sync-brandwatch.md`, passo 6). Mesmo padrão de
`category_id_key`/RLS. Existem porque `narrative_metrics.period` já previa
`weekly`/`monthly` desde o Sprint 1 (ver `narratives.md`), e porque agregados
nativos da Brandwatch por semana/mês podem diferir ligeiramente de somar as
linhas diárias (sampling/timezone) — por isso são buscados da API
diretamente, não calculados como rollup SQL local.

**Throttle de sync** (não é regra de negócio do dado em si, é comportamento
do `bw-sync`): como semanal/mensal mudam bem mais devagar que a cadência de
captura (`BW_SYNC_INTERVAL_HOURS`, default 3h — ver `sync-brandwatch.md`
passo 0.5b), a Edge Function só busca de novo quando não existe linha
"fresca" (semanal: sem `synced_at` nos últimos 7 dias; mensal: 30 dias) —
ver `ensureBootstrapSeed`/`isGrainStale` em `bw-sync/index.ts`.

### `bw_query_group_metrics_weekly`

Resolve a ⚠️ DECISÃO PENDENTE de `overview.md` ("SOV de Query Group... grão
exato fica para data-model.md", nunca fechada até 2026-07-07) — o card de
Share of Voice do Executive Overview (`executive-overview.md`) depende desta
tabela.

| Campo             | Tipo          | Obrigatório | Descrição |
|--------------------|---------------|-------------|-----------|
| `id`               | `uuid`        | sim | PK |
| `project_id`       | `bigint`      | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_group_id`   | `bigint`      | sim | FK → `bw_query_groups(id)` ON DELETE CASCADE |
| `query_id`         | `bigint`      | sim | FK → `bw_queries(id)` ON DELETE CASCADE — uma linha por Query **dentro** do grupo, não um agregado do grupo inteiro |
| `metric_week`      | `date`        | sim | |
| `total_mentions`   | `integer`     | sim | default `0` |
| `synced_at`        | `timestamptz` | sim | `now()` |

**Índices**: unique `(query_group_id, query_id, metric_week)` — sem o
problema de `category_id` nullable acima (`query_id` aqui nunca é null).

**Políticas RLS**: `org_isolation_bw_query_group_metrics_weekly` — via
`project_id` (mesmo padrão das demais tabelas de cache).

Populada por `data/volume/queries/weeks?queryGroupId=...` — grão de
comparação entre candidato/concorrentes (ver exemplo de Query Group em
`brandwatch-setup.md` §4).

> ⚠️ **Correção (2026-07-10)**: originalmente populada via
> `data/volume/queryGroups/weeks?queryGroupId=...`, assumindo (sem
> confirmação) que `results` teria um item por Query dentro do grupo. O
> exemplo real confirmado em `developers.brandwatch.com/docs/basic-charts`
> mostra o oposto: a dimensão `queryGroups` devolve **um item por Query
> Group inteiro** (`id` = o próprio `queryGroupId`), volume agregado do
> grupo todo — não dá o breakdown candidato × concorrente que esta tabela
> precisa. Trocado para `data/volume/queries/weeks?queryGroupId=...`
> (dimensão `queries`, válida conforme `chart-dimensions-and-aggregates`,
> usando o grupo como filtro/escopo). Ainda ⚠️ **não 100% confirmado**
> contra um payload real (a doc não tem exemplo mostrando os dois
> parâmetros juntos) — é a hipótese mais bem fundamentada hoje, mas o
> comportamento anterior estava provadamente errado. Ver
> `bw-sync/index.ts`, `syncQueryGroupSov()`.

### `bw_query_metrics_daily_by_platform`

Breakdown diário de volume por plataforma/fonte — populada por
`data/volume/pageTypes/days` (dimensão de chart `pageTypes`, plural;
distinta do campo de mention `pageType`, esse sim deprecated — ver §3).
Mesma motivação de sampling-safe das demais tabelas de agregado desta
seção. Adicionada em `20260710010000` a pedido do usuário (visão "Origem
das menções · por plataforma" do mockup de referência).

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK |
| `project_id` | `bigint` | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id` | `bigint` | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `page_type` | `text` | sim | nome da plataforma/fonte retornado pela dimensão `pageTypes` — sempre preenchido (não sofre o bug de `category_id` nullable) |
| `metric_date` | `date` | sim | |
| `total_mentions` | `integer` | sim | default `0` |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, page_type, metric_date)`.
**Políticas RLS**: select-only via `project_id`, mesmo padrão das demais.
Sync roda **toda invocação** (mesmo throttle "diário sempre" do sentiment).

### `bw_query_topics`

Temas extraídos via `data/topics` (`extract=words,phrases,hashtags,
entities,people,places,organisations`, `metrics=volume,percentageVolume,
sentiment,trending`) — o mecanismo nativo da Brandwatch mais próximo de
"clusters temáticos com sentimento/volume/trending" do mockup de
referência, sem precisar de embeddings/clusterização próprios (ver
investigação sobre "Iris" em `overview.md`/`_index.md` — não há uma Iris
API separada; isto é o que a Consumer Research API realmente oferece).
Adicionada em `20260710010000`.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK |
| `project_id` | `bigint` | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id` | `bigint` | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `category_id` | `bigint` | não | FK → `bw_categories(id)`; `null` = tema da Query inteira, preenchido = tema dentro de uma Narrativa |
| `category_id_key` | `bigint` | sim | gerada, `coalesce(category_id, 0)` — mesmo padrão de `bw_query_metrics_daily` (evita o bug de `NULL <> NULL`) |
| `topic_type` | `text` | sim | um dos valores de `extract` (`words`, `phrases`, `hashtags`, `entities`, `people`, `places`, `organisations`) |
| `label` | `text` | sim | o termo/tema em si |
| `volume` | `integer` | sim | |
| `percentage_volume` | `numeric` | não | |
| `sentiment_positive`/`neutral`/`negative` | `integer` | sim | default `0` |
| `trending` | `numeric` | não | |
| `daily_series` | `jsonb` | não | array bruto do campo `days` do payload de `data/topics` para este tópico (confirmado em `developers.brandwatch.com/docs/topics`: `[{date, volume}, ...]` — sem sentimento por dia, só volume) — permite reconstruir picos de volume por Narrativa/tema (ex: "03/02 · Operação policial na Baixada Santista" do mockup de referência) sem violar a premissa de nunca somar `mentions` amostrada, já que vem do mesmo agregado oficial já buscado no passo 6.4. Adicionado 2026-07-11 (revisão de spec — payload do endpoint já trazia este dado, não capturado até então) |
| `page_type_breakdown` | `jsonb` | não | objeto bruto do campo `pageType` do mesmo payload (confirmado: volume do tópico por canal — `blog`/`facebook`/`forum`/`general`/`image`/`instagram`/`news`/`review`/`twitter`/`video`) — mesma chamada do passo 6.4, sem custo extra de rate limit. Adicionado 2026-07-11 |
| `metric_week` | `date` | sim | data do snapshot de sync (não um bucket semanal literal — `data/topics` é um agregado sobre a janela toda, não uma série por semana; usado só como marcador de frescor/throttle) |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, category_id_key, topic_type,
label, metric_week)`. **Políticas RLS**: select-only via `project_id`.
Throttle semanal (mesmo padrão de `bw_query_metrics_weekly`,
`isTopicsStale()` em `bw-sync/index.ts`), por `categoryTarget` (query
inteira + cada Narrativa).

> ⚠️ **Ampliação pendente de implementação (2026-07-11, revisão de spec)**:
> `daily_series`/`page_type_breakdown` ainda não têm migration/código
> correspondentes — mapeamento de campos adicional sobre a mesma chamada já
> feita no passo 6.4 de `sync-brandwatch.md`, não um endpoint novo. Nomes de
> campo (`days`, `pageType`) confirmados direto contra
> `developers.brandwatch.com/docs/topics`, não inferidos — falta só
> confirmar contra um payload real de produção (logs) antes de consumir
> estes dois campos numa UI.

> ⚠️ **Revertido (2026-07-11, migration `20260711010000`)**:
> `engagement_total`/`reach_estimated` chegaram a existir aqui
> (`20260710060000`) — `data/topics` confirmadamente não expõe reach/
> engajamento como métrica (`metrics` só aceita `volume, percentageVolume,
> sentiment, gender, trending, timeSeries`), e o único jeito de aproximar
> era cruzar `topic_type='hashtags'` contra `mentions` (amostrada). O
> usuário fixou a premissa do projeto: **nunca calcular localmente sobre
> `mentions` pra preencher o que a Brandwatch não expõe como agregado
> oficial** — "não reflete a realidade, é apenas uma amostra". As duas
> colunas e a função `refresh_topic_engagement_reach()` foram removidas.
> Tópicos ficam só com o que `data/topics` de fato devolve.

### `bw_query_x_insights`

Dados agregados e não amostrados específicos de X (Twitter), via os 4
endpoints de "X (Twitter) Insights" — confirmados em
`developers.brandwatch.com/docs/twitter-insights`: `data/hashtags`,
`data/emoticons`, `data/urls` (nomeado "Stories" na doc, mas o path é
`urls`), `data/mentionedauthors`; todos exigem `queryId`/`queryGroupId` +
`startDate`/`endDate`. É o complemento que falta a `bw_query_topics`
(`data/topics` cobre tematização geral, mas não este componente) — o
insumo textual que dá sinal a narrativas exclusivas de X, já que a
Brandwatch redige o texto de mentions de X mention a mention (ver
`overview.md`, "Validação de viabilidade"), mas estes 4 aggregates
**não são redigidos** — trazem sentimento por hashtag/emoji/URL/autor
citado sem depender de reler texto restrito. Adicionado 2026-07-11
(revisão de spec pré-implementação — ainda sem migration correspondente).

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK |
| `project_id` | `bigint` | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id` | `bigint` | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `category_id` | `bigint` | não | FK → `bw_categories(id)`; `null` = agregado da Query inteira, preenchido = por Narrativa — mesmo padrão de `bw_query_topics`/`bw_query_top_authors` |
| `category_id_key` | `bigint` | sim | gerada, `coalesce(category_id, 0)` — mesmo padrão anti-`NULL <> NULL` já usado nas demais tabelas de agregado |
| `insight_type` | `text` | sim | `hashtag` \| `emoticon` \| `url` \| `mentioned_author` — discriminador em vez de 4 tabelas quase idênticas (mesmo raciocínio de `bw_query_topics.topic_type`) |
| `name` | `text` | sim | a hashtag, emoji, URL ou @handle citado |
| `label` | `text` | não | presente no payload dos 4 endpoints, mas só com conteúdo útil em `insight_type = 'emoticon'` (confirmado exemplo: `"label": "spaghetti"` para `"name": "🍝"` — descrição textual do emoji); vazio/irrelevante nos demais tipos na prática |
| `volume` | `integer` | sim | default `0` |
| `tweets` | `integer` | não | |
| `retweets` | `integer` | não | |
| `impressions` | `integer` | não | |
| `reach_estimate` | `integer` | não | confirmado **ausente** no payload de `data/hashtags` — `null` para `insight_type = 'hashtag'`, presente para `emoticon`/`url`/`mentioned_author` |
| `sentiment_positive`/`neutral`/`negative` | `integer` | sim | default `0`, do objeto `sentiment` do payload |
| `metric_week` | `date` | sim | mesmo caráter de snapshot que `bw_query_topics.metric_week`/`bw_query_top_authors.metric_week` — marcador de frescor/throttle, não bucket semanal literal |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, category_id_key, insight_type,
name, metric_week)`. **Políticas RLS**: select-only via `project_id`, mesmo
padrão de `bw_query_topics`/`bw_query_top_authors`. Throttle semanal, por
`categoryTarget` (query inteira + cada Narrativa) — ver `sync-brandwatch.md`
passo 6.4b. **Salvaguarda de orçamento**: só sincronizado para
`categoryTarget`s com volume relevante em `page_type = 'twitter'` (já
disponível em `bw_query_metrics_daily_by_platform`) — não gasta as 4
chamadas em Narrativa/Query sem presença em X.

### `bw_query_top_authors`

Ranking nativo de autores via `data/volume/topauthors/queries` (até 1000 —
`bw-sync` pede `limit=1000`, o máximo, desde `20260710050000`) — melhor do
que calcular "quem move a conversa" localmente por SQL sobre a amostra de
`mentions` sincronizada (que a própria skill `brandwatch-api` recomendava
como fallback, mas fica sujeita ao sampling de Queries de alto volume —
ver nota de sampling em §5 acima). Adicionada em `20260710010000`.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK |
| `project_id` | `bigint` | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id` | `bigint` | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `category_id` | `bigint` | não | FK → `bw_categories(id)`; `null` = ranking da Query inteira, preenchido = ranking por Narrativa — adicionado `20260710040000` |
| `category_id_key` | `bigint` | sim | gerada, `coalesce(category_id, 0)` — mesmo padrão de `bw_query_metrics_daily` |
| `author` | `text` | sim | |
| `volume` | `integer` | sim | default `0` |
| `reach_estimate` | `integer` | não | |
| `impact` | `numeric` | não | |
| `followers` | `integer` | não | de `twitterFollowers` — único campo de seguidores confirmado no envelope deste endpoint (Facebook/Reddit não têm campo de seguidores documentado aqui). Adicionado `20260710050000` |
| `is_influential` | `boolean` | sim | gerada, `coalesce(followers, 0) >= 100000` — adicionado `20260710050000`, pedido do usuário ("mais de 100000 seguidores... os mais influentes") |
| `sentiment_positive`/`neutral`/`negative` | `integer` | sim | default `0` |
| `platform_stats` | `jsonb` | sim | objeto `data` inteiro devolvido pelo endpoint por autor (twitter*/facebook*/reddit* etc.) — mesmo raciocínio de `mentions.engagement`, sem coluna por campo |
| `metric_week` | `date` | sim | mesmo caráter de snapshot que `bw_query_topics.metric_week` |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, category_id_key, author, metric_week)`;
parcial `(project_id, query_id, is_influential) where is_influential` —
acelera consultas de "só os influentes".
**Políticas RLS**: select-only via `project_id`. Throttle semanal, agora por
`categoryTarget` (query inteira + cada Narrativa).

> ✅ **Ampliação (2026-07-10, migration `20260710040000`)**: pedido do
> usuário — "influência do autor" também precisa ser por Narrativa, não
> amostrada. `bw-sync` passa `category=<id>` como filtro em
> `data/volume/topauthors/queries` (mesma convenção já comprovada em
> `data/volume/sentiment/days`) e itera por `categoryTarget`. ⚠️ Não há um
> exemplo específico confirmando o filtro `category` **neste** endpoint —
> apoiado na afirmação genérica de `filters.md` de que filtros valem pra
> "qualquer chamada de Mentions ou Data Retrieval (charts)". Revisar contra
> logs reais.

> ✅ **Ampliação (2026-07-10, migration `20260710050000`)**: pedido do
> usuário — "capturar todos os top autores que tiverem mais de 100000
> seguidores e considerar que são os mais influentes". `limit` subiu pro
> máximo do endpoint (`1000`) — a Brandwatch ordena Top Authors por
> volume/relevância, não por seguidores, então isso melhora a cobertura
> mas **não garante 100%**: um autor de altíssimo alcance com baixo volume
> na Query específica pode ficar fora mesmo no limite máximo — limitação
> documentada do endpoint, não do código. `reach_estimate`/`impact`/
> `platform_stats` (twitter*/facebook*/reddit*) já são suficientes pra
> "alcance dos autores influentes" — todos vêm direto deste endpoint
> (agregado oficial, não amostrado), sem precisar de nenhuma função extra
> — consultar `bw_query_top_authors where is_influential` já responde.

> ⚠️ **Função `influential_author_activity()` removida (2026-07-11, migration
> `20260711010000`)**: existiu brevemente (`20260710050000`) cruzando
> `bw_query_top_authors` com `mentions` pra computar
> `original_count`/`reply_count`/`retweet_count`/`total_reach`/`max_reach`
> por autor influente. Essas 5 colunas eram soma/contagem sobre `mentions`
> (amostrada), a mesma categoria de problema que o usuário pediu pra
> eliminar do projeto inteiro — "não faça cálculo local confiando na
> mentions, pois não reflete a realidade... isso deve ser premissa". O que
> sobrou de valor real (`followers`, `is_influential`, `impact`,
> `reach_estimate`, `platform_stats` — todos agregados oficiais da
> Brandwatch, não amostrados) já são colunas diretas de
> `bw_query_top_authors`, sem precisar de função nenhuma.

> ⚠️ **Bug de produção corrigido (2026-07-11)**: `syncTopAuthors()` fazia
> upsert de todas as linhas de uma resposta de `data/volume/topauthors/
> queries` numa única chamada, sem deduplicar por `author` antes — quando a
> Brandwatch devolveu o mesmo autor mais de uma vez na mesma resposta,
> Postgres rejeitou o upsert inteiro com `ON CONFLICT DO UPDATE command
> cannot affect row a second time` (um único `INSERT ... ON CONFLICT` não
> pode aplicar `DO UPDATE` duas vezes na mesma linha dentro da mesma
> instrução). Corrigido com `dedupeByKey()` — deduplica por `author` antes
> do upsert, mantendo a primeira ocorrência (a resposta já vem ordenada por
> volume/relevância). Mesma correção aplicada em `bw_query_topics`
> (`syncTopicsData()`, dedup por `topic_type::label`) — mesma classe de
> risco, ainda não observada em produção mas estruturalmente idêntica.

---

## 6. Narrativas (entidade viva)

### `narratives`

| Campo              | Tipo               | Obrigatório | Descrição |
|---------------------|--------------------|-------------|-----------|
| `id`                | `uuid`             | sim | PK |
| `organization_id`   | `uuid`             | sim | FK → `organizations(id)` ON DELETE CASCADE |
| `bw_category_id`    | `bigint`           | não | FK → `bw_categories(id)` — vínculo opcional com Category já curada |
| `title`             | `text`             | sim | |
| `description`       | `text`             | não | |
| `stage`             | `narrative_stage`  | sim | default `'emerging'` |
| `risk_level`        | `severity_level`   | sim | default `'low'` |
| `priority`          | `severity_level`   | sim | default `'medium'` |
| `first_seen_at`     | `timestamptz`      | não | |
| `last_seen_at`      | `timestamptz`      | não | |
| `owner`             | `text`             | não | responsável (texto livre no MVP — sem FK para usuário) |
| `notes`             | `text`             | não | |
| `created_at`        | `timestamptz`      | sim | `now()` |
| `updated_at`        | `timestamptz`      | sim | `now()`, mantido por `set_updated_at` |

**Índices**: `(organization_id, stage)`, `(bw_category_id)` where not null.

**Políticas RLS**: `org_isolation_narratives` — `organization_id in (select auth_organization_ids())`.

### `narrative_signals`

| Campo          | Tipo          | Obrigatório | Descrição |
|-----------------|---------------|-------------|-----------|
| `id`            | `uuid`        | sim | PK |
| `narrative_id`  | `uuid`        | sim | FK → `narratives(id)` ON DELETE CASCADE |
| `signal_type`   | `text`        | sim | `keyword` \| `hashtag` \| `author_handle` \| `domain` \| `url` (livre — ver `overview.md`) |
| `signal_value`  | `text`        | sim | |
| `weight`        | `numeric`     | sim | default `1` |
| `is_active`     | `boolean`     | sim | default `true` |
| `created_at`    | `timestamptz` | sim | `now()` |

**Índices**: `(signal_type, signal_value)`, `(narrative_id)`.

**Políticas RLS**: `org_isolation_narrative_signals` — via `narrative_id` (padrão satélite, igual `entity_tags`):
```sql
narrative_id in (
  select id from narratives
  where organization_id in (select auth_organization_ids())
)
```

### `narrative_tags`

| Campo          | Tipo   | Obrigatório | Descrição |
|-----------------|--------|-------------|-----------|
| `id`            | `uuid` | sim | PK |
| `narrative_id`  | `uuid` | sim | FK → `narratives(id)` ON DELETE CASCADE |
| `tag_type`      | `text` | sim | `theme` \| `topic` \| `target` \| `spectrum` \| `impact_area` \| `crisis_type`... |
| `tag_value`     | `text` | sim | |

**Índices**: unique `(narrative_id, tag_type, tag_value)`, `(tag_type, tag_value)`.

**Políticas RLS**: mesmo padrão satélite de `narrative_signals`.

### `narrative_metrics`

| Campo                 | Tipo          | Obrigatório | Descrição |
|------------------------|---------------|-------------|-----------|
| `id`                   | `uuid`        | sim | PK |
| `narrative_id`         | `uuid`        | sim | FK → `narratives(id)` ON DELETE CASCADE |
| `metric_date`          | `date`        | sim | |
| `period`               | `text`        | sim | `daily` \| `weekly` \| `monthly`; default `daily` |
| `source`               | `text`        | sim | `bw_aggregate` — check constraint permite também `mentions_sample`, mas nada insere com esse valor desde `20260711010000` (ver nota) |
| `total_mentions`       | `integer`     | sim | default `0`, de `bw_query_metrics_daily.total_mentions` (agregado oficial, não amostrado) |
| `sentiment_positive`/`neutral`/`negative` | `integer` | sim | default `0`, idem |
| `reach_estimated`      | `integer`     | não | de `bw_query_metrics_daily.reach_estimate` — `null` até `bw-sync` sincronizar essa coluna pro dia em questão, **nunca** estimado localmente |
| `engagement_total`     | `numeric`     | não | de `bw_query_metrics_daily.engagement_score` — mesma regra |
| `created_at`           | `timestamptz` | sim | `now()` |

**Índices**: unique `(narrative_id, metric_date, period)`.

**Check constraint**: `source in ('bw_aggregate', 'mentions_sample')`.

**Políticas RLS**: mesmo padrão satélite de `narrative_signals`.

> ⚠️ **Premissa fixada pelo usuário (2026-07-11, migration
> `20260711010000`)**: "Retire os cálculos locais baseados em mentions,
> pois não fará sentido. Se tem na Brandwatch mantém, se não tem, não faça
> cálculo local confiando na mentions, pois não reflete a realidade, é
> apenas uma amostra. Isso deve ser premissa." — regra geral do projeto
> daqui pra frente, não só desta tabela.
>
> Histórico do que essa tabela chegou a ter e foi revertido: colunas
> `unique_authors`/`top_domain`/`repost_count`/`comment_count`
> (`20260710030000`) e a via `mentions_sample` inteira (Narrativas sem
> `bw_category_id`, `20260707000000`) computavam número a partir de
> `count`/`sum`/`mode` sobre `mentions` — que é amostrada em Queries de
> alto volume, então esses números **subestimavam** sistematicamente sem
> avisar. `reach_estimated`/`engagement_total` chegaram a ter um fallback
> pro cálculo local (`20260710040000`) "só enquanto o histórico não
> resincronizasse" — também removido, já que qualquer cálculo local viola
> a premissa, mesmo como fallback temporário.
>
> **Estado atual**: só Narrativas com `bw_category_id` (todas as
> auto-criadas hoje) recebem `narrative_metrics`, inteiramente a partir de
> `bw_query_metrics_daily` (agregado oficial da Brandwatch). Narrativa sem
> `bw_category_id` (só `narrative_signals`) **não recebe nenhuma linha** —
> sem agregado oficial disponível, a tabela fica sem dado em vez de um
> número que não reflete a realidade. `unique_authors`/`top_domain`/
> `repost_count`/`comment_count` não existem mais como coluna — não há
> equivalente oficial da Brandwatch pra eles quebrado por Category.

> ✅ **`refresh_narrative_metrics()` finalmente agendada (2026-07-10)**:
> a função existe desde a migration inicial mas **nunca teve um
> `cron.schedule` correspondente** — `narrative_metrics` sempre esteve
> vazia, mesmo com `narratives`/`bw_query_metrics_daily` populadas. Migration
> `20260710030000` (a) muda a assinatura pra `(p_from date, p_to date)`
> em vez de um único dia, servindo tanto de backfill quanto de refresh
> incremental; (b) roda um backfill único imediato
> (`refresh_narrative_metrics('2026-01-01', current_date)`) cobrindo o
> mesmo histórico configurado pro resto da integração; (c) agenda
> `pg_cron` (`refresh_narrative_metrics_hourly`, a cada hora) cobrindo uma
> janela larga (`current_date - 210` até `current_date`) em vez de só
> "ontem" — necessário porque o backfill de `mentions`/
> `bw_query_metrics_daily` pelo `bw-sync` ainda está em andamento (agora
> agendado via heartbeat de `pg_cron`, migration `20260711020000`, mas
> gated pelo intervalo de negócio — ver `sync-brandwatch.md` — então ainda
> mais lento que um backfill contínuo), então dias antigos podem ganhar
> dado novo e precisam ser reprocessados aqui também. Revisar essa janela
> pra algo mais estreito quando o backfill de mentions estiver
> confirmadamente completo. Diferente de `bw-sync` (que chama a Brandwatch
> e por isso tem o gate de `BW_SYNC_INTERVAL_HOURS`, ver
> `sync-brandwatch.md`), `refresh_narrative_metrics()` não chama a
> Brandwatch — sem implicação de rate limit, podia rodar em `pg_cron`
> desde sempre.

---

## Relacionamentos

```
organizations        ──< organization_members  >── auth.users
organizations        ──< bw_projects
bw_projects          ──< bw_queries ──< bw_query_metrics_daily
bw_projects          ──< bw_categories ──< bw_query_metrics_daily (category_id)
bw_projects          ──< bw_query_groups
organizations        ──< narratives >── bw_categories (bw_category_id, opcional)
narratives           ──< narrative_signals
narratives           ──< narrative_tags
narratives           ──< narrative_metrics
mentions             (sem FK direta a narratives — ligação via narrative_matched_mentions(), abaixo)
```

---

## Função: `narrative_matched_mentions`

Definição única de "quais mentions pertencem a uma Narrativa" (ver
`overview.md`, item 8 das decisões pendentes) — todo consumidor futuro
(`refresh_narrative_metrics`, `narrative_entities` no Sprint 2, drill-down do
Intelligence Center) deve reusar esta função, nunca reimplementar o matching.

```sql
create or replace function narrative_matched_mentions(
  p_narrative_id uuid,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns setof mentions
language sql
stable
as $$
  select m.*
  from mentions m
  join narratives n on n.id = p_narrative_id
  where m.organization_id = n.organization_id
    and (p_since is null or m.mention_date >= p_since)
    and (p_until is null or m.mention_date < p_until)
    and (
      (n.bw_category_id is not null and n.bw_category_id = any(m.category_ids))
      or exists (
        select 1 from narrative_signals s
        where s.narrative_id = p_narrative_id
          and s.is_active
          and (
            (s.signal_type = 'author_handle' and m.author_handle_normalized = lower(s.signal_value))
            or (s.signal_type = 'domain' and m.domain = s.signal_value)
            or (s.signal_type = 'hashtag' and s.signal_value = any(m.tag_names))
            or (s.signal_type = 'keyword' and (
                  m.snippet ilike '%' || s.signal_value || '%'
                  or m.full_text ilike '%' || s.signal_value || '%'
                ))
          )
      )
    )
$$;
```

> ⚠️ Rascunho de referência, não testado contra dados reais. `ilike` sobre
> `snippet`/`full_text` sem índice de texto (trigram/tsvector) é aceitável no
> volume do MVP mas deve ganhar índice antes de qualquer narrativa com sinal
> `keyword` rodar sobre milhões de mentions — ver Princípio de índices da
> skill `supabase-postgres-best-practices`. Sempre passar `p_since`/`p_until`
> em produção — nunca escanear todas as partições de `mentions` sem filtro de
> data.

## Função: `refresh_narrative_metrics`

Chamada direto pelo `pg_cron` (sem Edge Function). Desde `20260711010000`,
uma via só — sem agregado oficial da Brandwatch (`bw_category_id` nulo),
sem `narrative_metrics`.

> ⚠️ **A definição completa da função vive só na migration**
> (`supabase/migrations/20260711010000_remove_sampled_mentions_aggregations.sql`,
> que substitui as versões anteriores de `20260707000000` e
> `20260710030000`) — não duplicada aqui verbatim pra evitar drift entre
> spec e código. Resumo do comportamento atual:

- **Assinatura**: `refresh_narrative_metrics(p_from date, p_to date)` —
  range, não um único dia, servindo tanto de backfill histórico quanto de
  refresh incremental (via `pg_cron`, ver seção "`pg_cron` —
  agendamentos deste módulo" abaixo).
- **Única via**: `join bw_query_metrics_daily on category_id = bw_category_id`
  — `total_mentions`/sentimento/`reach_estimate`/`engagement_score`, tudo
  agregado oficial da Brandwatch, sampling-safe. `where bw_category_id is
  not null` — Narrativa sem Category vinculada não recebe linha nenhuma
  (não existe agregado oficial pra ela; ver premissa fixada na tabela
  `narrative_metrics` acima).
- Não usa `narrative_matched_mentions()` nem toca `mentions` de forma
  alguma — removido junto com a via antiga (`mentions_sample`) e os 3
  helpers `mention_engagement_likes`/`_reposts`/`_comments`, que não têm
  mais chamador.

---

## Camada de reporting (BI externo)

```sql
create schema if not exists reporting;

create or replace view reporting.mentions_daily as
select project_id, query_id, category_id, metric_date,
       total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative
from bw_query_metrics_daily;

comment on view reporting.mentions_daily is
  'Volume/sentimento diário por Query/Category, direto dos agregados oficiais da Brandwatch (não amostrado).';

create or replace view reporting.narratives_overview as
with daily as (
  select narrative_id, metric_date, total_mentions,
         sentiment_positive, sentiment_neutral, sentiment_negative,
         lag(total_mentions) over (partition by narrative_id order by metric_date) as prev_total_mentions
  from narrative_metrics
  where period = 'daily'
),
org_totals as (
  select nm.metric_date, n.organization_id, sum(nm.total_mentions) as org_total_mentions
  from narrative_metrics nm
  join narratives n on n.id = nm.narrative_id
  where nm.period = 'daily'
  group by nm.metric_date, n.organization_id
)
select
  n.id as narrative_id,
  n.organization_id,
  n.title,
  n.stage,
  n.risk_level,
  d.metric_date,
  d.total_mentions,
  round(100.0 * d.total_mentions / nullif(t.org_total_mentions, 0), 1) as sov_percent,
  round(100.0 * (d.total_mentions - d.prev_total_mentions) / nullif(d.prev_total_mentions, 0), 1) as trend_percent,
  case
    when d.total_mentions = 0 then 'neutral'
    when (d.sentiment_positive - d.sentiment_negative)::numeric / d.total_mentions > 0.2 then 'positive'
    when (d.sentiment_positive - d.sentiment_negative)::numeric / d.total_mentions < -0.2 then 'negative'
    else 'neutral'
  end as sentiment_bucket
from narratives n
join daily d on d.narrative_id = n.id
join org_totals t on t.metric_date = d.metric_date and t.organization_id = n.organization_id;

comment on view reporting.narratives_overview is
  'View usada pela tabela interativa de Narrativas no Executive Overview e exposta para BI externo. Thresholds de sentiment_bucket (±20%) e o bucket de Momentum (calculado no frontend a partir de trend_percent) são placeholders — ver ⚠️ DECISÃO PENDENTE em overview.md.';

-- Role só-leitura para BI externo (Qlik Cloud, Power BI, ferramentas próprias)
create role bi_reader login noinherit;
-- Senha real deve ser gerada e guardada fora do repositório (gestor de segredos),
-- nunca commitada. Ex.: alter role bi_reader password '<gerar e rotacionar externamente>';
grant usage on schema reporting to bi_reader;
grant select on all tables in schema reporting to bi_reader;
alter default privileges in schema reporting grant select on tables to bi_reader;
revoke all on schema public from bi_reader;
```

> `reporting` **não** deve entrar em `db.schemas` (Settings → API → Exposed
> schemas) no dashboard do Supabase — só acessível via conexão Postgres
> direta (Session pooler, porta 5432), nunca via PostgREST.

---

## `pg_cron` — agendamentos deste módulo

| Job | Frequência | Ação |
|---|---|---|
| `bw-sync-heartbeat` (Edge Function) | a cada 15min (heartbeat fixo, infraestrutura) | ✅ **agendado em `20260711020000`** — `select net.http_post(url := 'https://ktvyqpogfnowuqmjybvu.supabase.co/functions/v1/bw-sync', ...)` (URL hardcoded, não é segredo — ver nota acima). Cadência de negócio real (quando de fato minta token/chama a Brandwatch) é `BW_SYNC_INTERVAL_HOURS` (secret da Edge Function, default `3`) — ver `sync-brandwatch.md`, passo 0.5b. Nenhum passo manual pós-deploy necessário |
| `refresh_narrative_metrics_hourly` | de hora em hora | ✅ **agendado em `20260710030000`** — `select refresh_narrative_metrics(current_date - 210, current_date);`. Não chama a Brandwatch (só agrega dado já sincronizado), então não tinha o mesmo bloqueio de `bw-sync`. Janela larga (210 dias) hoje porque o backfill de `bw-sync` ainda está em andamento; revisar pra uma janela mais estreita quando isso estabilizar |

## Checklist antes de aplicar a migration

- [ ] Extensões `pgcrypto`/`btree_gin`
- [ ] Enums (`sentiment_type`, `severity_level`, `narrative_stage`)
- [ ] Funções utilitárias (`set_updated_at`, `auth_organization_ids`,
      `narrative_matched_mentions`, `refresh_narrative_metrics`)
- [ ] Tabelas na ordem: `organizations` → `organization_members` →
      `brandwatch_credentials` → `bw_projects` → `bw_queries`/`bw_query_groups`/`bw_categories`
      → `mentions` (+ partições) → `sync_cursors`/`sync_log` →
      `bw_query_metrics_daily` → `narratives` → `narrative_signals`/`narrative_tags`/`narrative_metrics`
      → `bw_query_metrics_weekly`/`bw_query_metrics_monthly`/`bw_query_group_metrics_weekly`
      (migration `20260707030000`, também corrige o bug de `category_id`
      nullable em `bw_query_metrics_daily` — ver seção 5)
      → colunas novas de `mentions` + `bw_query_metrics_daily_by_platform`/
      `bw_query_topics`/`bw_query_top_authors` (migration `20260710010000`,
      também corrige `create_mentions_partition` pra `security definer` —
      ver migration `20260710000000` — e o fix de dimensão do SOV de Query
      Group em `bw-sync/index.ts`)
      → colunas de engajamento em `narrative_metrics` +
      `refresh_narrative_metrics()` reescrita (range + engagement) +
      `pg_cron` agendado pela primeira vez (migration `20260710030000`)
      → `reach_estimate`/`engagement_score` não-amostrados em
      `bw_query_metrics_daily` + `category_id` em `bw_query_top_authors` +
      `refresh_narrative_metrics()` lendo da fonte não-amostrada (migration
      `20260710040000`)
      → `followers`/`is_influential` em `bw_query_top_authors` +
      `mentions.mention_role` + `influential_author_activity()` (migration
      `20260710050000`) → `bw_query_topics.engagement_total`/
      `reach_estimated` + `refresh_topic_engagement_reach()` (migration
      `20260710060000`) → lock de concorrência `bw_sync_lock` (migration
      `20260711000000`) → **remoção** de todo cálculo local sobre
      `mentions` amostradas: `refresh_topic_engagement_reach()`,
      `influential_author_activity()`, colunas
      `unique_authors`/`top_domain`/`repost_count`/`comment_count` de
      `narrative_metrics`, via `mentions_sample` de
      `refresh_narrative_metrics()` (migration `20260711010000` — ver
      premissa fixada na tabela `narrative_metrics`)
      → ⚠️ **pendente de implementação** (revisão de spec 2026-07-11, sem
      migration ainda): nova tabela `bw_query_x_insights` (§5), colunas
      `bw_query_topics.daily_series`/`page_type_breakdown` (§5), busca
      seletiva de `full_text` por Narrativa/top-N (§3) — ver
      `sync-brandwatch.md` passos 6.4b e 5
      → heartbeat `pg_cron`/`pg_net` pra `bw-sync` a cada 15min (URL
      hardcoded, não é segredo), gated por `BW_SYNC_INTERVAL_HOURS`
      (migration `20260711020000`)
- [ ] Triggers `set_updated_at` em `organizations`, `brandwatch_credentials`, `narratives`
- [ ] RLS habilitada em **todas** as tabelas deste módulo (inclusive
      `sync_cursors`/`sync_log`, deny-all)
- [ ] Schema `reporting` + views + role `bi_reader` (senha fora do repo)
- [ ] `reporting` fora de `db.schemas` no dashboard do Supabase
- [x] `pg_cron` configurado para `refresh_narrative_metrics` (migration
      `20260710030000`) e para `bw-sync` (heartbeat, migration
      `20260711020000` — autossuficiente, sem passo manual pós-deploy)
- [ ] Rodar `supabase gen types typescript --local > types/database.types.ts`
