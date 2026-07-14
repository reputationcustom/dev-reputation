---
tipo: feature-spec
módulo: event-radar
funcionalidade: agent-orchestrator
status: implementado
atualizado: 2026-08-06
---

# Orquestrador de Agent (única chamada à IA por evento)

> ✅ **Implementado (2026-07-31)** — Edge Function
> `supabase/functions/event-radar-agent-orchestrator/index.ts` (migration
> `20260731020000_event_radar_agent_orchestrator.sql`), primeira e única
> etapa do módulo com chamada de IA (1.1/1.2/1.3/1.6 são 100% SQL). Fluxo
> igual ao descrito abaixo: lê `radar_staging_events` já dentro do cap
> diário (`queued_for_agent_at is not null`, 1.6) e ainda não processados
> (`agent_processed_at is not null` marca "IA já rodou" — coluna nova, não
> antecipada em `data-model.md`), monta o payload via
> `event_radar_build_agent_payload()` (SQL), faz a chamada e grava em
> `feed_events` quando `should_publish=true` — que **também** foi criada
> nesta migration (nunca tinha `data-model.md`/migration antes, mesmo
> tabela documentada desde a "Fusão de módulos"). Agendada via `pg_cron` a
> cada 15min, mesmo padrão `net.http_post` de `bw-sync-heartbeat`.
>
> **Modelo: Claude Haiku 4.5** (`claude-haiku-4-5`) — decisão explícita do
> usuário (2026-07-31), dado que este módulo já declara "cada chamada de
> IA tem custo" como princípio (`overview.md`) — conflitava com o default
> geral de assistente de sempre usar o modelo mais capaz, por isso essa
> escolha específica foi levada ao usuário em vez de decidida
> silenciosamente. Configurável via `EVENT_RADAR_AGENT_MODEL` (secret da
> Edge Function), sem precisar de nova migration/deploy de código.
>
> ⚠️ **Dedup semântico ("Regras de negócio") implementado como contexto no
> payload, não como um prompt com múltiplos eventos simultâneos** — o
> desenho é uma chamada por evento, então não há como literalmente "juntar
> vários eventos no mesmo prompt". Em vez disso,
> `event_radar_build_agent_payload()` inclui `sibling_events` (outros
> eventos ativos agora no mesmo escopo) e `recent_related_cards` (cards já
> publicados nas últimas 24h pra mesma Narrativa, só escopo `narrative` —
> `feed_events` não tem uma coluna de `scope_id` própria, só
> `related_narrative_id`) — o prompt instrui a IA a retornar
> `should_publish: false` quando o evento não traz nada novo em relação a
> esse contexto. Decisão de escopo documentada, não um gap silencioso.
>
> **Fora desta leva, deliberadamente**: "Resumo executivo" em lote (1x/dia
> — feature separada, não descrita no "Fluxo principal" abaixo) e
> `feed_event_feedback`/`schema-integration.md` item 2 (retroalimentação
> pós-publicação do analista — precisa de UI própria, não pedida ainda).
>
> **Coluna nova em `feed_events`, não antecipada em `data-model.md`**:
> `severity_explanation` — o "Schema de saída" abaixo já exigia esse campo
> da IA ("por que essa severidade, em linguagem natural"), mas
> `data-model.md` nunca tinha uma coluna pra guardá-lo (distinto de
> `description`, que guarda o `explanation` — causa provável do evento em
> si, não da severidade).
>
> ⚠️ Não testado contra a API real da Anthropic nem do Supabase nesta
> sessão (sem credenciais/ambiente disponíveis) — revisado manualmente.

## Objetivo

Transformar um evento estatístico (já deduplicado e com severidade calculada) em um card
legível para a equipe de comunicação — com exatamente uma chamada de IA por evento.

## Usuários afetados

Consumido indiretamente por qualquer usuário autenticado que visualize uma página com
`highlights` (ver módulo `aggregated-metrics`) — todo evento aprovado pela IA publica direto,
sem fila de aprovação humana intermediária (✅ decisão do usuário, 2026-07-25).

## Fluxo principal

1. Uma Edge Function consome `radar_staging_events` já deduplicados, com severidade calculada,
   e dentro do cap diário (ver [volume-limits.md](volume-limits.md)).
2. Monta o payload agregado (ver regras abaixo — nunca texto bruto de menções).
3. Faz **uma única chamada** à API do Claude, com saída estruturada forçada via schema JSON.
4. Recebe a resposta e grava conforme [schema-integration.md](schema-integration.md).

## Regras de negócio

