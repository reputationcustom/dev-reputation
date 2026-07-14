---
tipo: glossary
atualizado: 2026-07-25
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
- **Nota de escopo**: ✅ **atualizada 2026-07-22** — convite de usuário e
  associação a organizações têm tela própria (admin-only), ver
  [auth/user-management.md](auth/user-management.md). Troca de organização
  ativa **existe** pela UI desde o Sprint 2 (seletor no header,
  `intelligence-center/executive-overview.md`, "Header") — o texto anterior
  desta nota ("continua fora do MVP") ficou desatualizado assim que esse
  seletor foi implementado e não foi corrigido até agora. Persistir qual
  organização é a **padrão** do usuário (reaberta ao carregar a aplicação,
  não só durante a sessão) também existe desde 2026-07-22 —
  `user_profiles.default_organization_id`, ver
  [auth/data-model.md](auth/data-model.md). Ainda **não** existe criação de
  organização pela UI — isso continua fora do MVP.

### User Profile
- **Definição**: Perfil de aplicação 1:1 com `auth.users` (Supabase Auth) —
  nome de exibição e o flag `is_admin` (administrador da plataforma,
  **global**, não por organização). Um dos perfis é `is_principal = true`
  (o admin fundador, `lidiane.carvalho@gmail.com`) — nunca pode ser
  excluído nem perder `is_admin`.
- **Sinônimos a evitar**: não confundir com `Entity` (pessoa/veículo/
  partido monitorado no debate público) — `User Profile` é sempre um
  usuário **do produto** (equipe da Lidi/cliente), nunca alguém sendo
  monitorado.
- **Tabela no banco**: `user_profiles`
- **Spec de dados**: [auth/data-model.md](auth/data-model.md)

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
- ✅ **Uma Organization está vinculada a 1 ou mais Queries** (confirmado
  2026-07-13), mas **Query é um detalhe técnico, nunca exposto ao usuário
  final** — pedido explícito: "o seletor de organização é independente de
  Query... as Queries devem ser transparentes para o usuário final, ele só
  entende organização". Vínculo organização↔Queries é resolvido no
  cadastro/configuração da organização (não pelo usuário em tempo de uso —
  ver `foundation/overview.md`). Quando uma organização tem mais de uma
  Query, a aplicação **combina os dados de todas automaticamente**: soma
  para métricas agregadas, união para listas (ex: tabela de Narrativas) —
  ver [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md).
  Internamente, todo dado por Narrativa (`narrative_metrics.query_id`,
  `sov_percent` etc.) continua calculado relativo à **sua própria** Query,
  nunca ao total combinado da organização — só não é algo que o usuário
  escolhe ou percebe.
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
  é sempre o Supabase. ✅ **Especificado (2026-07-13)** — catálogo **global**,
  compartilhado por toda a plataforma (sem `organization_id`), CRUD
  restrito a `is_admin` — ver [entities/overview.md](entities/overview.md).
  Cadastro **manual e curado**, distinto do ranking automático/exaustivo de
  autores nativo da Brandwatch (`bw_query_top_authors`) — ver
  [entities/author-linking.md](entities/author-linking.md).
- **Sinônimos a evitar**: **nunca usar "ator"/"actor"** no código, nas specs ou
  na UI — o termo fixado é "Entity"/"Entidade", porque o grafo inclui veículos
  de imprensa, partidos e instituições, não só pessoas.
- **Tabela no banco**: `entities` (contas por plataforma em `entity_accounts`)
- **Spec de dados**: [entities/data-model.md](entities/data-model.md)

### entity_tags (tag_type / tag_value)
- **Definição**: Classificação EAV (Entity-Attribute-Value) de uma Entity —
  cada dimensão de classificação (estado, instituição/braço de poder,
  postura em relação ao candidato etc.) é um par `tag_type`/`tag_value`.
  Uma **nova dimensão de classificação é um INSERT em `entity_tags`, nunca
  uma migration**. ⚠️ **Cargo, partido e ideologia não são mais
  `entity_tags` (2026-07-13)** — viraram colunas próprias de `entities`
  (`cargo`/`partido`/`ideologia`), pedido explícito do usuário; ver
  [entities/data-model.md](entities/data-model.md). Vocabulário sugerido
  do restante de `tag_type` (não enforçado) no mesmo arquivo.
