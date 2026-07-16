---
tipo: feature-spec
módulo: entities
funcionalidade: author-linking
status: implementado
atualizado: 2026-08-01
---

# Vínculo com Autores e Influenciadores

> ✅ **Implementado (2026-08-01)**, pedido do usuário: "revise a página e
> o backend de autores e influenciadores e sugira novas visualizações
> integrando com a tabela entities... totalmente interativa". Auditoria de
> código confirmou que **nada desta spec tinha sido implementado ainda** —
> `get_authors_ranking` sempre devolveu `entity_id`/`risk_level` como
> `null::uuid`/`null::text` hardcoded, sem nenhum `JOIN` real com
> `entities`/`entity_accounts`. Migration
> `supabase/migrations/20260801010000_authors_entity_enrichment.sql` —
> `LEFT JOIN entity_accounts`/`entities`/`entity_tags` exatamente como
> especificado abaixo (contra a definição **real** da function, migration
> `20260721030000`, não uma suposição), mais o campo `mentions` (achado na
> mesma revisão — `g.volume` já existia só pra ordenar, nunca tinha sido
> exposto). Propagado em `AuthorRow`
> (`packages/shared-types/src/envelope.ts` + cópia inline nas **7** Edge
> Functions `get-page-*`/`get-narrative-detail`, Princípio técnico 5). O
> desenho de UI completo (filtros, KPIs, dispersão alcance×sentimento,
> breakdowns por ideologia/partido, painel de detalhe) foi implementado em
> [`intelligence-center/authors-and-influencers.md`](../intelligence-center/authors-and-influencers.md)
> — este arquivo é só o mecanismo de backend (o `JOIN`, os campos novos do
> envelope). **Não implementado nesta sessão**: o botão "+ Cadastrar
> Entidade" (ver "Cadastro rápido a partir de um autor já visto" abaixo) já
> aparece no painel de detalhe, mas ainda não abre o `EntityFormModal` de
> verdade — depende de `entity-registration.md` (CRUD ainda não
> implementado) existir primeiro.

## Objetivo

Conectar o Cadastro de Entidades ao ranking nativo de autores da Brandwatch
(`bw_query_top_authors`/`bw_query_top_tweeters`, já sincronizado por
`foundation` desde o Sprint 1, exposto hoje via `get_authors_ranking` —
`aggregated-metrics/sql-aggregation.md`) — é o pedido explícito do usuário
("vincular essa tabela com a visão de autores e influencias"). O ranking já
responde "quem está falando muito"; este vínculo faz o produto também
responder "quem essa pessoa é" (partido, espectro, cargo, nível de
influência) direto na mesma visão, sem sair da tela — a base concreta para
relatórios "por diversas perspectivas" que o cadastro de Entidades existe
para viabilizar.

## Mecanismo de vínculo

`entities`/`entity_accounts` **não têm nenhuma FK** para `bw_query_top_authors`/
`bw_query_top_tweeters`/`mentions` — essas são tabelas espelho da
Brandwatch (`foundation`), só leitura, e uma Entity pode existir sem nunca
ter sido vista pela Brandwatch (ex: um partido cadastrado preventivamente).
O vínculo é um **`JOIN` em tempo de leitura**, por texto:

```
lower(trim(entity_accounts.username)) = lower(trim(bw_query_top_authors.author))
lower(trim(entity_accounts.username)) = lower(trim(bw_query_top_tweeters.author))
```

Mesma convenção de comparação já usada em todo o projeto para handles
(`mentions.author_handle_normalized = lower(author)`, `narrative_signals`
"author_handle" — ver `foundation/data-model.md`/`foundation/overview.md`)
— nunca uma comparação sensível a maiúsculas/`@`, para não depender de o
admin digitar o handle exatamente como a Brandwatch formata internamente.

⚠️ **Limitação aceita, documentada**: o `JOIN` é só por `username`, sem
considerar `platform` — na prática improvável de colidir (o mesmo texto de
handle raramente existe em duas plataformas diferentes apontando para
Entities diferentes), mas não é uma garantia matemática. Revisitar só se
uma colisão real for reportada.

