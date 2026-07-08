---
tipo: data-model
módulo: foundation
status: pronto
atualizado: 2026-07-07
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

Sem alterações estruturais em relação ao schema anexo — já tinha RLS correta
e índices adequados. Mantido aqui só como referência de campos usados pelas
seções seguintes: `organization_id`, `project_id`, `query_id`, `resource_id`,
`category_ids bigint[]`, `tag_names text[]`, `sentiment`, `author`,
`author_handle_normalized` (gerada, `lower(author)`), `reach_estimate`,
`domain`, `snippet`, `full_text`, `added`, `mention_date`, `raw jsonb`.

> ⚠️ DECISÃO PENDENTE: campos de engajamento (likes/shares/comentários) não
> têm coluna tipada hoje — só existiriam dentro de `raw jsonb` se a
> Brandwatch retornar isso por mention. Verificar payload real antes de
> adicionar coluna.

**Índice adicional necessário** (ausente no schema anexo, precisa para
`narrative_matched_mentions()` abaixo, sinal `signal_type = 'domain'`):
```sql
create index idx_mentions_domain on mentions (domain);
```

---

## 4. Operacional — cursores e log (sem alteração estrutural)

### `sync_cursors` / `sync_log`

Campos idênticos ao schema anexo. **Políticas RLS**: `enable row level
security` em ambas, **sem nenhuma policy** (deny-all para `anon`/
`authenticated` — só `SUPABASE_SECRET_KEY`, que bypassa RLS, acessa).

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
| `synced_at`              | `timestamptz` | sim | `now()` |

**Índices**: unique `(project_id, query_id, category_id_key, metric_date)`.

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
do `bw-sync`): como semanal/mensal mudam bem mais devagar que o polling de
mentions (~20-30s), a Edge Function só busca de novo quando não existe linha
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

Populada por `data/volume/queryGroups/weeks?queryGroupId=...` — grão de
comparação entre candidato/concorrentes (ver exemplo de Query Group em
`brandwatch-setup.md` §4). ⚠️ Formato de resposta inferido da documentação
(um item de `results` por Query do grupo), não confirmado contra um payload
real — ver ressalva em `bw-sync/index.ts`, `syncQueryGroupSov()`.

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
| `source`               | `text`        | sim | `bw_aggregate` \| `mentions_sample` — check constraint |
| `total_mentions`       | `integer`     | sim | default `0` |
| `unique_authors`       | `integer`     | não | só preenchido na via `mentions_sample` |
| `sentiment_positive`   | `integer`     | sim | default `0` |
| `sentiment_neutral`    | `integer`     | sim | default `0` |
| `sentiment_negative`   | `integer`     | sim | default `0` |
| `reach_estimated`      | `integer`     | não | só via `mentions_sample` |
| `top_domain`           | `text`        | não | só via `mentions_sample` |
| `created_at`           | `timestamptz` | sim | `now()` |

**Índices**: unique `(narrative_id, metric_date, period)`.

**Check constraint**: `source in ('bw_aggregate', 'mentions_sample')`.

**Políticas RLS**: mesmo padrão satélite de `narrative_signals`.

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

Chamada direto pelo `pg_cron` (sem Edge Function). Populável em duas vias —
prioriza `bw_aggregate` quando a Narrativa tem `bw_category_id`.

```sql
create or replace function refresh_narrative_metrics(p_metric_date date default current_date - 1)
returns void
language plpgsql
as $$
begin
  -- Via 1: agregado oficial da Brandwatch (Narrativas com bw_category_id)
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative
  )
  select n.id, q.metric_date, 'daily', 'bw_aggregate',
         q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative
  from narratives n
  join bw_query_metrics_daily q
    on q.category_id = n.bw_category_id and q.metric_date = p_metric_date
  where n.bw_category_id is not null
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative;

  -- Via 2: agregação local (Narrativas só com sinais, sem bw_category_id)
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, unique_authors, sentiment_positive, sentiment_neutral,
    sentiment_negative, reach_estimated, top_domain
  )
  select
    n.id, p_metric_date, 'daily', 'mentions_sample',
    count(*),
    count(distinct m.author_handle_normalized),
    count(*) filter (where m.sentiment = 'positive'),
    count(*) filter (where m.sentiment = 'neutral'),
    count(*) filter (where m.sentiment = 'negative'),
    sum(m.reach_estimate),
    mode() within group (order by m.domain)
  from narratives n
  join lateral narrative_matched_mentions(
    n.id, p_metric_date::timestamptz, (p_metric_date + 1)::timestamptz
  ) m on true
  where n.bw_category_id is null
  group by n.id
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    unique_authors = excluded.unique_authors,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    reach_estimated = excluded.reach_estimated,
    top_domain = excluded.top_domain;
end;
$$;
```

> ⚠️ Rascunho de referência — validar performance real (via 2 escaneia
> mentions via `narrative_matched_mentions`, uma vez por Narrativa sem
> Category; aceitável para o volume esperado de Narrativas ativas no MVP,
> reavaliar se crescer muito).

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
| `bw-sync` (Edge Function) | a cada ~20–30s | invocação HTTP via `net.http_post` para a Edge Function `bw-sync` (round-robin de project+query) |
| `refresh_narrative_metrics` | diário (ex: 02:00 America/Sao_Paulo) | `select refresh_narrative_metrics();` — chamada SQL direta, sem Edge Function |

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
- [ ] Triggers `set_updated_at` em `organizations`, `brandwatch_credentials`, `narratives`
- [ ] RLS habilitada em **todas** as tabelas deste módulo (inclusive
      `sync_cursors`/`sync_log`, deny-all)
- [ ] Schema `reporting` + views + role `bi_reader` (senha fora do repo)
- [ ] `reporting` fora de `db.schemas` no dashboard do Supabase
- [ ] `pg_cron` configurado para `bw-sync` e `refresh_narrative_metrics`
- [ ] Rodar `supabase gen types typescript --local > types/database.types.ts`
