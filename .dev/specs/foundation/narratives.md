---
tipo: feature-spec
módulo: foundation
funcionalidade: narratives
status: implementado
atualizado: 2026-08-06
---

# Narratives

> ✅ **Status corrigido 2026-07-14** (premissa do projeto, ver CLAUDE.md
> "Close the loop"): `ensureNarrativesFromCategories()` em produção desde
> 2026-07-10 (auto-seed de Category/Subcategory de topo), métricas via
> `refresh_narrative_metrics()` agendada por `pg_cron` — ver `CLAUDE.md`,
> "Brandwatch sync model", pro histórico completo.

> ✅ **Implementado (2026-07-16)**: `bw_categories.status` (migration
> `20260716010000`) — uma Narrativa cuja Category/Subcategory saiu do
> `GET /rulecategories` da Brandwatch (renomeada/excluída lá) não é
> deletada, mas para de aparecer em `get_narratives_table`/
> `get_theme_breakdown` (aggregated-metrics exige `bc.status = 'active'`) e
> `bw-sync` para de gastar orçamento sincronizando novo dado pra ela
> (`fetchNarrativeCategoryIds()`). Dado histórico já sincronizado
> (`narrative_metrics`, `bw_query_metrics_daily`) permanece intacto — só a
> listagem/score em telas fica escondida por padrão. Mesma sessão também
> resolveu, no lado de `intelligence-center` (ver
> [narratives-exploration.md](../intelligence-center/narratives-exploration.md)/
> [executive-overview.md](../intelligence-center/executive-overview.md)),
> qual granularidade de Narrativa cada página lista por padrão quando uma
> Category tem Subcategories (Overview = só a Category de topo; aba
> Narrativas = as Subcategories) — ver CLAUDE.md "Category/Subcategory
> status tracking + página-escopo raiz/subcategoria".

> ✅ **Alterado (2026-07-20)**, pedido do usuário — 3 mudanças:
> 1. **Título passa a ser "Categoria - Subcategoria"**: `ensureNarrativesFromCategories()`
>    (`bw-sync/index.ts`, `buildNarrativeTitle()`) compõe o título de toda
>    Narrativa nova cuja Category tem `parent_id` como
>    `"<nome da Category-pai> - <nome da Subcategory>"`; Category de topo
>    continua só com o próprio nome (não tem pai pra compor). Migration
>    `20260720000000` fez o backfill do título de toda Narrativa já
>    existente pro novo formato — seguro porque não há CRUD de Narrativas em
>    nenhuma camada do produto (ver "Interface (UI)" abaixo), então todo
>    `title` em produção é 100% derivado, nunca editado manualmente.
> 2. **Overview e a aba Narrativas voltam a listar todas as Narrativas**
>    (Category de topo e Subcategory juntas, não mais só um nível cada) —
>    reverte a decisão de 2026-07-16 citada acima só pra essas duas páginas
>    (`platforms`/`themes`/`reports` continuam no escopo raiz/folha
>    original). Viabilizado pela mudança de título acima: uma Subcategory
>    (`"Vacinação"`) sozinha ficaria ambígua ao lado de outras Pautas na
>    mesma lista plana; com o novo formato ela aparece como
>    `"Saúde - Vacinação"`. Ver
>    [narratives-exploration.md](../intelligence-center/narratives-exploration.md)/
>    [executive-overview.md](../intelligence-center/executive-overview.md) e
>    `aggregated-metrics/sql-aggregation.md`/`service-layer-aggregation.md`.
> 3. **Bug real corrigido em `sentiment_bucket`** ("no Frontend está tudo
>    neutro"): o fallback local de `public.narratives_overview` (usado só
>    enquanto `net_sentiment`, a fonte oficial, ainda não sincronizou pra
>    aquele dia/Narrativa) dividia `(sentiment_positive - sentiment_negative)`
>    pelo **total** de mentions (incluindo as neutras), o que dilui o
>    resultado sempre que há uma fatia relevante de mentions neutras/factuais
>    — exigindo um desequilíbrio grande demais pra sair de 'neutral'.
>    Corrigido pra normalizar por `(sentiment_positive + sentiment_negative)`,
>    mesma definição usada por `net_sentiment`. Separadamente,
>    `runDailyMetricsStep()` (bw-sync) fazia as chamadas de `net_sentiment`
>    por Narrativa/Query inteira por **último** entre as 10 chamadas fixas
>    de agregado da fase, sob risco de ficarem de fora quando o orçamento de
>    25 chamadas/invocação se esgotava antes de chegar nelas — reordenado
>    pra rodar logo após o loop de sentimento, com prioridade sobre as
>    demais métricas. Ver migration `20260720000000` e `CLAUDE.md`.

