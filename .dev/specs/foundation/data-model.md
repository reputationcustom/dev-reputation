---
tipo: data-model
módulo: foundation
status: implementado
atualizado: 2026-07-23
---

> ✅ **Status corrigido 2026-07-14** (premissa do projeto, ver CLAUDE.md
> "Close the loop"): schema em produção desde a migration
> `20260707000000_foundation_schema.sql`, com dezenas de migrations
> incrementais desde então (ver `CLAUDE.md`, "Brandwatch sync model") —
> ficava marcado `pronto` por defasagem de tracking, não por estar
> pendente.

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
> `intelligence-center` (`cases`, ver `intelligence-center/data-model.md`)
> reutiliza o mesmo tipo pra um eventual `cases.priority` no futuro (o
> schema mínimo atual de `cases` não usa `risk_level`/`priority` ainda),
> sem recriar.

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
| `query_ids`      | `bigint[]`    | sim | default `'{}'`. ✅ Adicionado 2026-07-11 (migration `20260711080000`, correção de bug de SOV) — de `queryIds` no payload de `GET .../rulecategories` (confirmado em `developers.brandwatch.com/docs/retrieving-categories`), sem chamada nova. Quais Queries essa Category está associada — usado por `fetchNarrativeCategoryIds()` pra escopar `categoryTargets` corretamente por Query, e por `refresh_narrative_metrics()` pra saber a qual Query o `total_mentions` de uma Narrativa pertence |
| `status`         | `text`        | sim | default `'active'`. ✅ Adicionado 2026-07-16 (migration `20260716010000`, pedido do usuário: "as categorias permanecem mesmo quando excluídas da brandwatch... status passa para inativo"). `active` \| `inactive` (check constraint). `refreshMetadata()` marca `inactive` toda Category/Subcategory do Project que não veio mais em `GET /rulecategories` na última checagem — a linha nunca é deletada (preserva FK de `bw_query_metrics_daily`/`bw_query_topics`/`bw_query_top_authors`/histórico), só sinaliza que não deve mais ser usada. Reativação é automática se a Category reaparecer num sync futuro. `get_narratives_table`/`get_theme_breakdown` (aggregated-metrics) exigem `status = 'active'`; `fetchNarrativeCategoryIds()` (bw-sync) também, pra não gastar orçamento de rate limit sincronizando novo dado pra Category já removida |
| `synced_at`      | `timestamptz` | sim | `now()` |

**Índices**: `(project_id)`, `(parent_id)`, `(project_id, status)`.

**RLS**: mesmo padrão via `project_id`.

> ⚠️ **`query_ids` — ver bug de produção corrigido na seção "Camada de
> reporting" abaixo**: antes desta coluna existir, não havia como saber a
> qual Query cada Category pertencia, e `fetchNarrativeCategoryIds()`
> devolvia todas as Categories do Project pra qualquer Query — problema
> real quando o Project tem mais de uma Query (vários candidatos).

---

## 3. Mentions (particionada por mês)

Campos originais: `organization_id`, `project_id`,
`query_id`, `resource_id`, `category_ids bigint[]`, `tag_names text[]`,
`sentiment`, `author`, `author_handle_normalized` (gerada,
`lower(author)`), `reach_estimate bigint`, `domain`, `snippet`, `full_text`,
`added`, `mention_date`, `raw jsonb`.

> ⚠️ **`reach_estimate`/`impressions` corrigidos de `integer` pra `bigint`
> (2026-07-12, migration `20260712000000`)**: bug de produção real —
> `bw_query_x_insights.impressions` (campo análogo, ver §5) estourou o
> teto do `integer` do Postgres (~2.1 bilhões) com um valor real de
> ~3.96 bilhões. Diferente de contagens de posts (`volume`/`tweets`/
> `retweets`, limitadas ao número de mentions/reposts capturados — não
> passam de milhões mesmo pra um tema nacional), `reach_estimate`/
> `impressions` são métricas de **visualização/audiência**, cuja escala é
> ordens de magnitude maior. Corrigido em toda tabela que tem essas duas
> colunas: `mentions`, `bw_query_metrics_daily`, `bw_query_group_metrics_weekly`,
> `bw_query_top_authors`, `bw_query_top_sites`, `bw_query_x_insights`, e
> `narrative_metrics.reach_estimated` (populado direto de
> `bw_query_metrics_daily.reach_estimate`, mesmo risco).
>
> ⚠️ **`bw_query_top_sites.monthly_visitors` também estourou (2026-07-12,
> migration `20260712020000`)** — mesma classe de bug, mas essa coluna
> ficou de fora da correção acima porque não é chamada `reach_estimate`/
> `impressions`. É um valor nativo da Brandwatch (`monthlyVisitors`, não
> somado localmente) e domínios grandes passam facilmente de 2.1 bilhões
> de visitantes mensais estimados. Widened pra `bigint`.

