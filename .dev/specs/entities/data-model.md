---
tipo: data-model
módulo: entities
status: implementado
atualizado: 2026-07-13
---

# Modelo de Dados — Cadastro de Entidades

> ✅ **Implementado (2026-07-13)**: migration
> `supabase/migrations/20260731000000_entities_schema.sql` — `entity_type`
> (enum) + `entities`/`entity_accounts`/`entity_tags` exatamente como
> especificado abaixo, sem desvio. Reaproveita `severity_level` (enum já
> existente desde `foundation`, `20260707000000` — comentário original já
> dizia "Reusado por risk_level e priority em narratives e futuramente
> cases"), `set_updated_at` (`foundation`) e `is_current_user_admin()`
> (`auth`, `20260713000000`) — nenhuma função nova precisou ser criada.
>
> ✅ **Seed de partidos e parlamentares (2026-07-13)**, pedido do usuário:
> "crie um seed com todos os partidos e parlamentares complementando todas
> as informações que vc conseguir na internet" — migration
> `supabase/migrations/20260731010000_seed_parties_and_parliamentarians.sql`.
> Dados consultados ao vivo nesta sessão contra as APIs de dados abertos
> oficiais do Congresso Nacional (`dadosabertos.camara.leg.br/api/v2/
> deputados`+`/partidos`, `legis.senado.leg.br/dadosabertos/senador/lista/
> atual`) — nunca inventados/estimados, mesma premissa de "nunca fabricar
> dado sem fonte real" já aplicada em todo o resto do projeto (`mentions`/
> sampling, ver `CLAUDE.md`). Cobertura: **21 partidos** com representação
> federal ativa (Câmara e/ou Senado) + **512 deputados federais** + **81
> senadores** = **593 parlamentares**, cada um com 3 `entity_tags`
> (`office`/`party`/`state`) direto dos mesmos endpoints oficiais.
> **Deliberadamente fora do seed** (mesmo critério de nunca fabricar sem
> fonte confiável, ver o comentário completo no topo do arquivo da
> migration): `entity_accounts` (handles de rede social — sem API oficial
> em lote confiável para 593 pessoas; um handle errado quebraria
> silenciosamente o vínculo com `bw_query_top_authors`, ver
> `author-linking.md`), `influence_level` (campo explicitamente manual/
> subjetivo por design), `political_spectrum`/`ideology` (classificação
> contestável — não apresentada como fato sem fonte verificada nesta
> sessão), e partidos registrados no TSE sem parlamentar federal eleito
> hoje (ex: PCO, PSTU, PCB, UP, PMB, PRTB — fora do escopo "partidos e
> parlamentares" tal como as duas fontes oficiais usadas confirmam agora).
> Ambas as migrations foram revisadas manualmente (estrutura de `INSERT`,
> ausência de vírgula solta antes de `on conflict`, encoding UTF-8 dos
> nomes acentuados) mas **não executadas contra um banco real** nesta
> sessão — sem credenciais/deploy neste ambiente, mesma limitação
> recorrente de toda sessão sem acesso ao Supabase Dashboard já registrada
> em várias entradas de `CLAUDE.md`. `entity-registration.md`
> (CRUD/Edge Functions) e `author-linking.md` (`LEFT JOIN` em
> `get_authors_ranking`) continuam `pronto`, não implementados — o módulo
> `entities` como um todo permanece amarelo em `_architecture.md` até os
> dois existirem também.

## Entidades

### `entities`

**Descrição**: Uma pessoa, veículo de imprensa, partido, instituição,
empresa ou movimento relevante para o debate público monitorado (definição
já fixada em `_glossary.md`, "Entity"). Catálogo **global**, não escopado
por `organization_id` (ver `overview.md`, "Escopo: catálogo global") —
fonte da verdade da classificação é sempre este cadastro, nunca a
Brandwatch (que não tem noção de partido/espectro/cargo).

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK — `gen_random_uuid()` |
| `type` | `entity_type` (enum) | sim | `person` \| `media_outlet` \| `party` \| `institution` \| `company` \| `movement` \| `other` — ver enum abaixo |
| `name` | `text` | sim | Nome de exibição (ex: "João da Silva", "Rede Globo", "Partido X") |
| `description` | `text` | não | Texto livre — biografia curta, contexto, por que esta Entity é monitorada |
| `photo_url` | `text` | não | URL de uma imagem/avatar (Supabase Storage ou externa) — sem upload próprio nesta versão, só um campo de URL (mesma simplicidade do `external_url` de `communications`) |
| `influence_level` | `severity_level` (enum reaproveitado) | não | Avaliação **manual e subjetiva** do administrador sobre o quanto esta Entity influencia a campanha/candidato monitorado — `null` até alguém avaliar. Reaproveita o enum Postgres `severity_level` (`low`\|`medium`\|`high`\|`critical`, já criado em `foundation` — `create type severity_level as enum (...)`, reaproveitado por `narratives.risk_level`/`narratives.priority`) em vez de criar um tipo novo — mesmo princípio já registrado em `foundation/overview.md` ("Reuso de enums já existentes em vez de `text` livre") e no próprio comentário dessa migration ("Reusado por risk_level e priority em narratives (e futuramente cases)"). ⚠️ **A UI usa um rótulo próprio para este campo** (ex: "Baixa"/"Média"/"Alta"/"Muito alta"), diferente do rótulo usado para risco de Narrativa/Caso ("Baixo"/"Médio"/"Alto"/"Crítico") — mesmo valor de banco (mesmo tipo `severity_level`), semântica de exibição diferente; não reaproveitar o componente `RiskBadge` sem primeiro trocar o texto, para não confundir "risco" com "influência" na tela |
| `is_active` | `boolean` | sim | Default `true`. Desativar (não excluir) preserva o cadastro para quem já referencia esta Entity — ver `entity-registration.md`, "Regras de negócio" |
| `created_by` | `uuid` | não | FK → `user_profiles(id)` — qual admin cadastrou (auditoria) |
| `updated_by` | `uuid` | não | FK → `user_profiles(id)` — qual admin fez a última alteração (auditoria) |
| `created_at` | `timestamptz` | sim | `now()` |
| `updated_at` | `timestamptz` | sim | Trigger `set_updated_at` (já definida em `foundation`, reaproveitada) |

**Enum `entity_type`** (estrutural — mesma categoria de decisão já usada
para `communication_record_type`: poucos valores, não se espera que
cresça, então um enum Postgres é apropriado em vez de uma tabela de
referência):

| Valor | Rótulo em português (produto) |
|---|---|
| `person` | Pessoa |
| `media_outlet` | Veículo de Imprensa |
| `party` | Partido |
| `institution` | Instituição |
| `company` | Empresa |
| `movement` | Movimento |
| `other` | Outro |

**Índices**:
- `entities_name_idx` em `(name)` — busca/filtro por nome na listagem.
- `entities_type_idx` em `(type)` — filtro por tipo na listagem.
- `entities_is_active_idx` em `(is_active)` — a listagem por padrão só
  mostra ativas (ver `entity-registration.md`).

**Políticas RLS**:

| Operação | Quem pode | Condição |
|---|---|---|
| SELECT | qualquer usuário autenticado | `auth.role() = 'authenticated'` (sem filtro de organização — catálogo global, mesmo padrão de `communication_types`) |
| INSERT/UPDATE/DELETE | admin da plataforma | `is_current_user_admin()` (função já existente, `auth/data-model.md`) |

## `entity_accounts`

**Descrição**: Contas/perfis de uma Entity nas plataformas monitoradas
pela Brandwatch — é o que permite ligar uma Entity ao autor equivalente em
`bw_query_top_authors`/`bw_query_top_tweeters`/`mentions` (ver
[author-linking.md](author-linking.md)). Uma Entity pode ter 0, 1 ou várias
contas (ex: a mesma pessoa no X e no Instagram).

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK — `gen_random_uuid()` |
| `entity_id` | `uuid` | sim | FK → `entities(id) on delete cascade` |
| `platform` | `text` | sim | Mesmo vocabulário livre já usado por `mentions.content_source` (`twitter`, `instagram`, `facebook`, `tiktok`, `reddit`, `linkedin`, `news`, `blog` etc.) — texto livre, não enum, pelo mesmo motivo que `content_source` é texto: a lista de plataformas que a Brandwatch cobre evolui, não vale a pena travar num `ALTER TYPE` |
| `username` | `text` | sim | O handle/identificador exatamente como a Brandwatch reporta (`bw_query_top_authors.author`/`mentions.author`) — sem normalização própria na gravação; toda comparação usa `lower(trim(...))` nos dois lados (mesma convenção já usada por `mentions.author_handle_normalized`/`narrative_signals`, ver `foundation/data-model.md`) |
| `url` | `text` | não | URL do perfil, para o admin conferir/abrir — informativo, não usado no vínculo |
| `created_at` | `timestamptz` | sim | `now()` |
| `updated_at` | `timestamptz` | sim | Trigger `set_updated_at` |

**Índices**:
- `entity_accounts_entity_id_idx` em `(entity_id)`.
- `entity_accounts_platform_username_idx` em `(platform, lower(username))`
  — é como o vínculo com `bw_query_top_authors`/`bw_query_top_tweeters`
  sempre consulta (ver `author-linking.md`).

**Constraint**:
```sql
alter table entity_accounts add constraint entity_accounts_unique_handle
  unique (platform, username);
```
Impede que o mesmo handle, na mesma plataforma, seja cadastrado em duas
Entities diferentes — sem isso, o `JOIN` de enriquecimento em
`get_authors_ranking` (ver `author-linking.md`) ficaria ambíguo (2
resultados para 1 autor). A tela de cadastro deve traduzir a violação
desta constraint numa mensagem amigável (ver `entity-registration.md`,
"Fluxos alternativos").

**Políticas RLS**: mesmas de `entities` (SELECT aberto, escrita
`is_current_user_admin()`).

## `entity_tags`

**Descrição**: Classificação EAV (Entity-Attribute-Value) de uma Entity —
cada dimensão de classificação é um par `tag_type`/`tag_value`. **Uma nova
dimensão de classificação é um `INSERT`, nunca uma migration** — mesma
regra já fixada em `_glossary.md` desde a criação do glossário, e o mesmo
princípio de design já usado por `communication_types`/`bw_categories.status`
neste projeto: taxonomia é dado, não schema.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | `uuid` | sim | PK — `gen_random_uuid()` |
| `entity_id` | `uuid` | sim | FK → `entities(id) on delete cascade` |
| `tag_type` | `text` | sim | Ver vocabulário sugerido abaixo |
| `tag_value` | `text` | sim | Texto livre — o valor daquela dimensão para esta Entity |
| `created_at` | `timestamptz` | sim | `now()` |
| `updated_at` | `timestamptz` | sim | Trigger `set_updated_at` |

**Constraint**:
```sql
alter table entity_tags add constraint entity_tags_unique_dimension_value
  unique (entity_id, tag_type, tag_value);
```
Impede duplicar exatamente o mesmo par `tag_type`/`tag_value` na mesma
Entity — **não** impede múltiplos `tag_value` para o mesmo `tag_type`
(ex: uma Instituição pode ter mais de um `power_branch`) — a UI decide,
por `tag_type`, se oferece seleção única ou múltipla (ver
`entity-registration.md`, "Interface").

**Vocabulário sugerido de `tag_type`** (seed **informativo**, não
enforçado por constraint — qualquer `tag_type` novo é um `INSERT` direto,
sem passar por esta lista):

| `tag_type` | O que representa | Exemplos de `tag_value` | Seleção |
|---|---|---|---|
| `political_spectrum` | Posicionamento político | `esquerda`, `centro-esquerda`, `centro`, `centro-direita`, `direita` | única (recomendado) |
| `ideology` | Corrente ideológica | `liberal`, `conservador`, `progressista`, `nacionalista`, `ambientalista` | múltipla |
| `party` | Partido político (sigla) | `PT`, `PL`, `MDB`, `PSDB`... | única (recomendado) |
| `office` | Cargo/função | `Senador`, `Deputado Federal`, `Prefeito`, `Colunista`, `Apresentador` | única (recomendado) |
| `power_branch` | Poder/instituição a que pertence | `Executivo`, `Legislativo`, `Judiciário`, `Mídia`, `Sociedade Civil`, `Setor Privado` | múltipla |
| `state` | Estado (UF) de atuação | `SP`, `RJ`, `MG`... | única (recomendado) |
| `stance_to_candidate` | Postura em relação ao candidato/campanha monitorada | `aliado`, `opositor`, `crítico ocasional`, `neutro` | única (recomendado) |

⚠️ **`influence_level`, apesar do nome parecido com `stance_to_candidate`
acima, é coluna própria de `entities`, não um `tag_type`** — é o único
campo de classificação tratado como estruturado (não EAV) porque o pedido
original do usuário o trata como um atributo central e único por Entity
("qual o nível de influência sobre o candidato"), o que se beneficia de
ordenação/filtro direto na listagem (mais barato como coluna do que como
`tag_type` — ver `entity-registration.md`, "Interface").

**Políticas RLS**: mesmas de `entities` (SELECT aberto, escrita
`is_current_user_admin()`).

## Relacionamentos

```
entities        ──< entity_accounts   (1:N — 0 ou várias contas por Entity)
entities        ──< entity_tags       (1:N — 0 ou várias classificações por Entity)
user_profiles   ──< entities.created_by  (nullable)
user_profiles   ──< entities.updated_by  (nullable)

-- Vínculo com o dado já sincronizado da Brandwatch (foundation), nunca uma FK real
-- (bw_query_top_authors/mentions não referenciam entities — o vínculo é um JOIN em
-- tempo de leitura, ver author-linking.md):
entity_accounts.username ≈ bw_query_top_authors.author (lower/trim)
entity_accounts.username ≈ bw_query_top_tweeters.author (lower/trim)
entity_accounts.username ≈ mentions.author_handle_normalized (lower, já normalizado)
```

## Notas para a migration

- Depende de `user_profiles` (`auth`, para `created_by`/`updated_by`) e da
  trigger `set_updated_at` (`foundation`) já existirem — roda depois das
  duas.
- Não depende de nenhuma tabela `bw_*` — o vínculo com dado da Brandwatch é
  só de leitura, em tempo de consulta (`author-linking.md`), nunca uma FK.
- Criar o enum `entity_type` antes da tabela `entities`.
- `entities.influence_level` referencia o enum `severity_level` — já criado
  desde a migration inicial de `foundation` (`20260707000000`, ver comentário
  "Reusado por risk_level e priority em narratives") — nenhuma dependência
  nova, roda em qualquer migration posterior à de `foundation`.
- Ordem de criação dentro desta migration: `entity_type` (enum) →
  `entities` → `entity_accounts` → `entity_tags` (cada uma depende da
  anterior via FK).

## Referências relacionadas

- [overview.md](overview.md)
- [entity-registration.md](entity-registration.md)
- [author-linking.md](author-linking.md)
- [../_glossary.md](../_glossary.md) — "Entity", "entity_tags"
- [../auth/data-model.md](../auth/data-model.md) — `is_current_user_admin()`, `user_profiles`
- [../foundation/data-model.md](../foundation/data-model.md) — `mentions.author_handle_normalized`, `bw_query_top_authors`, `bw_query_top_tweeters`
- [../communications/data-model.md](../communications/data-model.md) — mesmo padrão de tabela de referência global (`communication_types`) e de `is_active` em vez de exclusão
