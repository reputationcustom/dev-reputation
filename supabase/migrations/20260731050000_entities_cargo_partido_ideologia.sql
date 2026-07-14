-- Módulo `entities` — reorganização de campos, pedido do usuário: "renomeie
-- o campo descrição para cargo, inclua um novo campo chamado partido, crie
-- um campo chamado ideologia (popule com direita, esquerda, centro, centro
-- direita, centro esquerda) e reorganize os dados nessas novas colunas."
--
-- Complementa 20260731000000_entities_schema.sql (schema original) e
-- 20260731010000_seed_parties_and_parliamentarians.sql (dado já semeado,
-- fonte da reorganização abaixo — nenhum dado novo é buscado nesta
-- migration, só reorganizado dentro do banco).
--
-- ⚠️ `ideologia`: campo contestável/subjetivo por natureza (mesma cautela já
-- registrada em data-model.md desde a sessão anterior, quando esta mesma
-- dimensão foi deliberadamente deixada de fora do primeiro seed por não ter
-- fonte única/oficial). Diferente daquela sessão, aqui é um pedido explícito
-- e direto do usuário — os 21 partidos são classificados abaixo por
-- caracterização amplamente citada na ciência política/imprensa brasileira
-- (linha editorial/composição de blocos parlamentares/posicionamento em
-- pautas econômicas e de costumes já descritos por fontes como DIAP/
-- Congresso em Foco/cobertura eleitoral corrente), não uma fonte única
-- verificável em lote como as migrations anteriores deste módulo — **é uma
-- classificação de melhor esforço, revisável pelo admin a qualquer momento
-- pela tela `/admin/entities` quando implementada**, não um dado oficial
-- como cargo/partido/estado (esses sim, direto da Câmara/Senado). Pessoas
-- (parlamentares) herdam a ideologia do próprio partido — não é uma
-- avaliação individual por parlamentar.

-- =========================================================================
-- 1. Renomeia description -> cargo (mesmo `data-model.md` atualizado).
-- =========================================================================

alter table entities rename column description to cargo;

-- =========================================================================
-- 2. Novas colunas.
-- =========================================================================

alter table entities add column partido text;
alter table entities add column ideologia text;

create index if not exists idx_entities_partido on entities(partido);
create index if not exists idx_entities_ideologia on entities(ideologia);

-- =========================================================================
-- 3. Reorganização dos dados já existentes.
-- =========================================================================

-- Partidos: `cargo` não se aplica (a coluna guardava o nome completo do
-- partido antes da renomeação — ex: "Movimento Democrático Brasileiro" —
-- que deixou de fazer sentido semântico numa coluna chamada "cargo").
update entities set cargo = null where type = 'party';

-- Classificação de ideologia por partido (ver nota no topo do arquivo).
update entities set ideologia = v.ideologia
from (values
  ('AVANTE', 'centro-direita'),
  ('CIDADANIA', 'centro'),
  ('MDB', 'centro'),
  ('MISSÃO', 'direita'),
  ('NOVO', 'direita'),
  ('PCdoB', 'esquerda'),
  ('PDT', 'centro-esquerda'),
  ('PL', 'direita'),
  ('PODE', 'centro-direita'),
  ('PP', 'direita'),
  ('PRD', 'direita'),
  ('PSB', 'centro-esquerda'),
  ('PSD', 'centro'),
  ('PSDB', 'centro-direita'),
  ('PSOL', 'esquerda'),
  ('PT', 'esquerda'),
  ('PV', 'centro-esquerda'),
  ('REDE', 'centro-esquerda'),
  ('REPUBLICANOS', 'direita'),
  ('SOLIDARIEDADE', 'centro'),
  ('UNIÃO', 'centro-direita')
) as v(sigla, ideologia)
where entities.type = 'party' and entities.name = v.sigla;

-- Parlamentares: move cargo/partido dos entity_tags (office/party, criados
-- pelo seed anterior) para as colunas novas.
update entities e
set cargo = et.tag_value
from entity_tags et
where et.entity_id = e.id and et.tag_type = 'office' and e.type = 'person';

update entities e
set partido = et.tag_value
from entity_tags et
where et.entity_id = e.id and et.tag_type = 'party' and e.type = 'person';

-- Parlamentares herdam a ideologia do próprio partido (classificação por
-- partido, não uma avaliação individual por parlamentar).
update entities e
set ideologia = p.ideologia
from entities p
where e.type = 'person' and p.type = 'party' and e.partido = p.name;

-- entity_tags (office/party) ficam redundantes — o dado já vive nas colunas
-- novas. `state` permanece em entity_tags (não fazia parte deste pedido).
delete from entity_tags where tag_type in ('office', 'party');
