---
tipo: data-model
módulo: event-radar
status: rascunho
atualizado: 2026-07-25
---

# Modelo de Dados — Radar de Eventos

> ✅ **Criado 2026-07-25**, numa sessão de revisão de coerência da
> documentação deste módulo (pedido do usuário: "revise a documentação do
> módulo event-radar e verifique se está coerente e conciso com tudo que já
> foi desenvolvido... se houver pendências vamos resolvê-las"). Até aqui,
> `event-radar` era o único módulo do projeto sem um `data-model.md`
> dedicado — as colunas de `radar_staging_events` estavam espalhadas entre
> `detection-engine.md` (colunas base), `deduplication-grouping.md`
> (`closed_at`) e `severity.md` (`severity_score`/`severity`), e o schema de
> saída em `feed_events` nunca tinha sido reconciliado contra o que
> `standard-json-envelope.md`'s bloco `highlights` já espera ler (`event_type`
> granular, `summary`, `explanation`, `recommendation`, `confidence`, `tags`,
> `related_narrative_id`/`related_entity_id`) — um gap real de schema, não
> só de organização de arquivo. Este arquivo consolida os dois, sem mudar
> nenhuma decisão de negócio já tomada nos outros specs do módulo — é
> puramente a tradução delas em colunas/tabelas concretas. Ainda **sem
> migration** (módulo `rascunho`, Sprint 3, não iniciado).

## Entidades

### `radar_staging_events`

Staging interno do motor de detecção (etapa 1.1) — **nunca lido pelo frontend**, só por
`deduplication-grouping` (1.2), `severity` (1.3) e `agent-orchestrator` (1.4). Ver
`detection-engine.md`, `deduplication-grouping.md`, `severity.md`.

| Campo               | Tipo             | Obrigatório | Descrição |
|----------------------|------------------|-------------|-----------|
| `id`                 | `uuid`           | sim | PK |
| `organization_id`    | `uuid`           | sim | FK → `organizations(id)` ON DELETE CASCADE |
| `scope_type`         | `text`           | sim | `query`\|`narrative`\|`platform` (ver `detection-engine.md`, "Escopo do evento") — **nunca** `entity_type`, termo reservado para `entities` |
| `scope_id`           | `text`           | sim | Polimórfico conforme `scope_type` — `bw_queries.id`/`narratives.id` (uuid como texto) ou `bw_query_metrics_daily_by_platform.page_type` (texto nativo). Sem FK única possível por ser polimórfico; validado em código, não em constraint |
| `event_type`         | `text`           | sim | Rótulo livre da regra que disparou — ex: `volume_spike`, `volume_drop`, `sentiment_change`, `negative_sentiment_increase`, `negative_sentiment_spike` (ver `detection-engine.md`, "Regras de negócio"). **Este é o campo que popula `event_type` do bloco `highlights` do envelope** (ver "Propagação para `feed_events`" abaixo) |
| `window`             | `text`           | sim | Qual das 5 janelas de `detection-engine.md` disparou — `3h`\|`24h`\|`today_vs_last_week`\|`current_hour_vs_4week_avg`\|`3d` |
| `metric_value`       | `numeric`        | sim | Valor observado na janela atual |
| `comparison_value`   | `numeric`        | sim | Valor da janela de comparação |
| `delta_pct`          | `numeric`        | não | Variação percentual, quando a regra for desse tipo |
| `z_score`            | `numeric`        | não | Quando a regra for z-score (≥2 atenção, ≥3 relevante) |
| `detected_at`        | `timestamptz`    | sim | Quando o motor de detecção (1.1) gravou esta linha |
| `severity_score`     | `numeric`        | não | 0-100, preenchido pela etapa 1.3 (`severity.md`) — `null` até essa etapa rodar |
| `severity`           | `risk_level`     | não | `low`\|`medium`\|`high`\|`critical`, mesmo enum de `narratives.risk_level` — preenchido pela etapa 1.3 |
| `closed_at`          | `timestamptz`    | não | Preenchido pela etapa 1.2 quando o indicador volta ao normal e a regra deixa de disparar — evento deixa de ser "ativo" (ver `deduplication-grouping.md`) |
| `created_at`/`updated_at` | `timestamptz` | sim | Padrão (`set_updated_at`) |

