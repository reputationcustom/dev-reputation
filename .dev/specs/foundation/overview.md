---
tipo: module-overview
módulo: foundation
status: pronto
atualizado: 2026-07-06
---

# Módulo: Fundação (Sprint 1)

## Objetivo

> ✅ **Escopo de Sprint confirmado (2026-07-10)**: Sprint 1 é **inteiramente**
> a integração com a Brandwatch (sync serial+rate-limited pra Supabase) —
> nenhuma UI. A tela de consumo (Executive Overview e demais dashboards)
> passa a ser Sprint 2 ("a interface web com os gráficos"), consumindo os
> dados que Sprint 1 já deixa prontos no Supabase. `sync-brandwatch` e
> `narratives` (a base de dados + a lógica de agregação) são Sprint 1;
> `executive-overview` (a tela em si) é Sprint 2 — ver tabela abaixo.

Estabelecer a base de dados sincronizada da Brandwatch no Supabase — todo o
dado que qualquer tela ou módulo futuro (`executive-overview` no Sprint 2;
`entities`, `command-center`, `threshold-engine`... nos Sprints seguintes)
vai precisar pra operar. Nenhum desses tem dado sem este módulo — é a
fundação literal do produto.

## Funcionalidades

| Funcionalidade      | Descrição resumida                                                        | Sprint | Status implementação | Spec |
|----------------------|------------------------------------------------------------------------------|--------|----|------|
| `sync-brandwatch`    | Edge Function que sincroniza projects/queries/query-groups/categories/mentions/métricas (diária/semanal/mensal, plataforma, temas, top autores, SOV) da Brandwatch para o Supabase | 1 | **implementado** (ver `CLAUDE.md` "Brandwatch sync model" pro estado atual completo — mentions, narrativas auto-criadas, métricas não-amostradas por Narrativa incluídas) | [sync-brandwatch.md](sync-brandwatch.md) |
| `narratives`         | Tabela de Narrativas como entidade viva (auto-criada a partir de Category, sinais, tags, métricas históricas incl. engajamento/reach/reposts/comments), priorizando agregados oficiais da Brandwatch sobre soma local de mentions | 1 | **implementado** | [narratives.md](narratives.md) |
| `executive-overview` | Tela pós-login com métricas cacheadas: volume/sentimento, share of voice, contagem total, tabela interativa de Narrativas | **2** | não iniciado — depende só de ler o que Sprint 1 já deixa em `narratives_overview`/`bw_query_metrics_daily` | [executive-overview.md](executive-overview.md) |

## Dependências

- **Módulos que este depende**: nenhum — é a fundação.
- **Módulos que dependem deste**: `executive-overview` (Sprint 2, primeira
  tela — lê direto do que este módulo sincroniza, sem lógica de negócio
  própria), `entities` (Sprint 2/3, usa `mentions.author` para o JOIN de
  enriquecimento), `command-center` (`cases.category_id` referencia
  `bw_categories`), `threshold-engine` e `intelligent-feed` (Sprint 3,
  consomem `mentions`/`bw_categories` sincronizados).

## Rotas/Páginas

⚠️ Sprint 2 — nenhuma rota abaixo existe no app Next.js ainda (`app/` tem só
o scaffold inicial). Listada aqui porque é a única UI que `foundation`
prevê consumir; a implementação em si não é entrega de Sprint 1.

| Rota         | Componente/Página     | Acesso       |
|--------------|-------------------------|--------------|
| `/overview`  | `ExecutiveOverviewPage` | autenticado  |

## Dados gerenciados

Ver [data-model.md](data-model.md), cobrindo as tabelas já definidas em
`20260706_reputation_os_schema.sql`:
`organizations`, `organization_members`, `brandwatch_credentials`, `bw_projects`,
`bw_queries`, `bw_query_groups`, `bw_categories`, `mentions`, `sync_cursors`,
`sync_log` — mais as novas tabelas de Narrativa (`narratives`,
`narrative_signals`, `narrative_tags`, `narrative_metrics`) e a nova tabela de
agregados oficiais da Brandwatch `bw_query_metrics_daily` (ver nota de
sampling abaixo).

### `sync-brandwatch` — comportamento esperado