> ⚠️ **Itens 1 e 2 acima revertidos no dia seguinte (2026-07-21)** — pedido
> do usuário, mesma sessão que corrigiu o escopo de "Pautas Eleitorais"
> (ver [electoral-themes.md](../intelligence-center/electoral-themes.md)):
> "Para facilitar vamos considerar apenas as subcategorias em todas as
> narrativas. Retire a regra de 'categoria - subcategoria'." Toda página
> volta a listar só Narrativas-folha (Subcategory) — `narrativesScopeForPage()`
> agora retorna `'leaves'` pra Overview/Narrativas/Plataformas/Relatórios e
> `'pautas'` (mais restrito ainda) pra Pautas Eleitorais, nunca mais
> `'roots'`/`null`. Sem a Category raiz misturada na mesma lista, o título
> composto deixou de resolver alguma ambiguidade real —
> `buildNarrativeTitle()` voltou a devolver só o nome da própria
> Category/Subcategory, e migration `20260721030000` faz o backfill inverso
> (título de volta ao nome simples pra toda Narrativa-Subcategory já
> existente). Item 3 (fix de `sentiment_bucket`) continua em vigor, não foi
> afetado.

> ✅ **Cards de Narrativa redesenhados (2026-07-21)**: `get_narratives_table`
> (migration `20260721010000`) ganhou `sentiment_positive_pct`/
> `sentiment_neutral_pct`/`sentiment_negative_pct` (split de
> `narrative_metrics.sentiment_*`, normalizado por `(pos+neu+neg)`, nunca
> pelo total de mentions), `summary` (= `narratives.description`, o mesmo
> campo reservado desde sempre nesta spec, "Regras de negócio" — segue sem
> produtor, mas agora lido pelo frontend) e `tags` (top termos/hashtags de
> `bw_query_topics` por Narrativa). Ver
> `aggregated-metrics/sql-aggregation.md`, "Campos do card de Narrativa", e
> `intelligence-center/narratives-exploration.md`.