- Uma única chamada à IA por evento — não uma cadeia de 4 agents. Os quatro "papéis" (análise,
  dedup semântico, recomendação, resumo executivo) são seções de um único system prompt.
- O dedup semântico entre narrativas relacionadas (ex: volume + sentimento + engajamento de
  "Segurança" virando um card só) é a única parte desta etapa que exige IA — porque depende de
  julgamento sobre o que conta como "o mesmo movimento". É uma etapa dentro do mesmo prompt, não
  um agent separado.
- O payload enviado à IA contém **apenas dados agregados**: métricas já calculadas, top tópicos
  com percentuais, principais plataformas, contagens de autores. **Nunca** enviar texto bruto
  das menções — isso encarece o prompt sem agregar precisão. Para conteúdo de X/Twitter, usar os
  endpoints X Insights (`data/hashtags`, `data/emoticons`, `data/urls`, `data/mentionedauthors`)
  como fonte de evidência agregada, já decidido em sprint anterior.
- Prompt-base deve reforçar: não inventar números/causas, diferenciar correlação de causa, usar
  linguagem como "associado a" quando a evidência for insuficiente, títulos ≤ 90 caracteres,
  resumo ≤ 300 caracteres.
- ✅ **Tom padronizado via skill `humanizer-pt-br` (2026-08-06)** — pedido do usuário, aplicado
  aos 3 pontos de geração de texto por IA do produto (este, `narrative-summary-composer` e a
  Camada 1 de `aggregated-metrics/ai-synthesis.md`), não só a este. Objetivo/direto/eficiente,
  sem os tiques de escrita de IA (aberturas de preenchimento, "além disso", atribuição vaga a
  "especialistas", conclusão genérica/otimista, gerúndio final de falsa profundidade, regra dos 3
  forçada) — instrução destilada da skill (`.agents/skills/humanizer-pt-br/SKILL.md`, um guia
  interativo de edição, não um trecho colável direto na API) direto no `SYSTEM_PROMPT`. Ver
  `aggregated-metrics/ai-synthesis.md`, "Dependências técnicas", pro detalhe completo da skill.
- Resumo executivo (antigo "Agent 4") roda separado, em lote — uma chamada por dia agregando
  todos os cards publicados nas últimas 72h, nunca uma chamada por evento.

## Schema de saída (contrato obrigatório)

> ⚠️ Este schema é compartilhado com o bloco `highlights` do envelope de `aggregated-metrics`.
> Não renomear campos aqui sem atualizar `standard-json-envelope.md` na mesma alteração — ver
> [aggregated-metrics-integration.md](aggregated-metrics-integration.md).

| Campo                  | Tipo               | Obrigatório | Descrição                                     |
|--------------------------|---------------------|-------------|-------------------------------------------------|
| `should_publish`          | boolean             | sim         | Se `false`, evento é descartado, nada é gravado |
| `event_type`               | string              | sim         | ex: `spike`, `queda`, `mudanca_sentimento`      |
| `severity`                  | enum                | sim         | `low`\|`medium`\|`high`\|`critical` (vem de 1.3, não recalculado pela IA) |
| `severity_score`            | number              | sim         | vem de 1.3, repassado no payload de saída        |
| `severity_explanation`      | string              | sim         | por que essa severidade, em linguagem natural    |
| `title`                      | string (≤90 chars)  | sim         | título do card                                    |
| `summary`                    | string (≤300 chars) | sim         | resumo curto                                       |
| `explanation`                | string              | sim         | explicação mais detalhada (causa provável etc.)   |
| `recommendation`             | string ou null      | não         | ação sugerida, quando aplicável                    |
| `confidence`                  | number (0-1)        | sim         | confiança da IA na análise                          |
| `tags`                        | string[]            | sim         | tags livres para busca/filtro                      |

## Fluxos alternativos e erros

| Situação                                | Comportamento esperado                                   |
|--------------------------------------------|--------------------------------------------------------------|
| IA retorna `should_publish: false`         | Evento não é gravado em `feed_events`, fica só no log interno |
| Chamada à IA falha (erro/timeout)           | Evento permanece pendente, reprocessado na próxima execução |
| Resposta não bate com o schema JSON forçado | Descartar e logar erro — nunca gravar payload malformado    |

## Dados envolvidos

- **Lê**: `radar_staging_events` (deduplicados, com severidade, dentro do cap diário).
- **Escreve**: via [schema-integration.md](schema-integration.md) — `feed_events`, qualquer
  severidade.

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [severity.md](severity.md)
- [volume-limits.md](volume-limits.md)
- [schema-integration.md](schema-integration.md)
- [aggregated-metrics-integration.md](aggregated-metrics-integration.md)
