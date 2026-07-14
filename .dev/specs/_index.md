---
tipo: index
projeto: Digital Intelligent Communication
atualizado: 2026-07-25
---

# Digital Intelligent Communication — Índice de Especificações

> 🗺️ Ver [_architecture.md](_architecture.md) para o mapa visual (diagrama Mermaid) de todos os
> módulos e suas dependências — atualizado junto com este arquivo sempre que um módulo muda.
> ✅ Ver [_pending.md](_pending.md) para a lista agregada de decisões de produto pendentes e
> gaps técnicos (spec pronta, sem código) de todos os módulos, num lugar só.

> ✅ **Nome do produto atualizado (2026-07-12)**: "Reputation OS" →
> "Digital Intelligent Communication", pedido do usuário. Aplicado em
> `_index.md`, `CLAUDE.md` e nos exemplos de nomenclatura em
> `foundation/brandwatch-setup.md`. Não é uma mudança de schema/slug — os
> nomes técnicos do projeto (`organizations`, módulos em `.dev/specs/`,
> etc.) não referenciavam "Reputation OS" em nenhum identificador, só em
> texto descritivo.

## Sobre o projeto

Plataforma de inteligência reputacional construída sobre a Brandwatch, para
campanhas políticas e reputation management no Brasil. Sincroniza dados da
Brandwatch (mentions, queries, narrativas) para um cadastro próprio de
Entidades, rastreia ações/decisões por Narrativa (`cases`, ver
`intelligence-center`), tem um motor de risco/threshold próprio (`event-radar`)
e um Feed Inteligente de eventos (`feed_events`) — tudo com a classificação de
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
   - ✅ **Resolvido (2026-07-13)**: acesso de BI é **só uso interno da
     Lidi**, por enquanto — um único `bi_reader` vendo todas as
     organizações, sem credential por cliente final. Acesso de BI
     multi-tenant (cada organização com seu próprio Power BI/Qlik, view já
     filtrada por `organization_id`) fica descartado por ora — se algum
     cliente precisar disso no futuro, é uma extensão aditiva (novo role +
     view filtrada), não uma mudança no que já existe. Não confundir esse
     uso interno com acesso multi-tenant seguro — `bi_reader` continua
     `bypassrls` por design (Princípio técnico 6 acima), então nunca deve
     ser exposto a um cliente final sem essa extensão ser feita primeiro.