- Executa como **uma única Edge Function autossuficiente**
  (`supabase/functions/bw-sync/index.ts`, sem depender de `supabase/functions/_shared/`
  — ver Princípio técnico 5 em [`_index.md`](../_index.md)), agendada via
  `pg_cron`.
- **Bootstrap** (primeira execução ou por organização nova): busca e cacheia
  `projects/summary`, `queries/summary` e `GET /metrics` em
  `bw_projects`/`bw_queries`/`bw_query_groups`.
- **Polling de mentions**: para cada `(project_id, query_id)` ativo, usa o
  padrão oficial `sinceAdded` + buffer de 5 minutos (ver skill
  `brandwatch-api`, `references/mentions.md`), deduplicando por
  `(queryId, resourceId)` via `idx_mentions_natural_key` (upsert idempotente).
- **Fila serial sem estado entre invocações**: como a Edge Function é
  stateless entre execuções, a "fila serial" exigida pela Brandwatch (30
  chamadas/10min por Client) é implementada como **invocações de `pg_cron`
  espaçadas no tempo** (ex: a cada 20–30s, uma invocação processa um par
  project+query em round-robin, avançando `sync_cursors`), em vez de manter uma
  fila em memória entre execuções. Dentro de uma mesma invocação (ex:
  paginação por cursor de um backfill), a fila in-memory do
  `brandwatch-client.ts` de referência continua válida.
- **Autenticação**: resolve o access token da Brandwatch por organização via
  `brandwatch_credentials.access_token_secret_ref` (Supabase Vault) — nunca
  hard-coded, nunca no frontend.
- **Client Supabase da função**: usa `SUPABASE_SECRET_KEY` (bypassa RLS para
  escrever nas tabelas de cache), conforme padrão do Princípio técnico 5.
- **Observabilidade**: cada corrida grava/atualiza `sync_log` (status,
  `rows_processed`, `error_message`) e `sync_cursors` (`last_added_cursor`,
  `last_synced_at`, `status`, `last_error`).
- **Cache**: Categories, Tags e os "Global Preset Metrics" (`GET /metrics`)
  são buscados só no bootstrap/refresh periódico (não a cada polling de
  mentions), conforme best practice da Brandwatch.
- **Agregados oficiais (`bw_query_metrics_daily`)**: além do polling de
  mentions individuais, a função busca periodicamente
  `data/volume/sentiment/days` (com filtro `category=<bw_category_id>` quando
  aplicável, ver `references/filters.md`) por Query/Category ativa e faz
  upsert em `bw_query_metrics_daily` (`project_id`, `query_id`,
  `category_id` nullable, `metric_date`, `total_mentions`,
  `sentiment_positive/neutral/negative`, `synced_at`). Isso existe
  especificamente por causa do sampling descrito abaixo — ver nota de
  sampling na subseção `narratives`. A mesma lógica se aplica ao Share of
  Voice de Query Group (`data/volume/queryGroups/weeks`).
  ✅ **Decisão fechada (2026-07-07)**: tabela própria,
  `bw_query_group_metrics_weekly` (`project_id`, `query_group_id`, `query_id`,
  `metric_week`, `total_mentions`, `synced_at`) — uma linha por Query
  **dentro** do grupo, não um agregado único por `query_group_id`, para
  permitir comparar candidato × concorrentes direto em SQL. Ver
  `data-model.md` §5 e `sync-brandwatch.md` (passo 6.2).
  Mesmo padrão de tabela própria (em vez de reuso de `bw_query_metrics_daily`)
  vale para o grão semanal/mensal por Query/Category:
  `bw_query_metrics_weekly`/`bw_query_metrics_monthly`, populadas por
  `data/volume/sentiment/weeks`/`.../months` — decisão tomada junto com a de
  Query Group, já que ambas eram a mesma pergunta em aberto (grão de tempo
  além do diário).

### `narratives` — comportamento esperado

Adaptação do modelo sugerido pelo usuário ("narrativa como entidade viva"),
com as seguintes correções de terminologia, tenancy e fonte-da-verdade
volumétrica antes de virar migration (motivos abaixo):