⚠️ **Possível colisão real reportada (2026-08-09, não confirmada)** —
usuário relatou uma Entity cadastrada manualmente ("Revista Fórum",
`ideologia = 'esquerda'`) exibindo `ideologia = 'direita'` na UI.
Auditoria de código completa (`entity_match`, `ideologyLabel`/
`ideologyBadgeClass`/`IDEOLOGY_HEX`, `tailwind.config.ts`) não encontrou
nenhum bug — todo mapeamento é por chave de dicionário direta. Sem acesso
ao banco real neste ambiente (RLS de `entities` exige
`auth.role() = 'authenticated'`), não foi possível confirmar se é
exatamente esta colisão de handle entre plataformas, uma segunda Entity
duplicada com o mesmo handle, ou um erro de digitação direto no Supabase
Table Editor. Ver `_pending.md` #37 para o diagnóstico completo e o
próximo passo (query de verificação a rodar pelo usuário).

## Extensão de `get_authors_ranking` (aggregated-metrics)

✅ **Aditiva, nunca pré-requisito do ranking** — mesma assinatura de
entrada (`p_organization_id, p_period_start, p_period_end, p_filters,
p_scope`), mesmo comportamento pra quem não tem nenhuma Entity cadastrada.
A versão **real** e atual da function (confirmada por leitura direta da
migration `20260721030000` nesta sessão — não a versão assumida quando
esta spec foi escrita em 2026-07-13) já calcula um CTE final `grouped` (1
linha por autor, deduplicado, com `reach_estimate`/`impact`/`volume`
somados e `is_influential`/`narrative_labels` agregados) antes do
`select` de saída. O vínculo entra **depois** desse `grouped`, como mais
um `LEFT JOIN` sobre o resultado já pronto — não muda nenhum cálculo de
ranking existente:

```sql
entity_match as (
  -- 1 linha por handle (lower/trim), desempatando por created_at quando o
  -- mesmo texto de username existe em 2 entity_accounts diferentes (ver
  -- "Limitação aceita" abaixo — o vínculo ignora platform de propósito).
  select distinct on (lower(trim(ea.username)))
    lower(trim(ea.username)) as author_key,
    ea.entity_id
  from entity_accounts ea
  join entities e on e.id = ea.entity_id and e.is_active = true
  order by lower(trim(ea.username)), ea.created_at asc
),
entity_tags_agg as (
  select et.entity_id,
    jsonb_agg(jsonb_build_object('tag_type', et.tag_type, 'tag_value', et.tag_value)
      order by et.tag_type, et.tag_value) as tags
  from entity_tags et
  group by et.entity_id
)
select
  em.entity_id,
  g.author as name,
  coalesce(g.account_type, 'unknown') as type,
  g.reach_estimate::numeric as reach,
  g.impact as engagement,
  g.volume::numeric as mentions,          -- ✅ novo, ver nota abaixo
  null::text as risk_level,                -- inalterado, gap #11 de _pending.md
  ent.type::text as entity_type,
  ent.cargo as entity_cargo,
  ent.partido as entity_partido,
  ent.ideologia as entity_ideologia,
  ent.influence_level::text as entity_influence_level,
  coalesce(eta.tags, '[]'::jsonb) as entity_tags,
  g.is_influential,
  asent.sentiment_positive, asent.sentiment_neutral, asent.sentiment_negative,
  coalesce(g.narrative_labels, '{}') as narrative_labels
from grouped g
left join author_sentiment asent on asent.author = g.author
left join entity_match em on em.author_key = lower(trim(g.author))
left join entities ent on ent.id = em.entity_id
left join entity_tags_agg eta on eta.entity_id = em.entity_id
order by g.volume desc nulls last
```

Campos novos no `returns table`: `entity_type`, `entity_cargo`,
`entity_partido`, `entity_ideologia`, `entity_influence_level`,
`entity_tags jsonb` (array de `{tag_type, tag_value}` — hoje cobre
`state`/`power_branch`/`stance_to_candidate`, **não** `party`/`office`,
que viraram `entity_partido`/`entity_cargo` e foram removidos de
`entity_tags`, ver `data-model.md`), e **`mentions numeric`** — ✅ achado
nesta revisão: `g.volume` (soma de menções por autor) já era calculado
para ordenar o ranking (`order by g.volume desc`) mas **nunca era
devolvido ao client** — gap real, fechado na mesma migration por ser a
mesma linha de código, e porque o usuário pediu explicitamente
"menções" como uma das perspectivas de avaliação.

Só considera Entities com `is_active = true` (`join entities e on ... and
e.is_active = true` dentro de `entity_match`) — uma Entity desativada
(`entity-registration.md`, "Regras de negócio") deixa de enriquecer o
ranking, mesmo que a conta ainda exista em `entity_accounts` (efeito
imediato de "Desativar": some do enriquecimento sem precisar apagar a
conta).