7. **Higiene de migrations** — adicionado 2026-08-02 depois de uma sequência
   real de erros de deploy, todos rastreados até um pequeno conjunto de
   padrões recorrentes. Conferir esta lista antes de escrever qualquer
   migration que altere uma function/constraint já existente:
   - **Mudar a aridade (nº de parâmetros) de uma function exige `drop
     function` explícito da assinatura ANTIGA antes do `create or
     replace` da nova.** Sem isso, Postgres não substitui a function —
     **cria um segundo overload coexistindo** com o antigo, já que
     `create or replace` só substitui uma function de assinatura
     idêntica. Isso já causou: (a) `comment on function` falhando com
     "function name is not unique" (2026-07-21); (b) dois
     `get_narratives_table` conflitantes (6 e 7 parâmetros) fazendo o
     PostgREST falhar silenciosamente ao escolher qual chamar — causa
     raiz real de `/narratives` retornando vazio por vários dias
     (2026-07-14/2026-07-26). Sempre que uma migration mudar a
     quantidade de parâmetros de uma function existente, o próprio
     arquivo deve dropar a assinatura antiga por extenso (tipos exatos,
     ex: `drop function if exists foo(uuid, date, date, jsonb);`) —
     nunca assumir que uma migration anterior "já cuidou disso" sem
     conferir a assinatura de fato aplicada no banco.
   - **Nunca `select alias.*` dentro de uma CTE/join quando outra fonte
     na mesma CTE também pode ter uma coluna de nome genérico repetido**
     (`id` é o caso clássico). Um `left join lateral get_x(...) gnt`
     seguido de `select w.id, gnt.*` produz duas colunas `id` na mesma
     CTE — válido dentro dela, mas vira `ERROR: column reference "id" is
     ambiguous` assim que a CTE é referenciada de fora (achado real em
     `get_communication_impact`, 2026-07-26). Sempre listar as colunas
     de `alias` explicitamente por nome.
   - **Uma coluna nullable que faz parte de uma chave de unicidade
     precisa de uma coluna gerada não-nula pra a constraint funcionar de
     verdade** — SQL trata `NULL <> NULL`, então duas linhas "iguais"
     exceto por essa coluna nula nunca colidem e a dedupe silenciosamente
     falha. Padrão: `col_key bigint generated always as (coalesce(col, 0))
     stored`, e a `unique` constraint usa `col_key`, não `col` (achado
     real em `bw_query_metrics_{daily,weekly,monthly}`, 2026-07-07).
   - **Divisão guardada por comparação de denominador sempre via `CASE
     WHEN denom > 0 THEN a / denom END`, nunca via `AND denom > 0` numa
     cláusula `WHERE`/condição composta** — Postgres não garante ordem de
     avaliação dos operandos de `AND`, então a divisão pode em tese ser
     avaliada antes do guard e estourar divisão por zero (achado real em
     `event-radar`, 2026-07-27, corrigido extraindo uma function
     `..._delta_pct()` com `CASE` interno).
   - **Nunca escrever `coluna = any((select ...))`** esperando
     desempacotar um array retornado por subquery escalar — Postgres
     sempre interpreta `ANY (` seguido de `SELECT` entre parênteses como
     a forma "linha a linha" (compara contra cada LINHA que a subquery
     retorna), nunca como "= ANY(array)", mesmo quando a subquery de fato
     devolve uma única linha de um array. Sempre `cross join` a fonte
     pra dentro do escopo da query e referenciar uma coluna simples:
     `= any(fonte.coluna)` (achado real em `aggregated-metrics`,
     migration `20260714000000`).
   - **CI/CD**: o workflow de deploy (`.github/workflows/deploy.yaml`)
     precisa de `concurrency` (serializar deploys por branch) — sem
     isso, dois pushes próximos disparam `supabase db push` em paralelo,
     e ambos correm pra aplicar a mesma migration mais antiga pendente;
     quem perde a corrida trava com "duplicate key... schema_migrations_pkey"
     na mesma versão, indefinidamente, bloqueando toda migration nova
     atrás dela na fila (incidente real, 2026-08-02 — ver
     `CLAUDE.md`, "`.github/workflows/deploy.yaml`").

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
| `foundation`            | Sync serial+rate-limited da Brandwatch → Supabase (`sync-brandwatch`, `narratives`) — **implementado**, ver `CLAUDE.md`. Só backend, nenhuma rota própria (ver "Executive Overview movida" em `foundation/overview.md`) | implementado | 1 | [foundation/overview.md](foundation/overview.md) |
| `auth`                  | Login/recuperação de senha via Supabase Auth + administração de usuários restrita a admins (`user_profiles`) — **pré-requisito de todo o resto**, nenhuma página é acessível sem sessão | **implementado** (2026-07-13, `middleware.ts` + `/login` + `/forgot-password` + `/reset-password` + `/admin/users` + `/perfil` (fuso horário, ver `data-model.md` "timezone") + as 6 Edge Functions administrativas + `update-my-timezone` — ver `CLAUDE.md` "Módulo auth") | 2 | [auth/overview.md](auth/overview.md) |
| `entities`              | Cadastro Nacional de Entidades (colunas próprias `cargo`/`partido`/`ideologia` + EAV via entity_tags para o restante) + vínculo com o ranking de Autores e Influenciadores | **pronto** (`data-model.md` e `author-linking.md` **implementados** — schema + seed real de 21 partidos/593 parlamentares federais + contas de rede social de 512 deputados + reorganização de campos + `LEFT JOIN` em `get_authors_ranking` (migrations `20260731000000`–`20260801010000`) + redesenho interativo de `/authors` (`intelligence-center/authors-and-influencers.md`) — só `entity-registration.md` (CRUD pela UI) ainda não implementado, ver `CLAUDE.md`) | 2      | [entities/overview.md](entities/overview.md) |
| `intelligence-center`   | Todas as páginas do frontend (Sprint 2): Executive Overview (entrada pós-login) + Exploração de Narrativas + Sentimento + Plataformas + Pautas Eleitorais — inclui `cases` (ações/decisões por Narrativa, ex-`command-center`, ver "Módulo `command-center` removido" abaixo) | pronto — não implementado | 2 | [intelligence-center/overview.md](intelligence-center/overview.md) |
| `aggregated-metrics`    | Camada de agregação/envelope JSON único, reaproveitada por todas as páginas do frontend (Sprints 2-4) e pela síntese de IA — ver "Fusão de módulos" abaixo | **implementado** (2026-07-14/15 — `get_active_highlights`/breakdown de região/`page_narrative_synthesis`/Camada 0 de `ai-synthesis` pendentes, ver `_pending.md`) | 2-4 | [aggregated-metrics/overview.md](aggregated-metrics/overview.md) |
| `communications`       | Registro de Comunicações (post, e-mail, propaganda de TV etc.) ou Decisões (data/título/responsável/detalhamento) vinculadas a uma Narrativa, com CRUD completo pela UI, e acompanhamento de impacto (sentimento/menções/risco/momentum antes vs. depois) | **implementado** (2026-07-25, migrations `20260726000000`/`20260726010000` + 5 Edge Functions + frontend — ver `CLAUDE.md`, "Módulo communications (Sprint 2.1)") | 2.1 | [communications/overview.md](communications/overview.md) |
| `event-radar`         | Detecção estatística (SQL) de picos/quedas/mudanças de sentimento + 1 card de IA por evento, publicado em `feed_events` — **substitui/absorve** `threshold-engine` e `intelligent-feed` abaixo, ver "Fusão de módulos" | rascunho     | 3      | [event-radar/overview.md](event-radar/overview.md) |
| ~~`threshold-engine`~~  | Motor de risco próprio (volume/percentual/sentimento negativo) — **absorvido por `event-radar`** (motor de detecção + severidade fazem o mesmo papel, com mais rigor estatístico) | absorvido    | 3      | — |
| ~~`intelligent-feed`~~  | Feed de eventos do sistema — **absorvido por `event-radar`** (grava em `feed_events`, mesma tabela já reservada em `_glossary.md`) | absorvido    | 3      | — |
| `propagation-graph`     | Grafo de propagação de narrativas com rollup materializado (histórico completo) — versão simplificada já cobrida via `mentions.reply_to`/`retweet_of`/`insights_mentioned` em `intelligence-center/narratives-exploration.md` e reaproveitada por `aggregated-metrics` (`get_dissemination_graph`); este módulo é só o rollup materializado completo, não um novo cálculo | rascunho   | 3      | — |
| `decision-center`       | AI Advisors — perguntas livres/interativas sobre mentions/narrativas, respeitando data-restrictions. **Não** se sobrepõe a `event-radar`: aquele gera cards automáticos por evento detectado (push), este responde perguntas ad-hoc do analista (pull) | rascunho     | 3      | — |
| `executive-reports`     | Geração de relatórios periódicos (`reports_generated`: diário/semanal/mensal/executivo/crise) — reaproveita o envelope de `aggregated-metrics` (página "Relatórios") em vez de agregação própria | rascunho | 4 | — |

