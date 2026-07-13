---
tipo: feature-spec
módulo: foundation
funcionalidade: narratives
status: implementado
atualizado: 2026-07-16
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
   Category/Subcategory, `title` = nome dela. Idempotente (nunca
   sobrescreve `title`/`stage`/`risk_level` de uma Narrativa já existente).
   **Não existe** caminho de criação fora deste — nem manual, nem por
   sinal isolado (`narrative_signals` sem `bw_category_id`), nem por UI.
   `narrative_signals` continua existindo no schema, mas só como
   complemento **qualitativo** de uma Narrativa que já tem `bw_category_id`
   (ex: palavras-chave extras pra contexto), nunca como mecanismo pra criar
   uma Narrativa sem Category — ver Regras de negócio.
2. `refresh_narrative_metrics()` roda diariamente via `pg_cron`
   (ver [data-model.md](data-model.md)): copia de `bw_query_metrics_daily`
   (`source = 'bw_aggregate'`) para toda Narrativa (sempre tem
   `bw_category_id`, ver item 1). ⚠️ **Nota de consistência**: a versão
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
- **Escreve**: `narratives` (exclusivamente por `ensureNarrativesFromCategories()` em `bw-sync` — sem escrita via UI/cliente, ver "Interface (UI)"), `narrative_signals` (complemento qualitativo, manual/seed via backend, nunca cria Narrativa nova), `narrative_tags` (manual/seed), `narrative_metrics` (via `refresh_narrative_metrics()`).
- Detalhes: [data-model.md](data-model.md).

## Permissões

| Ação | Quem pode |
|---|---|
| Ler Narrativas/métricas | Membros da organização (RLS) |
| Criar/editar/excluir Narrativa | Ninguém — sem CRUD em nenhuma camada do produto (ver "Interface (UI)") |
| Criar Narrativa a partir de Category/Subcategory | Automático (`bw-sync`, service role) — único mecanismo existente |
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

## Referências relacionadas

- [overview.md](overview.md) — validação de viabilidade completa, decisão de
  design (por que `bw_category_id` é coluna direta, não sinal EAV).
- [data-model.md](data-model.md)
- [../intelligence-center/executive-overview.md](../intelligence-center/executive-overview.md)