- **Nomenclatura em inglês** para todas as tabelas/colunas — **correção**: a
  primeira versão desta spec tinha deixado `casos`/`caso_*` (schema anexo do
  Dia 1) em português "por já existirem"; o usuário corrigiu isso — como o
  desenvolvimento ainda não começou, não existe schema legado a preservar, e
  a regra vale para **tudo**, sem exceção (ver tabela de renomeação em
  `_index.md`: `casos`→`cases`, `caso_prioridade`→`case_priority`,
  `risco_nivel`→`risk_level` etc.). O termo de produto continua "Narrativa"/
  "Caso" (português) na UI e no glossário — só tabela/coluna é inglês.
- **Nunca "actor"/"ator"** nos nomes de coluna — a proposta original usava
  `actor_profiles`/`actor_id`/`actor_role`; qualquer referência a Entity segue
  o termo fixado em `_glossary.md` (`entity_id`, não `actor_id`). O schema
  anexo também tinha essa violação escondida num valor de enum
  (`ator_novo_detectado` em `feed_evento_tipo`) — corrigida para
  `new_entity_detected` em `feed_event_type` (ver `_index.md`).
- **Reuso de enums já existentes** em vez de `text` livre: `risk_level`
  (mesmo enum reusado por `cases`, agora também em inglês — ver tabela de
  renomeação em `_index.md`) para o campo de risco, `case_priority` para
  prioridade (coluna `priority`) — evita duplicar vocabulário e drift de
  valores.
- **`status` e `lifecycle_stage` colapsados em um único campo** `stage`
  (novo enum `narrative_stage`, em inglês por ser novo, sem reuso:
  `emerging | growing | stable | crisis | declining | closed`) — os dois
  campos da proposta original se sobrepunham (uma narrativa "closed" já é,
  por definição, inativa).
- **`organization_id` + RLS via `auth_organization_ids()`** em todas as tabelas
  novas — ausente na proposta original, mas obrigatório (mesmo padrão do resto
  do schema).
- **Vínculo com Category vira coluna direta, não um sinal EAV**:
  `narratives.bw_category_id uuid null references bw_categories(id)` — mantém
  a compatibilidade com a definição original do Dia 1 ("Narrativa = Category")
  como um **caso particular opcional**, em vez de forçar tudo a ser
  redescoberto via sinais.
- **`top_actor_id`/`narrative_actors`/`narrative_relationships` adiados**:
  dependem de `entities` (Sprint 2) ou são grafo/relacionamento entre
  narrativas (mais próximo de `propagation-graph`, Sprint 3). Ficam
  documentados no glossário como satélites futuros
  (`narrative_entities`, `narrative_relationships`), não fazem parte da
  migration deste módulo.
- **`narrative_metrics` prioriza os agregados oficiais da Brandwatch sobre
  agregação local — correção importante pedida pelo usuário**: em Queries de
  altíssimo volume (casa dos milhões/mês, nosso caso), a Brandwatch só libera
  uma **amostra** das mentions individuais via `data/mentions` (~12% em
  volumes muito altos — campo `sampled`/`samplePercentage` da Query), mas os
  **indicadores agregados continuam contando o volume total contratado**
  (ver skill `brandwatch-api`, `references/queries-and-projects.md` e o novo
  `references/analysis-api.md`). Ou seja, somar as mentions sincronizadas
  localmente **subestimaria** o volume real de Narrativas de alto volume.
  Por isso:
  - Quando `narratives.bw_category_id` está preenchido, `narrative_metrics`
    é alimentada por **upsert a partir de `bw_query_metrics_daily`**
    (populada pelo `sync-brandwatch` direto dos agregados da Brandwatch —
    ver seção anterior), com `source = 'bw_aggregate'`.
  - ⚠️ **Revertido (2026-07-11)**: quando a Narrativa **não** tem
    `bw_category_id`, este parágrafo previa cair pra agregação SQL local
    sobre `mentions` (`source = 'mentions_sample'`). O usuário fixou a
    premissa do projeto — "se não tem na Brandwatch, não faça cálculo
    local confiando na mentions, pois não reflete a realidade, é apenas
    uma amostra" — e essa via foi **removida** (migration
    `20260711010000`). Estado atual: Narrativa sem `bw_category_id` não
    recebe nenhuma linha em `narrative_metrics`, ponto. `source` no schema
    continua aceitando `'mentions_sample'` como valor de check constraint,
    mas nada insere com ele.
  - Campos que existem hoje em `narrative_metrics`: `total_mentions`,
    `sentiment_positive/neutral/negative`, `reach_estimated`,
    `engagement_total` — **todos** direto de `bw_query_metrics_daily`
    (agregado oficial da Brandwatch, não amostrado), nunca calculados
    localmente. `unique_authors`/`top_domain`/`repost_count`/
    `comment_count` da proposta original **não têm equivalente oficial da
    Brandwatch quebrado por Category** — chegaram a existir como
    agregação local sobre `mentions` (migrations `20260710010000`/
    `20260710030000`) e foram removidos pela mesma premissa acima
    (`20260711010000`). Ver `data-model.md` §`narrative_metrics` pro
    histórico completo e o estado atual.