> ✅ **Módulo `command-center` removido (2026-07-13)**, a pedido do
> usuário: nunca chegou a ganhar spec própria além de um único requisito
> pequeno — mostrar ações/responsável/prazo por Narrativa na seção "Ações
> e decisões" do detalhe ([intelligence-center/narratives-exploration.md](intelligence-center/narratives-exploration.md)).
> Manter um módulo (e uma linha nesta tabela, e um nó em `_architecture.md`)
> só por causa disso violava a própria regra deste projeto de arquitetura
> simples/sem duplicidade. A tabela `cases` (schema mínimo, somente
> leitura) passa a ser dado próprio de `intelligence-center` — ver
> [intelligence-center/data-model.md](intelligence-center/data-model.md).
> Se checklist/comentários/arquivos/histórico de status completos forem
> pedidos no futuro (o "Command Center" original, mais amplo), viram
> satélites dessa mesma tabela quando o pedido existir — não uma
> especulação antecipada.

> ✅ **`aggregated-metrics` e `event-radar` adicionados (2026-07-12)**,
> **fusão de módulos aplicada na mesma revisão**: as duas specs novas foram
> escritas a partir de um índice próprio (`_index_agente_inteligente.md`,
> desde então removido — conteúdo mesclado aqui) com um schema genérico
> (`mentions`/`entities`/`grafo_arestas`/`intelligent_feed`) que não
> correspondia ao schema real já implementado neste projeto
> (`bw_query_metrics_daily`/`weekly`/`monthly`,
> `bw_query_metrics_daily_by_platform`, `narrative_metrics`,
> `bw_query_top_authors`, `bw_query_topics` etc. — ver
> `foundation/data-model.md`) nem aos módulos/rotas já planejados
> (`threshold-engine`, `intelligent-feed`, `intelligence-center` já
> `pronto` com rotas em inglês). Correções aplicadas em toda a árvore de
> `aggregated-metrics/*.md` e `event-radar/*.md`:
> - Toda agregação (`metrics`, `breakdowns`, `trends`, `narratives`,
>   `authors`, `term_signals`, motor de detecção do radar) passa a ler dos
>   agregados oficiais da Brandwatch já sincronizados por `foundation`,
>   nunca de `mentions` cru — mesma premissa já fixada em
>   `foundation/overview.md` ("nunca calcular localmente sobre mentions
>   amostrada"), que essas specs novas violavam por terem sido escritas sem
>   ler o schema real primeiro.
> - `intelligent_feed` (tabela inventada pelas specs novas) →
>   `feed_events`, nome já reservado para esse exato conceito em
>   `_glossary.md` desde antes dessas specs existirem.
> - `grafo_arestas` (tabela nova, nunca planejada) → reaproveita a mesma
>   abordagem já decidida em `narratives-exploration.md` (grafo simplificado
>   sobre `mentions.reply_to`/`retweet_of`/`insights_mentioned`, via
>   `narrative_matched_mentions()`) — `propagation-graph` (Sprint 3) continua
>   como o rollup materializado completo, não duplicado aqui.
> - Rotas/nomes de Edge Function em português (`/visao-geral`,
>   `/narrativas`, `/pautas-eleitorais`...) → alinhadas às rotas em inglês
>   já `pronto` em `intelligence-center/executive-overview.md`/`intelligence-center/overview.md`
>   (`/overview`, `/narratives`, `/sentiment`, `/platforms`, `/themes`).
> - Nome de produto "Loxias" (resíduo de outro projeto/template) → Reputation OS
>   (por sua vez renomeado para Digital Intelligent Communication em
>   2026-07-12, ver nota no topo deste arquivo).
> - `threshold-engine`/`intelligent-feed` (Sprint 3, sem spec própria desde
>   sempre) marcados como absorvidos por `event-radar`, que é uma
>   especificação mais detalhada e concreta exatamente da mesma ideia (motor
>   de risco + feed de eventos) — evita manter duas specs concorrentes para
>   o mesmo conceito. `decision-center` continua distinto (Q&A interativo,
>   não geração automática de card).
> - Colisão de nomenclatura em `radar_staging_events`: as colunas
>   `entity_type`/`entity_id` do rascunho original colidiam com o termo de
>   domínio reservado "Entity" (`_glossary.md` — pessoa/veículo/partido/
>   instituição). Renomeadas para `scope_type`/`scope_id` (o que mudou:
>   narrativa, plataforma, Query — nunca uma Entity de fato) em
>   `event-radar/detection-engine.md` e `deduplication-grouping.md`.
> - Ver [event-radar/fluxo-aggregated-metrics.md](event-radar/fluxo-aggregated-metrics.md) para o
>   diagrama de dependência/sincronismo entre os dois módulos (movido para dentro do diretório do
>   módulo em 2026-07-25, era `_fluxo-event-radar-aggregated-metrics.md` na raiz de `.dev/specs/`)
>   — continua válido, só os nomes de tabela citados nele foram corrigidos junto.
>
> **Ordem de implementação recomendada** (de `_index_agente_inteligente.md`,
> preservada, com uma correção — ver nota ✅ logo abaixo): 1) `aggregated-metrics`
> Fase A — envelope, SQL base, Edge Functions das páginas, exceto
> `highlights`/`narrative_text` reais (fallback estatístico); 2) `event-radar`
> completo, na ordem interna já descrita em `event-radar/overview.md`; 3)
> `aggregated-metrics` Fase B — liga `get_active_highlights`, o boost de
> `risk_score` via evento ativo, e `ai-synthesis`.
> Ver detalhamento completo passo a passo na seção "Sequência de implantação
> — Sprint 2" logo abaixo.
>
> ✅ **Correção (2026-07-25)**: a nota original (2026-07-12) listava
> `momentum_score` como parte do que fica em fallback até `event-radar`
> existir — desatualizado desde a redefinição de Momentum de 2026-07-13
> (`aggregated-metrics/sql-aggregation.md`, "Momentum"), quando esse
> indicador passou a ser um índice de crescimento 100% calculado a partir
> de `foundation`, sem depender de evento detectado. Quem depende de
> `event-radar` hoje é o boost de `risk_score` (`risk_score = greatest(...,
> severity_score)`), não Momentum — corrigido acima. Achado na mesma
> revisão de coerência que também corrigiu essa mesma confusão em
> `event-radar/overview.md` e na seção "O que fica fora do Sprint 2" logo
> abaixo.

