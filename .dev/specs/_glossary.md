---
tipo: glossary
atualizado: 2026-07-06
---

# Glossário de Domínio

Termos usados nas specs e no código. O Claude Code deve usar estes nomes
exatos em variáveis, componentes, tabelas e comentários.

## Entidades

### Organization
- **Definição**: Tenant do sistema (cliente da Lidi — ex: uma campanha, um
  cliente de reputation management). Toda tabela com dado de negócio é isolada
  por `organization_id`.
- **Tabela no banco**: `organizations`
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)

### Organization Member
- **Definição**: Associação entre um usuário (`auth.users`) e uma Organization
  — permite que **um usuário pertença a 1 ou mais organizações** (multi-tenant
  por associação, não por claim único no JWT). Todas as policies RLS de
  isolamento por organização resolvem as organizações do usuário através desta
  tabela (via função `auth_organization_ids()`), não mais via
  `app_metadata.organization_id` do JWT.
- **Tabela no banco**: `organization_members`
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)
- **Nota de escopo**: no MVP só a estrutura existe — sem tela/fluxo de convite
  ou gestão de organizações.

### Project
- **Definição**: Silo da Brandwatch que contém Queries, Tags e Categories.
  Espelhado (cache, só leitura) no Supabase — o sync nunca cria Projects.
- **Sinônimos a evitar**: "projeto" genérico de produto — sempre deixar claro
  que é o Project da Brandwatch quando ambíguo.
- **Tabela no banco**: `bw_projects`
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)

### Query
- **Definição**: Busca booleana da Brandwatch (`type: monitor`) ou Channel
  (`twitter`/`publicfacebook`/`instagram`) dentro de um Project.
- **Sinônimos a evitar**: "busca", "monitor" (usar "Query" mesmo em português).
- **Tabela no banco**: `bw_queries`
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)

### Query Group
- **Definição**: Coleção de Queries/Channels agregada para análise conjunta
  (ex: marca + concorrentes, para share of voice).
- **Tabela no banco**: `bw_query_groups`
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)

### Category
- **Definição**: Label hierárquica **da Brandwatch** (Category → Subcategories;
  toda Category tem ao menos 1 Subcategory). Criada manualmente na Brandwatch
  por um analista; o sync só lê (`rulecategories`), nunca cria. É um mero
  **espelho/cache** — não confundir com "Narrativa" (ver abaixo), que é o
  conceito de produto e passou a ser mais rico que uma Category.
- **Sinônimos a evitar**: não usar "tópico" ou "tema" para Category — esses
  termos são reservados para "Topics" (feature diferente da Brandwatch).
- **Tabela no banco**: `bw_categories` (auto-relacionamento via `parent_id`;
  `parent_id null` = Category raiz)
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)

### Narrativa (Narrative)
- **Definição**: Entidade viva e própria do produto (não uma classificação
  fixa) que representa um tema em monitoramento — com ciclo de vida
  (`stage`), nível de risco, sinais de detecção (palavras-chave, hashtags,
  handles, domínios) e métricas históricas de volume/sentimento/SOV, **com
  precedência para os números agregados oficiais da Brandwatch sobre soma
  local de mentions** (ver `Sampling` abaixo). **Substitui** a definição
  original ("Narrativa = Category") por um modelo mais rico: uma Narrativa
  **pode** estar ligada a uma Category da Brandwatch (`narratives.bw_category_id`,
  opcional — quando o analista já curou uma Category equivalente) e/ou ser
  definida por sinais próprios em `narrative_signals`, sem depender de a
  Brandwatch ter uma Category para aquele tema.
- **Sinônimos a evitar**: não usar "classificação" ou "tag" para Narrativa —
  ela é uma entidade de primeira classe, com identidade e histórico próprios.
  Termo de produto em português ("Narrativa"), mas **tabelas e colunas em
  inglês** (`narratives`, não `narrativas`) — convenção de nomenclatura do
  projeto a partir desta revisão (ver nota em `_index.md`).
- **Tabela no banco**: `narratives` (+ satélites `narrative_signals`,
  `narrative_tags`, `narrative_metrics`; `narrative_entities` e
  `narrative_relationships` ficam para os módulos `entities`/`propagation-graph`,
  ver [foundation/overview.md](foundation/overview.md))
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)