⚠️ **`p_period_start`/`p_period_end` continuam aceitos mas não usados por
esta function** (achado confirmado nesta revisão, não uma regressão desta
mudança) — `bw_query_top_authors`/`bw_query_top_tweeters` não guardam
histórico por período: `metric_week` é só um marcador de frescor/throttle
(mesmo caráter já documentado pra `bw_query_topics.metric_week` em
`foundation/data-model.md`), a tabela sempre reflete o snapshot mais
recente, não uma série histórica. Diferente de um bug real (como o de
`daily_metrics`/`get_metrics_cards` já corrigidos em sessões anteriores),
**não há dado histórico nenhum pra esta function filtrar por período** —
tentar "consertar" isso fabricaria um filtro sobre um dado que não existe.
Documentado aqui em vez de silenciosamente ignorado, e o parâmetro
permanece na assinatura só por consistência com as demais functions do
módulo.

## Extensão do envelope (`standard-json-envelope.md`, `AuthorRow`)

✅ **Aditiva** — mesmo princípio de todo campo novo já adicionado ao
envelope neste projeto (nunca quebra um consumidor que ainda não lê o
campo novo). `AuthorRow` ganha:

```
entity_type: string | null            // entities.type, rótulo cru (ex: "person")
entity_cargo: string | null           // entities.cargo (ex: "Deputado Federal")
entity_partido: string | null         // entities.partido (sigla, ex: "PT")
entity_ideologia: string | null       // entities.ideologia (ex: "centro-esquerda")
entity_influence_level: string | null // entities.influence_level (low|medium|high|critical)
entity_tags: { tag_type: string; tag_value: string }[]  // sempre array, nunca null
mentions: number                      // g.volume — ✅ novo (2026-08-01), nunca opcional/null
```

`entity_cargo`/`entity_partido`/`entity_ideologia` são campos fixos (não
genéricos) porque, desde 2026-07-13, viraram colunas estruturadas de
`entities` — não fazem mais parte de `entity_tags` (ver `data-model.md`,
"⚠️ `party`/`office`/`political_spectrum` saíram desta tabela"). O array
`entity_tags` continua genérico (espelha `entity_tags` linha a linha, sem
campos fixos) só para as dimensões que **continuam** EAV (`state`/
`power_branch`/`stance_to_candidate` e qualquer dimensão nova) — a
taxonomia dessas seguem extensível por design, então o envelope não pode
assumir nomes fixos pra elas sem recriar, no lado do contrato, a mesma
rigidez que `entity_tags` foi desenhada para evitar no lado do banco.

## Onde isso aparece

`components/intelligence-center/authors-list.tsx` é o componente
compartilhado que recebe o enriquecimento — hoje renderizado em 3 lugares
(✅ confirmado por grep nesta sessão, corrige a lista desatualizada que
esta spec tinha antes — `/platforms` **não** renderiza mais
`AuthorsList` desde 2026-07-25, foi movido para a página dedicada
`/authors`):

| Página | Envelope/escopo | `p_scope` |
|---|---|---|
| `/authors` (`get-page-authors`) | Ranking completo, Query inteira | `null` |
| `/themes` (`get-page-themes`) | Só autores que citaram alguma pauta | `'pautas'` |
| `/narratives/[id]` (`get-narrative-detail`) | Só a Narrativa aberta | `null` (escopado via `filters.narratives`) |

O desenho completo de UI (como o selo de partido/ideologia aparece, o
painel de detalhe, os novos gráficos que cruzam menções/sentimento com
partido/ideologia) é responsabilidade de `intelligence-center`, não deste
módulo — ver
[`intelligence-center/authors-and-influencers.md`](../intelligence-center/authors-and-influencers.md),
"Redesenho interativo (2026-08-01)". Este arquivo garante só que o dado
(`entity_id`/`entity_cargo`/`entity_partido`/`entity_ideologia`/
`entity_tags`/`mentions`) chega correto no `AuthorRow` — quando `entity_id`
é `null` (autor não cadastrado como Entity), a linha degrada normalmente,
sem nenhum campo extra preenchido.

## Cadastro rápido a partir de um autor já visto