- **Tabela no banco**: `entity_tags`
- **Spec de dados**: [entities/data-model.md](entities/data-model.md)

### Caso (Case)
- **Definição**: Ação/decisão de resposta vinculada a uma Narrativa — o que o
  time de comunicação está fazendo a respeito. ✅ **Simplificado 2026-07-13**:
  não é mais um "Command Center" (módulo removido, nunca teve spec própria
  além disso) — `cases` é dado próprio de `intelligence-center`, schema
  mínimo, somente leitura (ver "Ações e decisões" do detalhe de Narrativa).
  Checklist/comentários/arquivos/histórico de status/prioridade/nível de
  risco próprio **não existem ainda** — ficam para quando forem pedidos,
  não são schema atual.
- **Sinônimos a evitar**: termo de produto em português ("Caso"), mas tabela e
  colunas em inglês (`cases`, não `casos`) — mesma convenção aplicada a
  Narrativa/`narratives`.
- **Tabela no banco**: `cases` (schema mínimo atual: `title`, `status`,
  `narrative_id`, `assignee_id` — `references user_profiles(id)`, ver
  [auth/data-model.md](auth/data-model.md) —, `due_date`). Colunas
  `priority`/`risk_level`/`summary`/`next_action` e satélites
  (`case_checklist_items`, `case_comments`, `case_files`,
  `case_status_history`) são visão futura, não implementadas — ver tabela
  de renomeação do schema anexo em `_index.md` pra quando forem.
- **Spec de dados**: [intelligence-center/data-model.md](intelligence-center/data-model.md)

### Comunicação / Decisão (Communication / Decision)
- **Definição**: Registro de uma ação **já realizada**, vinculada a uma
  Narrativa, usado para medir se o sentimento/percepção pública em torno
  daquela Narrativa melhorou ou piorou depois (comparação antes/depois
  ancorada na data do registro) — ver
  [communications/overview.md](communications/overview.md), Sprint 2.1.
  Dois tipos (`communications.record_type`), mesma tabela: **Comunicação**
  (post no perfil do candidato, e-mail, propaganda de TV/rádio, nota de
  imprensa, material impresso, evento presencial etc. — campos completos)
  e **Decisão** (✅ adicionado 2026-07-25 — data, título, responsável,
  detalhamento; um subconjunto estrito dos campos de Comunicação).
- **Sinônimos a evitar**: não confundir com `Caso` (`cases`, abaixo) —
  Comunicação/Decisão são fatos consumados com CRUD completo pela UI desde
  o início; um Caso é uma tarefa com ciclo de vida (aberto→resolvido),
  hoje somente leitura. "Decisão" (este módulo) e `Caso` se sobrepõem
  conceitualmente mais do que "Comunicação" e `Caso` — mantidos separados
  por pedido explícito do usuário, não por ausência de sobreposição. Ver
  a tabela comparativa em [communications/overview.md](communications/overview.md),
  "Relação com `cases`".
- **Tabela no banco**: `communications` (`record_type` enum
  `communication`\|`decision`; `communication_type_id` → FK para
  `communication_types`, uma tabela de referência — não um enum — seed
  inicial: `social_post`\|`email`\|`tv_ad`\|`radio_ad`\|`press_release`\|
  `printed_material`\|`event`\|`other`, extensível por `INSERT`; `null`
  quando `record_type = 'decision'`)
- **Spec de dados**: [communications/data-model.md](communications/data-model.md)

### Feed Inteligente (Intelligent Feed)
- **Definição**: Stream de eventos do sistema — narrativa detectada, threshold
  disparado, caso criado/alterado, nota publicada, sentimento mudou, entidade
  nova detectada. **Não é** um feed de mentions brutas da Brandwatch.
  **Populado pelo módulo `event-radar`** (2026-07-12, ver `_index.md`
  "Fusão de módulos") — o motor de detecção/dedup/severidade/IA por evento
  que substitui o que `intelligent-feed` previa como módulo próprio.
