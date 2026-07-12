---
tipo: index
projeto: Reputation OS
atualizado: 2026-07-11
---

# Reputation OS — Índice de Especificações

## Sobre o projeto

Plataforma de inteligência reputacional construída sobre a Brandwatch, para
campanhas políticas e reputation management no Brasil. Sincroniza dados da
Brandwatch (mentions, queries, narrativas) para um cadastro próprio de
Entidades, opera um Command Center de Casos, um motor de risco/threshold
próprio e um Feed Inteligente de eventos — tudo com a classificação de
entidades (partido, espectro, cargo, estado) mantida como fonte da verdade no
Supabase, não na Brandwatch.

## Stack

- **Frontend**: Next.js (App Router) + React + TypeScript + Tailwind CSS —
  deploy em **Hostinger** (servidor Node.js gerenciado via hPanel). **Não é
  Vercel** — nenhuma automação de backend (cron, jobs agendados) pode depender
  de Vercel Cron/Vercel Functions.
- **Backend/DB**: Supabase — Auth, PostgreSQL + Row Level Security, Storage,
  Realtime, Edge Functions (Deno). Todo job agendado (ex: sync da Brandwatch)
  roda como Edge Function acionada por `pg_cron`, nunca no processo Next.js.
- **Dados de terceiros**: Brandwatch Consumer Research API (`api.brandwatch.com`),
  rate limit de 30 chamadas/10min por Client, fila serial — ver skill
  `brandwatch-api`.
- **BI/Relatórios externos**: o modelo de dados precisa suportar consumo por
  ferramentas de BI de terceiros (Qlik Cloud, Power BI) e por ferramentas de
  relatório próprias, via conexão Postgres direta — ver Princípio técnico 6
  abaixo.

> Nota de nomenclatura (corrigida — vale para **todo** o schema, incluindo o
> anexo do Dia 1): tabelas, colunas, enums, funções e policies são **sempre em
> inglês**, sem exceção — o desenvolvimento ainda não começou, não existe
> schema "legado" a preservar. O termo de produto exibido ao usuário (rótulos
> de UI, textos) continua em português quando fizer sentido para o público
> (campanhas políticas brasileiras) — ex: tabela `narratives`, produto mostra
> "Narrativa"; tabela `cases`, produto mostra "Caso". A tradução entre os dois
> fica registrada em `_glossary.md`. Slugs de módulo em `.dev/specs/` também
> seguem inglês (`foundation`, não `fundacao`).
>
> **Tabela de renomeação do schema anexo (`20260706_reputation_os_schema.sql`)**
> — aplicar na migration real quando cada módulo gerar seu `data-model.md`:
>
> | Português (anexo) | Inglês (usar daqui em diante) |
> |---|---|
> | `casos` | `cases` |
> | `caso_checklist_items` | `case_checklist_items` |
> | `caso_comentarios` | `case_comments` (`autor_id`→`author_id`, `conteudo`→`content`) |
> | `caso_arquivos` | `case_files` (`nome_arquivo`→`file_name`) |
> | `caso_status_historico` | `case_status_history` (`status_anterior`→`previous_status`, `status_novo`→`new_status`, `alterado_por`→`changed_by`, `alterado_em`→`changed_at`) |
> | `caso_status` (enum) | `case_status` (`aberto\|em_andamento\|aguardando\|resolvido\|arquivado` → `open\|in_progress\|waiting\|resolved\|archived`) |
> | `caso_prioridade` (enum) | `case_priority` (`baixa\|media\|alta\|critica` → `low\|medium\|high\|critical`) |
> | `risco_nivel` (enum) | `risk_level` (`baixo\|medio\|alto\|critico` → `low\|medium\|high\|critical`) |
> | `threshold_tipo` (enum) | `threshold_type` (`volume\|percentual\|sentimento_negativo` → `volume\|percentage\|negative_sentiment`) |
> | `threshold_eventos` | `threshold_events` (`valor_observado`→`observed_value`, `disparado_em`→`triggered_at`, `resolvido`→`resolved`) |
> | `feed_eventos` | `feed_events` (`titulo`→`title`, `descricao`→`description`) |
> | `feed_evento_tipo` (enum) | `feed_event_type` — **inclui correção de outra violação da regra "nunca ator"**: `ator_novo_detectado` → `new_entity_detected` (os demais valores também traduzidos: `narrativa_detectada`→`narrative_detected`, `threshold_disparado`→`threshold_triggered`, `caso_criado`→`case_created`, `caso_status_alterado`→`case_status_changed`, `nota_publicada`→`note_published`, `sentimento_mudou`→`sentiment_changed`) |
> | `report_gerados` | `reports_generated` (`periodo_inicio`→`period_start`, `periodo_fim`→`period_end`, `gerado_por`→`generated_by`, `gerado_em`→`generated_at`) |
> | colunas `titulo`/`descricao`/`resumo`/`prioridade`/`prazo`/`responsavel_id`/`proxima_acao` em `cases` | `title`/`description`/`summary`/`priority`/`due_date`/`assignee_id`/`next_action` |
> | colunas `descricao`/`concluido`/`ordem` em `case_checklist_items` | `description`/`completed`/`position` |
>
> `entities`/`entity_accounts`/`entity_tags`, `mentions`, `organizations`,
> `brandwatch_credentials`, `bw_*`, `sync_cursors`, `sync_log`,
> `threshold_configs` (colunas `tipo`→`type`, `valor`→`value`,
> `janela_minutos`→`window_minutes`, `ativo`→`active`) já estavam em inglês ou
> são renomeadas na tabela acima — nada mais a ajustar fora dela.