### Mention
- **Definição**: Um item de conteúdo individual (tweet, post, notícia, review)
  retornado por uma Query. Fonte de verdade é a Brandwatch; o Supabase mantém
  uma cópia sincronizada via polling (`sinceAdded` + buffer de 5min).
- **Tabela no banco**: `mentions` (particionada por mês, campo `added`)
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)

### Entity
- **Definição**: Qualquer pessoa, veículo de imprensa, partido, instituição,
  empresa ou movimento que participa do debate público monitorado. Cadastro
  próprio (Supabase), **não** a Brandwatch — fonte da verdade da classificação
  é sempre o Supabase.
- **Sinônimos a evitar**: **nunca usar "ator"/"actor"** no código, nas specs ou
  na UI — o termo fixado é "Entity"/"Entidade", porque o grafo inclui veículos
  de imprensa, partidos e instituições, não só pessoas.
- **Tabela no banco**: `entities` (contas por plataforma em `entity_accounts`)
- **Spec de dados**: [entities/data-model.md](entities/data-model.md)

### entity_tags (tag_type / tag_value)
- **Definição**: Classificação EAV (Entity-Attribute-Value) de uma Entity —
  cada dimensão de classificação (partido, espectro político, cargo, estado,
  instituição/braço de poder etc.) é um par `tag_type`/`tag_value`. Uma **nova
  dimensão de classificação é um INSERT em `entity_tags`, nunca uma
  migration**.
- **Tabela no banco**: `entity_tags`
- **Spec de dados**: [entities/data-model.md](entities/data-model.md)

### Caso (Case)
- **Definição**: Unidade operacional do Command Center — uma narrativa (ou
  situação) que virou operação de resposta, com responsável, prazo, checklist,
  comentários e nível de risco. Pode estar vinculado a 0 ou 1 Category/Narrativa
  Brandwatch.
- **Sinônimos a evitar**: termo de produto em português ("Caso"), mas tabela e
  colunas em inglês (`cases`, não `casos`) — mesma convenção aplicada a
  Narrativa/`narratives`.
- **Tabela no banco**: `cases` (`title`, `status`, `priority`, `risk_level`,
  `assignee_id`, `due_date`, `summary`, `next_action`; satélites:
  `case_checklist_items` [`description`, `completed`, `position`],
  `case_comments` [`author_id`, `content`], `case_files` [`file_name`,
  `storage_path`], `case_status_history` [`previous_status`, `new_status`,
  `changed_by`, `changed_at`])
- **Spec de dados**: [command-center/data-model.md](command-center/data-model.md)

### Feed Inteligente (Intelligent Feed)
- **Definição**: Stream de eventos do sistema — narrativa detectada, threshold
  disparado, caso criado/alterado, nota publicada, sentimento mudou, entidade
  nova detectada. **Não é** um feed de mentions brutas da Brandwatch.
- **Tabela no banco**: `feed_events` (`title`, `description`; enum
  `feed_event_type`: `narrative_detected`, `threshold_triggered`,
  `case_created`, `case_status_changed`, `note_published`,
  `sentiment_changed`, `new_entity_detected` — este último corrige uma
  violação da regra "nunca ator" que existia no schema anexo como
  `ator_novo_detectado`)
- **Spec de dados**: [intelligent-feed/data-model.md](intelligent-feed/data-model.md)

### Threshold
- **Definição**: Motor de risco próprio do produto (volume, percentual de
  aumento, ou % de sentimento negativo, numa janela de minutos), **independente**
  dos Custom Alerts nativos da Brandwatch.
- **Tabela no banco**: `threshold_configs` (config: `type`, `value`,
  `window_minutes`, `active`) / `threshold_events` (disparos:
  `observed_value`, `triggered_at`, `resolved`)
- **Spec de dados**: [threshold-engine/data-model.md](threshold-engine/data-model.md)

### Generated Report
- **Definição**: Relatório executivo gerado periodicamente (diário, semanal,
  mensal, executivo, crise), com arquivo armazenado no Supabase Storage.