**Validação de viabilidade (skill `brandwatch-api`, `references/mentions.md` e
`references/data-restrictions-compliance.md`)** — achado central:

> Sinais de texto (`keyword`, `hashtag` buscados em `snippet`/`full_text`) só
> funcionam de forma confiável em fontes **sem redação de conteúdo**. Para
> **X/Twitter, Reddit e LinkedIn, o texto completo não está disponível via API**
> (removido por compliance/licenciamento — X e Reddit nem sequer têm o campo
> de texto na lista de campos permitidos; LinkedIn não tem snippet algum), e
> Online News só traz 256 caracteres. Ou seja, exatamente nas fontes mais
> relevantes para monitoramento político brasileiro (X em especial), matching
> de narrativa por palavra-chave teria recall baixo ou nulo.
>
> **Por isso o vínculo `narratives.bw_category_id` (ou um sinal apontando para
> um `bw_query_id`) não é só "conveniência" — é o mecanismo confiável para
> cobrir X/Reddit/LinkedIn**: a Query booleana da Brandwatch já casou o texto
> **no servidor da Brandwatch**, antes da redação; qualquer mention retornada
> por aquela Query/Category é presumivelmente sobre o tema, mesmo que o texto
> não possa ser relido depois. Sinais de texto continuam válidos como
> mecanismo **secundário/best-effort** para fontes não restritas (blogs,
> forums, news dentro do limite de 256 caracteres).
> Campos **disponíveis para todas as fontes, incluindo X/Reddit/LinkedIn** e
> por isso seguros para sinais/métricas: `tag_names`, `domain`, `author`/
> `author_handle_normalized` (já existe como coluna gerada em `mentions`),
> `category_ids`, `language`, `country_code`, `page_type`. Sinais de
> `signal_type = 'author_handle'` (renomeado de `actor` na proposta original)
> usam diretamente `author_handle_normalized`, que já tem índice.
>
> Extração de hashtag como campo estruturado próprio (fora do texto) não foi
> confirmada na documentação lida — marcado como ⚠️ DECISÃO PENDENTE, a
> verificar no payload real da API antes de assumir que existe fora de
> `full_text`/`snippet`.

Estrutura final proposta para `data-model.md`:

```
narratives            (id, organization_id, bw_category_id null, title,
                       description, stage, risk_level, priority,
                       first_seen_at, last_seen_at, owner, notes,
                       created_at, updated_at)
narrative_signals      (id, narrative_id, signal_type, signal_value, weight,
                       is_active, created_at)
narrative_tags         (id, narrative_id, tag_type, tag_value)
narrative_metrics      (id, narrative_id, metric_date, period, source,
                       total_mentions, unique_authors, sentiment_positive,
                       sentiment_neutral, sentiment_negative, reach_estimated,
                       top_domain, created_at,
                       unique(narrative_id, metric_date, period))

bw_query_metrics_daily (id, project_id, query_id, category_id null,
                       metric_date, total_mentions, sentiment_positive,
                       sentiment_neutral, sentiment_negative, synced_at,
                       unique(project_id, query_id, category_id, metric_date))
```

### `executive-overview` — comportamento esperado

- Tela pós-login (`/overview`), lê **direto do Supabase** (dados já
  sincronizados) — nunca chama `api.brandwatch.com` em tempo real a partir do
  frontend.