> Nota de adaptação: a skill `web-app-structure` deste projeto assume
> Vite + React Router + Supabase client único. A stack real é Next.js — o
> espírito da skill (services puros → hooks → componentes burros, RLS sempre
> ativo, tipos gerados) é seguido, mas adaptado a convenções Next.js: roteamento
> por arquivo em `app/`, dois clients Supabase via `@supabase/ssr`
> (`lib/supabase/client.ts` browser e `lib/supabase/server.ts` server), e a
> nomenclatura de variáveis de ambiente descrita abaixo.

## Princípios técnicos obrigatórios

Valem para todo o projeto, em qualquer sprint. Qualquer spec ou código gerado
deve ser conferido contra esta lista antes de ser considerado pronto.

1. **Sem credenciais hard-coded**. Edge Functions leem segredos via
   `Deno.env.get('VAR_NAME')`; Next.js via `process.env.VAR_NAME`. O frontend só
   acessa variáveis prefixadas `NEXT_PUBLIC_`. Segredos (chave secreta do
   Supabase, tokens da Brandwatch, chaves de terceiros futuras) ficam
   exclusivamente nas Edge Functions — nunca no Next.js server nem no client.
2. **Sem lógica de negócio no frontend**. Validações e regras de negócio vivem
   em Edge Functions ou no Postgres (constraints/triggers/RLS). O Next.js cuida
   apenas de apresentação, formatação de exibição e navegação.
3. **Nomenclatura de chaves do Supabase**: Edge Functions usam a chave secreta
   (bypassa RLS) via `SUPABASE_SECRET_KEY`; o frontend usa apenas a chave
   publicável via `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Não usar a
   nomenclatura antiga `anon`/`service_role` em variáveis novas.
4. **Timestamps obrigatórios em toda tabela própria**: `created_at timestamptz
   not null default now()` e `updated_at timestamptz not null default now()`,
   mais uma trigger `set_updated_at` que mantenha `updated_at` atualizado em
   todo UPDATE.
5. **Edge Functions autossuficientes**. O Supabase SaaS não suporta um
   diretório `supabase/functions/_shared/` compartilhado entre funções em
   produção. Cada Edge Function é um módulo isolado — sem `import` relativo de
   `../_shared/`. Código comum é replicado por função ou importado via URL
   pública (`npm:`, `https://deno.land/x/`, `jsr:`). Padrão de client Supabase
   dentro de toda Edge Function:
   ```ts
   import { createClient } from 'npm:@supabase/supabase-js@2'
   const supabase = createClient(
     Deno.env.get('SUPABASE_URL')!,
     Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
   )
   ```
   Padrão de resposta CORS obrigatório em Edge Functions chamadas pelo
   frontend (não se aplica a funções só acionadas por `pg_cron`):
   ```ts
   const corsHeaders = {
     'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
   }
   if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
   ```