- **Tabela no banco**: `reports_generated` (`type`, `period_start`,
  `period_end`, `storage_path`, `generated_by`, `generated_at`)
- **Spec de dados**: [executive-reports/data-model.md](executive-reports/data-model.md)

### Sinal de Narrativa (Narrative Signal)
- **Definição**: Evidência bruta usada para detectar/alimentar uma Narrativa —
  palavra-chave, hashtag, handle de autor, domínio, URL, ou vínculo com uma
  Category/Query já existente na Brandwatch. Uma Narrativa pode ter vários
  sinais; sinal isolado não é uma Narrativa.
- **Tabela no banco**: `narrative_signals` (`signal_type`/`signal_value`, EAV —
  mesmo padrão de `entity_tags`)
- **Spec de dados**: [foundation/data-model.md](foundation/data-model.md)

### Sampling (amostragem de mentions)
- **Definição**: Em Queries de altíssimo volume (casa dos milhões de
  mentions/mês — nosso caso), a Brandwatch só disponibiliza uma **amostra**
  das mentions **individuais** via `data/mentions` (campo `sampled`/
  `samplePercentage` na Query — ex: ~12% em volumes muito altos). **Os
  indicadores agregados (`data/{aggregate}/{dimension}`, `data/mentions/count`,
  Analysis API) refletem o volume total contratado, não a amostra.**
  Consequência direta para o produto: números de topo (total de mentions,
  tendência, SOV) vêm dos agregados da Brandwatch, nunca de somar mentions
  sincronizadas localmente — ver skill `brandwatch-api`
  (`references/queries-and-projects.md`, `references/analysis-api.md`) e
  [foundation/overview.md](foundation/overview.md).

## Termos de negócio

| Termo                | Definição                                                                 |
|-----------------------|----------------------------------------------------------------------------|
| Sentiment             | Classificação `positive`/`negative`/`neutral` de uma Mention (Brandwatch). |
| Risco (`risk_level`) | Nível categórico simples do Caso/Narrativa: `low`/`medium`/`high`/`critical`. **Não** confundir com um "Reputation Score" composto — isso está fora do escopo do MVP. |
| Share of Voice (Query Group) | Comparação de volume entre Queries de um Query Group (ex: candidato vs. concorrentes) — vem direto da Brandwatch (`data/volume/queries/weeks?queryGroupId=...`), incl. `reach_estimate` desde 2026-07-11. |
| Share of Voice (Narrativa) | Menções da Narrativa ÷ total de menções de **todas as Narrativas da mesma Query** (candidato/monitoramento) no mesmo período — ex: 200 mil menções totais, Saúde 40%/Educação 22%/Segurança 18%/Economia 12%/Mobilidade 8%. ⚠️ **Corrigido 2026-07-11** (bug real: agrupava por `organization_id` inteira, misturando Narrativas de candidatos/Queries diferentes quando o Project tem mais de uma Query) — agora agrupado por `query_id` via `narrative_metrics.query_id`. **Não** é a mesma coisa que o Share of Voice de Query Group acima; ver [foundation/data-model.md](foundation/data-model.md) "Camada de reporting". |
| Share of Voice (plataforma) | Participação de uma Narrativa dentro de uma plataforma específica, ou mix de plataformas dentro de uma Narrativa — via `bw_query_metrics_daily_by_platform.category_id` (adicionado 2026-07-11). |
| Share of Voice (autor) | Participação de um autor no total de menções de uma Query/Narrativa — `bw_query_top_authors.volume` ÷ `bw_query_metrics_daily.total_mentions` (mesmo Query/Category/período); razão calculada na camada de consumo, sem tabela própria. |
| Compliance eleitoral  | Guardrails de conteúdo/auditoria de IA sobre mentions relacionadas a candidatos/eleições — responsabilidade da aplicação, não da API da Brandwatch. |

## Abreviações usadas nas specs

| Abrev. | Significado                     |
|--------|----------------------------------|
| RLS    | Row Level Security               |
| EAV    | Entity-Attribute-Value            |
| BW     | Brandwatch                        |
| SoV    | Share of Voice                    |