> ✅ **`full_text` deixa de ser sempre `null` — busca seletiva implementada
> (2026-07-13, .dev/specs/_pending.md gap técnico #3 de foundation)**: a
> decisão original (`full_text = null` geral no poll principal, ver
> `sync-brandwatch.md` passo 5) continua valendo como *default* — buscar
> `/data/mentions/fulltext` pra toda mention dobraria as chamadas de todo
> poll, o que não se sustenta no orçamento de 25/invocação. Complementada
> por uma fase própria (`full_text_enrichment`, `runFullTextEnrichmentStep()`
> em `bw-sync/index.ts`, entre `demographics` e `sov` em `SYNC_STEPS`, sem
> migration — a coluna já existia): busca `full_text` **seletivamente**, só
> para mentions de fonte não-redigida (`content_source` fora de
> `twitter`/`reddit`/`linkedin`/`news`; `content_source` ainda `null` é
> tratado como elegível, não excluído preventivamente) já vinculadas a uma
> Narrativa (`bw_category_id`, via `categoryTargets`), limitado às top-N
> (`FULL_TEXT_ENRICHMENT_TOP_N = 8`) por `reach_estimate` por Narrativa/dia
> — a seleção do top-N é só um `ORDER BY` local sobre mentions já
> sincronizadas, não uma estatística agregada sobre a amostra. Throttle:
> no máximo 1 Narrativa×dia pendente por invocação, mesmo padrão das
> demais fases "stale-gated". Ver `sync-brandwatch.md` passo 5 (nota) pro
> fluxo completo e as duas incertezas de payload ainda não confirmadas
> (`fullText` como nome do campo de resposta; valores exatos de
> `content_source` pra `reddit`/`linkedin`).

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
| `impressions` | `bigint` | `impressions` — só X, `0` nas demais fontes. ⚠️ Corrigido de `integer` pra `bigint` em 2026-07-12 (bug de produção: overflow em `bw_query_x_insights.impressions`, mesma classe de risco em todo campo de visualização/audiência — ver nota em `mentions.reach_estimate` abaixo e migration `20260712000000`) |
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

> ⚠️ **`next_step` adicionado (2026-07-11, migration `20260711030000`,
> bug de produção: "CPU Time exceeded")**: `sync_cursors` ganha `next_step
> text not null default 'metadata'`, com check constraint restringindo aos
> valores de `SYNC_STEPS` em `bw-sync/index.ts` — originalmente 7
> (`metadata`, `mentions`, `daily_metrics`, `weekly_monthly`, `topics`,
> `top_authors`, `sov`), ampliado pra 8 na mesma revisão (migration
> `20260711040000`) com `author_enrichment` inserido entre `top_authors` e
> `sov` (ver `bw_query_top_authors`/`bw_query_author_topics` acima), depois
> pra 11 (migration `20260711070000`, adiciona `x_insights`/`top_sites`/
> `demographics`). A migration `20260711090000` (SOV/métricas por
> plataforma e Narrativa) adicionou um 12º valor, `platform_by_narrative`,
> a `SYNC_STEPS` no código mas **esqueceu de atualizar a constraint** —
> bug de produção descoberto 2026-07-12 ("new row ... violates check
> constraint \"sync_cursors_next_step_check\""), corrigido em
> `20260712010000` (constraint recriada com os 12 valores atuais). Uma
> única invocação processando um par "devido" de ponta a ponta (mentions +
> todas as métricas diárias/semanais/mensais/temas/top-authors/SOV)
> processava dezenas de milhares de objetos JSON sincronamente e estourava
> o orçamento de CPU do runtime. Com `next_step`, cada invocação executa só
> uma fase e avança o cursor — o ciclo completo se espalha por várias
> invocações (heartbeat de 15min ou clique manual no Dashboard, já que o
> estado vive inteiro nesta coluna, nunca em memória). `last_synced_at`
> só avança quando a última fase (`sov`) fecha o ciclo — até lá o par
> continua "devido" (ver nota acima) e é escolhido de novo a cada tick, o
> que garante que o ciclo termine antes de outro par começar. Ver
> "Execução em fases" em `sync-brandwatch.md` pro mapeamento fase↔passo e o
> trade-off aceito (categoryTargets de fases throttled — `weekly_monthly`/
> `topics`/`top_authors`/`sov` — podem levar vários ciclos completos pra
> cobrir todos, em vez de um só).

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
| `reach_estimate`         | `bigint`     | não | agregado oficial, `data/reachEstimate/categories/days` — adicionado `20260710040000`; corrigido de `integer` pra `bigint` em `20260712000000` (bug de overflow) |
| `engagement_score`       | `numeric`     | não | agregado oficial, `data/engagementScore/categories/days` — adicionado `20260710040000` |
| `unique_authors`         | `integer`     | não | agregado oficial, `data/authors/categories/days` (por Narrativa) e `data/authors/days` (Query inteira) — adicionado `20260712020000`, ver nota abaixo |
| `impressions`            | `bigint`      | não | agregado oficial, `data/impressions/categories/days` (por Narrativa) e `data/impressions/queries/days` (Query inteira) — adicionado `20260712030000`, ver nota abaixo |
| `net_sentiment`          | `numeric`     | não | agregado oficial, `data/netSentiment/categories/days` (por Narrativa) e `data/netSentiment/queries/days` (Query inteira) — ✅ implementado 2026-07-13, migration `20260713030000`. Score único de -100 a 100 (mesmo campo já usado em `bw_query_metrics_daily_by_platform`/`bw_query_demographics_daily` desde `20260712020000` — agora também na dimensão `categories`/`queries`) |
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

> ⚠️ **Bug encontrado 2026-07-12 (revisão de spec, ao planejar `unique_authors`
> abaixo)**: `syncCategoryDailyAggregate()` (que popula `reach_estimate`/
> `engagement_score`) só cobre a dimensão `categories` — que por natureza
> **nunca inclui uma linha "Query inteira"** (`category_id is null`). Ou
> seja, a linha de `category_id is null` de `bw_query_metrics_daily` (usada
> pelos cards "Alcance estimado"/"Engajamento total" do Executive Overview
> — ver `../intelligence-center/executive-overview.md`) **nunca teve `reach_estimate`/
> `engagement_score` populados** desde que essas colunas existem —
> `total_mentions`/sentimento funcionam para `category_id is null` porque
> `syncSentimentMetrics()` já trata esse caso (omite o filtro `category`),
> mas não havia função equivalente pros 2 agregados de chart. Corrigido
> nesta revisão junto com a adição de `unique_authors` (migration
> `20260712020000`) — nova função `syncQueryDailyAggregate()` em
> `bw-sync/index.ts`, ver `sync-brandwatch.md`.

> ✅ **`unique_authors` adicionado (2026-07-12, migration `20260712020000`)**:
> pedido do usuário — "Autores únicos já existe na brandwatch, precisamos
> rever o que estamos capturando por API". Confirmado direto contra
> `developers.brandwatch.com/docs/chart-dimensions-and-aggregates`: `authors`
> é um **aggregate** de chart válido (lista confirmada: `volume`, `authors`,
> `domains`, `impressions`, `netSentiment`, `reachEstimate`,
> `twitterFollowers`, `twitterLikeCount`, `engagementScore`), definido
> textualmente como "aggregate by the authors of the mentions" / "distinct
> authors who posted" — ou seja, uma contagem de autores distintos
> **oficial e não amostrada**, na mesma família que já confirmou
> `reachEstimate`/`engagementScore`. Isso **reverte, só para esta métrica**,
> a conclusão anterior registrada em "Premissa fixada pelo usuário" abaixo
> (que tratava `unique_authors`/`repost_count`/`comment_count` como um
> bloco só, sem fonte oficial — `unique_authors` sozinho, isolado, tem sim
> fonte oficial; `repost_count`/`comment_count` continuam sem). Populado
> via `data/authors/categories/days` (por Narrativa, mesmo mecanismo de
> `syncCategoryDailyAggregate()`, reusado passando `"authors"` como
> aggregate) e via `data/authors/days` (Query inteira, nova função
> `syncQueryDailyAggregate()` — ver bug acima). `integer`, mesmo tipo de
> `total_mentions` (contagem, não métrica de audiência/alcance — não
> sujeita à mesma classe de overflow de `reach_estimate`/`impressions`, ver
> migration `20260712000000`). ⚠️ Mesmo nível de confirmação já aceito pra
> `reachEstimate`/`engagementScore` neste projeto: a doc lista o aggregate
> e sua definição textual, mas não mostra um payload de exemplo específico
> — revisar contra logs reais após deploy.

> ✅ **`impressions` no nível de Narrativa/Query inteira adicionado
> (2026-07-12, migration `20260712030000`)** — auditoria pedida pelo
> usuário: "verifique se todas as agregações da página
> chart-dimensions-and-aggregates estão consideradas na integração".
> `impressions` já era capturado por autor
> (`bw_query_top_authors.impressions`, `data/impressions/queries/days?
> queryId=X&author=Y`) e por mention individual (`mentions.impressions`, só
> X), mas nunca agregado por Narrativa ou Query inteira — mesmo mecanismo
> de `reach_estimate`/`engagement_score`/`unique_authors` acima, mesma
> dimensão `categories` (por Narrativa, via `syncCategoryDailyAggregate()`)
> e `queries` (Query inteira, via `syncQueryDailyAggregate()`, mesma
> correção do gap de `category_id is null`). Também propagado pra
> `narrative_metrics.impressions` (ver abaixo).
>
> **Auditoria completa contra `chart-dimensions-and-aggregates` (2026-07-12)**
> — dos 9 aggregates não depreciados (`volume`, `authors`, `domains`,
> `impressions`, `netSentiment`, `reachEstimate`, `twitterFollowers`,
> `twitterLikeCount`, `engagementScore`; os outros 5 listados na doc —
> `blogComments`/`forumPosts`/`forumViews`/`influence`/`outreach`/`reach`
> — estão marcados **deprecated** pela própria Brandwatch, não
> implementados por esse motivo, não por omissão):
> - `volume`, `reachEstimate`, `engagementScore`, `authors`, `impressions`
>   — ✅ cobertos (ver notas desta seção).
>   `netSentiment` — ⚠️ **overclaim corrigido 2026-07-13, depois fechado no
>   mesmo dia**: esta linha dizia "✅ coberto" citando só
>   `bw_query_metrics_daily_by_platform`/`bw_query_demographics_daily` —
>   verdade pras dimensões `pageTypes`/
>   localização, **mas não** pra dimensão `categories`/`queries` (por
>   Narrativa / Query inteira), que é exatamente o que a tabela interativa
>   de Narrativas precisa pro indicador de Sentimento (ver
>   `../intelligence-center/executive-overview.md`) — antes desta revisão,
>   `net_sentiment` não existia em `bw_query_metrics_daily`, então o
>   Sentimento da tabela calculava um placeholder local
>   (`(sentiment_positive - sentiment_negative) / total_mentions`) em vez
>   de ler o score oficial da Brandwatch. **Implementado, migration
>   `20260713030000`** — ver `bw_query_metrics_daily.net_sentiment` acima e
>   `reporting.narratives_overview` abaixo (o cálculo local vira só
>   fallback, usado apenas em linhas onde `net_sentiment` ainda não
>   sincronizou).
> - `domains` **como aggregate** (contagem de domínios distintos, distinto
>   da dimensão `domains` usada por `bw_query_top_sites`) — ⚠️ **não
>   capturado**. Nenhuma spec/página pediu esse número até agora; não
>   implementado sem um pedido concreto (mesmo critério já usado pra outros
>   itens em "Fora de escopo do MVP", `_index.md`).
> - `twitterFollowers`/`twitterLikeCount` **como aggregate de chart geral**
>   (série temporal, ex: `data/twitterFollowers/categories/days`) — ⚠️
>   **não capturados** nesse formato. Já existe cobertura equivalente por
>   outra via: `bw_query_top_authors.followers`/`is_influential` (por
>   autor, de Top Authors) e `mentions.engagement->>'twitterLikeCount'`
>   (por mention, jsonb). Um agregado geral desses dois seria redundante
>   com o que já existe e não foi pedido por nenhuma página — não
>   implementado sem um caso de uso concreto que o distinga do que já
>   existe.

Nenhuma das 3 lacunas acima (`domains`/`twitterFollowers`/`twitterLikeCount`
como aggregate de chart geral) bloqueia qualquer spec já escrita — ficam
documentadas aqui como "disponível na Brandwatch, intencionalmente não
capturado" para não precisar repetir esta auditoria no futuro.

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

### `bw_query_metrics_hourly`

> ✅ **Adicionada 2026-07-13** — resolve a ⚠️ DECISÃO PENDENTE registrada em
> `event-radar/detection-engine.md` ("as janelas de 'hora atual'/'últimas
> 3h' exigem grão horário, mais fino que o diário oficial... não existe
> ainda"). Pedido do usuário: "Verificar se podemos corrigir a integração
> com a brandwatch para trazer essas informações no grão [horário]".
> Confirmado contra `developers.brandwatch.com/docs/chart-dimensions-and-aggregates`:
> a lista de dimensões de tempo de chart **inclui `hours`** (junto de
> `days`/`weeks`/`months`, já usadas neste projeto, e também `minutes`/
> `hourOfDay`/`dayOfWeek`, não usadas ainda) — o mesmo padrão de URL já
> usado pra `data/volume/sentiment/days` funciona trocando `days` por
> `hours` (`data/volume/sentiment/hours`), e o mesmo vale pra
> `netSentiment`/`categories`/`queries` já usados em `bw_query_metrics_daily`.
> ⚠️ Mesmo nível de confirmação já aceito neste projeto pra outras
> combinações de dimensão: a doc lista `hours` como dimensão válida
> genericamente pra "chart endpoints", mas não há exemplo de payload
> específico combinando `hours` com `volume`/`sentiment`/`netSentiment` —
> revisar contra logs reais após deploy, mesma ressalva já usada pra
> `reachEstimate`/`engagementScore`/`unique_authors`.

Estrutura idêntica a `bw_query_metrics_daily`, trocando `metric_date` por
`metric_hour` (`timestamptz`, não `date` — precisão de hora importa aqui) e
**restrita a `total_mentions`/`sentiment_positive`/`neutral`/`negative`/
`net_sentiment`** (sem `reach_estimate`/`engagement_score`/`unique_authors`/
`impressions` — não pedidos pra detecção de curto prazo, evita gastar
orçamento de chamada Brandwatch em dado que ninguém consome neste grão;
adicionar depois se `event-radar`/`aggregated-metrics` precisarem):

| Campo                  | Tipo          | Obrigatório | Descrição |
|--------------------------|---------------|-------------|-----------|
| `id`                     | `uuid`        | sim | PK |
| `project_id`             | `bigint`      | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id`               | `bigint`      | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `category_id`            | `bigint`      | não | FK → `bw_categories(id)` ON DELETE CASCADE; `null` = agregado da Query inteira — mesmo padrão de `bw_query_metrics_daily` |
| `category_id_key`        | `bigint`      | sim | gerada, `coalesce(category_id, 0)` — mesmo padrão anti-`NULL <> NULL` |
| `metric_hour`            | `timestamptz` | sim | início do bucket de hora (UTC ou `America/Sao_Paulo`, mesma decisão de timezone já usada no resto do projeto) |
| `total_mentions`         | `integer`     | sim | default `0` |
| `sentiment_positive`     | `integer`     | sim | default `0` |
| `sentiment_neutral`      | `integer`     | sim | default `0` |
| `sentiment_negative`     | `integer`     | sim | default `0` |
| `net_sentiment`          | `numeric`     | não | mesmo campo/escala de `bw_query_metrics_daily.net_sentiment` |
| `synced_at`              | `timestamptz` | sim | `now()` |

**Índices**: unique `(project_id, query_id, category_id_key, metric_hour)`.

**Políticas RLS**: `org_isolation_bw_query_metrics_hourly` — via `project_id`, mesmo padrão de
`bw_query_metrics_daily`.

**Janela de captura, deliberadamente curta** (diferente de `daily`/`weekly`/`monthly`, que
cobrem o histórico completo desde `BRANDWATCH_MENTIONS_START_DATE`): este grão existe só pra
detecção de curto prazo (`event-radar`) e pro grão `hour` do gráfico de tendência
(`get_volume_trend`, `aggregated-metrics`) — não pra histórico/BI. ⚠️ **Não é mais usado por
Tendência de Narrativa** (`get_narratives_table().trend_score`, antes "Velocidade"/`velocity_score`)
— desde a migration `20260722010000`, esse indicador passou a usar a série **diária** de
`narrative_metrics` (regressão sobre 14 dias), não mais o grão horário; ver
`aggregated-metrics/sql-aggregation.md`, "Tendência". `bw-sync` busca **últimos 30 dias** a cada
invocação (não só as horas desde o último sync). Motivo do tamanho: 30 dias cobre tanto a janela
"Últimas 3h" quanto "Hora atual vs. média das últimas 4 semanas na mesma hora"
(`event-radar/detection-engine.md`) com a **mesma tabela** — a segunda janela calcula a média
agrupando por hora-do-dia sobre os próprios registros
já armazenados aqui (`extract(hour from metric_hour)`), sem precisar de uma segunda chamada
usando a dimensão cíclica `hourOfDay` da Brandwatch. Sem custo extra de chamada por causa disso —
uma chamada de chart devolve todos os buckets do range pedido numa resposta só (mesmo princípio
já vale pra `days`/`weeks`/`months`), então pedir 30 dias de `hours` custa a mesma 1 chamada que
pedir 3 dias custaria. Ainda assim **sem job de retenção/limpeza** — mesma filosofia de
"histórico acumula indefinidamente por design" já aplicada a `daily`/`weekly`/`monthly` (ver
`CLAUDE.md`, "Data storage is historical by design"); o volume de linhas em grão horário continua
pequeno o bastante (24× o diário, ainda trivial pra Postgres) pra não precisar de exceção a essa
regra.

### `bw_query_group_metrics_weekly`

Resolve a ⚠️ DECISÃO PENDENTE de `overview.md` ("SOV de Query Group... grão
exato fica para data-model.md", nunca fechada até 2026-07-07) — o card de
Share of Voice do Executive Overview (`../intelligence-center/executive-overview.md`) depende desta
tabela.

| Campo             | Tipo          | Obrigatório | Descrição |
|--------------------|---------------|-------------|-----------|
| `id`               | `uuid`        | sim | PK |
| `project_id`       | `bigint`      | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_group_id`   | `bigint`      | sim | FK → `bw_query_groups(id)` ON DELETE CASCADE |
| `query_id`         | `bigint`      | sim | FK → `bw_queries(id)` ON DELETE CASCADE — uma linha por Query **dentro** do grupo, não um agregado do grupo inteiro |
| `metric_week`      | `date`        | sim | |
| `total_mentions`   | `integer`     | sim | default `0` |
| `reach_estimate`   | `bigint`     | não | ✅ adicionado 2026-07-11 (validação contra export real de dashboard Brandwatch — "Reach Over Time" comparado entre candidatos dentro de um Query Group). Via `data/reachEstimate/queries/weeks?queryGroupId=...` — mesmo agregado `reachEstimate` já confirmado em `bw_query_metrics_daily`, mesma dimensão `queries` já usada nesta tabela pro volume, só trocando o agregado. Corrigido de `integer` pra `bigint` em `20260712000000` (bug de overflow) |
| `synced_at`        | `timestamptz` | sim | `now()` |

**Índices**: unique `(query_group_id, query_id, metric_week)` — sem o
problema de `category_id` nullable acima (`query_id` aqui nunca é null).

**Políticas RLS**: `org_isolation_bw_query_group_metrics_weekly` — via
`project_id` (mesmo padrão das demais tabelas de cache).

Populada por `data/volume/queries/weeks?queryGroupId=...` — grão de
comparação entre candidato/concorrentes (ver exemplo de Query Group em
`brandwatch-setup.md` §4).

> ✅ **`reach_estimate` adicionado (2026-07-11, migration `20260711050000`)**:
> pedido do usuário após validar contra um export real de dashboard
> Brandwatch — "Reach Over Time" comparando candidatos dentro do mesmo
> Query Group não tinha equivalente nesta tabela (só `total_mentions`).
> Mesma chamada extra de `data/reachEstimate/queries/weeks?queryGroupId=...`
> (dimensão `queries`, já usada acima pro volume) — upsert parcial (só essa
> coluna), mesmo racional de `bw_query_metrics_daily.reach_estimate`. ⚠️
> Mesma categoria de risco da correção de dimensão acima (`queries` +
> `queryGroupId` juntos, sem exemplo de payload específico) — herda a
> mesma ressalva, não uma nova.

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
| `category_id` | `bigint` | não | FK → `bw_categories(id)`; `null` = breakdown da Query inteira, preenchido = por Narrativa. ✅ Adicionado 2026-07-11 (migration `20260711090000`, pedido do usuário: "importante que tenhamos share of voice por plataforma... por narrativa") |
| `category_id_key` | `bigint` | sim | gerada, `coalesce(category_id, 0)` — mesmo padrão anti-`NULL <> NULL` das demais tabelas de agregado |
| `page_type` | `text` | sim | nome da plataforma/fonte retornado pela dimensão `pageTypes` |
| `metric_date` | `date` | sim | |
| `total_mentions` | `integer` | sim | default `0` |
| `unique_authors` | `integer` | não | agregado oficial, `data/authors/pageTypes/days` — adicionado `20260712020000`, ver nota abaixo |
| `engagement_score` | `numeric` | não | agregado oficial, `data/engagementScore/pageTypes/days` — mesmo agregado já usado em `bw_query_metrics_daily`, dimensão `pageTypes` em vez de `categories`. Adicionado `20260712020000` |
| `net_sentiment` | `numeric` | não | agregado oficial, `data/netSentiment/pageTypes/days` — ver nota abaixo sobre a limitação (score único, não split positivo/neutro/negativo) |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, category_id_key, page_type, metric_date)`
(migração de `(project_id, query_id, page_type, metric_date)` — a constraint
antiga sem nome explícito foi localizada via `pg_constraint` em vez de
adivinhar o nome auto-gerado, ver migration `20260711090000`).
**Políticas RLS**: select-only via `project_id`, mesmo padrão das demais.
Breakdown da **Query inteira** (`category_id is null`) roda **toda
invocação** (mesmo throttle "diário sempre" do sentiment, fase
`daily_metrics`); breakdown **por Narrativa** roda em fase própria
(`platform_by_narrative`), throttle semanal, mesmo padrão de
`weekly_monthly`/`topics` — não faz parte de `daily_metrics` pra não
reintroduzir o risco de estouro de CPU corrigido em `20260711030000`.

**SOV por plataforma**: com `category_id` preenchido, dá pra responder
tanto "qual o mix de plataformas dentro da Narrativa X" (breakdown por
`page_type` dentro de uma `category_id`) quanto "qual a participação da
Narrativa X num `page_type` específico" (Narrativa/`page_type` ÷ Query
inteira/mesmo `page_type`, este último já disponível via `category_id is
null`) — sem cálculo local sobre `mentions`, os dois lados da divisão vêm
de agregados oficiais.

**SOV por autor**: já respondível com dado existente, sem tabela nova —
`bw_query_top_authors.volume` (por Query/Category/semana) ÷
`bw_query_metrics_daily.total_mentions` (mesmo Query/Category/dia mais
próximo) dá a participação de um autor no total — mera razão calculada na
camada de consumo (view/frontend), não precisa de sync adicional.

> ✅ **`unique_authors`/`engagement_score`/`net_sentiment` por plataforma
> adicionados (2026-07-12, migration `20260712020000`)** — resolve os gaps
> de "Autores únicos por plataforma" e "Engajamento médio por plataforma"
> registrados em `intelligence-center/platform-analysis.md`, e parcialmente
> "Sentimento por plataforma" em `intelligence-center/sentiment-analysis.md`.
> Pedido do usuário: "já estamos trazendo da brandwatch, se não tiver,
> reveja as especificações... vamos garantir que tenhamos essa informação
> no supabase via api da brandwatch". Mesmo padrão de `total_mentions`
> (`data/volume/pageTypes/days`) — troca só o aggregate, mesma dimensão
> `pageTypes`:
> - `unique_authors`: `data/authors/pageTypes/days` (aggregate `authors`,
>   ver nota de `bw_query_metrics_daily.unique_authors` acima).
> - `engagement_score`: `data/engagementScore/pageTypes/days` (mesmo
>   aggregate já usado por `categories`).
> - `net_sentiment`: `data/netSentiment/pageTypes/days` — **limitação
>   aceita conscientemente**: `netSentiment` é um aggregate próprio
>   (confirmado em `chart-dimensions-and-aggregates`), mas devolve um
>   **score único** (não split `positive`/`neutral`/`negative` como
>   `data/volume/sentiment/...`). Não existe uma combinação de 3 dimensões
>   (`sentiment` + `pageTypes` + `days` simultâneos) documentada — a API só
>   aceita 2 dimensões por chamada. "Sentimento por plataforma" na UI deve
>   exibir isso como **um score líquido por plataforma/dia**, não como as 3
>   barras positivo/neutro/negativo que o resto do produto usa — rotular
>   claramente a diferença (mesmo cuidado já aplicado a `emotion`).
>
> Throttle: rodam na fase `daily_metrics` (não throttled — mesma fase que já
> roda `syncPlatformMetrics` pro total_mentions), **não** numa fase
> separada. Diferente do incidente de CPU corrigido em `20260711030000`
> (que veio de milhares de linhas de `mentions`/`categories` numa só
> serialização síncrona), a dimensão `pageTypes` tem cardinalidade pequena
> (dezenas de plataformas, não milhares) — mesmo risco (e tamanho) já
> aceito para as 2 chamadas de `categories` (reach/engagement) que também
> rodam toda invocação. Rodam só para `category_id is null` (nível de Query
> inteira) nesta primeira leva — quebra por Narrativa (`category_id`
> preenchido) fica como ampliação futura, mesma ressalva já aplicada a
> outras métricas "por Narrativa" deste projeto (aí sim entraria na fase
> `platform_by_narrative`, throttled). ⚠️ Mesmo nível de confirmação já
> aceito para `reachEstimate`/`engagementScore`/`authors` — aggregate/
> dimensão válidos conforme a doc, sem payload de exemplo específico para
> esta combinação; revisar contra logs reais.

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
| `trending` | `numeric` | não | só para `topic_type` de `extract=` (endpoint novo) |
| `daily_series` | `jsonb` | não | array bruto do campo `days` — só para `topic_type = 'legacy_mixed'`, ver nota abaixo |
| `page_type_breakdown` | `jsonb` | não | objeto bruto do campo `pageType` — só para `topic_type = 'legacy_mixed'`, ver nota abaixo |
| `burst` | `numeric` | não | métrica de tendência própria do endpoint legado, escala diferente de `trending` — só para `topic_type = 'legacy_mixed'`. Adicionado `20260712040000` |
| `metric_week` | `date` | sim | data do snapshot de sync (não um bucket semanal literal — `data/topics` é um agregado sobre a janela toda, não uma série por semana; usado só como marcador de frescor/throttle) |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, category_id_key, topic_type,
label, metric_week)`. **Políticas RLS**: select-only via `project_id`.
Throttle semanal (mesmo padrão de `bw_query_metrics_weekly`,
`isTopicsStale()` em `bw-sync/index.ts`), por `categoryTarget` (query
inteira + cada Narrativa).

> ✅ **Correção de atribuição + implementação (2026-07-12, migration
> `20260712040000`, auditoria pedida pelo usuário contra
> `developers.brandwatch.com/docs/topics` vs. `/docs/data-topics`)**: a
> nota anterior (2026-07-11) tinha planejado `daily_series`/
> `page_type_breakdown` como se viessem do **mesmo** payload que
> `syncTopicsData()` já chama (`data/topics`, endpoint **novo**,
> `extract=`/`metrics=`) — **errado**: `days`/`pageType` só existem na
> resposta do endpoint **legado** (`data/volume/topics/queries`, doc
> `topics`), confirmado via quote literal do payload de exemplo de cada
> página. O endpoint novo devolve `sentimentScore`/`percentageVolume`/
> `trending`/`timeSeries` (quando `metrics` pedir), **sem** `days` nem
> `pageType` — os dois endpoints são fontes de dado genuinamente
> diferentes, não duas docs do mesmo endpoint (mesmo padrão do achado
> `topauthors`/`toptweeters` abaixo). Como o endpoint legado não aceita
> `extract` (devolve uma mistura de tipos de tópico já rankeados por
> `burst`), essas linhas usam `topic_type = 'legacy_mixed'` em vez de um
> dos valores de `extract` — `nova função `syncLegacyTopicsData()`,
> chamada logo após `syncTopicsData()` dentro da mesma fase `topics`
> (mesmo throttle semanal, sem fase própria). `burst` é uma métrica de
> tendência distinta de `trending` (algoritmo/escala diferentes) — nunca
> comparar os dois valores diretamente.

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
citado sem depender de reler texto restrito. ✅ **Implementado 2026-07-11**
(migration `20260711070000`) — priorizado depois de validar contra um
export real de dashboard Brandwatch ("X Themes": Top Stories/Hashtags/
Posters/Emojis, exatamente este shape de dado).

> ✅ **Cobertura reconfirmada (2026-07-13)** — pedido do usuário: "no
> endpoint twitter-insights é possível capturar Hashtags, Emoticons,
> Stories, Mentioned authors. Tudo isso deve existir na foundation."
> Revisitada a doc ao vivo (`developers.brandwatch.com/docs/twitter-insights`)
> nesta data: são exatamente os 4 endpoints já listados acima
> (`data/hashtags`, `data/emoticons`, `data/urls` = "Stories",
> `data/mentionedauthors`) — sem gap, os 4 já implementados desde
> `20260711070000`. Ver também
> [../intelligence-center/platform-analysis.md](../intelligence-center/platform-analysis.md)
> pra uma nota sobre uso futuro deste dado como nuvem de palavras no
> frontend (mesmo uso que a própria Brandwatch faz desses agregados).

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
| `impressions` | `bigint` | não | ⚠️ bug de produção real (2026-07-12): já observado excedendo o teto de `integer` (~2.1 bilhões) num hashtag de alto volume — corrigido pra `bigint` na migration `20260712000000` |
| `reach_estimate` | `bigint` | não | confirmado **ausente** no payload de `data/hashtags` — `null` para `insight_type = 'hashtag'`, presente para `emoticon`/`url`/`mentioned_author`. Corrigido de `integer` pra `bigint` em `20260712000000` |
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

> ✅ **Consumidor implementado + mapeamento reconfirmado (2026-07-18)** —
> até esta data, esta tabela era sincronizada e nunca lida por nada:
> nenhuma function/bloco de `aggregated-metrics` a expunha (achado numa
> auditoria pedida pelo usuário a partir de screenshots reais do
> dashboard nativo da Brandwatch — "Top Hashtags"/"Most Mentioned X
> Posters"/"Top Stories"/"Top Emojis"). Fechado via `get_x_insights`
> (`aggregated-metrics/sql-aggregation.md`), bloco `x_insights` do
> envelope, só na página `platforms`. Mesma sessão reconfirmou ao vivo
> contra `developers.brandwatch.com/docs/twitter-insights` que `volume`/
> `tweets`/`retweets`/`impressions`/`reachEstimate` são os nomes exatos de
> campo nos 4 endpoints (segunda confirmação independente, mesmo
> resultado da primeira em 2026-07-11/13) — os rótulos "Posts"/"Reposts"/
> "All Posts"/"Impressions" do dashboard nativo da Brandwatch são só
> apresentação da Brandwatch em cima destes mesmos 4 campos: `tweets` =
> Posts, `retweets` = Reposts, `volume` = All Posts, `impressions` =
> Impressions. Conferido também aritmeticamente contra um export real do
> usuário.

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
| `reach_estimate` | `bigint` | não | corrigido de `integer` pra `bigint` em `20260712000000` (bug de overflow) |
| `impact` | `numeric` | não | |
| `followers` | `integer` | não | de `twitterFollowers` — único campo de seguidores confirmado no envelope deste endpoint (Facebook/Reddit não têm campo de seguidores documentado aqui). Adicionado `20260710050000` |
| `is_influential` | `boolean` | sim | gerada, `coalesce(followers, 0) >= 100000` — adicionado `20260710050000`, pedido do usuário ("mais de 100000 seguidores... os mais influentes") |
| `tweets` | `integer` | não | de `twitterTweets` — contagem de posts do autor. ✅ Implementado 2026-07-11, migration `20260711060000` |
| `retweets` | `integer` | não | de `twitterRetweets` — contagem de reposts do autor. Mesmo migration que `tweets` acima |
| `impressions` | `bigint` | não | soma das impressões diárias do autor, via `data/impressions/queries/days?queryId=<id>&author=<handle>` — agregado oficial da Brandwatch (não `Top Authors`, que não expõe isso), filtrado por autor, **não** somado localmente sobre `mentions`. Ver nota abaixo. ✅ Implementado 2026-07-11, migration `20260711040000`; corrigido de `integer` pra `bigint` em `20260712000000` (bug de overflow real em `bw_query_x_insights.impressions`, mesma classe de campo) |
| `account_type` | `text` | não | de `authorAccountType` — confirmado no envelope do endpoint (ex: valores tipo governo/empresa/pessoal, exatos ainda não catalogados). ✅ Implementado 2026-07-11, migration `20260711060000` — habilita filtros tipo "Government Verification"/"Business Verification" já vistos num dashboard real da Brandwatch |
| `country_code` / `country_name` | `text` | não | de `countryCode`/`countryName` — país do autor (não do conteúdo da mention). Mesma migration que `account_type`, habilita "distribuição geográfica dos autores" (distinto de §5's demografia por *mention*) |
| `sentiment_positive`/`neutral`/`negative` | `integer` | sim | default `0` |
| `platform_stats` | `jsonb` | sim | objeto `data` inteiro devolvido pelo endpoint por autor (twitter*/facebook*/reddit* etc.) — mesmo raciocínio de `mentions.engagement`, sem coluna por campo. `account_type`/`country_code`/`country_name` acima são extrações de campos que já vivem aqui, não chamada nova |
| `metric_week` | `date` | sim | mesmo caráter de snapshot que `bw_query_topics.metric_week` |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, category_id_key, author, metric_week)`;
parcial `(project_id, query_id, is_influential) where is_influential` —
acelera consultas de "só os influentes".
**Políticas RLS**: select-only via `project_id`. Throttle semanal, agora por
`categoryTarget` (query inteira + cada Narrativa).

> ✅ **`tweets`/`retweets`/`account_type`/`country_code`/`country_name`
> implementados (2026-07-11, migration `20260711060000`)**: confirmado
> direto contra `developers.brandwatch.com/docs/top-tweeters` que o
> payload por autor já inclui `twitterTweets`/`twitterRetweets`/
> `authorAccountType`/`countryCode`/`countryName` — ou seja, esse dado já
> era capturado, só vivia dentro de `platform_stats` (jsonb), sem coluna
> própria. Extraído como colunas tipadas (mapeamento de campos já
> presentes na resposta, sem chamada nova à Brandwatch) depois de validar
> contra um export real de dashboard Brandwatch mostrando "Top X Authors |
> Government Verification"/"Business Verification" e distribuição
> geográfica de autores por Estado/Cidade.
>
> ✅ **`impressions` por autor — conclusão revertida no mesmo dia
> (2026-07-11)**: a primeira leitura desta spec (Top Authors não expõe
> impressões, confirmado) tinha concluído que não havia fonte oficial e
> que "fica de fora". **Corrigido** após o usuário pedir explicitamente
> pra incluir no MVP e pesquisa mais a fundo: `impressions` é um
> **agregado de chart oficial documentado** (confirmado em
> `developers.brandwatch.com/docs/chart-dimensions-and-aggregates`, mesma
> tabela que já confirmou `reachEstimate`/`engagementScore`), e o filtro
> `author=<handle>` (`available-filters.md`) é documentado como válido em
> "Mention ou Data Retrieval calls" — mesmo nível de evidência genérica já
> aceito neste projeto pro filtro `category=<id>`. Combinando os dois:
> `data/impressions/queries/days?queryId=<id>&author=<handle>&startDate&endDate`
> — mesmo padrão de dimensão `queries` já usado em `syncQueryGroupSov()`
> (`data/volume/queries/weeks?queryGroupId=X`), só trocando o agregado e o
> filtro de escopo. A resposta é uma série diária (`results[].values[]`,
> mesmo shape geral já usado em outros charts); `bw-sync` **soma os
> valores diários** (cada um já um número oficial não-amostrado da
> Brandwatch) pro total do período — isso **não** é o mesmo tipo de
> cálculo que a premissa de sampling proíbe: quem agrega é o motor de
> agregados da própria Brandwatch (filtrado por autor), não uma soma
> nossa sobre `mentions` (amostrada). ⚠️ Não confirmado com um payload de
> exemplo específico combinando `impressions` + `queries` + `author` — 
> mesma categoria de risco já aceita pra outras combinações análogas neste
> projeto (`category=<id>` em `data/volume/topauthors/queries`, dimensão
> `categories` em `data/reachEstimate/...`). Revisar contra logs reais.
>
> **Escopo inicial**: só os **top 10 autores por `volume`** da Query
> inteira (`category_id is null`), não todo autor já visto nem quebra por
> Narrativa — salvaguarda de orçamento (cada autor enriquecido custa 2
> chamadas extras: impressões + temas, ver `bw_query_author_topics`
> abaixo). Ampliar pra Narrativas específicas fica como ampliação futura.

> ⚠️ **`sentiment_positive`/`neutral`/`negative` — achado real numa
> auditoria (2026-07-17, pedido do usuário: "verifique como estão vindo os
> dados da brandwatch sobre sentimento... por autores")**: essas 3 colunas
> existem desde a criação da tabela (`20260710010000`) e `bw-sync` escreve
> nelas lendo `d.sentiment ?? {}` da resposta de
> `data/volume/topauthors/queries` (`syncTopAuthors()`) — mas, diferente de
> **todo** campo vizinho nesta mesma tabela (`tweets`/`retweets`/
> `account_type`/`country_code`/`country_name`, todos com nota explícita
> "confirmado contra developers.brandwatch.com/docs/top-tweeters"), este
> mapeamento **nunca foi confirmado** contra a documentação real do
> endpoint — o payload documentado (`authorVolume`/`reachEstimate`/
> `impact`/`twitterFollowers`/`twitterTweets`/`twitterRetweets`/
> `authorAccountType`/`countryCode`/`countryName`) não cita nenhum objeto
> `sentiment`. Risco real: `d.sentiment` provavelmente é sempre
> `undefined`, e as 3 colunas ficam sempre `0/0/0` em produção, sem nenhum
> erro (`?? 0` absorve silenciosamente). **Decisão do usuário**: não gastar
> uma chamada nova pra confirmar/substituir agora — `aggregated-metrics.
> get_authors_ranking` (ver `sql-aggregation.md`) foi corrigida pra NUNCA
> ler estas 3 colunas, usando `bw_query_author_topics` (fonte já
> confirmada, abaixo) como origem de "sentimento por autor" em vez disso.
> Estas colunas continuam existindo/sendo escritas (não removidas), só não
> têm mais nenhum consumidor downstream — revisar contra logs reais de
> produção antes de reativar seu uso. Mesma ressalva vale para
> `bw_query_top_tweeters.sentiment_positive/neutral/negative` (estrutura
> idêntica, ver abaixo).

> ✅ **Ampliação (2026-07-10, migration `20260710040000`)**: pedido do
> usuário — "influência do autor" também precisa ser por Narrativa, não
> amostrada. `bw-sync` passa `category=<id>` como filtro em
> `data/volume/topauthors/queries` (mesma convenção já comprovada em
> `data/volume/sentiment/days`) e itera por `categoryTarget`. ⚠️ Não há um
> exemplo específico confirmando o filtro `category` **neste** endpoint —
> apoiado na afirmação genérica de `filters.md` de que filtros valem pra
> "qualquer chamada de Mentions ou Data Retrieval (charts)". Revisar contra
> logs reais.

> ✅ **"Top Tweeters" implementado como tabela própria (2026-07-12,
> migration `20260712040000`, pedido do usuário: "termine integração do
> top-tweeters... considere esses dois endpoints como informações
> distintas, porém igualmente importantes")**: confirmado via auditoria
> direta contra `developers.brandwatch.com/docs/top-tweeters` (quote
> literal do payload de exemplo) que "Top Tweeters"/"Top X (Twitter)
> Authors" é um endpoint **próprio** (`data/volume/toptweeters/queries`),
> **diferente** do "Top Authors" geral (`data/volume/topauthors/queries`,
> acima) — não é o mesmo endpoint com dois nomes de doc, como uma leitura
> anterior (de fora desta spec — resumo curado da skill `brandwatch-api`)
> tinha assumido. `topauthors` rankeia por volume entre **todas** as
> plataformas da Query; `toptweeters` rankeia especificamente autores de
> X — o que mitiga, para X especificamente, a limitação já documentada
> acima ("Top Authors é ordenado por volume/relevância, não por
> seguidores... autor de altíssimo alcance com baixo volume pode ficar
> fora mesmo no limite máximo"), já que um autor de alto alcance mas baixo
> volume geral ainda pode rankear alto dentro do universo só-Twitter.
> Tabela própria (`bw_query_top_tweeters`, ver `syncTopTweeters()`), não
> uma coluna discriminadora dentro de `bw_query_top_authors` — o mesmo
> autor pode aparecer nos dois rankings com métricas potencialmente
> diferentes (universos de ranking diferentes), e a chave única de
> `bw_query_top_authors` (`project_id, query_id, category_id_key, author,
> metric_week`) colidiria se tentasse guardar as duas linhas juntas.

### `bw_query_top_tweeters`

Estrutura idêntica a `bw_query_top_authors` (mesmas colunas:
`author`/`volume`/`reach_estimate`/`impact`/`followers`/`is_influential`/
`tweets`/`retweets`/`account_type`/`country_code`/`country_name`/
`sentiment_positive`/`neutral`/`negative`/`platform_stats`/`category_id`/
`category_id_key`/`metric_week`/`synced_at`), populada por
`data/volume/toptweeters/queries` em vez de `data/volume/topauthors/queries`
— ver nota acima. Mesmo throttle semanal, mesma fase-irmã (`top_tweeters`,
logo após `top_authors` em `SYNC_STEPS`). **Não** alimenta
`author_enrichment` (impressões/temas por autor) nesta leva — esse
enriquecimento continua restrito aos top 10 de `bw_query_top_authors`,
ampliar para `bw_query_top_tweeters` fica como ampliação futura.

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

### `bw_query_top_sites`

✅ **Implementado 2026-07-11** — gap identificado validando o modelo de
dados contra um export real de dashboard Brandwatch (páginas "Top Site" —
ranking de domínios/sites, distinto de "Top Authors" que rankeia contas de
redes sociais). Confirmado endpoint próprio,
`data/volume/topsites/queries` (doc `top-sites`), agregado oficial não
amostrado, mesma família de `Top Authors` — payload por site quase
idêntico: `domain`, `volume`, `monthlyVisitors`, `countryName`/`countryCode`,
`authorName`/`authorGender`/`authorAccountType`, `authorVolume`/
`authorProfessions`/`authorInterest`, `sentiment`
(`negative`/`neutral`/`positive`), `reachEstimate`, `impact` — note que
mesmo sendo "Top Sites", o payload inclui dados do **autor típico** daquele
domínio (nome/gênero/tipo de conta/interesses), não só do site em si.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK |
| `project_id` | `bigint` | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id` | `bigint` | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `category_id` | `bigint` | não | FK → `bw_categories(id)`; `null` = ranking da Query inteira, preenchido = por Narrativa — mesmo padrão de `bw_query_top_authors` |
| `category_id_key` | `bigint` | sim | gerada, `coalesce(category_id, 0)` |
| `domain` | `text` | sim | |
| `volume` | `integer` | sim | default `0` |
| `monthly_visitors` | `bigint` | não | de `monthlyVisitors`; corrigido de `integer` pra `bigint` em `20260712020000` (bug de overflow, ver §5) |
| `reach_estimate` | `bigint` | não | corrigido de `integer` pra `bigint` em `20260712000000` (bug de overflow) |
| `impact` | `numeric` | não | |
| `author_name` | `text` | não | autor típico associado ao domínio (o payload trata isso como propriedade do site, não uma lista de autores) |
| `account_type` | `text` | não | de `authorAccountType` |
| `country_code` / `country_name` | `text` | não | de `countryCode`/`countryName` |
| `sentiment_positive`/`neutral`/`negative` | `integer` | sim | default `0` |
| `platform_stats` | `jsonb` | sim | objeto bruto do endpoint (mesmo raciocínio de `bw_query_top_authors.platform_stats`) |
| `metric_week` | `date` | sim | mesmo caráter de snapshot que `bw_query_top_authors.metric_week` |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, category_id_key, domain, metric_week)`.
**Políticas RLS**: select-only via `project_id`. Throttle semanal, mesmo
padrão de `bw_query_top_authors` (query inteira + cada Narrativa via
`categoryTarget`, `category=<id>` como filtro).

> ✅ **"Top Shared URLs" já coberto, sem gap (2026-07-12, auditoria pedida
> pelo usuário)**: `developers.brandwatch.com/docs/top-shared-urls`
> documenta o endpoint `data/urls` — **o mesmo path** já implementado como
> `bw_query_x_insights` (`insight_type = 'url'`, doc "Stories" dentro de
> "X (Twitter) Insights", ver acima). Não são dois endpoints diferentes com
> o mesmo path por coincidência — é literalmente o mesmo endpoint,
> documentado em duas páginas da doc da Brandwatch (uma vez dentro da
> família "X Insights", outra como item avulso de "Data Retrieval"). Sem
> gap, sem tabela nova. Única imprecisão a notar: o endpoint não é
> restrito a X apesar de viver na página/família "X (Twitter) Insights" —
> `bw-sync` hoje só chama os 4 endpoints de X Insights (incl. este) quando
> a Query/Narrativa tem presença relevante em `page_type = 'twitter'`
> (salvaguarda de orçamento, ver `bw_query_x_insights` acima) — isso
> significa URLs compartilhadas em Queries **sem** presença em X não são
> capturadas por este caminho. Não corrigido nesta leva (URL-sharing é
> majoritariamente um padrão de comportamento de X na prática, mesmo o
> endpoint não sendo tecnicamente restrito) — ampliação futura se o
> produto precisar de URLs compartilhadas fora de X.

### `bw_query_top_shared_sites`

✅ **Implementado 2026-07-12** (migration `20260712040000`, achado de
auditoria pedida pelo usuário contra
`developers.brandwatch.com/docs/top-shared-sites`). **Distinto de "Top
Sites" acima**: `data/sharedsites` mede domínios mais
**compartilhados/linkados dentro do conteúdo** das mentions ("a breakdown
of the top sites hosting the most link shares within your query topic"),
não domínios de onde as mentions em si vêm (isso é "Top Sites"). Payload
simples, sem o envelope `data`/`values` de Top Sites/Top Authors/Top
Tweeters — mesma família rasa de `bw_query_x_insights`.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK |
| `project_id` | `bigint` | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id` | `bigint` | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `category_id` | `bigint` | não | FK → `bw_categories(id)`; `null` = ranking da Query inteira, preenchido = por Narrativa |
| `category_id_key` | `bigint` | sim | gerada, `coalesce(category_id, 0)` |
| `domain` | `text` | sim | do campo `name` do payload |
| `label` | `text` | não | presente no payload, `null` nos exemplos vistos |
| `volume` | `integer` | sim | default `0` |
| `tweets` | `integer` | não | |
| `retweets` | `integer` | não | |
| `impressions` | `bigint` | não | mesma classe de risco de overflow de outros campos de impressões/audiência (ver `20260712000000`) |
| `metric_week` | `date` | sim | mesmo caráter de snapshot que `bw_query_top_sites.metric_week` |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, category_id_key, domain,
metric_week)`. **Políticas RLS**: select-only via `project_id`. Throttle
semanal, mesmo padrão de `bw_query_top_sites` (query inteira + cada
Narrativa via `categoryTarget`).

### `bw_query_author_topics`

✅ **Implementado 2026-07-11** (mesma revisão que corrigiu a conclusão de
`impressions` acima) — pedido do usuário: "principais temas do X por
autor". Mesmo raciocínio: `data/topics` é agregado por Query/Category
inteira por padrão, **mas aceita o filtro `author=<handle>`** (mesma
evidência genérica de `available-filters.md` já usada acima), então
`data/topics?queryId=<id>&author=<handle>&extract=...&metrics=...`
devolve temas oficiais **não amostrados**, restritos às mentions daquele
autor — sem violar a premissa de sampling, pelo mesmo motivo do
`impressions` acima (quem agrega é a Brandwatch, filtrado por autor).

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK |
| `project_id` | `bigint` | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id` | `bigint` | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `author` | `text` | sim | mesmo autor de `bw_query_top_authors.author` — sem FK formal (autor não é uma entidade própria no MVP, só uma string) |
| `topic_type` | `text` | sim | mesmo domínio de `bw_query_topics.topic_type` (`words`/`phrases`/`hashtags`/`entities`/`people`/`places`/`organisations`) |
| `label` | `text` | sim | o termo/tema em si |
| `volume` | `integer` | sim | |
| `percentage_volume` | `numeric` | não | |
| `sentiment_positive`/`neutral`/`negative` | `integer` | sim | default `0` |
| `trending` | `numeric` | não | |
| `metric_week` | `date` | sim | mesmo caráter de snapshot que `bw_query_topics.metric_week` |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, author, topic_type, label, metric_week)`.
**Políticas RLS**: select-only via `project_id`, mesmo padrão de
`bw_query_topics`. Throttle semanal, iterando os mesmos top 10 autores de
`bw_query_top_authors` (escopo inicial: Query inteira, sem quebra por
Narrativa — mesma ressalva de orçamento do `impressions` acima).
Upsert deduplicado por `dedupeByKey()` (`topic_type::label`), mesma
correção de "ON CONFLICT DO UPDATE" já aplicada em `bw_query_topics`.

### `bw_query_demographics_daily`

✅ **Implementado 2026-07-11** (migration `20260711070000`) — pedido do
usuário: "é possível fazer uma análise demográfica de tudo que vem do X?
Na Brandwatch eu tenho essa informação nos dashboards". Confirmado
direto contra `developers.brandwatch.com/docs/chart-dimensions-and-aggregates`
que existem dimensões de chart **oficiais e não amostradas** pra isso —
mesma família de `pageTypes`/`categories` já usada em `bw-sync`. Priorizado
depois de validar contra um export real de dashboard Brandwatch ("X
Demographics": gender split + trend diário, top interests, top
professions, top countries — exatamente este shape de dado, incluindo a
série temporal por dia que a tabela já previa):

- **Específicas de X/Twitter** (a doc marca explicitamente "currently for
  Twitter data only"): `gender`, `accountTypes`, `interest`, `profession`.
- **Localização** (sem restrição de plataforma indicada na doc):
  `countries`, `continents`, `cities`, `regions` — algumas variantes mais
  antigas (`states`, `counties`, `authorStates` etc.) aparecem marcadas
  como deprecated, não usar.

Não existe uma "dashboard-only API" — os dashboards da Brandwatch são
renderizados sobre essas mesmas dimensões de chart; não há necessidade
(nem suporte) de raspar a UI web da Brandwatch.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK |
| `project_id` | `bigint` | sim | FK → `bw_projects(id)` ON DELETE CASCADE |
| `query_id` | `bigint` | sim | FK → `bw_queries(id)` ON DELETE CASCADE |
| `dimension_type` | `text` | sim | `gender` \| `account_type` \| `interest` \| `profession` \| `country` \| `continent` \| `city` \| `region` — discriminador, mesmo raciocínio de `bw_query_x_insights.insight_type` (evita 8 tabelas quase idênticas) |
| `value` | `text` | sim | o bucket devolvido pela dimensão (ex: `"male"`, `"Brazil"`, `"São Paulo"`) |
| `metric_date` | `date` | sim | |
| `total_mentions` | `integer` | sim | default `0` |
| `net_sentiment` | `numeric` | não | agregado oficial, `data/netSentiment/{dimensão}/days` (mesma dimensão de `dimension_type`) — só para os 4 `dimension_type` de localização (`country`/`continent`/`city`/`region`), ver nota abaixo. Adicionado `20260712020000` |
| `synced_at` | `timestamptz` | sim | |

**Índices**: unique `(project_id, query_id, dimension_type, value, metric_date)`.
**Políticas RLS**: select-only via `project_id`, mesmo padrão de
`bw_query_metrics_daily_by_platform`.

**Escopo inicial: só nível de Query inteira, sem quebra por Narrativa** —
mesmo escopo de `bw_query_metrics_daily_by_platform` hoje. Quebra por
Narrativa (`category=<id>` por `categoryTarget`, mesmo padrão de
`bw_query_top_authors`) fica como ampliação futura, não bloqueia esta
primeira leva.

**Salvaguarda de orçamento**: as 4 dimensões específicas de X (`gender`/
`account_type`/`interest`/`profession`) só devem ser buscadas para Queries
com `bw_queries.type = 'twitter'` (ou, alternativa mais geral, com volume
relevante em `page_type = 'twitter'` — mesmo sinal já usado como
salvaguarda em `bw_query_x_insights`) — não gastar chamada em Query sem
presença em X. As 4 dimensões de localização não têm essa restrição
documentada, rodam para qualquer Query.

**Throttle/fase sugeridos**: throttle semanal (composição demográfica muda
devagar), mesmo padrão de `bw_query_topics`/`bw_query_top_authors`. Na
arquitetura de fases de `sync-brandwatch.md` ("Execução em fases"), isso
vira uma nova fase (`demographics`) — inserida entre `author_enrichment` e
`sov` em `SYNC_STEPS` (`author_enrichment` já ocupa o slot logo após
`top_authors`, ver abaixo) — que itera **uma dimensão por invocação**
(mesmo padrão de "para no primeiro que precisar de trabalho real" já
usado em `weekly_monthly`/`topics`/`top_authors`), não todas as 8 de uma
vez — evita reintroduzir o mesmo risco de estouro de CPU corrigido em
`20260711030000`.

⚠️ Formato de resposta inferido pelo padrão geral já confirmado pra outras
dimensões de chart (`results[].id` = bucket, `values[]` = `{id: data,
value: contagem}`, mesmo shape de `data/volume/pageTypes/days`) — não
confirmado com um payload de exemplo específico pra `gender`/`countries`
etc. Mesma categoria de risco já aceita pra `syncPlatformMetrics`/
`syncCategoryDailyAggregate`.

> ✅ **`net_sentiment` por localização adicionado (2026-07-12, migration
> `20260712020000`)** — resolve "Sentimento por localização"
> (`intelligence-center/sentiment-analysis.md`), mesma resposta do usuário
> que resolveu o gap de plataforma acima. Só para os 4 `dimension_type` de
> localização (`country`/`continent`/`city`/`region`) — os 4 específicos de
> X (`gender`/`account_type`/`interest`/`profession`) não foram pedidos
> para sentimento e não ganham a coluna nesta leva (`net_sentiment` fica
> `null` para essas linhas, sem custo de chamada extra). Mesma limitação de
> "score único" já registrada para `bw_query_metrics_daily_by_platform.net_sentiment`
> acima — não é split positivo/neutro/negativo.

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
| `query_id`             | `bigint`      | não | FK → `bw_queries(id)` ON DELETE CASCADE. ✅ Adicionado 2026-07-11 (migration `20260711080000`, correção de bug de SOV — ver "Camada de reporting" abaixo) — preenchido só quando `narratives.bw_category_id` está associado a **exatamente 1** Query em `bw_categories.query_ids`; `null` quando a Category não tem Query associada ainda ou (incomum, mas o schema da Brandwatch permite) está associada a mais de uma. Usado pelo SOV pra agrupar "total de menções" pela Query certa, não pela organização inteira |
| `metric_date`          | `date`        | sim | |
| `period`               | `text`        | sim | `daily` \| `weekly` \| `monthly`; default `daily` |
| `source`               | `text`        | sim | `bw_aggregate` — check constraint permite também `mentions_sample`, mas nada insere com esse valor desde `20260711010000` (ver nota) |
| `total_mentions`       | `integer`     | sim | default `0`, de `bw_query_metrics_daily.total_mentions` (agregado oficial, não amostrado) |
| `sentiment_positive`/`neutral`/`negative` | `integer` | sim | default `0`, idem |
| `reach_estimated`      | `bigint`      | não | de `bw_query_metrics_daily.reach_estimate` — `null` até `bw-sync` sincronizar essa coluna pro dia em questão, **nunca** estimado localmente. Corrigido de `integer` pra `bigint` em `20260712000000` (mesmo risco de overflow da coluna de origem) |
| `engagement_total`     | `numeric`     | não | de `bw_query_metrics_daily.engagement_score` — mesma regra |
| `unique_authors`       | `integer`     | não | de `bw_query_metrics_daily.unique_authors` — mesma regra. ✅ Adicionado `20260712020000`, ver nota de `unique_authors` em `bw_query_metrics_daily` acima |
| `impressions`          | `bigint`      | não | de `bw_query_metrics_daily.impressions` — mesma regra. ✅ Adicionado `20260712030000` |
| `net_sentiment`        | `numeric`     | não | de `bw_query_metrics_daily.net_sentiment` — mesma regra. ✅ Adicionado `20260713030000` |
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
> número que não reflete a realidade. `top_domain`/`repost_count`/
> `comment_count` não existem mais como coluna — não há equivalente oficial
> da Brandwatch pra eles quebrado por Category. **`unique_authors`
> reintroduzido em 2026-07-12** (migration `20260712020000`) — na época
> desta nota (2026-07-11) a conclusão era "sem alternativa oficial", mas
> pesquisa mais a fundo encontrou o aggregate `authors` de chart
> (`chart-dimensions-and-aggregates`), a mesma classe de agregado oficial
> não amostrado que já sustenta `reach_estimated`/`engagement_total` — não
> é uma reversão da premissa, é a mesma premissa aplicada com uma fonte que
> não tinha sido encontrada ainda. Ver nota completa em
> `bw_query_metrics_daily.unique_authors` acima.

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
            or (s.signal_type = 'hashtag' and lower(s.signal_value) = any(
                  select lower(h) from unnest(m.insights_hashtag) as h
                ))
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
>
> ✅ **Bug corrigido (2026-07-13, migration `20260713020000`)** — pedido do
> usuário: reveja a pendência de "extração de hashtag como campo
> estruturado" no endpoint de X Insights. Essa pendência já estava
> **resolvida de fato** desde 2026-07-10: `mentions.insights_hashtag
> text[]` (campo nativo `insightsHashtag`, específico de X/Instagram,
> confirmado contra `mention-metadata-field-definitions`) é exatamente o
> campo estruturado — a spec só nunca tinha sido atualizada pra remover o
> ⚠️ DECISÃO PENDENTE (ver `overview.md`, "Validação de viabilidade").
> Revisão encontrou, junto disso, um **bug real**: `signal_type = 'hashtag'`
> aqui casava contra `mentions.tag_names` — que é a feature de **Tags** da
> Brandwatch (`ruletags`, aplicadas manualmente, fora de escopo do MVP per
> `_index.md`), não os hashtags do post. Corrigido pra `insights_hashtag`
> (case-insensitive, `lower()`, mesmo padrão já usado pra `author_handle`).
> Sinais de `signal_type = 'hashtag'` só funcionam pra mentions de
> X/Instagram (`insights_hashtag` não é populado pras demais fontes) — mesma
> limitação já documentada pra outros campos restritos por plataforma.

## Função: `refresh_narrative_metrics`

Chamada direto pelo `pg_cron` (sem Edge Function). Desde `20260711010000`,
uma via só — sem agregado oficial da Brandwatch (`bw_category_id` nulo),
sem `narrative_metrics`.

> ⚠️ **A definição completa da função vive só na migration**
> (`supabase/migrations/20260711080000_narrative_sov_scoped_by_query.sql`,
> que substitui as versões anteriores de `20260707000000`, `20260710030000`
> e `20260711010000`) — não duplicada aqui verbatim pra evitar drift entre
> spec e código. Resumo do comportamento atual:

- **Assinatura**: `refresh_narrative_metrics(p_from date, p_to date)` —
  range, não um único dia, servindo tanto de backfill histórico quanto de
  refresh incremental (via `pg_cron`, ver seção "`pg_cron` —
  agendamentos deste módulo" abaixo).
- **Única via**: `join bw_categories on bw_categories.id = bw_category_id`,
  depois `join bw_query_metrics_daily on category_id = bw_category_id and
  query_id = any(bw_categories.query_ids)` — `total_mentions`/sentimento/
  `reach_estimate`/`engagement_score`, tudo agregado oficial da Brandwatch,
  sampling-safe. `where bw_category_id is not null and array_length(
  bw_categories.query_ids, 1) = 1` — Narrativa sem Category vinculada, ou
  cuja Category não está associada a exatamente 1 Query, não recebe linha
  nenhuma (sem escopo inequívoco de qual Query é o "total", ver bug
  corrigido na "Camada de reporting" acima).
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
  select narrative_id, query_id, metric_date, total_mentions,
         sentiment_positive, sentiment_neutral, sentiment_negative,
         net_sentiment, reach_estimated, engagement_total, unique_authors,
         -- ✅ Corrigido 2026-07-20 (bug real: "sentimento por narrativa
         -- sempre neutro" — dividir por total_mentions dilui o resultado
         -- sempre que há mentions neutras, exigindo desequilíbrio grande
         -- demais pra sair de 'neutral'). Normaliza por
         -- (sentiment_positive + sentiment_negative), mesma base usada por
         -- net_sentiment, em vez de total_mentions (que inclui neutras).
         case
           when coalesce(sentiment_positive, 0) + coalesce(sentiment_negative, 0) > 0
           then (sentiment_positive - sentiment_negative)::numeric * 100.0
                / (sentiment_positive + sentiment_negative)
           else null
         end as local_net_sentiment,
         lag(total_mentions) over (partition by narrative_id order by metric_date) as prev_total_mentions
  from narrative_metrics
  where period = 'daily'
),
query_totals as (
  select metric_date, query_id, sum(total_mentions) as query_total_mentions
  from narrative_metrics
  where period = 'daily' and query_id is not null
  group by metric_date, query_id
)
select
  n.id as narrative_id,
  n.organization_id,
  n.title,
  n.stage,
  n.risk_level,
  d.metric_date,
  d.total_mentions,
  d.net_sentiment,
  d.reach_estimated,
  d.engagement_total,
  d.unique_authors,
  round(100.0 * d.total_mentions / nullif(t.query_total_mentions, 0), 1) as sov_percent,
  round(100.0 * (d.total_mentions - d.prev_total_mentions) / nullif(d.prev_total_mentions, 0), 1) as trend_percent,
  coalesce(
    -- score oficial da Brandwatch (net_sentiment), quando já sincronizado
    case
      when d.net_sentiment >= 50 then 'very_positive'
      when d.net_sentiment >= 20 then 'positive'
      when d.net_sentiment >= 5 then 'slightly_positive'
      when d.net_sentiment >= -4 then 'neutral'
      when d.net_sentiment >= -19 then 'slightly_negative'
      when d.net_sentiment >= -49 then 'negative'
      when d.net_sentiment is not null then 'very_negative'
    end,
    -- fallback só enquanto net_sentiment ainda não sincronizou pra essa linha
    -- (histórico pré-20260713010000, ou sync ainda não passou por essa Narrativa/dia) —
    -- mesma escala de bucket de net_sentiment, aplicada a local_net_sentiment
    -- (mesma definição/base de net_sentiment: positivo/(positivo+negativo),
    -- só que calculada localmente sobre sentiment_positive/negative já
    -- oficiais/não amostrados — corrigido 2026-07-20, ver nota na CTE `daily`)
    case
      when d.local_net_sentiment >= 50 then 'very_positive'
      when d.local_net_sentiment >= 20 then 'positive'
      when d.local_net_sentiment >= 5 then 'slightly_positive'
      when d.local_net_sentiment >= -4 then 'neutral'
      when d.local_net_sentiment >= -19 then 'slightly_negative'
      when d.local_net_sentiment >= -49 then 'negative'
      when d.local_net_sentiment is not null then 'very_negative'
      else 'neutral'
    end
  ) as sentiment_bucket
from narratives n
join daily d on d.narrative_id = n.id
left join query_totals t on t.metric_date = d.metric_date and t.query_id = d.query_id;

comment on view reporting.narratives_overview is
  'View usada pela tabela interativa de Narrativas no Executive Overview e exposta para BI externo. sov_percent = menções da Narrativa / total de menções de todas as Narrativas da MESMA Query no mesmo dia — corrigido 2026-07-11 (ver nota abaixo). sentiment_bucket usa net_sentiment (score oficial da Brandwatch, 7 faixas, ver aggregated-metrics/sql-aggregation.md) com fallback pro cálculo local só enquanto net_sentiment não sincronizou. Momentum/Tendência/Risco (scores 0-100) NÃO vivem nesta view — são período-dependentes (a UI escolhe 7/14/30 dias) e ficam em aggregated-metrics.get_narratives_table(), que já recebe period_start/period_end; esta view expõe só dado bruto por dia, reaproveitado tanto pela UI quanto pelo BI externo. ✅ Momentum/Velocidade/Risco → Momentum/Tendência/Risco (2026-07-22, migration 20260722010000, comentário atualizado em 20260722010000).';

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

> ⚠️ **Bug de produção corrigido (2026-07-11, migration `20260711080000`,
> pedido do usuário: "O SOV corresponde a: Menções da Narrativa / Total de
> Menções. Verifique se estamos seguindo esse conceito")**: havia
> divergência real. `sov_percent` dividia pelo total de **todas as
> Narrativas da organização inteira** (`org_totals`, agrupado só por
> `organization_id`) — correto só na coincidência de a organização ter uma
> única Query monitorada. Com múltiplos candidatos/Queries no mesmo
> Project (confirmado no export de dashboard real validado na revisão
> anterior — 6 candidatos, 6 Queries), Narrativas de candidatos diferentes
> ficavam misturadas no mesmo denominador — o "Total" deixava de
> corresponder a "o total de menções da MESMA Query/candidato" que o
> conceito de SOV exige (ver exemplo do usuário: 200 mil menções de UM
> monitoramento, 5 Narrativas somando 100%).
>
> Causa raiz, mais funda que a view: `fetchNarrativeCategoryIds()` em
> `bw-sync/index.ts` devolvia **todas** as Narrativas do Project pra
> **qualquer** Query sendo sincronizada (sem noção de qual Query cada
> Category pertence) — desperdiçando orçamento (uma Query filtrando por
> Categories de candidatos alheios) e, mais grave, permitindo que
> `refresh_narrative_metrics()` (join só por `category_id`, sem restringir
> `query_id`) juntasse `total_mentions` da Query errada pra uma Narrativa.
>
> **Correção em 3 partes**:
> 1. `bw_categories` ganha `query_ids bigint[]` — Brandwatch já devolve
>    isso em `GET .../rulecategories` (campo `queryIds`, confirmado em
>    `developers.brandwatch.com/docs/retrieving-categories`), sem chamada
>    nova. Ver `refreshMetadata()`.
> 2. `fetchNarrativeCategoryIds()` passa a filtrar por Query (`bw_categories.
>    query_ids` contém o `queryId` corrente) — cada Query só recebe
>    `categoryTargets` das Narrativas que de fato pertencem a ela.
> 3. `narrative_metrics` ganha `query_id`, preenchido só quando a Category
>    da Narrativa está associada a **exatamente 1** Query (`array_length(
>    bc.query_ids, 1) = 1`) — o padrão recomendado em `brandwatch-setup.md`
>    (exemplos sempre usam `queryIds` com um único id). Categories
>    associadas a 0 ou >1 Queries não geram `narrative_metrics` — sem
>    escopo inequívoco, sem estimar (mesma premissa de "sem dado oficial
>    claro, sem número" já aplicada no resto do projeto). A view acima
>    agrupa `query_totals` por `query_id`, não mais por `organization_id`.

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
      → colunas `bw_query_topics.daily_series`/`page_type_breakdown` (§5,
      migration `20260712040000`, via o endpoint legado de Topics — ver
      `sync-brandwatch.md` passo 6.4c) e busca seletiva de `full_text` por
      Narrativa/top-N (§3, fase `full_text_enrichment`, sem migration —
      ver `sync-brandwatch.md` passo 5) — ✅ ambas implementadas
      → heartbeat `pg_cron`/`pg_net` pra `bw-sync` a cada 15min (URL
      hardcoded, não é segredo), gated por `BW_SYNC_INTERVAL_HOURS`
      (migration `20260711020000`) → `sync_cursors.next_step` (execução em
      fases, corrige bug de produção "CPU Time exceeded" — migration
      `20260711030000`, ver §4 e `sync-brandwatch.md` "Execução em fases")
      → `bw_query_top_authors.impressions` + nova tabela
      `bw_query_author_topics` + nova fase `author_enrichment` em
      `SYNC_STEPS` (migration `20260711040000`, ver `sync-brandwatch.md`
      passo 6.7) — top 10 autores da Query inteira, via
      `data/impressions/queries/days?author=` e `data/topics?author=`
      → `bw_query_group_metrics_weekly.reach_estimate` (migration
      `20260711050000`) → `bw_query_top_authors.tweets`/`retweets`/
      `account_type`/`country_code`/`country_name` (migration
      `20260711060000`, dado já capturado em `platform_stats`, só extraído
      como coluna) → nova tabela `bw_query_top_sites` (mesma migration) →
      nova tabela `bw_query_x_insights` + nova tabela
      `bw_query_demographics_daily` + novas fases `x_insights`/
      `top_sites`/`demographics` em `SYNC_STEPS` (migration
      `20260711070000`, ver `sync-brandwatch.md` passos 6.4b/6.6/6.8) —
      todos validados contra um export real de dashboard Brandwatch
      (2026-07-11, ver `sync-brandwatch.md` "Validação contra dashboard
      real")
      → **correção de bug de SOV** (pedido do usuário: "SOV = Menções da
      Narrativa / Total de Menções... verifique"): `bw_categories.query_ids`
      + `narrative_metrics.query_id` + `refresh_narrative_metrics()`
      reescrita (join agora respeita `query_id`) +
      `public.narratives_overview`/`reporting.narratives_overview`
      recalculando `sov_percent` por Query, não por organização inteira +
      `fetchNarrativeCategoryIds()` escopado por Query (migration
      `20260711080000`) → `bw_query_metrics_daily_by_platform.category_id`
      + nova fase `platform_by_narrative` em `SYNC_STEPS` (migration
      `20260711090000`, "SOV por plataforma")
      → **bug de produção corrigido**: `reach_estimate`/`impressions`
      widened de `integer` pra `bigint` em `mentions`,
      `bw_query_metrics_daily`, `bw_query_group_metrics_weekly`,
      `bw_query_top_authors`, `bw_query_top_sites`, `bw_query_x_insights` e
      `narrative_metrics.reach_estimated` (migration `20260712000000`) —
      overflow real observado em `bw_query_x_insights.impressions` (valor
      ~3.96 bilhões, acima do teto de `integer`, ~2.1 bilhões)
      → ✅ **`net_sentiment` implementado (2026-07-13, migration
      `20260713030000`)**: `bw_query_metrics_daily.net_sentiment`/
      `narrative_metrics.net_sentiment` (dimensões `categories`/`queries`,
      `runDailyMetricsStep()` em `bw-sync/index.ts`), `refresh_narrative_metrics()`
      e `reporting.narratives_overview` atualizados para ler o score oficial
      — resolve o gap de Sentimento por Narrativa
      → ✅ **implementado (2026-07-13, migration `20260713040000`)**: nova
      tabela `bw_query_metrics_hourly` + nova fase `hourly_metrics` em
      `SYNC_STEPS` (ver `sync-brandwatch.md` passo 6.3e) — resolve a
      detecção intra-dia do `event-radar`
      → ✅ **correção de bug de produção (2026-07-13)**: `daily_metrics`
      (`runDailyMetricsStep()`) era a única fase sem `hasBrandwatchCallBudget()`
      — relatado em produção como `429` esgotando os retries de
      `callBrandwatch()` em `netSentiment/queries/days`. Cada chamada da
      fase agora é guardada pelo mesmo orçamento usado em toda fase
      "stale-gated" (ver `sync-brandwatch.md`, nota logo após a tabela de
      fases)
      → ✅ **`bw_categories.status` implementado (2026-07-16, migration
      `20260716010000`)**: pedido do usuário — Category/Subcategory some do
      Brandwatch, mas nunca é deletada localmente, passa a `status =
      'inactive'`; `refreshMetadata()` recalcula isso a cada refresh de
      metadata (checando o `GET /rulecategories` atual contra o que já
      existe localmente). `get_narratives_table`/`get_theme_breakdown`
      (aggregated-metrics) e `fetchNarrativeCategoryIds()` (bw-sync) passam
      a exigir `status = 'active'` — ver §"bw_categories" acima e CLAUDE.md
      "Category/Subcategory status tracking + página-escopo raiz/subcategoria"
      → ✅ **correção de bug de produção (2026-07-16, migration
      `20260716020000`)**: `bw_sync_lock` ganha `rate_limited_until` — um
      429 com retry esgotado agora grava um backoff de 10min (a janela real
      do rate limit da Brandwatch), e a próxima invocação checa esse campo
      antes de mintar token/chamar a Brandwatch de novo, em vez de repetir a
      mesma chamada fadada a tomar 429 a cada heartbeat de 15min — ver
      CLAUDE.md "bw-sync rate limit cross-invocation backoff"
      → ✅ **bug real corrigido (2026-07-23)**: a desativação de
      `bw_categories.status` acima estava correta como lógica, mas só
      rodava quando `sync_cursors.next_step` chegava em `"metadata"` — a
      primeira fase de `SYNC_STEPS`, reavaliada só quando um ciclo inteiro
      de 16 fases fecha e dá a volta. Fases "stale-gated" avançam no
      máximo 1 categoryTarget por invocação, e `daily_metrics` também pode
      se estender por várias invocações desde 2026-07-22 (`stayOnStep`) —
      um ciclo inteiro podia levar bem mais que `BW_SYNC_INTERVAL_HOURS`
      (3h) pra fechar, deixando Categories removidas na Brandwatch
      marcadas `active` por muito mais tempo do que o throttle de 1h de
      `needsMetadataRefresh()` sugere. Corrigido: a checagem (e o refresh
      de verdade, quando devido) agora roda em toda invocação do par,
      independente da fase corrente — ver CLAUDE.md "Category
      deactivation wasn't actually running on any predictable cadence".
      Também ganhou log de sucesso (`refreshMetadata:categories_deactivated`,
      via `.select("id")` no `UPDATE`) — antes não havia nenhum log
      confirmando se a desativação rodou ou quantas linhas afetou
- [ ] Triggers `set_updated_at` em `organizations`, `brandwatch_credentials`, `narratives`
- [ ] RLS habilitada em **todas** as tabelas deste módulo (inclusive
      `sync_cursors`/`sync_log`, deny-all)
- [ ] Schema `reporting` + views + role `bi_reader` (senha fora do repo)
- [ ] `reporting` fora de `db.schemas` no dashboard do Supabase
- [x] `pg_cron` configurado para `refresh_narrative_metrics` (migration
      `20260710030000`) e para `bw-sync` (heartbeat, migration
      `20260711020000` — autossuficiente, sem passo manual pós-deploy)
- [ ] Rodar `supabase gen types typescript --local > types/database.types.ts`