6. **Camada de reporting para BI externo (Qlik Cloud, Power BI, ferramentas
   próprias)**. Essas ferramentas conectam via **Postgres direto** (protocolo
   wire), não via PostgREST/Supabase client — então **RLS baseada em
   `auth.uid()`/`auth_organization_ids()` não se aplica** a essa conexão (não
   existe sessão de Supabase Auth numa conexão Postgres crua). Regras:
   - Nenhuma ferramenta de BI acessa as tabelas transacionais brutas
     diretamente. Toda exposição para BI passa por um **schema `reporting`**
     dedicado, com views read-only, nomes/colunas documentados
     (`comment on view/column`) e sem tipos `jsonb`/array crus (achatar em
     colunas ou linhas antes de expor).
   - `reporting` **não** entra na lista de schemas expostos por PostgREST do
     Supabase (`db.schemas`) — só é acessível via conexão Postgres direta, com
     um role dedicado (ex: `bi_reader`) com `GRANT SELECT` apenas nesse schema.
   - Conectar ferramentas de BI via **Session pooler (porta 5432)** ou conexão
     direta — **não** usar o Transaction pooler (porta 6543): várias
     ferramentas de BI dependem de recursos de sessão (prepared statements,
     `SET search_path`) incompatíveis com pooling em modo transaction.
   - ⚠️ DECISÃO PENDENTE: se o acesso de BI for por cliente final (cada
     organização com seu próprio Power BI/Qlik vendo só os dados dela), cada
     organização precisa de um role/credential próprio com a view já filtrada
     por `organization_id` — isso não está implementado no MVP. Por ora, a
     camada de reporting é de uso interno da Lidi (um único `bi_reader`
     vendo todas as organizações), documentado explicitamente para não ser
     confundido com acesso multi-tenant seguro.

## Módulos

> ✅ **Escopo de Sprint reconfirmado (2026-07-10)**: "Toda essa Sprint 1 que
> estamos [construindo] terá a integração com a Brandwatch. Sprint 2 será a
> interface web com os gráficos." Ou seja, Sprint 1 = **só** o backend de
> integração (`sync-brandwatch`/`narratives`, sem nenhuma UI própria);
> `executive-overview` (a primeira tela — volume/sentimento, Share of
> Voice, tabela de Narrativas) passa a ser a abertura de Sprint 2, junto
> com o restante da "interface web com os gráficos". Isso não move as
> specs de arquivo (continuam em `foundation/`, já que os dados que a tela
> consome são deste módulo) — só reatribui a coluna Sprint na tabela
> abaixo.

| Módulo                 | Descrição curta                                                              | Status geral | Sprint | Specs |
|-------------------------|-------------------------------------------------------------------------------|--------------|--------|-------|
| `foundation` (sync)     | Sync serial+rate-limited da Brandwatch → Supabase (`sync-brandwatch`, `narratives`) — **implementado**, ver `CLAUDE.md` | pronto | 1 | [foundation/overview.md](foundation/overview.md) |
| `foundation` (UI)       | Executive Overview — primeira tela web (gráficos de volume/sentimento, Share of Voice, tabela de Narrativas) | rascunho — não iniciado | 2 | [foundation/executive-overview.md](foundation/executive-overview.md) |
| `entities`              | Cadastro Nacional de Entidades (EAV via entity_tags) + enriquecimento de mentions | rascunho | 2      | — |
| `command-center`        | CRUD de Casos (`cases`), checklist, comentários, arquivos, histórico de status | rascunho     | 2      | [command-center/overview.md](command-center/overview.md) |
| `intelligence-center`   | Exploração de narrativas/mentions com filtros + enriquecimento de entidades  | rascunho     | 2      | [intelligence-center/overview.md](intelligence-center/overview.md) |
| `threshold-engine`      | Motor de risco próprio (volume/percentual/sentimento negativo)               | rascunho     | 3      | — |
| `intelligent-feed`      | Feed de eventos do sistema (`feed_events`: narrativas, thresholds, casos, sentimento) | rascunho | 3 | — |
| `propagation-graph`     | Grafo de propagação de narrativas (arestas por mention + rollup materializado) | rascunho   | 3      | — |
| `decision-center`       | AI Advisors sobre mentions/narrativas, respeitando data-restrictions          | rascunho     | 3      | — |
| `executive-reports`     | Geração de relatórios periódicos (`reports_generated`: diário/semanal/mensal/executivo/crise) | rascunho | 4 | — |