- **Tabela no banco**: `feed_events` (`title`, `description`; enum
  `feed_event_type`: `narrative_detected`, `threshold_triggered`,
  `case_created`, `case_status_changed`, `note_published`,
  `sentiment_changed`, `new_entity_detected` — este último corrige uma
  violação da regra "nunca ator" que existia no schema anexo como
  `ator_novo_detectado`)
- **Spec de dados**: [event-radar/schema-integration.md](event-radar/schema-integration.md)

### Threshold
- **Definição**: Motor de risco próprio do produto (volume, percentual de
  aumento, ou % de sentimento negativo, numa janela de minutos), **independente**
  dos Custom Alerts nativos da Brandwatch. **Realizado pelo módulo
  `event-radar`** (2026-07-12, ver `_index.md` "Fusão de módulos") — motor
  de detecção por janelas de comparação + z-score, mais rigoroso que a
  configuração `threshold_configs`/`threshold_events` originalmente
  prevista; essas duas tabelas nunca chegaram a ser migradas e não fazem
  mais parte do plano — `event-radar` usa `radar_staging_events`
  (staging interno) e `feed_events` (saída pública) no lugar delas.
- **Tabela no banco**: `radar_staging_events` (staging, nunca lido pelo
  frontend — colunas `scope_type`/`scope_id`/`severity_score`/`severity`,
  ver [event-radar/detection-engine.md](event-radar/detection-engine.md) e
  [event-radar/severity.md](event-radar/severity.md)) → publica em
  `feed_events` (ver "Feed Inteligente" acima)
- **Spec de dados**: [event-radar/overview.md](event-radar/overview.md)

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
| Sentiment             | Classificação `positive`/`negative`/`neutral` de uma Mention (Brandwatch). Distinto de `net_sentiment` (score -100 a 100 da Narrativa/Query, ver abaixo). |
| Net Sentiment (`net_sentiment`) | Score de sentimento líquido -100 a 100, agregado oficial da Brandwatch (`data/netSentiment/...`) — não é um cálculo local. 7 faixas (muito positivo → muito negativo), ver `aggregated-metrics/sql-aggregation.md` "Scores de Narrativa" e `_design-tokens.md`. |
| Momentum / Tendência (`momentum_score`/`trend_score`) | Scores 0-100 calculados por `get_narratives_table()` (`aggregated-metrics/sql-aggregation.md`) — Momentum = força/relevância atual (volume+engajamento+autores+alcance, período selecionado); Tendência = tendência estatística de crescimento/queda (regressão linear sobre 14 dias, independente do período selecionado). Indicadores distintos por pedido explícito do usuário (2026-07-13). ✅ **Tendência substitui Velocidade (2026-07-22)** — mesmo pedido do usuário, mesma distinção de Momentum, só troca o método (regressão sobre 14 dias em vez de snapshot 3h-vs-3h) e o nome (`trend_score`/`trend_label`, não mais `velocity_score`/`velocity_label`) — não confundir um pelo outro. |
| Risco por Narrativa (`risk_score`) | Score 0-100 de prioridade operacional (`get_narratives_table()`), combina Sentimento/Momentum/Tendência/alcance/influência de autores/impacto — ver `aggregated-metrics/sql-aggregation.md`. **Não** é o "Reputation Score composto" descartado em `_index.md` ("Fora de escopo do MVP") — aquele era um score de reputação agregado por candidato/Entity ao longo de todas as Narrativas, ainda fora de escopo; `risk_score` é por Narrativa individual, para triagem operacional (ordenar a tabela por prioridade), escopo bem mais restrito. `narratives.risk_level` (enum `low`/`medium`/`high`/`critical`) continua no schema como override manual opcional, não é mais o que a UI mostra por padrão. |
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