- **Série temporal de volume por sentimento**: lida direto de
  `bw_query_metrics_daily` (já populada pelo `sync-brandwatch` a partir de
  `data/volume/sentiment/days`) — **não** recalculada por agregação local
  sobre `mentions`, exatamente por causa do sampling em Queries de alto
  volume (ver seção `narratives` acima).
- **Share of Voice (Query Group)**: se a organização tiver um Query Group
  configurado, comparação de volume por Query dentro do grupo, por semana —
  também cacheada via `sync-brandwatch` (`data/volume/queryGroups/weeks`),
  não recalculada localmente.
- **Contagem total de mentions** no período selecionado, a partir de
  `bw_query_metrics_daily` (soma de `total_mentions`).
- **Timezone fixo `America/Sao_Paulo`** para todos os buckets de data (o
  parâmetro `timezone` da Brandwatch, quando usado no sync, só afeta como os
  buckets são calculados — não filtra dados).
- Estados de loading/erro/vazio seguem o padrão da skill `web-app-structure`
  (`references/frontend.md`): `<Spinner />`, `<ErrorMessage retry />`,
  `<EmptyState />`.

#### Tabela interativa de Narrativas

Uma linha por Narrativa ativa da organização, colunas: **Narrativa**, **SOV**,
**Tendência**, **Sentimento**, **Momentum**, **Risco**, **Ação**. Nenhum
número é armazenado duplicado nas tabelas — tudo calculado sob demanda por uma
view/função `narratives_overview(organization_id, at_date)` sobre `narratives`
+ `narrative_metrics` (detalhada em `data-model.md`). Para Narrativas com
`bw_category_id`, a view usa as linhas com `source = 'bw_aggregate'`
(prioridade sobre `mentions_sample`, conforme a nota de sampling acima):

| Coluna | Origem | Cálculo |
|---|---|---|
| Narrativa | `narratives.title` | direto |
| SOV | `narrative_metrics.total_mentions` | `total_mentions` da narrativa ÷ soma de `total_mentions` de todas as Narrativas ativas da organização no mesmo `metric_date` — **Share of Voice (Narrativa)**, não confundir com o SOV de Query Group já descrito acima (ver `_glossary.md`) |
| Tendência | 2 linhas consecutivas de `narrative_metrics` | variação % entre o período atual e o anterior (mesmo `period`) |
| Sentimento | `sentiment_positive/neutral/negative` | bucket a partir do sentimento líquido `(positive - negative) / total`; thresholds exatos ⚠️ DECISÃO PENDENTE (decisão de produto, não técnica) |
| Momentum | magnitude/direção da Tendência | bucket categórico (ex: "Explodindo" / "Forte" / "Médio" / "Esfriando"); thresholds exatos ⚠️ DECISÃO PENDENTE — candidato natural a virar configurável no `threshold-engine` (Sprint 3) em vez de hard-coded |
| Risco | `narratives.risk_level` | direto — é julgamento (analista/IA), não derivado das métricas |
| Ação | — | link "Ver" → detalhe da Narrativa (rota exata fica para quando `intelligence-center`, Sprint 2, for especificado; para o Sprint 1 pode ser um detalhe mínimo: título, descrição, sinais, métricas atuais) |

`period` e o intervalo de comparação da Tendência (diário vs. semanal) ficam
como ⚠️ DECISÃO PENDENTE — a imagem de referência sugere variações do tipo
"+8%"/"-3%" que soam a comparação semana a semana, mas o valor exato é
configurável, não uma restrição técnica.

### Preparação para relatórios e cruzamento (Narrativa × Entity)

Revisão pedida pelo usuário: a estrutura de `narratives` + `mentions` +
agregados prontos da Brandwatch, combinada com o cadastro de `entities`
(Sprint 2), **já é suficiente como base** para relatórios e cruzamento — com
um ajuste de design a fazer agora para não gerar inconsistência depois.

**O que já funciona, sem tabela nova:**
`mentions.author_handle_normalized` → `entity_accounts.username` →
`entities` → `entity_tags` é um caminho de JOIN direto (todos os campos já
existem/existirão a partir do Sprint 2). Isso já permite responder "quais
Entities/partidos/espectros estão mais associados à Narrativa X" sem precisar
de nenhuma tabela de ponte — é só um `JOIN` sobre as mentions que casam com a
Narrativa (via `bw_category_id` ou `narrative_signals`). Ou seja,
`narrative_entities` (satélite adiado para o Sprint 2, ver acima) é uma
**otimização de performance/histórico** (evita recalcular o JOIN+agregação a
cada relatório), não um requisito estrutural — a base já suporta o
cruzamento hoje.