> **Escopo de dados do `foundation` (sync), confirmado e ampliado em
> 2026-07-10**: cobre **todo** o dado de leitura (pull) da Brandwatch que
> Sprint 2 (UI) e os módulos dos Sprints seguintes precisam. Cobertura
> hoje em `bw-sync` (ver `CLAUDE.md` "Brandwatch sync model" pro detalhe
> completo, este é só o resumo):
> - Metadata: `bw_projects`/`bw_queries`/`bw_query_groups`/`bw_categories`.
> - `mentions`: polling paginado (walk ascendente desde
>   `BRANDWATCH_MENTIONS_START_DATE`, resumo rastreado via
>   `sync_cursors.backfill_completed_at`), com campos enriquecidos
>   (gender/geo/pageType→contentSource/language/impressions/impact/
>   classifications+emotion/hashtags/@mentions/reply-retweet/engagement por
>   plataforma).
> - `narratives`: auto-criadas a partir de Category de topo
>   (`ensureNarrativesFromCategories`), com `narrative_metrics` agendada via
>   `pg_cron` incluindo `engagement_total`/`repost_count`/`comment_count` —
>   sentimento/volume/reach/engagement vêm de agregados oficiais não
>   amostrados quando a Narrativa tem `bw_category_id` (a maioria hoje);
>   `unique_authors`/`top_domain`/repost/comment continuam agregação local
>   (sem alternativa oficial da Brandwatch pra esses, quebrados por
>   Category).
> - Agregados oficiais (sampling-safe): `bw_query_metrics_daily`/`weekly`/
>   `monthly` (sentiment/volume + `reach_estimate`/`engagement_score` por
>   Category), `bw_query_metrics_daily_by_platform` (breakdown por
>   plataforma), `bw_query_group_metrics_weekly` (Share of Voice + reach por
>   candidato dentro do Query Group), `bw_query_topics` (temas/hashtags/
>   entidades com sentimento, via `data/topics` — o mecanismo mais próximo
>   de "clusterização" que a API padrão oferece, incl. série diária/
>   breakdown por canal por tópico), `bw_query_top_authors` (ranking de
>   autores por Query e por Narrativa, não amostrado, incl. `tweets`/
>   `retweets`/`account_type`/país/`impressions` por autor),
>   `bw_query_author_topics` (temas por autor via `data/topics?author=`),
>   `bw_query_x_insights` (hashtags/emojis/URLs/autores citados específicos
>   de X com sentimento próprio, via os 4 endpoints de "X (Twitter)
>   Insights"), `bw_query_demographics_daily` (gender/tipo de conta/
>   interesse/profissão — só X — e localização, via dimensões de chart
>   oficiais não amostradas), `bw_query_top_sites` (ranking de domínios/
>   sites, via `data/volume/topsites/queries`). Todos ✅ implementados —
>   os últimos 5 (`bw_query_author_topics` em diante) foram priorizados em
>   2026-07-11 depois de validar o modelo de dados contra um export real de
>   dashboard Brandwatch (ver `sync-brandwatch.md`, "Validação contra
>   dashboard real", inclusive o achado de que o painel "Iris detected N
>   peaks" — picos de volume com driver nomeado — **não tem endpoint
>   público**, é recurso só do dashboard BWX, não replicável via API).
>
> Isso já cobre o que `entities` (via `mentions.author`),
> `threshold-engine`/`intelligent-feed` (via `mentions`/`bw_categories`/
> métricas) e `propagation-graph` (via `mentions.raw` — os campos de
> relacionamento `insightsMentioned`/`replyTo`/`retweetOf` já têm coluna
> tipada própria desde 2026-07-10, não só jsonb bruto) vão precisar ler.
> Três tipos de dado da Brandwatch continuam **fora** do `foundation` por
> decisão explícita, não por esquecimento — ver seção seguinte.

