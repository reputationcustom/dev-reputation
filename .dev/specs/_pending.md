---
tipo: pending-tracker
atualizado: 2026-07-13 (rev. 3)
---

# Pendências — Digital Intelligent Communication

> Agregador de tudo que está marcado `⚠️ DECISÃO PENDENTE` (decisão de produto, alguém precisa
> responder) ou "especificado, ainda sem migration/implementação" (trabalho técnico já
> desenhado, só falta escrever o código) em qualquer spec do projeto. **Não é uma fonte nova de
> verdade** — cada linha é só um ponteiro pro lugar onde a pendência de fato está documentada
> (a spec continua sendo a fonte real). Atualizar sempre que uma pendência for aberta ou fechada
> em qualquer spec — mesma disciplina já usada pra manter `_architecture.md`/`_index.md`
> sincronizados.
>
> Pra "o que falta implementar de cada módulo inteiro" (não uma pendência pontual), ver
> [_architecture.md](_architecture.md) — a coluna Status ali já responde isso. Este arquivo é só
> pra decisões/gaps específicos, não pra status de módulo.

## Como usar

- **Quer decidir algo?** Escolha uma linha em "Decisões de produto pendentes", responda no chat
  (ex: "resolve a pendência de X: a resposta é Y") — a spec é atualizada e a linha sai daqui.
- **Quer saber o que falta codar?** "Gaps técnicos" lista specs já prontas sem migration/código
  correspondente — dá pra pedir "implemente a pendência de net_sentiment" direto.

## Decisões de produto pendentes

| # | Módulo | Decisão | Spec |
|---|---|---|---|
| 1 | `intelligence-center` | Rota de `/narratives/[id]`: página própria vs. modal (depende do roteamento geral do app) | [intelligence-center/overview.md](intelligence-center/overview.md) |
| 2 | `aggregated-metrics` | Tipos TS do envelope: pacote compartilhado (`packages/shared-types`) vs. duplicado entre frontend e Edge Functions | [aggregated-metrics/service-layer-aggregation.md](aggregated-metrics/service-layer-aggregation.md) |
| 3 | `aggregated-metrics` | Fórmula de `risk_score`: adicionar termo de interação pra não inflar risco quando Momentum/Velocidade altos vêm com sentimento positivo (v1 é soma simples) | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md), "Scores de Narrativa" |
| 4 | `event-radar` | Intervalo exato do `pg_cron` do motor de detecção (15min vs. 30min) — depende de teste de carga | [event-radar/detection-engine.md](event-radar/detection-engine.md) |
| 5 | `event-radar` | UI de aprovação (aceitar/rejeitar) de `cases` pendentes `high`/`critical` — ainda sem spec própria, bloqueia só esse passo específico de `schema-integration.md` | [event-radar/schema-integration.md](event-radar/schema-integration.md) |
| 6 | `auth` | Reforçar (ou não) `admin-revoke-user-access` pra bloquear ban do admin principal no backend, não só ocultar o botão na UI | [auth/user-management.md](auth/user-management.md), "Regras de negócio" |

✅ Resolvidas em 2026-07-13: extração de hashtag como campo estruturado (`mentions.insights_hashtag`
— e um bug real de matching corrigido junto); seletor de organização/Query — **organização é a
única unidade visível ao usuário**, Queries são sempre combinadas automaticamente e nunca
expostas (revisado 2× nesta mesma data — a primeira versão desta resolução tinha introduzido um
seletor de Query, corrigido pelo usuário no mesmo dia); "Post Type" — retirada, não fazia
sentido como pendência (a informação já é capturada, usada no grafo de disseminação, não num
painel agregado); síntese de página — assíncrona e armazenada em banco por período
(`page_narrative_synthesis`, período fechado = permanente); mapeamento de `case_status` — mantido
igual ao protótipo (`open`/`waiting`→Pendente, `in_progress`→Em andamento,
`resolved`/`archived`→Concluída).

## Gaps técnicos (spec pronta, sem migration/código ainda)

> Diferente da lista acima — estes não são decisões em aberto, é trabalho já desenhado esperando
> implementação. Em módulos que já têm outras partes implementadas (`foundation`), é fácil essas
> passarem despercebidas porque o módulo "parece pronto" — por isso ficam explícitas aqui.

### `foundation`

| # | O que falta | Spec | Observação |
|---|---|---|---|
| 1 | `bw_query_metrics_daily.net_sentiment`/`narrative_metrics.net_sentiment` — sentimento líquido oficial por Narrativa/Query | [foundation/data-model.md](foundation/data-model.md), passo 6.3d de [sync-brandwatch.md](foundation/sync-brandwatch.md) | Resolve o Sentimento (7 faixas) da tabela de Narrativas |
| 2 | Tabela `bw_query_metrics_hourly` + fase `hourly_metrics` — grão horário | [foundation/data-model.md](foundation/data-model.md), passo 6.3e de [sync-brandwatch.md](foundation/sync-brandwatch.md) | Resolve a Velocidade (curto prazo) da tabela de Narrativas e a detecção intra-dia do `event-radar` |
| 3 | Busca seletiva de `full_text` (top-N por Narrativa/dia, fontes não-redigidas) | [foundation/data-model.md](foundation/data-model.md) §3, passo 5 de [sync-brandwatch.md](foundation/sync-brandwatch.md) | Pré-requisito de síntese de Narrativa mais rica (Sprint 4) |
| 4 | `bw_query_topics.daily_series`/`page_type_breakdown` (campos do endpoint legado de Topics) | [foundation/data-model.md](foundation/data-model.md) §5 | Sem consumidor definido ainda, não bloqueia nada hoje |
| 5 | Cache do token Brandwatch no Vault (`brandwatch_credentials.access_token_secret_ref` write-back) | [foundation/brandwatch-setup.md](foundation/brandwatch-setup.md) | Gap conhecido de longa data, **não bloqueante** — `bw-sync` minta token novo a cada par "devido", já barato o bastante na cadência atual (`BW_SYNC_INTERVAL_HOURS`) |

### Outros módulos

| # | Módulo | O que falta | Spec |
|---|---|---|---|
| 6 | `auth` | `login.md`/`password-recovery.md`/`user-management.md` — UI + Edge Functions (só `data-model.md`/seed do admin principal estão implementados) | [auth/overview.md](auth/overview.md) |
| 7 | `aggregated-metrics` | Tabela `page_narrative_synthesis` (armazenamento persistente da síntese de página) — spec pronta, sem migration | [aggregated-metrics/ai-synthesis.md](aggregated-metrics/ai-synthesis.md) |

## Referências

- [_architecture.md](_architecture.md) — status por módulo (o que já existe vs. planejado).
- [_index.md](_index.md) — "Sequência de implantação — Sprint 2", mapa de módulos.
