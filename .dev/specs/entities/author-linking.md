---
tipo: feature-spec
módulo: entities
funcionalidade: author-linking
status: pronto
atualizado: 2026-07-13
---

# Vínculo com Autores e Influenciadores

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

## Extensão de `get_authors_ranking` (aggregated-metrics)

✅ **Aditiva, nunca pré-requisito do ranking** — `get_authors_ranking`
(`aggregated-metrics/sql-aggregation.md`) já reserva `entity_id` desde a
criação do envelope (`standard-json-envelope.md`, bloco `authors`, campo
sempre existente, só `null` até agora). Esta spec fecha essa pendência,
sem mudar a assinatura da function nem o comportamento para quem não tem
nenhuma Entity cadastrada.

Mudança em `get_authors_ranking`: `LEFT JOIN entity_accounts` (por
`username`, ver "Mecanismo de vínculo" acima) sobre o resultado já
calculado, e, quando casar, `LEFT JOIN entities`/`entity_tags` para trazer:

- `entity_id` (já existia no envelope, passa a ser preenchido de fato).
- `entity_type` (novo — `entities.type`, `null` quando não há vínculo).
- `entity_cargo` (novo — `entities.cargo`, ex: "Deputado Federal";
  ✅ **atualizado 2026-07-13** junto da reorganização de campos de
  `data-model.md` — antes desta nota este campo se chamava `description`).
- `entity_partido` (novo — `entities.partido`, sigla, ex: "PT"; ✅
  adicionado 2026-07-13, coluna nova).
- `entity_ideologia` (novo — `entities.ideologia`, ex:
  "centro-esquerda"; ✅ adicionado 2026-07-13, coluna nova — ver
  `data-model.md` para a ressalva de que é classificação de melhor
  esforço, não uma fonte oficial como cargo/partido).
- `entity_influence_level` (novo — `entities.influence_level`, `null`
  quando não há vínculo **ou** quando a Entity vinculada nunca teve esse
  campo avaliado).
- `entity_tags` (novo — array de `{tag_type, tag_value}`, um item por
  linha de `entity_tags` daquela Entity — hoje cobre `state`/
  `power_branch`/`stance_to_candidate` e qualquer dimensão nova que surgir;
  **não** inclui mais `party`/`office`, que viraram `entity_partido`/
  `entity_cargo` acima e foram removidos de `entity_tags` na mesma
  migration; `[]` quando não há vínculo).

Só considera Entities com `is_active = true` — uma Entity desativada
(`entity-registration.md`, "Regras de negócio") deixa de enriquecer o
ranking, mesmo que a conta ainda exista em `entity_accounts` (efeito
imediato de "Desativar": some do enriquecimento sem precisar apagar a
conta).

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

✅ **A página dedicada "Autores e Influenciadores" (`/authors`) já existe e
já está implementada** (`intelligence-center/authors-and-influencers.md`,
2026-07-25 — implementada em paralelo à redação desta spec, não fazia
parte do escopo original quando esta seção foi pensada). Ela própria já
lista, em "Gaps conhecidos", exatamente o que este módulo fecha:
"Classificação de espectro político/tipo de autor (`entities`/
`entity_tags`) — depende de Sprint 3, não implementada. A página de hoje
mostra ranking por alcance/engajamento, não uma visão editorializada por
afiliação." O enriquecimento descrito nesta spec passa a aparecer, sem
mudança de layout própria deste módulo, em **todo** lugar que já renderiza
o componente `AuthorsList` (`components/intelligence-center/authors-list.tsx`)
— `/authors` (ranking completo, escopo Query inteira), detalhe de
Narrativa (principais disseminadores), `/platforms` (perfis relevantes por
plataforma), `/themes` (autores e comunidades por pauta, escopo
`'pautas'`). Quando `entity_id` vem preenchido, a linha do autor ganha um
selo compacto (ex: tipo + partido, quando existir essa dimensão) ao lado
do nome — quando `entity_id` é `null` (autor não cadastrado como Entity, o
caso mais comum hoje), a linha permanece exatamente como já é, sem nenhuma
mudança visual. Nenhuma mudança de escopo/filtro/rota é necessária em
`authors-and-influencers.md` para isso — é só `AuthorsList` passando a
usar campos que já chegam no mesmo `AuthorRow` que ela já consome.

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
- Alteração em `AuthorRow`/`standard-json-envelope.md` — 3 campos novos
  opcionais, ver "Extensão do envelope" acima. Propagar em
  `@reputation/shared-types` (`packages/shared-types/src/envelope.ts`) e,
  por Princípio técnico 5, nas 6 cópias inline das Edge Functions que
  usam `AuthorRow` (`get-page-narratives`... — ver
  `aggregated-metrics/service-layer-aggregation.md`).
- `components/intelligence-center/authors-list.tsx` ganha o selo
  compacto + a ação "+ Cadastrar Entidade" — trabalho de
  `intelligence-center`, não deste módulo, mas listado aqui porque é o
  único componente de UI afetado por esta funcionalidade; por ser
  compartilhado por `/authors`/`platforms`/`themes`/detalhe de Narrativa
  (ver "Onde isso aparece" acima), uma única mudança neste componente
  cobre todas as telas de uma vez.

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [entity-registration.md](entity-registration.md)
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md) — `get_authors_ranking`
- [../aggregated-metrics/standard-json-envelope.md](../aggregated-metrics/standard-json-envelope.md) — bloco `authors`/`AuthorRow`
- [../foundation/data-model.md](../foundation/data-model.md) — `bw_query_top_authors`, `bw_query_top_tweeters`, `mentions.author_handle_normalized`
- [../foundation/overview.md](../foundation/overview.md) — "Preparação para relatórios e cruzamento (Narrativa × Entity)"
- [../communications/communication-registration.md](../communications/communication-registration.md) — padrão de "entrada rápida" pré-preenchida reaproveitado