> ✅ **`intelligence-center` ganha specs, todas `status: pronto`
> (2026-07-12)**: a partir do protótipo de frontend "Comunicação
> Inteligente" (claude.ai/design, importado via MCP) e do documento de
> estrutura recomendada que o acompanha, foram escritas 4 specs de página
> em [intelligence-center/overview.md](intelligence-center/overview.md)
> (Exploração de Narrativas, Análise de Sentimento, Análise por Plataforma,
> Pautas Eleitorais). Primeira leva de revisão encontrou várias métricas do
> desenho sem agregado oficial aparente (Autores únicos, sentimento/
> engajamento/autores por plataforma, sentimento por localização) — o
> usuário pediu para **rever a captura antes de aceitar omitir** qualquer
> uma; pesquisa mais a fundo contra `chart-dimensions-and-aggregates`
> encontrou fonte oficial pra praticamente todas (aggregates `authors`/
> `netSentiment`, antes não usados neste projeto — ver
> `foundation/data-model.md` e migration `20260712020000`). Mesmo
> levantamento encontrou e corrigiu um bug real: `reach_estimate`/
> `engagement_score` nunca tinham sido populados pra `category_id is null`
> (Query inteira) em `bw_query_metrics_daily` — os cards do Executive
> Overview que leem essa linha estavam sempre vazios nesses 2 campos.
> Achado relevante, sem relação com dado: **"Pautas Eleitorais" não é uma
> entidade nova** — os exemplos do documento (Educação, Saúde,
> Segurança...) são os mesmos nomes já usados como Narrativa de topo no
> protótipo; "Pauta" = `narratives` ligada a uma `bw_categories` raiz, e a
> "Narrativa dentro da pauta" do desenho = Subcategory — confirmado pelo
> usuário (2026-07-12) que Subcategories devem virar `narratives`
> automaticamente também, não só Categories de topo;
> `ensureNarrativesFromCategories()` em `bw-sync/index.ts` foi alterada
> nesse sentido. "Ações e decisões" do detalhe de Narrativa depende do
> módulo `command-center`, que ganhou sua primeira spec
> ([command-center/overview.md](command-center/overview.md)) detalhando o
> que falta (schema de `cases`, vínculo com `narratives`, tabela de perfil
> de usuário para `assignee_id`) — ainda `rascunho`, não bloqueia o resto
> de `intelligence-center`. Do mesmo protótipo,
> [foundation/executive-overview.md](foundation/executive-overview.md)
> também foi revalidada (cards de topo, seletor de organização, rota de
> detalhe de Narrativa via modal/intercepting route).

## Entidades principais

- `Organization` (multi-tenancy) + `Organization Member` (associação
  usuário↔organização, N:N — um usuário pode pertencer a 1 ou mais
  organizações; ver [foundation/overview.md](foundation/overview.md)) → todos
  os módulos.
- `Mention`, `Query`, `Query Group`, `Category` (cache Brandwatch: `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`, `mentions`) → `foundation`.
- `Narrativa` (entidade viva própria do produto: `narratives`, `narrative_signals`, `narrative_tags`, `narrative_metrics`; opcionalmente ligada a uma `Category` via `bw_category_id`) → `foundation`. Satélites `narrative_entities` (Sprint 2, depende de `Entity`) e `narrative_relationships` (Sprint 3, grafo) ficam para depois.
- `Entity` / `entity_tags` (Cadastro Nacional de Entidades) → `entities`.
- `Caso` (`cases`) e satélites (`case_checklist_items`, `case_comments`, `case_files`, `case_status_history`) → `command-center`.
- `ThresholdConfig` / `ThresholdEvent` → `threshold-engine`.
- `FeedEvent` (`feed_events`) → `intelligent-feed`.
- `GeneratedReport` (`reports_generated`) → `executive-reports`.

