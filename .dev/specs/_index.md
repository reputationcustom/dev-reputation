---
tipo: index
projeto: Reputation OS
atualizado: 2026-07-07
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

| Módulo                 | Descrição curta                                                              | Status geral | Sprint | Specs |
|-------------------------|-------------------------------------------------------------------------------|--------------|--------|-------|
| `foundation`            | Sync serial+rate-limited da Brandwatch → Supabase + Executive Overview       | pronto       | 1      | [foundation/overview.md](foundation/overview.md) |
| `entities`              | Cadastro Nacional de Entidades (EAV via entity_tags) + enriquecimento de mentions | rascunho | 2      | — |
| `command-center`        | CRUD de Casos (`cases`), checklist, comentários, arquivos, histórico de status | rascunho     | 2      | — |
| `intelligence-center`   | Exploração de narrativas/mentions com filtros + enriquecimento de entidades  | rascunho     | 2      | — |
| `threshold-engine`      | Motor de risco próprio (volume/percentual/sentimento negativo)               | rascunho     | 3      | — |
| `intelligent-feed`      | Feed de eventos do sistema (`feed_events`: narrativas, thresholds, casos, sentimento) | rascunho | 3 | — |
| `propagation-graph`     | Grafo de propagação de narrativas (arestas por mention + rollup materializado) | rascunho   | 3      | — |
| `decision-center`       | AI Advisors sobre mentions/narrativas, respeitando data-restrictions          | rascunho     | 3      | — |
| `executive-reports`     | Geração de relatórios periódicos (`reports_generated`: diário/semanal/mensal/executivo/crise) | rascunho | 4 | — |

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

- Sincronizar `entity_tags` de volta como Author Lists na Brandwatch.
- Reputation Score composto — usar apenas `risk_level` (low/medium/high/critical).

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