**Gap real a fechar já no Sprint 1** (antes que Sprint 2/Intelligence Center
implemente algo divergente): não existe ainda **uma única definição
canônica** de "quais mentions pertencem à Narrativa X" quando ela não tem
`bw_category_id`. Hoje isso está descrito só implicitamente (via
`narrative_signals`) dentro do cálculo de `narrative_metrics`. Sem uma
view/função única, o job de métricas, a futura `narrative_entities` (Sprint 2)
e o drill-down do Intelligence Center (Sprint 2) correm o risco de
implementar o matching de sinais cada um à sua maneira e chegarem a números
diferentes para "a mesma" Narrativa. **Ação**: `data-model.md` deste módulo
deve especificar uma única view/função (ex: `narrative_matched_mentions(narrative_id)`)
que todo consumidor futuro reusa — `refresh_narrative_metrics()` já descrita
acima passa a ser implementada *sobre* essa view, não com lógica própria.

**Recomendação para quando `entities` (Sprint 2) for especificado**: desenhar
`narrative_entities` já pensando em relatório/cruzamento, não só em
"quem está falando sobre o tema" — ou seja, granular o suficiente para
`GROUP BY narrative_id, entity_id` e joinável a `entity_tags` para cross-tabs
tipo "Narrativa × partido" ou "Narrativa × espectro político" direto em BI
(Power BI/Qlik), reaproveitando a mesma `narrative_matched_mentions()` acima
como fonte. Quando isso existir, adicionar `reporting.narrative_entities`
como terceira view da camada de BI (ver abaixo) — não faz parte do Sprint 1,
só fica registrado aqui para o módulo `entities` não redesenhar do zero.

## Camada de reporting (BI externo)

Ver Princípio técnico 6 em [`_index.md`](../_index.md). Para o Sprint 1, os
dois primeiros objetos do schema `reporting` (read-only, fora do
`db.schemas` do PostgREST) são:

- `reporting.mentions_daily` — espelho de `bw_query_metrics_daily` (volume/
  sentimento por dia, por Query/Project — já a partir dos agregados oficiais
  da Brandwatch, não de uma amostra local), achatado (sem arrays/jsonb) para
  consumo direto por Power BI/Qlik Cloud.
- `reporting.narratives_overview` — mesma view usada pela tabela interativa do
  Executive Overview, exposta também para BI externo.

Acesso via role `bi_reader` (somente `SELECT` no schema `reporting`),
conectando pelo Session pooler do Supabase — não pelo Transaction pooler.
Como discutido no Princípio 6, isso **não** isola por organização
automaticamente (RLS de `auth.uid()` não vale numa conexão Postgres crua);
para o MVP a camada de reporting é de uso interno da Lidi.

## Notas para implementação

### Multi-tenancy: usuário ↔ organização (decisão fechada)

O schema anexo assumia 1 organização por usuário via claim `app_metadata.organization_id`
no JWT. Substituído pelo seguinte design, que suporta **um usuário pertencer a
1 ou mais organizações**:

- Nova tabela `organization_members` (associação usuário↔organização):
  `id`, `organization_id` (FK `organizations`), `user_id` (FK `auth.users`),
  `created_at`, unique `(organization_id, user_id)`. Sem coluna de papel/role —
  não faz parte do MVP, é uma coluna trivial de adicionar depois se necessário.
- Função auxiliar `security definer` (evita recursão de RLS ao consultar
  `organization_members`, que também tem RLS ativa, e permite ao planner
  cachear o resultado por statement):
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
- Toda policy `org_isolation_*` (existente e nova) passa a usar
  `organization_id in (select auth_organization_ids())` — substitui totalmente
  o padrão `organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid`
  do schema anexo em **todas** as tabelas org-scoped (`mentions`, `cases`,
  `entities`, `threshold_configs`, `feed_events`, `reports_generated`,
  `brandwatch_credentials`, `organizations` e as de cache listadas no item 1
  abaixo).