## Fora de escopo do MVP (não implementar sem pedido explícito)

- Sincronizar `entity_tags` de volta como Author Lists na Brandwatch —
  reconfirmado em 2026-07-07 apesar de "trazer todos os dados da Brandwatch"
  ter sido pedido para `foundation`: Author/Site/Location Lists são um
  mecanismo de **push** (Lidi → Brandwatch), não pull, e dependem de
  `entities`/`entity_tags` (Sprint 2) como fonte — não há o que sincronizar
  ainda. Revisitar quando `entities` existir.
- Tags (`ruletags`) da Brandwatch — sem necessidade concreta antes do
  Command Center (Sprint 2, triagem de Casos); `brandwatch-setup.md` §6.
- Custom Alerts da Brandwatch — `threshold-engine` (Sprint 3) é o motor de
  risco próprio do produto, não depende de Custom Alerts nativos;
  `brandwatch-setup.md` §7.
- Reputation Score composto — usar apenas `risk_level` (low/medium/high/critical).
- **Clusterização semântica por IA e classificação de papel do autor**
  (Institucional/Imprensa/Apoiador/Crítico/Amplificador) — pedido em
  2026-07-10 a partir de um mockup de "Relatório de Insights"
  (`mockup_governo_sp_narrativas.pdf`) com clusters temáticos gerados por
  embeddings/HDBSCAN. Confirmado com o usuário: **não são dados da
  Brandwatch** — ficam fora de `foundation`/`bw-sync`, viram gap
  documentado pra um módulo futuro (candidato natural: `executive-reports`,
  Sprint 4, já que a prosa/síntese do relatório é geração de conteúdo, não
  sync de dados). `foundation` cobre só a captura de dados brutos que esse
  módulo futuro vai precisar (mentions enriquecidas, `bw_query_topics`,
  `bw_query_top_authors`, `bw_query_author_topics`, `bw_query_x_insights`,
  `bw_query_demographics_daily`, `bw_query_top_sites` — ver `data-model.md`
  §5). ⚠️ `bw_query_topics.daily_series`/`page_type_breakdown` ainda sem
  migration própria.
  **Investigação sobre "Iris"** (a IA da Brandwatch — teria uma API
  própria que resolvesse isso?): pesquisa direta em
  `developers.brandwatch.com` (índice `llms.txt` + páginas individuais)
  confirmou que **não existe uma "Iris API" separada** — Iris é a camada de
  IA que já alimenta as APIs padrão (Consumer Research, Analysis, Data
  Upload, Measure), sem endpoint que devolva narrativas prontas ou papel de
  autor. `data/topics` (Consumer Research API) é o mecanismo mais próximo
  de tematização automática disponível hoje — ver `sync-brandwatch.md`
  passo 6.4.