**Índices**: unique parcial em `(organization_id, scope_type, scope_id, event_type, window) WHERE closed_at IS NULL` —
é a "chave de dedup para eventos com status ativo" que `deduplication-grouping.md` exige; um evento
fechado (`closed_at` preenchido) não conta para o unique, permitindo reabrir a mesma combinação no
futuro como uma linha nova.

**Políticas RLS**: `radar_staging_events: sem acesso direto` (deny-all, `for all using (false)`) —
mesmo padrão de `sync_cursors`/`bw_sync_lock`/`sync_log` (ver `CLAUDE.md`, "Database security",
regra 3): staging interno, só `SUPABASE_SECRET_KEY` (as próprias Edge Functions do radar) acessa.

### `feed_events` — colunas específicas de `event-radar`

`feed_events` é uma tabela compartilhada (`_glossary.md`, "Feed Inteligente") — outros produtores
além do radar já são citados no enum `feed_event_type` (`case_created`, `case_status_changed`,
`note_published`, `new_entity_detected`, ver `_glossary.md`). Esta seção documenta só a parte
relevante para `event-radar`, que é quem define o schema completo pela primeira vez (nenhum outro
módulo tem `data-model.md` gravando nela ainda).

| Campo                  | Tipo               | Obrigatório | Descrição |
|--------------------------|---------------------|-------------|-----------|
| `id`                     | `uuid`              | sim | PK |
| `organization_id`        | `uuid`              | sim | FK → `organizations(id)` ON DELETE CASCADE |
| `type`                   | `feed_event_type`   | sim | Enum já reservado em `_glossary.md` — para eventos de origem `event-radar`, o motor escolhe o valor mais próximo da **categoria** da regra: `threshold_triggered` para regras de volume (`volume_spike`/`volume_drop`/z-score), `sentiment_changed` para regras de sentimento (`sentiment_change`/`negative_sentiment_increase`/`negative_sentiment_spike`). **Não** um valor novo por regra — o enum é deliberadamente grosso, a granularidade real mora em `event_type` (abaixo) |
| `event_type`             | `text`              | não | ✅ **Coluna nova, resolve a ambiguidade encontrada nesta revisão**: copia literalmente `radar_staging_events.event_type` (o rótulo granular da regra — `volume_spike`, `sentiment_change` etc.) — é o que o bloco `highlights` do envelope lê para diferenciar ícone/rótulo por tipo de evento (`standard-json-envelope.md`). `null` para eventos de origem não-radar (`case_created`/`note_published`/etc.), que não têm essa granularidade |
| `severity`               | `risk_level`        | não | Copiado de `radar_staging_events.severity` no momento da publicação — `null` para eventos de origem não-radar |
| `severity_score`         | `numeric`           | não | Copiado de `radar_staging_events.severity_score` — mesma ressalva acima |
| `title`                  | `text`              | sim | ≤ 90 caracteres (`agent-orchestrator.md`, schema de saída) |
| `description`            | `text`              | sim | Nome de coluna já reservado em `_glossary.md` (`titulo`→`title`, `descricao`→`description`) — guarda o `explanation` do agent (texto mais longo, causa provável etc.) |
| `summary`                | `text`              | sim | ≤ 300 caracteres — resumo curto, campo próprio (distinto de `description`/`explanation`) |
| `recommendation`         | `text`              | não | Ação sugerida, quando aplicável |
| `confidence`             | `numeric`           | não | 0-1, confiança da IA — `null` para eventos de origem não-radar |
| `tags`                   | `text[]`            | não | Tags livres de busca/filtro |
| `related_narrative_id`   | `uuid`              | não | FK → `narratives(id)` ON DELETE SET NULL — preenchido quando `scope_type = 'narrative'` |
| `related_entity_id`      | `uuid`              | não | Sem FK ainda (`entities`, Sprint 2, ainda `rascunho`) — nullable, ligado quando `entities` existir |
| `closed_at`              | `timestamptz`       | não | Espelha `radar_staging_events.closed_at`, para o card sumir do bloco `highlights` quando o evento correspondente for encerrado |
| `created_at`/`updated_at`| `timestamptz`       | sim | Padrão (`set_updated_at`) |