- `organization_members` tem sua própria RLS: `select` permitido apenas onde
  `user_id = (select auth.uid())` (o usuário só vê suas próprias associações).
- **Fora do MVP, só a estrutura**: não há tela/fluxo de convite, criação de
  organização ou troca de organização ativa — a tabela existe e a RLS já
  funciona para múltiplas organizações, mas popular `organization_members`
  continua manual (seed/SQL direto) até um módulo futuro de gestão de
  organizações ser especificado.

> ⚠️ DECISÃO PENDENTE (ajustes de schema a aplicar na migration inicial, antes
> de implementar `sync-brandwatch`/`executive-overview` — detalhamento completo
> vai para `data-model.md`):
>
> 1. **Gap de RLS real**: `organizations`, `bw_projects`, `bw_queries`,
>    `bw_query_groups`, `bw_categories` não têm `ENABLE ROW LEVEL SECURITY` no
>    schema anexo. Como o Executive Overview lê essas tabelas direto do client
>    Supabase (padrão `web-app-structure`), sem RLS qualquer usuário
>    autenticado de qualquer organização conseguiria ler projetos/queries de
>    **todos os tenants** via PostgREST. Precisa de RLS + policy
>    `org_isolation_*` (usando `auth_organization_ids()` acima; mesmo padrão de
>    derivar organização via tabela pai já usado em
>    `entity_accounts`/`entity_tags` para as tabelas satélite).
> 2. `sync_cursors`/`sync_log` também sem RLS — são de uso exclusivo da Edge
>    Function (via `SUPABASE_SECRET_KEY`, que ignora RLS de qualquer forma),
>    mas devem ganhar RLS deny-all (sem policy) por defesa em profundidade e
>    para não acusar erro no Database Linter do Supabase.
> 3. Todas as policies (novas e as já existentes no schema anexo) usam a
>    função `auth_organization_ids()` acima, que já é `stable` — não repetir o
>    padrão antigo de claim JWT em nenhuma tabela.
> 4. Falta a função/trigger `set_updated_at` referenciada implicitamente pelas
>    colunas `updated_at` já presentes em `brandwatch_credentials`, `entities`,
>    `cases` e, agora, `narratives` (Princípio técnico 4).
> 5. `narratives`/`narrative_signals`/`narrative_tags`/`narrative_metrics`
>    precisam de `ENABLE ROW LEVEL SECURITY` + policy `org_isolation_*` desde
>    a criação (via `auth_organization_ids()`; satélites derivam a organização
>    de `narratives` como no padrão já usado por `entity_accounts`/`entity_tags`).
> 6. Criar o schema `reporting` + role `bi_reader` (Princípio técnico 6) como
>    parte da mesma migration inicial, já que as duas primeiras views
>    (`mentions_daily`, `narratives_overview`) dependem das tabelas deste
>    módulo.
> 7. `bw_query_metrics_daily` é derivada de `bw_projects`/`bw_queries`
>    (organização via `project_id`) — precisa de RLS + policy
>    `org_isolation_*` no mesmo padrão do item 1, não é uma tabela
>    "interna only" como `sync_cursors`/`sync_log`.
> 8. Especificar a view/função única `narrative_matched_mentions(narrative_id)`
>    (ver "Preparação para relatórios e cruzamento" acima) — `refresh_narrative_metrics()`
>    deve ser implementada sobre ela, não com lógica de matching própria,
>    para não divergir do que `entities`/Intelligence Center (Sprint 2) vierem
>    a usar para o mesmo cruzamento.
>
> Nenhum desses ajustes foi aplicado ainda — ficam para a migration inicial,
> a ser desenhada em `data-model.md` após aprovação deste overview.

## Referências relacionadas

- [_index.md](../_index.md) — stack, princípios técnicos obrigatórios, mapa de módulos.
- [_glossary.md](../_glossary.md) — Project, Query, Query Group, Category/Narrativa, Mention.
- [brandwatch-setup.md](brandwatch-setup.md) — checklist de configuração
  manual na Brandwatch (Project, Queries, Query Groups, Categories) que
  precisa existir **antes** do primeiro `sync-brandwatch` de cada
  organização.