- ✅ **Impressões por autor e temas por autor (X) — conclusão revertida
  2026-07-11, mesmo dia**: a primeira leitura (linha acima nesta mesma
  revisão) tinha concluído "sem fonte oficial" — **corrigido** após
  pesquisa mais a fundo, a pedido do usuário ("incluir no MVP e garantir
  que temos informações suficientes"). Achado: `impressions` **é** um
  agregado de chart oficial documentado (`developers.brandwatch.com/docs/
  chart-dimensions-and-aggregates`, mesma tabela que já confirmou
  `reachEstimate`/`engagementScore`), e o filtro `author=<handle>`
  (`available-filters.md`) é documentado como válido em "Mention ou Data
  Retrieval calls" — mesmo nível de evidência genérica já aceito neste
  projeto pro filtro `category=<id>` em `data/volume/sentiment/days`/
  `data/topics`/`data/volume/topauthors/queries`. Combinando os dois:
  `data/impressions/queries/days?queryId=X&author=<handle>` (mesmo padrão
  de dimensão `queries` já usado em `syncQueryGroupSov()`,
  `data/volume/queries/weeks?queryGroupId=X`) dá impressões oficiais **não
  amostradas** de um autor específico, e `data/topics?queryId=X&author=<handle>`
  dá temas oficiais **não amostrados** desse mesmo autor — sem violar a
  premissa de nunca agregar localmente sobre `mentions`, porque quem agrega
  é o próprio motor de agregados da Brandwatch, só filtrado por autor (não
  um cálculo nosso sobre a amostra). Ver `data-model.md` §5
  (`bw_query_top_authors.impressions`, `bw_query_author_topics`) e
  `sync-brandwatch.md` passo 6.7 — implementado nesta leva, escopo inicial
  limitado aos top 10 autores da Query inteira (sem quebra por Narrativa
  ainda, ver ressalva de orçamento no passo 6.7).
- **"Iris detected N peaks" (picos de volume com driver nomeado)** —
  validado 2026-07-11 contra um export real de dashboard Brandwatch que
  mostra esse recurso funcionando ("540% aumento, causado por: 10 reposts
  deste Post"). Pesquisa a fundo (`chart-dimensions-and-aggregates`,
  `basic-charts`, índice completo da doc — sem menção a "Iris"/"peak"/
  "spike"/"anomaly"/"driver") confirma que **não existe endpoint público**
  pra isso — é a mesma camada de IA Iris já investigada (ver item acima),
  só que rodando dentro do produto BWX/dashboard, não exposta via Consumer
  Research API. Esse card específico não é replicável por `bw-sync`.
- **"Post Type" agregado por candidato (retweet/reply/original)** —
  identificado na mesma validação. Não existe dimensão de chart oficial
  equivalente (só `mentions.mention_role`, por mention individual).
  Replicar um painel comparando candidatos por tipo de post exigiria somar
  `mention_role` localmente sobre `mentions` (amostrada), o que conflita
  com a premissa do projeto. Fica como ⚠️ DECISÃO PENDENTE (mesmo padrão
  já usado pra `emotion` em `data-model.md` §3) — não implementar sem
  decisão explícita do usuário sobre aceitar essa aproximação amostrada.
- **"Análise de Imagem"** — o único recurso da API parecido é "Objects &
  Logos" (`images/objects`/`images/logos`), mas é um mecanismo de lookup
  pra **configurar filtro de Query** (achar IDs de logo/objeto pra usar
  como filtro), não um analytics de conteúdo visual das mentions. Não
  implementar sem um pedido concreto que esclareça o que essa visão
  precisaria mostrar.

## Decisões pendentes globais

> ⚠️ DECISÃO PENDENTE: aplicar na migration inicial os ajustes de RLS e
> performance identificados na revisão do schema anexo (`20260706_reputation_os_schema.sql`) —
> ver notas em [foundation/overview.md](foundation/overview.md) e, quando
> gerado, `foundation/data-model.md`. Resumo: nova tabela `organization_members`
> (usuário↔organização, N:N) + função `auth_organization_ids()` substituem o
> padrão de claim único `auth.jwt() -> app_metadata.organization_id` em
> **todas** as policies `org_isolation_*` do schema anexo (decisão já fechada,
> ver `foundation/overview.md`); faltam `ENABLE ROW LEVEL SECURITY` + policy de
> isolamento em `organizations`, `bw_projects`, `bw_queries`, `bw_query_groups`,
> `bw_categories`; faltam RLS deny-all em `sync_cursors`/`sync_log`; falta a
> trigger `set_updated_at` referenciada nas tabelas que já têm coluna
> `updated_at`; e a renomeação completa para inglês listada na nota de
> nomenclatura acima (aplicar em cada módulo conforme seu `data-model.md` for
> gerado — `command-center`, `threshold-engine`, `intelligent-feed`,
> `executive-reports`).
