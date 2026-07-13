---
tipo: module-overview
módulo: foundation
status: implementado
atualizado: 2026-07-14
---

# Módulo: Fundação (Sprint 1)

> ✅ **Status corrigido 2026-07-14** (premissa do projeto: spec concluída
> deve ficar `implementado`, ver CLAUDE.md "Close the loop"): este arquivo
> ficava `pronto` mesmo com o módulo inteiro em produção desde
> 2026-07-07/13 — defasagem de tracking, não do código. `sync-brandwatch`
> está rodando via `pg_cron` (heartbeat 15min), `narratives` auto-semeadas
> e com métricas agendadas — ver `CLAUDE.md`, "Brandwatch sync model", para
> o histórico completo de implementação/bugs corrigidos.

## Objetivo

> ✅ **Escopo de Sprint confirmado (2026-07-10)**: Sprint 1 é **inteiramente**
> a integração com a Brandwatch (sync serial+rate-limited pra Supabase) —
> nenhuma UI. `sync-brandwatch` e `narratives` (a base de dados + a lógica
> de agregação) são Sprint 1; toda a interface web ("a interface web com os
> gráficos", incluindo a tela de entrada pós-login) é Sprint 2 e vive
> inteira em `intelligence-center` — ver "✅ Executive Overview movida para
> `intelligence-center`" abaixo.

Estabelecer a base de dados sincronizada da Brandwatch no Supabase — todo o
dado que qualquer tela ou módulo futuro (`intelligence-center` no Sprint 2,
incl. `cases`; `entities`, `event-radar`... nos Sprints seguintes) vai
precisar pra operar. Nenhum desses tem dado sem este módulo — é a fundação
literal do produto.

> ✅ **Executive Overview movida para `intelligence-center` (2026-07-12)**:
> a spec da tela pós-login (`executive-overview.md`) vivia aqui apesar de
> `foundation` ser, por definição, só backend — conflitava com
> `aggregated-metrics/overview.md`, que já listava `/overview` como página
> de `intelligence-center` como as demais. Movida para
> [../intelligence-center/executive-overview.md](../intelligence-center/executive-overview.md),
> que agora é a versão única e confiável dessa spec. `foundation` continua
> dono só dos dados que ela lê — nada mudou de schema.

## Funcionalidades

| Funcionalidade      | Descrição resumida                                                        | Sprint | Status implementação | Spec |
|----------------------|------------------------------------------------------------------------------|--------|----|------|
| `sync-brandwatch`    | Edge Function que sincroniza projects/queries/query-groups/categories/mentions/métricas (diária/semanal/mensal, plataforma, temas, top autores, SOV) da Brandwatch para o Supabase | 1 | **implementado** (ver `CLAUDE.md` "Brandwatch sync model" pro estado atual completo — mentions, narrativas auto-criadas, métricas não-amostradas por Narrativa incluídas) | [sync-brandwatch.md](sync-brandwatch.md) |
| `narratives`         | Tabela de Narrativas como entidade viva (auto-criada a partir de Category, sinais, tags, métricas históricas incl. engajamento/reach/reposts/comments), priorizando agregados oficiais da Brandwatch sobre soma local de mentions | 1 | **implementado** | [narratives.md](narratives.md) |

## Dependências

- **Módulos que este depende**: nenhum — é a fundação.
- **Módulos que dependem deste**: `intelligence-center` (Sprint 2, primeira
  tela é `executive-overview.md` — lê direto do que este módulo sincroniza,
  sem lógica de negócio própria), `aggregated-metrics` (Sprint 2, camada de
  agregação que serve todas as páginas), `entities` (Sprint 2/3, usa
  `mentions.author` para o JOIN de enriquecimento), `cases`
  (`intelligence-center/data-model.md`, `narrative_id` referencia
  `narratives`), `event-radar` (Sprint
  3, consome os agregados oficiais já sincronizados — nunca `mentions` cru,
  ver `event-radar/detection-engine.md`).

## Rotas/Páginas

Este módulo não tem rotas próprias — é só backend (ver nota acima). A tela
que consome estes dados (`/overview`) é especificada e implementada em
[../intelligence-center/executive-overview.md](../intelligence-center/executive-overview.md).

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
> por isso seguros para sinais/métricas: `domain`, `author`/
> `author_handle_normalized` (já existe como coluna gerada em `mentions`),
> `category_ids`, `language`, `country_code`, `page_type`. Sinais de
> `signal_type = 'author_handle'` (renomeado de `actor` na proposta original)
> usam diretamente `author_handle_normalized`, que já tem índice.
>
> ✅ **Resolvido (2026-07-13)**: extração de hashtag como campo estruturado
> próprio existe, sim — `mentions.insights_hashtag text[]` (campo nativo
> `insightsHashtag`, adicionado em `20260710010000`, confirmado contra
> `mention-metadata-field-definitions`). Diferente dos campos da lista
> acima, **só está disponível pra X/Instagram** (não é um campo universal
> como `domain`/`author`) — sinais de `signal_type = 'hashtag'` em
> `narrative_signals` ficam restritos a mentions dessas duas fontes. A
> revisão que fechou esta pendência também encontrou um bug real na função
> que consome isso — ver `narrative_matched_mentions()` em
> `data-model.md`, corrigia contra `tag_names` (Tags da Brandwatch, campo
> errado) em vez de `insights_hashtag`.

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

> ✅ **`entities` especificado (2026-07-13)** — ver
> [entities/overview.md](../entities/overview.md)/[entities/data-model.md](../entities/data-model.md).
> `mentions.author_handle_normalized` → `entity_accounts.username` → `entities` → `entity_tags`
> confirmado exatamente como previsto acima (`entity_accounts.username`, mesmo nome de coluna já
> antecipado aqui). `narrative_entities` (cross-tab materializado) **não** entrou nesta rodada —
> deliberadamente fora de escopo (o pedido do usuário era o CRUD de Entidades + o vínculo com o
> ranking de Autores, não a otimização de relatório) — continua registrado aqui como recomendação
> para quando um relatório concreto precisar dela, ver `entities/overview.md`, "Notas para
> implementação".

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
- ✅ **Atualizado 2026-07-13**: convite de usuário e vínculo com 1+
  organizações agora têm tela própria, admin-only — ver
  [../auth/user-management.md](../auth/user-management.md). Troca de
  organização ativa também resolvida — seletor no header, ver
  `intelligence-center/executive-overview.md`, "Header"/"Fluxo principal"
  (RLS já garante o isolamento, o seletor só troca qual organização está
  "ativa" na sessão do frontend). Continua fora do MVP: criação de
  organização pela UI — segue manual/SQL direto.

> ✅ **Todos os 8 itens abaixo confirmados aplicados (2026-07-13)** — esta
> nota ficou marcada `⚠️ DECISÃO PENDENTE` desde a versão original do
> overview e nunca foi atualizada depois que a migration inicial
> (`20260707000000_foundation_schema.sql`) e as seguintes foram escritas.
> Revisão pedida pelo usuário ("O RLS do Supabase obrigatoriamente precisa
> respeitar user_id e organization_id... Reveja se a foundation também
> está atendendo a esse requisito") — conferido linha a linha contra as
> migrations reais, não só contra esta spec:
>
> 1. ✅ **RLS aplicada em todas as tabelas** — `organizations`,
>    `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories` (e
>    toda tabela de agregado criada depois: `bw_query_metrics_weekly`/
>    `monthly`, `bw_query_metrics_daily_by_platform`, `bw_query_topics`,
>    `bw_query_top_authors`/`top_tweeters`/`top_sites`/`top_shared_sites`,
>    `bw_query_author_topics`, `bw_query_x_insights`,
>    `bw_query_demographics_daily`) têm `ENABLE ROW LEVEL SECURITY` +
>    policy `org_isolation_*`.
> 2. ✅ `sync_cursors`/`sync_log`/`bw_sync_lock` têm RLS ativa, **sem**
>    nenhuma policy (deny-all) — só `SUPABASE_SECRET_KEY` acessa.
> 3. ✅ Toda policy usa `auth_organization_ids()` (`stable`/`security
>    definer`) — nenhuma tabela ficou com o padrão antigo de claim JWT.
> 4. ✅ Trigger `set_updated_at` existe (`20260707000000`) e é reusada por
>    toda tabela nova com coluna `updated_at` (`brandwatch_credentials`,
>    `narratives`, e agora também `user_profiles` em `auth/data-model.md`).
> 5. ✅ `narratives`/`narrative_signals`/`narrative_tags`/`narrative_metrics`
>    têm RLS + `org_isolation_*` desde a criação.
> 6. ✅ Schema `reporting` + role `bi_reader` criados na migration inicial.
> 7. ✅ `bw_query_metrics_daily` tem RLS + `org_isolation_bw_query_metrics_daily_select`
>    (não é tratada como tabela "interna only").
> 8. ✅ `narrative_matched_mentions(narrative_id)` existe em
>    `data-model.md` e é reusada por `refresh_narrative_metrics()` e por
>    todo consumidor de "quais mentions pertencem a esta Narrativa"
>    (`intelligence-center/narratives-exploration.md`, grafo simplificado).
>
> ⚠️ **Gap real diferente, encontrado na mesma revisão** (não é sobre
> `foundation` — é sobre como `aggregated-metrics` consome `foundation`):
> os Edge Functions `get-page-*` não podem usar `SUPABASE_SECRET_KEY` como
> o padrão do Princípio técnico 5 sugere, porque isso bypassa a RLS que
> este módulo cuidadosamente implementa — corrigido em
> [../aggregated-metrics/edge-functions-per-page.md](../aggregated-metrics/edge-functions-per-page.md),
> "Autenticação do client Supabase (exceção ao padrão)".

## Referências relacionadas

- [_index.md](../_index.md) — stack, princípios técnicos obrigatórios, mapa de módulos.
- [_glossary.md](../_glossary.md) — Project, Query, Query Group, Category/Narrativa, Mention.
- [brandwatch-setup.md](brandwatch-setup.md) — checklist de configuração
  manual na Brandwatch (Project, Queries, Query Groups, Categories) que
  precisa existir **antes** do primeiro `sync-brandwatch` de cada
  organização.