## Sequência de implantação — Sprint 2

> ✅ Proposta 2026-07-12, a pedido do usuário ("Sprint 1... já estão OK.
> Podemos passar para Sprint 2 que será o frontend e o backend para
> suportar o frontend. Qual a sequência de implantação correta?").
> Sprint 1 (`foundation`) está `pronto`/implementado — todo o dado que
> Sprint 2 precisa já está sincronizado. Sprint 2 tem três frentes que
> **rodam em sequência, não em paralelo**: `auth` primeiro (nenhuma página
> pode ir ao ar sem login — pedido explícito do usuário em 2026-07-13,
> "Todas as funcionalidades só poderão ser utilizadas por usuários
> logados"), depois o backend de dados, porque o frontend não tem lógica
> de negócio própria (Princípio técnico 2) e não tem o que renderizar sem
> o envelope que o backend expõe. Dentro de cada frente, a granularidade
> de execução continua sendo **uma spec por sessão** (ver skill
> `spec-driven-dev`), não o pacote inteiro de uma vez — a ordem abaixo é a
> ordem entre sessões, não uma autorização para implementar tudo junto.

### Pacote Auth — `auth` (implementar primeiro de todos)

✅ **Completo (2026-07-13)** — os 4 itens abaixo estão todos implementados,
ver `CLAUDE.md` "Módulo auth (Sprint 2)" para o detalhe de cada um:

1. [auth/data-model.md](auth/data-model.md) — ✅ **implementado**
   (migration `20260713000000_user_profiles_and_principal_admin.sql`):
   `user_profiles` + trigger de proteção do admin principal + admin
   principal cadastrado (`lidiane.carvalho@gmail.com`).
2. [auth/login.md](auth/login.md) — ✅ **implementado**: `/login` +
   `middleware.ts` de proteção de rota. **É o que efetivamente bloqueia
   acesso não-autenticado** — protege toda rota não-pública do produto
   desde já, mesmo enquanto as páginas de `intelligence-center` ainda não
   existem.
3. [auth/password-recovery.md](auth/password-recovery.md) — ✅
   **implementado**: `/forgot-password` + `/reset-password`, reaproveitando
   o layout do login — já destrava trocar a senha fraca do admin principal.
4. [auth/user-management.md](auth/user-management.md) — ✅ **implementado**:
   `/admin/users` + as 6 Edge Functions administrativas.

Pode rodar **em paralelo** com o Pacote Backend abaixo (não há dependência
entre os dois — `auth` não usa o envelope de `aggregated-metrics`, e
`aggregated-metrics` só depende de sessão existir, não de como ela foi
criada).

### Pacote Backend — `aggregated-metrics` (em paralelo com `auth`)

Único módulo backend que bloqueia o frontend do Sprint 2. Ordem interna (a
própria spec já recomenda isso em "Notas para implementação" —
`aggregated-metrics/overview.md`):

1. ✅ [aggregated-metrics/standard-json-envelope.md](aggregated-metrics/standard-json-envelope.md) — o contrato; todo o resto depende dele. **Implementado 2026-07-12/14**: `@reputation/shared-types` (`packages/shared-types`, workspace npm) — ver `CLAUDE.md`, "aggregated-metrics module (Sprint 2)".
2. ✅ [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) — functions Postgres. 100% SQL determinístico (sem IA) — cadeia forte o bastante para ir numa sessão só, um commit por function (exceção controlada de granularidade da skill), lendo sempre dos agregados oficiais de `foundation` (nunca `mentions` cru). **Implementado 2026-07-14** (migration `20260714000000`) — 9 das 10 functions; `get_active_highlights` deferida (depende de `feed_events`/`event-radar`, ver `_pending.md` gap #8).
3. ✅ [aggregated-metrics/service-layer-aggregation.md](aggregated-metrics/service-layer-aggregation.md) — camada TS que monta o envelope a partir das functions acima. **Implementado 2026-07-14** (`supabase/functions-shared-source/aggregated-metrics-service.ts`, código-fonte canônico a ser copiado pra dentro de cada Edge Function quando o passo 4 abaixo for feito — nunca importado em produção, Princípio técnico 5).
4. ✅ [aggregated-metrics/edge-functions-per-page.md](aggregated-metrics/edge-functions-per-page.md) — só as **6 Edge Functions** que as 5 páginas do Sprint 2 precisam (`get-page-overview`, `get-page-narratives`, `get-narrative-detail`, `get-page-sentiment`, `get-page-platforms`, `get-page-themes`). `get-page-alerts`/`get-page-reports` esperam `event-radar`/`executive-reports` (Sprint 3-4) — não implementar antes das páginas que os consomem existirem. **Implementado 2026-07-15** — cache de página (TTL 5min) não implementado ainda, ver `_pending.md` gap #21. ✅ **7ª Edge Function, `get-page-authors`, adicionada 2026-07-25** (fora da sequência original do Sprint 2, ver `intelligence-center/authors-and-influencers.md`) — não dependia de `entities`, só reusa `get_authors_ranking`/`get_x_insights`, já prontas.
5. [aggregated-metrics/ai-synthesis.md](aggregated-metrics/ai-synthesis.md) — só a **Camada 0** (template determinístico, sem IA) é possível agora, já que `event-radar` (fonte dos `highlights`) ainda não existe. Camadas 1/2 ficam para depois de `event-radar` (Sprint 3, ver "Fusão de módulos" acima).

`cases` (schema mínimo, ver
[intelligence-center/data-model.md](intelligence-center/data-model.md) —
dado próprio de `intelligence-center`, não mais um módulo `command-center`
separado) pode ser feito **em paralelo**, em qualquer ponto — não bloqueia
nem é bloqueado pelo pacote acima. Sem ele, a seção "Ações e decisões" só
mostra `<EmptyState />`; com ele, passa a mostrar dado real, sem mudar
contrato do envelope.

### Pacote Frontend — `intelligence-center` (depois do backend acima)

Consome o envelope pronto, sem lógica de negócio própria. Ordem recomendada:

1. ✅ [intelligence-center/executive-overview.md](intelligence-center/executive-overview.md) — página de entrada, a mais simples das 5 (sem grafo, sem disseminadores) — valida o contrato do envelope ponta a ponta (Edge Function → hook → componente) antes de replicar o padrão nas outras quatro. **Implementado 2026-07-15**.
2. ✅ [intelligence-center/narratives-exploration.md](intelligence-center/narratives-exploration.md) — a mais complexa (lista + detalhe + grafo de disseminação simplificado + disseminadores + menções relevantes) — construir logo em seguida, com o padrão do Overview ainda fresco. **Implementado 2026-07-15**, com 3 simplificações registradas em `_pending.md` (gaps #16/#20): detalhe abre como página cheia (não modal via intercepting route, que a spec já tinha decidido), "Menções relevantes" e "Ações e decisões" ficam `<EmptyState />` (sem bloco de envelope pra mentions em destaque; `cases` sem migration ainda).
3. ✅ [intelligence-center/sentiment-analysis.md](intelligence-center/sentiment-analysis.md), [platform-analysis.md](intelligence-center/platform-analysis.md), [electoral-themes.md](intelligence-center/electoral-themes.md) — sem dependência forte entre si (todas reaproveitam os mesmos componentes de tabela/cards/states já validados nos passos 1-2) — podem ser feitas em qualquer ordem ou por sessões diferentes a partir daqui. **Implementadas 2026-07-15**, com gaps registrados em `_pending.md` (#17 drill-down de pauta, #18 4 widgets de Plataformas sem fonte, #19 2 widgets de Sentimento sem fonte) para os pedaços sem function SQL correspondente em `sql-aggregation.md`.

### Sprint 2.1 — módulo `communications`

> ✅ Adicionado 2026-07-25, a pedido do usuário — módulo novo, fora da
> sequência original de Sprint 2 acima (por isso "2.1", não uma
> renumeração do que já existe). Depende de `foundation` (`narratives`),
> `auth` (`user_profiles`) e `aggregated-metrics` (reaproveita as fórmulas
> de Sentimento/Momentum/Tendência/Risco de `sql-aggregation.md`, "Scores
> de Narrativa") — todos já implementados —, e do shell de
> `intelligence-center` (páginas novas vivem no mesmo route group, sem
> layout próprio). Não bloqueia nem é bloqueado por `event-radar`
> (Sprint 3). ✅ **Ampliado, mesma sessão**: o módulo cobre dois tipos de
> registro — Comunicação (campos completos) e Decisão (data/título/
> responsável/detalhamento, campos reduzidos) — mesma tabela
> `communications`, coluna `record_type`. Ver
> [communications/overview.md](communications/overview.md) para o
> objetivo completo e a distinção explícita com `cases`
> (`intelligence-center`) — são conceitos parecidos, mas não o mesmo.

### O que fica fora do Sprint 2 (não bloqueia as 5 páginas acima)

- `entities` — ranking de autores já funciona sem ela (`bw_query_top_authors`/`bw_query_top_tweeters`, nativos da Brandwatch desde Sprint 1); só falta classificação partido/espectro (`entity_tags`), gap conhecido registrado em `intelligence-center/authors-and-influencers.md`. ✅ **Módulo especificado (2026-07-13)** — [entities/overview.md](entities/overview.md), CRUD admin-only + o desenho exato do vínculo aditivo com `get_authors_ranking`/`AuthorRow` que fecha esse gap ([entities/author-linking.md](entities/author-linking.md)) — ainda não implementado.
- CRUD completo de `cases` pela UI (criar/editar, checklist/comentários/arquivos/histórico) — só o schema mínimo somente-leitura é útil agora, ver acima; sem spec própria ainda, sem módulo dedicado (ver "Módulo `command-center` removido" mais abaixo).
- `event-radar` (Sprint 3) — sem ele, `highlights`/`narrative_text` real e o boost de `risk_score` via evento ativo ficam em fallback (não vazio: Camada 0 de `ai-synthesis` já cobre `narrative_text`, e `risk_score`/`momentum_score` já são 100% calculados a partir de `foundation` desde 2026-07-13, sem depender de `event-radar` — ver `aggregated-metrics/sql-aggregation.md`, "Risco"/"Momentum") — nenhuma página quebra ou fica bloqueada por causa disso.
- Páginas `/alerts`, `/reports` — dependem de `event-radar`/`executive-reports` (Sprint 3-4) respectivamente; não fazem parte do pacote frontend do Sprint 2. ✅ **`/authors` implementada parcialmente (2026-07-25)** — ver
  [intelligence-center/authors-and-influencers.md](intelligence-center/authors-and-influencers.md); só a classificação de espectro/`entities` continua pendente, o ranking de autores e X Themes já funcionam.

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
> `event-radar` (via os agregados oficiais listados acima — nunca via
> soma local sobre `mentions`, ver "Fusão de módulos") e `propagation-graph`
> (via `mentions.raw` — os campos de
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
> nesse sentido. "Ações e decisões" do detalhe de Narrativa lê `cases`
> (schema de `cases`, vínculo com `narratives`, `assignee_id` →
> `user_profiles`) — dado próprio de `intelligence-center` desde
> 2026-07-13 (ver [intelligence-center/data-model.md](intelligence-center/data-model.md)
> e "Módulo `command-center` removido" abaixo), não mais um módulo à
> parte. Do mesmo protótipo,
> [intelligence-center/executive-overview.md](intelligence-center/executive-overview.md)
> também foi revalidada (cards de topo, seletor de organização, rota de
> detalhe de Narrativa via modal/intercepting route) — spec movida para
> `intelligence-center` em 2026-07-12, ver nota "Executive Overview movida"
> em `foundation/overview.md`.

## Entidades principais

- `Organization` (multi-tenancy) + `Organization Member` (associação
  usuário↔organização, N:N — um usuário pode pertencer a 1 ou mais
  organizações; ver [foundation/overview.md](foundation/overview.md)) → todos
  os módulos.
- `User Profile` (`user_profiles`, perfil 1:1 com `auth.users` — nome de
  exibição, `is_admin`, `is_principal`) → `auth`. Todo módulo que precise
  referenciar "o usuário logado" além de `auth.uid()` (ex: `assignee_id`
  de `cases`) referencia esta tabela, não `auth.users` direto — ver
  [auth/data-model.md](auth/data-model.md).
- `Mention`, `Query`, `Query Group`, `Category` (cache Brandwatch: `bw_projects`, `bw_queries`, `bw_query_groups`, `bw_categories`, `mentions`) → `foundation`.
- `Narrativa` (entidade viva própria do produto: `narratives`, `narrative_signals`, `narrative_tags`, `narrative_metrics`; opcionalmente ligada a uma `Category` via `bw_category_id`) → `foundation`. Satélites `narrative_entities` (Sprint 2, depende de `Entity`) e `narrative_relationships` (Sprint 3, grafo) ficam para depois.
- `Entity` / `entity_tags` (Cadastro Nacional de Entidades, catálogo global — não por organização, ver [entities/overview.md](entities/overview.md)) → `entities`.
- `Caso` (`cases`, schema mínimo — título/status/`assignee_id`/`due_date`) → `intelligence-center` (ver [intelligence-center/data-model.md](intelligence-center/data-model.md)). Satélites (`case_checklist_items`, `case_comments`, `case_files`, `case_status_history`) ficam para quando forem pedidos, não fazem parte do schema mínimo atual — ver "Módulo `command-center` removido" acima.
- `Communication` / `Decision` (`communications`, coluna `record_type`) → `communications` (Sprint 2.1, ver [communications/data-model.md](communications/data-model.md)) — uma Comunicação já realizada (post, e-mail, propaganda de TV etc., campos completos) ou uma Decisão (data/título/responsável/detalhamento, campos reduzidos), vinculada a uma Narrativa; **não confundir com `Caso`** (`cases`, acima) — ver [communications/overview.md](communications/overview.md), "Relação com `cases`".
- `FeedEvent` (`feed_events`) → produzido por `event-radar` (absorve o papel antes reservado a `threshold-engine`/`intelligent-feed`, ver tabela de módulos acima).
- `radar_staging_events` (staging interno, pré-publicação — nunca lido pelo frontend) → `event-radar`.
- Envelope de página (contrato de resposta, não é tabela) → `aggregated-metrics`.
- `GeneratedReport` (`reports_generated`) → `executive-reports`.

## Fora de escopo do MVP (não implementar sem pedido explícito)

- Sincronizar `entity_tags` de volta como Author Lists na Brandwatch —
  reconfirmado em 2026-07-07 apesar de "trazer todos os dados da Brandwatch"
  ter sido pedido para `foundation`: Author/Site/Location Lists são um
  mecanismo de **push** (Lidi → Brandwatch), não pull, e dependem de
  `entities`/`entity_tags` (Sprint 2) como fonte — não há o que sincronizar
  ainda. Revisitar quando `entities` existir.
- Tags (`ruletags`) da Brandwatch — sem necessidade concreta antes do
  CRUD completo de `cases` (triagem de Casos, `intelligence-center`);
  `brandwatch-setup.md` §6.
- Custom Alerts da Brandwatch — `event-radar` (Sprint 3, ex-`threshold-engine`)
  é o motor de risco próprio do produto, não depende de Custom Alerts
  nativos; `brandwatch-setup.md` §7.
- Reputation Score composto **por candidato/Entity** (uma nota única de reputação
  agregando todas as Narrativas de uma pessoa/campanha) — continua fora de
  escopo. ⚠️ **Não confundir** com `risk_score` (2026-07-13, ver
  `aggregated-metrics/sql-aggregation.md`), que é um score 0-100 **por
  Narrativa individual** (prioridade operacional de triagem), pedido
  explícito do usuário — escopo bem mais restrito que um "Reputation
  Score" de candidato, que continua não implementado.
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
- ✅ **"Post Type" (retweet/reply/original) — pendência retirada 2026-07-13**:
  a informação já é buscada — `mentions.mention_role`, derivado dos campos
  nativos `replyTo`/`retweetOf` que a Brandwatch retorna em cada mention
  (fato sobre a mention, já capturado por `bw-sync`, não algo inventado
  localmente). O uso real pedido pelo usuário é o **grafo de disseminação**
  (quem postou, quem compartilhou, quem comentou — ver
  `intelligence-center/narratives-exploration.md`, "grafo de disseminação
  simplificado", e `get_dissemination_graph` em
  `aggregated-metrics/sql-aggregation.md`), que já consome `mention_role`/
  `reply_to`/`retweet_of`/`insights_mentioned` por mention individual —
  **sem violar a premissa de sampling**, porque cada nó/aresta do grafo é
  um fato sobre uma mention já sincronizada, não uma soma/contagem
  apresentada como total. Um painel separado comparando candidatos por %
  agregado de retweet/reply/original (diferente do grafo) continuaria sem
  fonte oficial se algum dia for pedido, mas deixa de ser uma pendência
  registrada aqui por não ser um caso de uso real do produto hoje.
- **"Análise de Imagem"** — o único recurso da API parecido é "Objects &
  Logos" (`images/objects`/`images/logos`), mas é um mecanismo de lookup
  pra **configurar filtro de Query** (achar IDs de logo/objeto pra usar
  como filtro), não um analytics de conteúdo visual das mentions. Não
  implementar sem um pedido concreto que esclareça o que essa visão
  precisaria mostrar.

## Decisões pendentes globais

> ✅ **RLS multi-tenant confirmada como já aplicada (2026-07-13)** —
> revisão pedida pelo usuário ("O RLS do Supabase obrigatoriamente precisa
> respeitar user_id e organization_id no acesso aos dados... Reveja se a
> foundation também está atendendo a esse requisito"). Esta nota ficava
> como ⚠️ DECISÃO PENDENTE desde a spec original (pedindo pra "aplicar na
> migration inicial os ajustes de RLS") — **a spec nunca foi atualizada
> depois que o trabalho foi feito**. Conferido linha a linha contra
> `supabase/migrations/20260707000000_foundation_schema.sql` e todas as
> migrations que criaram tabela nova depois dela: **todas** as 26 tabelas
> de `foundation` têm `ENABLE ROW LEVEL SECURITY`, e todas as org-scoped
> usam o padrão `organization_id in (select auth_organization_ids())`
> (direto) ou, pra satélites sem `organization_id` própria (`bw_queries`,
> `bw_query_groups`, `bw_categories`, `bw_query_top_authors` etc.), o
> mesmo padrão via subquery no FK pai (`project_id in (select id from
> bw_projects where organization_id in (select auth_organization_ids()))`).
> `auth_organization_ids()` já resolve por `user_id = auth.uid()` — ou
> seja, toda policy já é `user_id` **e** `organization_id`, não uma coisa
> ou outra. `sync_cursors`/`sync_log`/`bw_sync_lock` são deny-all (RLS
> ativa, zero policy — só `SUPABASE_SECRET_KEY` acessa). Nada pendente
> aqui — ver `foundation/overview.md`, "Multi-tenancy: usuário ↔
> organização", que também foi atualizado pra remover a marcação de
> pendente. ⚠️ **Gap real encontrado na mesma revisão, esse sim pendente
> de correção** (não de spec, de comportamento): os Edge Functions de
> `aggregated-metrics` (`get-page-*`) **bypassam RLS** se implementados
> com `SUPABASE_SECRET_KEY` como todo o resto do Princípio técnico 5 —
> corrigido na spec, ver
> [aggregated-metrics/edge-functions-per-page.md](aggregated-metrics/edge-functions-per-page.md),
> "Autenticação do client Supabase (exceção ao padrão)".
>
> A renomeação completa para inglês (nota de nomenclatura acima) segue
> valendo como lembrete de aplicar em cada módulo conforme seu
> `data-model.md` for gerado — `event-radar`, `executive-reports`
> (`command-center` removido do projeto, ver nota acima).

> ✅ **Resolvido (2026-07-14)**: tipos TS do envelope em pacote
> compartilhado — `packages/shared-types` (`@reputation/shared-types`).
> Ressalva: só resolve o lado Next.js/frontend, Edge Functions continuam
> com cópia inline por Princípio técnico 5. Ver
> [aggregated-metrics/service-layer-aggregation.md](aggregated-metrics/service-layer-aggregation.md)
> e `_pending.md` (decisão #2).

> ✅ **Resolvido (2026-07-13)**: síntese de página (`narrative_text`) é **assíncrona** (carrega
> com fallback determinístico, atualiza quando a composição terminar) **e armazenada em banco
> por período** (`page_narrative_synthesis`, período fechado = permanente, nunca regenerado) —
> pedido explícito do usuário: "para que não haja necessidade de pesquisar novamente utilizando
> a IA". Ver [aggregated-metrics/ai-synthesis.md](aggregated-metrics/ai-synthesis.md).

> ✅ **Resolvido (2026-07-24)**: intervalo do `pg_cron` do motor de detecção
> fixado em **15 minutos** (mesma cadência do heartbeat de `bw-sync`) —
> decisão do usuário, ver `_pending.md` e
> [event-radar/detection-engine.md](event-radar/detection-engine.md), "Fluxo
> principal" item 1.