> ✅ **"Resumo executivo" ganha produtor (2026-07-14)** — achado real desta
> sessão, a partir de screenshot do usuário: todo card de Narrativa
> mostrava o fallback "Resumo automático ainda não disponível para esta
> Narrativa." indefinidamente — `description` (= `summary` no bloco
> `narratives` do envelope) nunca teve nenhum caminho de escrita em nenhuma
> camada do produto desde `20260707000000`, apesar de `narratives-exploration.md`
> já apontar o candidato natural desde 2026-07-13 ("reaproveitando os
> `highlights` do `event-radar`"). Fechado com `narrative-summary-composer`
> (Edge Function nova, `pg_cron` a cada 30min, migration `20260804010000`)
> — ver "Resumo executivo (produtor)" abaixo pro fluxo completo. Mesma
> sessão também encontrou e corrigiu uma regressão real e silenciosa em
> `get_narratives_table`: a migration `20260802030000` (fix de sentimento
> "Neutro predominante") tinha sido escrita a partir de uma cópia da
> versão *anterior* ao boost de risco do `event-radar` (`20260802010000`,
> "Fase B"/A2), revertendo esse boost sem nenhum aviso — `create or
> replace` com a mesma assinatura não alertou de nada, e
> `aggregated-metrics/sql-aggregation.md` nunca tinha sido atualizado pra
> refletir a perda porque a sessão de 2026-08-02 nunca tocou nesse trecho.
> Corrigido na migration `20260804000000` (reúne as duas correções que
> deveriam ter sido a mesma migration). Ver
> `aggregated-metrics/sql-aggregation.md`, "Risco", pra nota completa.

## Objetivo

Manter Narrativas como entidades vivas e mensuráveis — com sinais de
detecção, classificação e métricas históricas — servindo de base tanto para
a tabela interativa do Executive Overview quanto para cruzamento futuro com
Entities (Sprint 2) e para relatórios (Sprint 4).

## Usuários afetados

Analistas (leitura, via Executive Overview/Intelligence Center). **Não há
CRUD de Narrativas em nenhuma versão do produto** — ver "Interface (UI)" e
"Regras de negócio", decisão fechada 2026-07-13.

## Fluxo principal (dados, não UI)

1. ✅ **Toda Narrativa vem 100% da integração com a Brandwatch — decisão
   fechada 2026-07-13** ("As narrativas vêm todas da integração com a
   Brandwatch (categorias e subcategorias). Não haverá CRUD de narrativas
   no sistema."). `bw-sync` (`ensureNarrativesFromCategories()`, chamada no
   final do bootstrap/refresh de metadata — ver `sync-brandwatch.md` passo
   4) cria uma Narrativa por `bw_categories` — **Category de topo e
   Subcategory**, desde a correção de 2026-07-12 (`bw_categories.parent_id`
   não importa mais pra decidir se auto-cria, só pra saber se é
   "Pauta" ou "Narrativa dentro da pauta" na UI, ver
   `intelligence-center/electoral-themes.md`). `bw_category_id` = a
   Category/Subcategory. `title` = sempre o próprio nome da
   Category/Subcategory (`buildNarrativeTitle()` em `bw-sync/index.ts`) —
   ✅ **estado atual desde 2026-07-21**, revertendo um formato composto
   `"<Category> - <Subcategory>"` adotado brevemente em 2026-07-20 (ver
   "Alterado (2026-07-20)"/"revertidos no dia seguinte" acima). Idempotente
   (nunca sobrescreve `title`/`stage`/`risk_level` de uma Narrativa já
   existente).
   **Não existe** caminho de criação fora deste — nem manual, nem por
   sinal isolado (`narrative_signals` sem `bw_category_id`), nem por UI.
   `narrative_signals` continua existindo no schema, mas só como
   complemento **qualitativo** de uma Narrativa que já tem `bw_category_id`
   (ex: palavras-chave extras pra contexto), nunca como mecanismo pra criar
   uma Narrativa sem Category — ver Regras de negócio.
2. `refresh_narrative_metrics()` roda de hora em hora via `pg_cron`
   (`refresh_narrative_metrics_hourly`, `'0 * * * *'`) e, desde
   2026-08-06, também logo após a fase `daily_metrics` de `bw-sync`
   gravar dado novo — ver [data-model.md](data-model.md), "`pg_cron` —
   agendamentos deste módulo": copia de `bw_query_metrics_daily`
   (`source = 'bw_aggregate'`) para toda Narrativa (sempre tem
   `bw_category_id`, ver item 1). ⚠️ **Correção 2026-08-06**: até então
   esta linha dizia "roda diariamente" — descrição sempre incorreta desde
   que o cron foi agendado em `20260710030000` (é `'0 * * * *'`, de hora
   em hora, não diário); só ficou visível como um problema real quando um
   usuário rodou `bw-sync` manualmente e reportou que o painel não
   refletia o novo dado — o atraso real (até 59min entre execuções do
   cron) era maior do que essa descrição sugeria, e sem relação alguma com
   quando `bw-sync` de fato termina um ciclo. ⚠️ **Nota de consistência**: a versão
   anterior desta spec ainda descrevia aqui um fallback pra
   `source = 'mentions_sample'` (agregação local sobre `narrative_signals`
   quando não há `bw_category_id`) — esse caminho **nunca existe mais**
   desde a premissa fixada em 2026-07-11 (migration `20260711010000`, ver
   `foundation/overview.md`/`CLAUDE.md`) e, com a decisão de hoje, deixou
   de ter até um cenário hipotético que o justificasse (não existe mais
   Narrativa sem `bw_category_id`). Documentação corrigida pra refletir a
   realidade atual, não redescrever um caminho já removido.
3. O Executive Overview (e Intelligence Center/relatórios) lê
   `narrative_metrics`/`reporting.narratives_overview` — nunca recalcula por
   conta própria (ver Regra de negócio abaixo).

## Resumo executivo (produtor)

✅ **Implementado (2026-07-14)**, migration `20260804010000` +
`supabase/functions/narrative-summary-composer/index.ts`. Diferente do
resto desta spec (dados 100% derivados da Brandwatch, sem escrita fora de
`bw-sync`), `description`/`description_generated_at` são a única exceção
— escritos exclusivamente por este job, nunca por `bw-sync`, nunca por UI.

1. `narrative_summary_due_ids(p_batch_size)` (SQL) seleciona, por
   invocação (até `NARRATIVE_SUMMARY_BATCH_SIZE`, default 5), Narrativas
   com Category/Subcategory ainda `active` cujo resumo: nunca foi gerado;
   ou tem mais de 7 dias (refresh periódico — sentimento/momentum/risco
   derivam continuamente, não só de eventos discretos); ou tem um
   `feed_events` (evento do `event-radar`) novo desde o último resumo; ou
   tem uma Comunicação/Decisão nova (`communications`) desde o último
   resumo.
2. `narrative_summary_build_payload(id)` (SQL) monta o payload agregado: os
   scores da própria Narrativa via `get_narratives_table` (mesma fonte que
   a tabela/cards já mostram — o resumo tem que concordar com os números
   ao lado dele), até 5 eventos recentes do radar, até 5 Comunicações/
   Decisões recentes e, desde 2026-08-06 (migration `20260806000000`),
   `sample_mentions` — até 8 mentions reais da Narrativa
   (`narrative_matched_mentions()`, mesma janela de 30 dias dos scores,
   texto = `coalesce(full_text, snippet)` truncado a 400 caracteres,
   ranqueadas por `reach_estimate`). **Reverte, só pra este produtor**, a
   decisão original "nunca texto bruto de mentions" (mesmo princípio de
   `event_radar_build_agent_payload`, `event-radar/agent-orchestrator.md`,
   que continua sem ler mentions cruas) — pedido explícito do usuário pra a
   IA explicar do que a Narrativa trata e o que está acontecendo nela, não
   só repetir os scores. Uso é **qualitativo** (contexto de conteúdo real),
   nunca estatístico: o `SYSTEM_PROMPT` proíbe explicitamente usar
   `sample_mentions` pra afirmar proporções/percentuais — para números, só
   `scores`. Nenhuma chamada nova à Brandwatch (100% dado já sincronizado
   por `bw-sync`); ver "Amostragem de mentions via Brandwatch" em
   `_pending.md`/histórico de research desta mesma sessão pro porquê disso
   ser tecnicamente possível também via API (`category=<id>` em
   `/data/mentions`), mas resolvido aqui com o dado local, sem custo extra
   de rate limit.
3. Uma chamada ao Claude Haiku 4.5 por Narrativa, texto livre (3-5 frases,
   até 500 caracteres, guardado por truncamento defensivo no código, nunca
   só confiado ao prompt) — mesmo padrão da Camada 1 de
   `aggregated-metrics/ai-synthesis.md` (`composeLayer1NarrativeText`),
   não o schema JSON estruturado do `event-radar-agent-orchestrator`
   (aqui a saída é só prosa, não dado estruturado). Tom segue a skill
   `humanizer-pt-br` (instalada 2026-08-06, pedido explícito do usuário) —
   reforçada como instrução direta no `SYSTEM_PROMPT` (a skill em si é um
   guia interativo de edição, não um trecho colável na API), mesmo padrão
   agora replicado em `event-radar-agent-orchestrator` e na Camada 1 de
   `ai-synthesis.md`. Objetivo: texto objetivo, direto, sem os tiques de
   escrita de IA (aberturas de preenchimento, atribuição vaga, conclusão
   genérica etc.) e sem textos longos.
4. `update narratives set description = ..., description_generated_at =
   now()` só em caso de sucesso — uma falha de composição (recusa, erro de
   rede, resposta vazia) não escreve nada; a Narrativa continua elegível
   na próxima invocação via `narrative_summary_due_ids()`.

Agendado via `pg_cron` a cada 30min (`narrative-summary-composer-heartbeat`,
menos urgente que o heartbeat de 15min de `bw-sync`/`event-radar` — um
resumo executivo é uma foto do estado atual, não uma detecção em tempo
real). Modelo configurável via `NARRATIVE_SUMMARY_MODEL` (secret próprio,
default `claude-haiku-4-5`, mesma decisão de custo já tomada para
`event-radar-agent-orchestrator`).

⚠️ Não testado contra a API real da Anthropic nem contra um Supabase real
nesta sessão (sem credenciais/ambiente disponíveis) — revisado
manualmente. Confirmar em produção, via logs (`[narrative-summary-composer]`),
que `description` está de fato sendo populado depois do próximo deploy.

### Admin force-refresh (2026-07-14)

✅ Pedido do usuário: "permita que eu consiga executar a atualização do
resumo executivo... por algo disponível na sessão do administrador."
Esperar o próximo tick do `pg_cron` (a cada 30min) e que a organização do
admin calhe de ser a mais "devida" no momento não é uma opção pra quem
quer confirmar agora que o resumo está atualizado.

Nova Edge Function **`admin-refresh-narrative-summaries`** (mesmo padrão
de auth de todo `admin-*`: Bearer JWT → `supabaseAdmin.auth.getUser(token)`
→ checar `user_profiles.is_admin`) — duplica a lógica de composição de
`narrative-summary-composer` (mesmo `SYSTEM_PROMPT`/modelo/truncamento,
Princípio técnico 5), mas a origem da lista de Narrativas é diferente:
`narrative_summary_due_ids()` ganhou `p_organization_id uuid default
null`/`p_force boolean default false` (migration `20260809060000`, `drop
function` — mudança de aridade de 1 pra 3 parâmetros). Chamada do
`pg_cron` (sem argumentos) continua com o comportamento de sempre — as 4
condições de staleness, sem filtro de organização. Chamada desta Edge
Function passa `p_organization_id => <org do admin>`/`p_force => true` —
ignora as 4 condições e devolve **toda** Narrativa ativa daquela
organização, até `MAX_BATCH_SIZE = 50` por chamada (admin clica de novo se
sobrar mais, mesmo padrão de "continuar em lotes" já aceito em outras
partes do produto — ex: backfill de mentions).

Roda de forma síncrona (o admin está disposto a esperar, mesmo padrão de
`compose-narrative-synthesis`), botão "Atualizar resumos executivos das
Narrativas" em `/narratives` (admin-only, `intelligence-center/
narratives-exploration.md`). **Deliberadamente não exposto via
`narrative-summary-composer` em si** — essa function só o `pg_cron` chama
(`verify_jwt = false`, sem CORS/auth); aceitar um `organization_id`
arbitrário ali sem autenticação seria um vetor de "gaste dinheiro de IA da
vítima" pra qualquer um que soubesse a URL, daí a Edge Function separada
com o gate de admin de verdade.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Narrativa sem nenhum sinal e sem `bw_category_id` | `refresh_narrative_metrics()` não gera linha para ela naquele dia (sem mentions para agregar) — Narrativa aparece na tabela com métricas zeradas/vazias, não é erro |
| Narrativa com `bw_category_id` apontando para uma Category sem `bw_query_metrics_daily` sincronizado ainda | Sem linha em `narrative_metrics` até o próximo `sync-brandwatch` popular o agregado — tratar como estado de carregamento na UI, não erro |
| Dois sinais conflitantes (ex: um `keyword` muito genérico trazendo ruído) | Fora do escopo técnico — é curadoria do analista; `weight`/`is_active` em `narrative_signals` existem para permitir desativar um sinal sem apagar o histórico |

## Interface (UI)

✅ **Resolvido 2026-07-13**: **não há, e não haverá, tela de CRUD de
Narrativas** — nem no Sprint 1, nem em nenhum sprint futuro. A única
leitura prevista é consumo (Executive Overview/Intelligence Center, ver
`../intelligence-center/executive-overview.md`). Narrativas existem
exclusivamente porque `bw-sync` as espelhou de uma Category/Subcategory
já configurada na Brandwatch (ver `brandwatch-setup.md`) — criar, editar
estrutura ou excluir uma Narrativa pela aplicação nunca é uma operação
suportada; a única forma de "criar" uma Narrativa é criar a
Category/Subcategory correspondente na Brandwatch e esperar o próximo
sync. Substitui a ⚠️ DECISÃO PENDENTE anterior desta seção ("confirmar se
`intelligence-center` é o lugar certo pro CRUD de Narrativas") — não é
mais uma pergunta em aberto, é uma decisão fechada: não existe CRUD em
lugar nenhum do produto.

## Regras de negócio

- Uma Narrativa com `bw_category_id` **sempre** usa `source = 'bw_aggregate'`
  para os números de volume/sentimento — nunca cai para agregação local
  mesmo que `narrative_signals` também exista para ela (sinais viram
  complementares/qualitativos nesse caso, não fonte do número).
- `narrative_matched_mentions()` é a **única** definição de "mentions desta
  Narrativa" — qualquer feature nova que precise desse recorte (Intelligence
  Center, `narrative_entities` no Sprint 2) reusa essa função, não
  reimplementa o matching.
- `narratives.risk_level`/`priority` (colunas do schema) não têm mais UI
  de edição prevista (ver "Interface (UI)" acima — decisão de não ter
  CRUD) e, pra Risco, a UI hoje mostra `risk_score` (calculado, ver
  `aggregated-metrics/sql-aggregation.md` "Scores de Narrativa"), não
  `risk_level`. As colunas continuam no schema (podem ser populadas por
  SQL/backend direto se necessário), mas não são mais descritas como
  "julgamento do analista via UI" — não existe essa UI.

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily`, `mentions` (via `narrative_matched_mentions`).
- **Escreve**: `narratives` — `title`/`stage`/`risk_level`/`priority` exclusivamente por `ensureNarrativesFromCategories()` em `bw-sync`; `description`/`description_generated_at` exclusivamente por `narrative-summary-composer` (ver "Resumo executivo (produtor)" acima) — sem escrita via UI/cliente em nenhum dos dois casos, ver "Interface (UI)"; `narrative_signals` (complemento qualitativo, manual/seed via backend, nunca cria Narrativa nova), `narrative_tags` (manual/seed), `narrative_metrics` (via `refresh_narrative_metrics()`).
- Detalhes: [data-model.md](data-model.md).

## Permissões

| Ação | Quem pode |
|---|---|
| Ler Narrativas/métricas | Membros da organização (RLS) |
| Criar/editar/excluir Narrativa | Ninguém — sem CRUD em nenhuma camada do produto (ver "Interface (UI)") |
| Criar Narrativa a partir de Category/Subcategory | Automático (`bw-sync`, service role) — único mecanismo existente |
| Gerar/atualizar `description` (Resumo executivo) | Automático (`narrative-summary-composer`, service role, `pg_cron`) — único mecanismo existente, ver "Resumo executivo (produtor)" |
| Criar sinal complementar (`narrative_signals`) numa Narrativa já existente | Manual via SQL/backend, sem UI — não cria Narrativa nova, só adiciona contexto qualitativo a uma já auto-criada |

## Notificações / Feedback

Nenhuma — sem UI de gestão em nenhum sprint. Eventos de "Narrativa
detectada" automaticamente por IA (`feed_event_type = 'narrative_detected'`)
são do `event-radar` (ex-`intelligent-feed`)/Decision Center (Sprint 3),
fora deste escopo.

## Dependências técnicas

- `bw_query_metrics_daily` e `sync-brandwatch` (fonte dos agregados oficiais).
- Skill `brandwatch-api`: `references/data-restrictions-compliance.md` (por
  que sinais de texto são best-effort em X/Reddit/LinkedIn/News).
- `narrative_matched_mentions()` (ver "Regras de negócio" acima) — fonte de
  `sample_mentions` no payload do `narrative-summary-composer` (ver "Resumo
  executivo (produtor)"). Nenhuma chamada nova à Brandwatch: usa `mentions`
  já sincronizada localmente.
- Skill `humanizer-pt-br` (`.agents/skills/humanizer-pt-br/SKILL.md`,
  instalada 2026-08-06) — padrões de tom destilados no `SYSTEM_PROMPT` do
  `narrative-summary-composer`. Ver `aggregated-metrics/ai-synthesis.md`,
  "Dependências técnicas", pro detalhe completo.

## Referências relacionadas

- [overview.md](overview.md) — validação de viabilidade completa, decisão de
  design (por que `bw_category_id` é coluna direta, não sinal EAV).
- [data-model.md](data-model.md)
- [../intelligence-center/executive-overview.md](../intelligence-center/executive-overview.md)
