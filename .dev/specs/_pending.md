---
tipo: pending-tracker
atualizado: 2026-07-15 (rev. 7)
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
| 3 | `aggregated-metrics` | Fórmula de `risk_score`: adicionar termo de interação pra não inflar risco quando Momentum/Velocidade altos vêm com sentimento positivo (v1 é soma simples) | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md), "Scores de Narrativa" |
| 4 | `event-radar` | Intervalo exato do `pg_cron` do motor de detecção (15min vs. 30min) — depende de teste de carga | [event-radar/detection-engine.md](event-radar/detection-engine.md) |
| 5 | `event-radar` | UI de aprovação (aceitar/rejeitar) de `cases` pendentes `high`/`critical` — ainda sem spec própria, bloqueia só esse passo específico de `schema-integration.md` | [event-radar/schema-integration.md](event-radar/schema-integration.md) |

✅ **Resolvida 2026-07-13** (decisão #6, `auth`): implementado o reforço que
a própria spec recomendava — `admin-revoke-user-access` agora verifica
`user_profiles.is_principal` e recusa `revoke: true` para essa conta,
além da UI já ocultar a ação nessa linha. Ver `auth/user-management.md`
("Regras de negócio") e `CLAUDE.md`, "Módulo auth (Sprint 2)".

✅ **Resolvida 2026-07-14** (decisão #2, `aggregated-metrics`): tipos TS do envelope ficam em pacote
compartilhado — `packages/shared-types` (`@reputation/shared-types`, primeiro workspace npm deste
repo), consumido pelo frontend via `next.config.ts`'s `transpilePackages`. Ressalva encontrada ao
implementar: isso resolve só o lado Next.js/frontend — Edge Functions continuam sem conseguir
importar um pacote de workspace local em produção (Princípio técnico 5), então
`supabase/functions-shared-source/aggregated-metrics-service.ts` mantém sua própria cópia inline
dos tipos, sincronizada à mão. Ver `CLAUDE.md`, "aggregated-metrics module (Sprint 2)".

✅ Resolvidas em 2026-07-13: `net_sentiment` oficial por Narrativa/Query
(gap técnico #1 de foundation, migration `20260713030000` — ver
[foundation/data-model.md](foundation/data-model.md)); tabela
`bw_query_metrics_hourly` + fase `hourly_metrics` (gap técnico #2 de
foundation, migration `20260713040000`); busca seletiva de `full_text`
top-N por Narrativa/dia (gap técnico #3 de foundation, fase
`full_text_enrichment`, sem migration — coluna já existia); extração de hashtag como campo estruturado (`mentions.insights_hashtag`
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
| 5 | Cache do token Brandwatch no Vault (`brandwatch_credentials.access_token_secret_ref` write-back) | [foundation/brandwatch-setup.md](foundation/brandwatch-setup.md) | Gap conhecido de longa data, **não bloqueante** — `bw-sync` minta token novo a cada par "devido", já barato o bastante na cadência atual (`BW_SYNC_INTERVAL_HOURS`). **Deferido a pedido do usuário (2026-07-13)**: fora do escopo desta rodada de implementação, evolução futura quando necessário |

✅ Item #4 (`bw_query_topics.daily_series`/`page_type_breakdown`) removido
desta tabela em 2026-07-13 — auditoria encontrou que já estava
implementado desde a migration `20260712040000` (endpoint legado de
Topics, `syncLegacyTopicsData()`); o tracker só não tinha sido atualizado
na época. Itens #2/#3 resolvidos na mesma data (ver acima).

### Outros módulos

| # | Módulo | O que falta | Spec |
|---|---|---|---|
| 7 | `aggregated-metrics` | Tabela `page_narrative_synthesis` (armazenamento persistente da síntese de página) — spec pronta, sem migration | [aggregated-metrics/ai-synthesis.md](aggregated-metrics/ai-synthesis.md) |
| 8 | `aggregated-metrics` | `get_active_highlights` (bloco `highlights`) — depende de `feed_events`, populada por `event-radar` (Sprint 3, ainda `rascunho`, tabela não existe). Os outros 9 blocos do envelope já têm function SQL implementada (migration `20260714000000`); `fetchHighlights` na service layer já existe e retorna `[]` até essa function existir | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 9 | `aggregated-metrics` | Breakdown por região/localização (`breakdowns` tipo `'region'`, pedido em `narrative_detail`/`sentiment`) — `bw_query_demographics_daily` existe (`foundation/data-model.md`) mas nenhuma function SQL do tipo `get_region_breakdown` foi especificada em `sql-aggregation.md`. `fetchOneBreakdown('region', ...)` na service layer já loga e retorna `null` (não quebra o envelope), só falta a function+wiring quando alguém confirmar o desenho (que dimensão de localização — país/estado/cidade? — e qual métrica exibir) | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 10 | `aggregated-metrics` | Trend "volume por plataforma ao longo do tempo" (`platforms`) e "SOV por pauta ao longo do tempo" (`themes`) — `block-mapping-per-page.md` pede os dois, mas `sql-aggregation.md`'s `get_volume_trend` só cobre volume/sentimento geral, sem quebra por plataforma/pauta ao longo de uma série temporal (só como snapshot estático via `get_platform_breakdown`/`get_theme_breakdown`). `fetchTrends()` na service layer já loga e retorna `[]` pra essas 2 páginas em vez de inventar uma série | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 11 | `aggregated-metrics` | `authors[].risk_level` sempre `null` — diferente de `narratives` (que tem a fórmula completa "Scores de Narrativa"), nenhuma spec define como calcular risco por autor individual. `get_authors_ranking` retorna `null` de propósito até uma spec futura definir a fórmula | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 15 | `intelligence-center` | Breakpoints responsivos exatos não confirmados contra o protótipo real (`_design-tokens.md` não documenta layout) — a implementação de 2026-07-15 usa a convenção padrão Tailwind (`lg` como corte mobile/desktop) como aproximação razoável, não um valor validado | [intelligence-center/overview.md](intelligence-center/overview.md), "Premissas de shell/layout" |
| 16 | `intelligence-center` | `/narratives/[id]` abre como página cheia, não como modal via intercepting route — `narratives-exploration.md` já tinha decidido por modal (2026-07-12, `(.)narratives/[id]`); não é uma decisão em aberto, é uma simplificação de implementação (2026-07-15) por causa do volume de trabalho da sessão. A rota funciona e navega corretamente, só não abre sobre a lista como a spec pede | [intelligence-center/narratives-exploration.md](intelligence-center/narratives-exploration.md), "Fluxo principal" item 5 |
| 17 | `intelligence-center` | Pautas Eleitorais (`/themes`): drill-down "narrativas dentro da pauta" (clicar numa Pauta → só as Narrativas-filhas, via `get-page-themes` com `pauta_id`) não está interativo — o backend já suporta (`get_narratives_table`'s `p_pauta_id`), só falta a UI de seleção; a tabela hoje mostra Pautas e Narrativas-filhas juntas, sem distinguir (bloco `narratives` do envelope não expõe a hierarquia `bw_categories.parent_id`) | [intelligence-center/electoral-themes.md](intelligence-center/electoral-themes.md) |
| 18 | `intelligence-center`/`platform-analysis` | 4 widgets de `/platforms` sem fonte de dado (nenhuma function SQL cobre): evolução do volume por plataforma ao longo do tempo, narrativas dominantes especificamente por plataforma, velocidade de propagação por plataforma (variação % entre períodos por `page_type`), conteúdos de destaque (cards de mentions individuais) — todos renderizados como `<EmptyState />` explicando o motivo, não omitidos silenciosamente | [intelligence-center/platform-analysis.md](platform-analysis.md) |
| 19 | `intelligence-center`/`sentiment-analysis` | 2 widgets de `/sentiment` sem fonte de dado: "Sentimento por Narrativa" (barras por Narrativa — `block-mapping-per-page.md` não marca o bloco `narratives` para esta página) e "Menções que mais influenciaram o sentimento" (lista de mentions individuais, sem bloco correspondente no envelope) | [intelligence-center/sentiment-analysis.md](sentiment-analysis.md) |
| 20 | `intelligence-center`/`narratives-exploration` | Detalhe de Narrativa: "Menções relevantes" e "Ações e decisões" (`cases`) ficam `<EmptyState />` — a primeira por falta de bloco no envelope (nenhum dos 8 blocos padrão cobre "lista de mentions em destaque"), a segunda porque a tabela `cases` (`intelligence-center/data-model.md`) ainda não tem migration — spec já previa esse estado vazio explicitamente ("Nenhuma ação registrada ainda") enquanto `cases` não existir | [intelligence-center/narratives-exploration.md](narratives-exploration.md), "Ações e decisões" |
| 21 | `aggregated-metrics` | Cache de página (TTL 5min + invalidação por sync/refresh manual) não implementado — as 6 Edge Functions `get-page-*`/`get-narrative-detail` recalculam o envelope a cada chamada. Não bloqueia funcionalidade (cada chamada já é rápida — leitura de agregados já sincronizados, não de `mentions` cru), só custa mais chamadas RPC do que o necessário sob uso intenso | [aggregated-metrics/edge-functions-per-page.md](edge-functions-per-page.md), "Regras de negócio" |

✅ Item #6 (`auth` — UI + Edge Functions) removido desta tabela: já estava
`implementado` desde 2026-07-13 (ver `CLAUDE.md`, "Módulo auth (Sprint
2)") — o tracker só não tinha sido atualizado depois do trabalho ser
concluído, mesmo tipo de defasagem já corrigida antes para itens de
`foundation`.

✅ **Item #12 resolvido parcialmente (2026-07-15)**: `/admin/users` e
`/perfil` movidos para dentro do route group `(intelligence-center)`
(`app/(intelligence-center)/admin/users/`, `app/(intelligence-center)/perfil/`)
— agora têm o mesmo shell (Sidebar/header/footer fixos, não remontam ao
navegar). Sidebar ganhou colapso/expansão («»/mobile drawer) persistente
entre navegações (estado vive no layout, que não remonta — App Router).
Footer mínimo adicionado. Restam itens #15 (breakpoint exato não
confirmado) — ver linha acima; o resto do item #12 original (menu
ocultável com forma óbvia de reabrir, shell fixo) está feito.

## Referências

- [_architecture.md](_architecture.md) — status por módulo (o que já existe vs. planejado).
- [_index.md](_index.md) — "Sequência de implantação — Sprint 2", mapa de módulos.