**Políticas RLS**: `feed_events_select_org` — leitura para `authenticated` escopada por
`organization_id in (select auth_organization_ids())` (é assim que `get_active_highlights`,
chamada pelas Edge Functions `get-page-*` com o JWT do usuário — não a chave secreta, ver
`aggregated-metrics/edge-functions-per-page.md` — consegue ler sem bypassar RLS). Sem policy de
INSERT/UPDATE/DELETE para `authenticated` — só `SUPABASE_SECRET_KEY` (a Edge Function do
orquestrador, 1.4/1.5) escreve, mesmo padrão de toda tabela gravada exclusivamente por job de
backend neste projeto (ex: `bw_query_metrics_daily`).

### `feed_event_feedback`

Feedback do analista sobre um card já publicado (`schema-integration.md`, item 4) — tabela nova,
nome não definido em nenhum spec anterior até esta revisão.

| Campo             | Tipo          | Obrigatório | Descrição |
|--------------------|---------------|-------------|-----------|
| `id`               | `uuid`        | sim | PK |
| `feed_event_id`    | `uuid`        | sim | FK → `feed_events(id)` ON DELETE CASCADE |
| `user_id`          | `uuid`        | sim | FK → `user_profiles(id)` — nunca `auth.users` direto (convenção do projeto, ver `_index.md`, "Entidades principais") |
| `feedback_type`    | `text`        | sim | `useful`\|`irrelevant`\|`wrong_severity`\|`wrong_explanation` (CHECK constraint, não enum Postgres — mesma razão de extensibilidade já usada em `communication_types`: adicionar um tipo de feedback novo deve ser possível sem migration) |
| `comment`          | `text`        | não | Comentário livre opcional |
| `created_at`/`updated_at` | `timestamptz` | sim | Padrão (`set_updated_at`) |

**Políticas RLS**: `feed_event_feedback_org_isolation` — via subquery no FK pai
(`feed_event_id in (select id from feed_events where organization_id in (select
auth_organization_ids()))`), mesmo padrão de satélites sem `organization_id` própria
(`bw_query_top_authors` etc.). Qualquer usuário autenticado da organização pode inserir seu
próprio feedback (`user_id = auth.uid()`, resolvido via `user_profiles`); sem UPDATE/DELETE — um
feedback é um registro imutável.

## Dependências técnicas

- `organizations`, `narratives` (`foundation`) já existem.
- `user_profiles` (`auth`) já existe.
- `entities` (Sprint 2, ainda `rascunho`) — `feed_events.related_entity_id` fica sem FK até essa
  tabela existir; não bloqueia o resto deste modelo.
- Enum `risk_level` já existe no schema (usado por `narratives.risk_level`) — reaproveitado aqui,
  não recriado.

## Referências relacionadas

- [overview.md](overview.md)
- [detection-engine.md](detection-engine.md)
- [deduplication-grouping.md](deduplication-grouping.md)
- [severity.md](severity.md)
- [agent-orchestrator.md](agent-orchestrator.md)
- [schema-integration.md](schema-integration.md)
- [../aggregated-metrics/standard-json-envelope.md](../aggregated-metrics/standard-json-envelope.md)
- [../_glossary.md](../_glossary.md)