✅ Fecha o outro lado do pedido do usuário ("vincular... com a visão de
autores") com uma via de mão dupla, não só leitura: qualquer linha de
`AuthorsList` sem `entity_id` (a maioria) ganha uma ação secundária
"+ Cadastrar Entidade" (visível só para admins, mesmo gate de
`entity-registration.md`) que abre o `EntityFormModal` já com uma linha de
conta pré-preenchida (`platform`/`username` = os dados do autor daquela
linha) — o admin só completa Tipo/Nome/classificação, sem digitar o handle
de novo. Mesmo espírito de UX de "Entrada rápida a partir de uma
Narrativa" já usado por `communications/communication-registration.md`,
aplicado ao caminho inverso (a partir de um autor, não de uma Narrativa).

Depois de salvar, a linha do autor na mesma tela atualiza para refletir o
vínculo novo **no lugar** (sem recarregar a página), mesmo padrão já
estabelecido em `communication-registration.md`.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Autor sem Entity vinculada | Linha renderiza normalmente, sem selo — "+ Cadastrar Entidade" visível só para admins |
| Handle do autor já cadastrado em outra Entity (colisão rara) | O `EntityFormModal` pré-preenchido segue o mesmo fluxo de erro já descrito em `entity-registration.md` ("Handle já cadastrado em outra Entity") |
| Usuário não-admin vê uma linha de `AuthorsList` sem Entity vinculada | Sem ação "+ Cadastrar Entidade" (some, não aparece desabilitada) — mesma regra de visibilidade condicional já usada em `user-management.md` para ações admin-only |
| Entity vinculada foi desativada | `entity_id`/`entity_type`/`entity_tags` voltam a `null`/`[]` na próxima leitura do ranking — sem erro, o enriquecimento é sempre best-effort |

## Regras de negócio

- O enriquecimento **nunca** é pré-requisito do ranking em si —
  `get_authors_ranking` já funciona hoje inteiramente sem `entities`
  existir (dado nativo da Brandwatch), e continua funcionando
  identicamente para qualquer autor sem Entity vinculada.
- O `JOIN` nunca cria nem sugere criação automática de Entity — é sempre
  leitura (enriquecimento) ou um atalho de UX que ainda exige confirmação
  manual do admin (ver "Cadastro rápido" acima). Nenhum autor vira Entity
  sozinho.
- Uma Entity desativada (`is_active = false`) some do enriquecimento
  imediatamente (efeito do `LEFT JOIN` filtrando `is_active = true`), sem
  precisar remover a conta de `entity_accounts` — reversível só
  reativando a Entity (`entity-registration.md`).

## Dados envolvidos

- **Lê**: `entity_accounts`/`entities`/`entity_tags` (`is_active = true`),
  `bw_query_top_authors`/`bw_query_top_tweeters` (já lidos por
  `get_authors_ranking` hoje, sem mudança de origem).
- **Escreve**: nenhuma escrita própria desta funcionalidade — a escrita
  (cadastro rápido) reusa `create-entity`/`update-entity`
  (`entity-registration.md`), só com pré-preenchimento diferente.

## Dependências técnicas

- Alteração em `get_authors_ranking` (função SQL existente,
  `aggregated-metrics/sql-aggregation.md`) — aditiva, mesma assinatura,
  só ganha os `LEFT JOIN`s descritos acima.
- Alteração em `AuthorRow`/`standard-json-envelope.md` — 7 campos novos
  (6 de entity + `mentions`), ver "Extensão do envelope" acima. Propagar
  em `@reputation/shared-types` (`packages/shared-types/src/envelope.ts`)
  e, por Princípio técnico 5, nas **7** cópias inline das Edge Functions
  que usam `AuthorRow` (`get-page-overview`, `get-page-narratives`,
  `get-narrative-detail`, `get-page-sentiment`, `get-page-platforms`,
  `get-page-themes`, `get-page-authors` — ✅ lista corrigida nesta sessão,
  a nota anterior dizia "6" porque `get-page-authors` ainda não existia
  quando esta spec foi escrita em 2026-07-13).
- `components/intelligence-center/authors-list.tsx` ganha o selo
  compacto + a ação "+ Cadastrar Entidade" — trabalho de
  `intelligence-center`, não deste módulo, mas listado aqui porque é o
  único componente de UI afetado por esta funcionalidade; por ser
  compartilhado pelas 3 páginas da tabela acima ("Onde isso aparece"),
  uma única mudança neste componente cobre todas de uma vez.

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [entity-registration.md](entity-registration.md)
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md) — `get_authors_ranking`
- [../aggregated-metrics/standard-json-envelope.md](../aggregated-metrics/standard-json-envelope.md) — bloco `authors`/`AuthorRow`
- [../foundation/data-model.md](../foundation/data-model.md) — `bw_query_top_authors`, `bw_query_top_tweeters`, `mentions.author_handle_normalized`
- [../foundation/overview.md](../foundation/overview.md) — "Preparação para relatórios e cruzamento (Narrativa × Entity)"
- [../communications/communication-registration.md](../communications/communication-registration.md) — padrão de "entrada rápida" pré-preenchida reaproveitado
