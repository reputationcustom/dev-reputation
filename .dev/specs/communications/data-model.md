---
tipo: data-model
módulo: communications
status: rascunho
atualizado: 2026-07-25
---

# Modelo de Dados — Comunicações e Decisões

> Módulo novo (Sprint 2.1), pedido do usuário em 2026-07-25: "permitir o
> time de comunicação registrar as ações associadas a cada narrativa" para
> depois medir se houve melhora ou piora do sentimento/percepção pública em
> torno daquela Narrativa. **Não confundir com `cases`** (`intelligence-center/data-model.md`)
> — ver a distinção completa em [overview.md](overview.md), "Relação com
> `cases`". Resumo: `cases` é genérico ("o que o time está fazendo a
> respeito", somente leitura, sem UI de escrita ainda); `communications` é
> específico de **ações já executadas** vinculadas a uma Narrativa, com
> CRUD completo pela UI desde o início, e cuja razão de existir é alimentar
> o cálculo de impacto (antes/depois) descrito em
> [narrative-impact-tracking.md](narrative-impact-tracking.md).
>
> ✅ **Ampliado 2026-07-25, mesma sessão** (pedido do usuário: "o usuário
> poderá registrar uma comunicação ou uma decisão. Comunicação deve ter os
> campos já documentados e decisão deve ter apenas a data, um título,
> responsável, detalhamento"): a tabela `communications` agora guarda
> **dois tipos de registro** via a coluna `record_type` — `communication`
> (todos os campos já documentados: tipo, canal, link, vínculo com
> Brandwatch) e `decision` (só data/título/responsável/detalhamento, um
> subconjunto estrito dos campos de `communication`). Os dois tipos
> compartilham a mesma tabela, o mesmo trigger de `organization_id`, o
> mesmo formulário de cadastro (ver [communication-registration.md](communication-registration.md))
> e o mesmo cálculo de impacto antes/depois (ver
> [narrative-impact-tracking.md](narrative-impact-tracking.md)) — uma
> Decisão é, estruturalmente, uma Comunicação com menos campos
> preenchidos, não um conceito à parte.
>
> ⚠️ **Observação registrada, não uma pendência bloqueante**: "Decisão"
> (data/título/responsável/detalhamento) é muito próxima do que `cases`
> já modela (`intelligence-center/data-model.md` — título/status/
> `assignee_id`/`due_date`, ver "Relação com `cases`" em
> [overview.md](overview.md)). Mantidas como conceitos separados nesta
> rodada porque foi um pedido explícito e específico do usuário dentro
> deste módulo — não uma fusão dos dois modelos, que seguiria sendo
> especulação sem um pedido direto para isso (mesmo critério já aplicado
> ao decidir não fundir `cases`/`communications` antes). Sinalizado aqui
> para quem revisar esta spec no futuro não presumir que a sobreposição
> passou despercebida.

## Entidades

### `communication_types`

✅ **Decidido 2026-07-25** (pedido do usuário: "tipo de comunicação pode
ser uma tabela que é atualizada com os tipos e a lógica do módulo pega
dela") — **substitui o enum `communication_type` da versão anterior desta
spec**. Mesma razão de design já aplicada a `entity_tags` (EAV,
`_glossary.md`: "uma nova dimensão de classificação é um INSERT, nunca uma
migration") e a `bw_categories.status` (desativar em vez de excluir): uma
tabela de referência simples, em vez de um enum Postgres, deixa adicionar/
renomear/desativar um tipo de comunicação uma operação de **dado**, nunca
uma migration (`ALTER TYPE` é irreversível e mais caro de alterar depois).

| Campo         | Tipo          | Obrigatório | Descrição |
|-----------------|----------------|-------------|-----------|
| `id`            | `uuid`         | sim         | PK — `gen_random_uuid()` |
| `code`          | `text`         | sim         | Chave estável usada internamente pelo código (nunca exibida ao usuário) — única (`unique`). Não é a chave de exibição — isso é `label` |
| `label`         | `text`         | sim         | Rótulo em português exibido no combobox de cadastro |
| `is_active`     | `boolean`      | sim         | default `true`. Mesmo padrão de `bw_categories.status`: desativar em vez de excluir — uma comunicação já registrada com um tipo desativado continua mostrando seu rótulo normalmente, só o combobox de cadastro para de oferecê-lo em novos registros |
| `position`      | `integer`      | sim         | default `0`. Ordem de exibição no combobox (não alfabética — deixa "Outro" sempre por último, por exemplo) |
| `created_at`    | `timestamptz`  | sim         | `now()` |
| `updated_at`    | `timestamptz`  | sim         | Trigger `set_updated_at` |

**Seed inicial** (via a mesma migration que cria a tabela, `insert ... on
conflict (code) do nothing` — idempotente): cobre os 3 exemplos citados
pelo usuário mais os tipos mais comuns de comunicação de campanha
política. Como agora é só dado, um 9º tipo (ex: "WhatsApp"/"SMS", hoje
cobertos genericamente por `other` + `channel_detail` em texto livre) é um
`INSERT` a qualquer momento, não uma decisão que bloqueia a primeira
migration:

| `code` | `label` | `position` |
|---|---|---|
| `social_post` | Post em rede social | 10 |
| `email` | E-mail | 20 |
| `tv_ad` | Propaganda de TV | 30 |
| `radio_ad` | Propaganda de rádio | 40 |
| `press_release` | Assessoria de imprensa/nota oficial | 50 |
| `printed_material` | Material impresso (panfleto, outdoor) | 60 |
| `event` | Evento presencial | 70 |
| `other` | Outro | 999 |

**Políticas RLS**: tabela **global**, não escopada por `organization_id` —
é uma taxonomia compartilhada por toda a plataforma, mesmo papel que um
enum Postgres teria (todo Client da Lidi usa o mesmo vocabulário de tipos
de comunicação).

| Operação | Quem pode | Condição |
|----------|-----------|----------|
| SELECT | qualquer usuário autenticado | `auth.role() = 'authenticated'` (sem filtro de organização — dado compartilhado) |
| INSERT/UPDATE/DELETE | ninguém via client nesta versão | deny-all (RLS ativa, zero policy de escrita) — sem UI de gestão de tipos ainda (ver nota abaixo); populado/editado via SQL direto ou uma futura tela `is_admin`-only, mesmo padrão de `admin-*` |

> Sem tela de administração destes tipos nesta rodada — o pedido do
> usuário foi que **a lógica do módulo lesse de uma tabela**, não que
> existisse uma UI de gestão. Se o time precisar editar/adicionar tipos
> com frequência sem acesso a SQL direto, uma tela simples (mesmo padrão
> `is_admin`-only de `auth/user-management.md`) é uma extensão aditiva
> futura — não modelada preventivamente agora.

### `communication_record_type` (enum)

Estrutural, só 2 valores, não se espera que cresça (diferente de
`communication_types` acima, que é extensível por design) — por isso um
enum Postgres simples é apropriado aqui, sem o mesmo risco de `ALTER
TYPE` que motivou virar tabela o tipo de comunicação:

| Valor | Rótulo em português (produto) |
|---|---|
| `communication` | Comunicação |
| `decision` | Decisão |

### `communications`

**Descrição**: Um registro vinculado a uma Narrativa — uma Comunicação
já realizada (o que o time publicou/enviou/veiculou) ou uma Decisão (o
que o time decidiu fazer/não fazer a respeito do tema), conforme
`record_type`. Estruturalmente uma Decisão é uma Comunicação com menos
campos preenchidos (ver nota no topo deste arquivo) — mesma tabela, não
duas. É o dado de entrada do acompanhamento de impacto (ver
[narrative-impact-tracking.md](narrative-impact-tracking.md)); sozinho, é
também a fonte da tela de cadastro/listagem (ver
[communication-registration.md](communication-registration.md)).

| Campo              | Tipo                  | Obrigatório | Descrição |
|----------------------|------------------------|-------------|-----------|
| `id`                 | `uuid`                 | sim         | PK — `gen_random_uuid()` |
| `organization_id`    | `uuid`                 | sim         | FK → `organizations(id)`. **Nunca recebido do client** — derivado no servidor a partir de `narrative_id` (ver trigger `set_communication_organization` abaixo). Mesmo princípio já registrado como pendência em `intelligence-center/data-model.md` ("Caso") para quando `cases` ganhasse um caminho de escrita — este módulo resolve essa mesma questão desde a primeira migration, via trigger em vez de Edge Function (ver "Regras de negócio" abaixo) |
| `narrative_id`       | `uuid`                 | sim         | FK → `narratives(id) on delete cascade` — mesmo padrão de `cases.narrative_id`, nunca `bw_category_id` direto (as tabelas `bw_*` são espelho/leitura da Brandwatch, não algo que dado de produto referencia). Vale para os dois `record_type` — uma Decisão também é sempre sobre uma Narrativa específica |
| `record_type`        | `communication_record_type` (enum) | sim | `communication` \| `decision` — ver acima. Determina quais dos campos abaixo são obrigatórios (ver CHECK constraint) |
| `communication_type_id` | `uuid`              | **só quando `record_type = 'communication'`** | FK → `communication_types(id)` — ver entidade acima. `null` para `record_type = 'decision'` (uma Decisão não tem "tipo de comunicação") |
| `title`              | `text`                 | sim (os dois tipos) | Título curto da ação (ex: "Post no Instagram sobre reforma da saúde" / "Decidimos não comentar publicamente sobre X") |
| `description`        | `text`                 | não (os dois tipos) | Para `communication`: conteúdo/resumo da comunicação. Para `decision`: o "detalhamento" pedido pelo usuário — texto livre, sem limite de tamanho imposto pelo produto |
| `channel_detail`     | `text`                 | não, **só aplicável a `communication`** | Detalhe do canal dentro do tipo — ex: "Instagram"/"X (Twitter)" para `social_post`; "Rede Globo"/"Jovem Pan" para `tv_ad`/`radio_ad`; nome da ferramenta de disparo para `email`. Texto livre (não uma segunda tabela de referência). `null` obrigatório para `record_type = 'decision'` (ver CHECK constraint) |
| `external_url`       | `text`                 | não, **só aplicável a `communication`** | Link para a evidência da comunicação (o post publicado, o release, o material) — quando existir. `null` obrigatório para `record_type = 'decision'` |
| `bw_resource_id`     | `text`                 | não, **só aplicável a `communication`** | Quando a comunicação é ela mesma um post já sincronizado pela Brandwatch (`mentions.resource_id`), permite linkar as duas. ✅ **Vínculo manual, decisão final (2026-07-25)**: o usuário cola o ID/URL da mention no formulário — sem matching automático (por autor/URL) nesta ou em nenhuma versão futura planejada. `null` obrigatório para `record_type = 'decision'` |
| `occurred_at`        | `timestamptz`          | sim (os dois tipos) | Para `communication`: data/hora em que a comunicação foi ao ar/publicada/enviada. Para `decision`: data da decisão. **Âncora** de todo o cálculo de antes/depois em `narrative-impact-tracking.md` nos dois casos. Pode ser uma data passada distante (registro retroativo) — o produto não assume que o registro é feito no mesmo dia do fato. Renomeado de `published_at` (versão anterior desta spec, quando só existia `communication`) — "publicado" não fazia sentido para uma Decisão |
| `assignee_id`        | `uuid`                 | não (os dois tipos) | Quem é o responsável pela ação/decisão (não necessariamente quem registrou no sistema, ver `created_by`) — campo "responsável" pedido explicitamente para Decisão, e já existia para Comunicação |
| `created_by`         | `uuid`                 | não         | FK → `user_profiles(id)` — quem criou o registro (auditoria; `null` só seria possível numa inserção via SQL direto, nunca pela UI) |
| `created_at`         | `timestamptz`          | sim         | `now()` |
| `updated_at`         | `timestamptz`          | sim         | Trigger `set_updated_at` (já definida em `foundation`, reaproveitada) |

**CHECK constraint** — garante que os campos exclusivos de `communication`
nunca fiquem preenchidos "pela metade" numa Decisão nem faltando numa
Comunicação:

```sql
alter table communications add constraint communications_record_type_fields_check
  check (
    (record_type = 'communication' and communication_type_id is not null)
    or
    (record_type = 'decision'
      and communication_type_id is null
      and channel_detail is null
      and external_url is null
      and bw_resource_id is null)
  );
```

**Índices**:
- `communications_narrative_id_occurred_at_idx` em `(narrative_id, occurred_at)` — é como a linha do tempo de impacto sempre lê (uma Narrativa, ordenado por data), para os dois `record_type` juntos.
- `communications_organization_id_idx` em `(organization_id)` — listagem geral da tela de cadastro, filtrável por organização.
- `communications_occurred_at_idx` em `(occurred_at)` — filtro de período na listagem.
- `communications_communication_type_id_idx` em `(communication_type_id)` — filtro por Tipo na listagem (só relevante para `record_type = 'communication'`).
- `communications_record_type_idx` em `(record_type)` — filtro "Comunicação"/"Decisão" na listagem.

**Políticas RLS**:

| Operação | Quem pode | Condição |
|----------|-----------|----------|
| SELECT | membro da organização | `organization_id in (select auth_organization_ids())` |
| INSERT | membro da organização | `with check`: a linha final (já com `organization_id` sobrescrito pelo trigger, ver abaixo) precisa ter `organization_id in (select auth_organization_ids())` — na prática, isso só passa quando `narrative_id` enviado pertence a uma organização da qual o usuário é membro, porque é de lá que o trigger deriva o valor |
| UPDATE | membro da organização | `using`/`with check`: `organization_id in (select auth_organization_ids())` |
| DELETE | membro da organização | `using`: `organization_id in (select auth_organization_ids())` |

✅ **Sem restrição por papel/usuário além de pertencer à organização** —
qualquer membro pode registrar, editar ou excluir uma comunicação de
qualquer colega, mesma granularidade de permissão já existente no produto
hoje (não há um papel "equipe de comunicação" distinto de "membro da
organização" — só existe `is_admin`, que é **global de plataforma**, não
por organização, ver `auth/data-model.md`). ⚠️ **DECISÃO PENDENTE**: se o
volume de uso mostrar necessidade de restringir edição/exclusão a quem
criou o registro (ou a um admin), isso é uma extensão aditiva da policy —
não modelar preventivamente agora.

## Trigger: `set_communication_organization` (BEFORE INSERT)

Deriva `organization_id` a partir de `narrative_id`, ignorando qualquer
valor enviado pelo client — mesmo espírito do `set_updated_at` (regra
única, reaproveitada, nunca duplicada por tabela), aplicando aqui a
correção que `intelligence-center/data-model.md` já tinha identificado como
pendência para quando `cases` ganhasse escrita:

```sql
create or replace function set_communication_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select organization_id into new.organization_id
  from narratives
  where id = new.narrative_id;

  if new.organization_id is null then
    raise exception 'narrative_id inválido ou sem organização associada';
  end if;

  return new;
end;
$$;

create trigger communications_set_organization
  before insert on communications
  for each row
  execute function set_communication_organization();
```

> **Por que trigger e não Edge Function** (diferente do padrão usado por
> `admin-*`/`update-my-timezone`): aqueles precisam de `service_role`
> (`auth.admin.*`) ou de validação server-side que a UI não pode garantir
> sozinha. Aqui não há chamada externa nem privilégio elevado — a garantia
> de "nunca confiar em `organization_id` vindo do client" (Princípio
> técnico 2) é satisfeita inteiramente dentro do Postgres, mais simples que
> subir uma Edge Function só para isso. As Edge Functions deste módulo (ver
> [communication-registration.md](communication-registration.md),
> "Dependências técnicas") continuam existindo, mas por outro motivo:
> centralizar a tradução de erro amigável (regra global "Edge Function
> error handling" do `CLAUDE.md`), não a derivação de `organization_id`.

## Relacionamentos

```
communication_types ──< communications
narratives ──< communications
user_profiles ──< communications.assignee_id (nullable)
user_profiles ──< communications.created_by (nullable)
```

## Notas para a migration

- Depende de `narratives` (`foundation`) e `user_profiles` (`auth`) já existirem — mesma ordem de dependência de `cases`.
- `communication_types` precisa existir (com o seed inicial) antes de `communications`, já que `communication_type_id` é uma FK (condicional a `record_type = 'communication'`, ver CHECK constraint).
- `communication_record_type` (enum) precisa existir antes de `communications` também — criar junto com a tabela.
- Reaproveita a trigger `set_updated_at` já definida na migration de `foundation` — não recriar (usada por `communication_types` e por `communications`).

## ⚠️ Pendências

1. Permissão de CRUD restrita por papel/criador (ver acima) — hoje aberta para qualquer membro da organização.

✅ Duas pendências anteriores desta seção foram resolvidas em 2026-07-25:
"Lista final de `communication_type`" deixou de bloquear a migration —
virou tabela (`communication_types`), então adicionar/corrigir um tipo é
um `INSERT`, não uma decisão de schema; "vínculo automático com
`mentions`" foi confirmado como manual, definitivamente (ver
`bw_resource_id` acima) — nenhuma automação de matching está planejada.
