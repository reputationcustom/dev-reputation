-- Seed — Institutos de pesquisa eleitoral e Veículos de imprensa/mídia
-- .dev/specs/entities/data-model.md
--
-- Pedido do usuário: "crie um seed para entities com informações de
-- entidades de pesquisas eleitorais, mídia, imprensa e veículos de
-- comunicação que emitem notícias e que podemos de alguma forma vincular
-- com os dados que vem da brandwatch."
--
-- Fonte dos dados: consultado AO VIVO nesta sessão contra a API pública do
-- Wikidata (wbsearchentities + Special:EntityData, propriedades P856
-- website oficial/P2002 usuário do Twitter-X/P2003 usuário do Instagram) —
-- mesma premissa de "nunca fabricar dado sem fonte real" já aplicada em
-- todo o resto do projeto (mentions/sampling, seed de partidos e
-- parlamentares). Nenhum handle foi completado de memória — quando o
-- Wikidata não tinha o dado ou não tinha um item correspondente
-- verificável, o campo fica de fora deste seed (ver lista de exclusões
-- abaixo), a mesma disciplina já usada para os Senadores no seed anterior.
--
-- Escopo: 12 institutos de pesquisa eleitoral (type = 'company' — são
-- empresas privadas de pesquisa, não "instituição" no sentido cívico do
-- enum) + 30 veículos de imprensa/mídia (type = 'media_outlet') = 42
-- Entities novas. `cargo`/`partido`/`ideologia` ficam `null` para todas —
-- esses 3 campos são específicos de pessoas (`data-model.md`: "cargo...
-- para pessoas; null para os demais tipos") e classificar o espectro
-- político de um veículo de imprensa não foi pedido nesta sessão (seria
-- uma inferência própria não solicitada, diferente da classificação de
-- partidos em `20260731050000`, que foi um pedido explícito do usuário).
--
-- Classificação via entity_tags (EAV, cada dimensão é só um INSERT, nunca
-- uma migration — `data-model.md`):
--   - `segment` (tag_type NOVO nesta sessão, não estava no vocabulário
--     sugerido de `data-model.md` até aqui): 'Pesquisa Eleitoral' para os
--     12 institutos; para os 30 veículos, o tipo de mídia (`Portal de
--     Notícias`/`Jornal Impresso`/`Revista`/`TV Aberta`/`TV a Cabo/
--     Notícias 24h`/`Rádio`/`Agência de Notícias`/`Jornalismo
--     Investigativo`), lido da própria descrição do item no Wikidata.
--   - `power_branch` (tag_type já existente): 'Setor Privado' para os
--     institutos (empresas privadas de pesquisa), 'Mídia' para os 30
--     veículos — os dois já fazem parte do vocabulário sugerido em
--     `data-model.md`.
--   - `website` (tag_type NOVO nesta sessão): URL oficial confirmada via
--     Wikidata (P856). Puramente informativo para o admin conferir/abrir —
--     `entity_accounts` é o único mecanismo que de fato liga uma Entity ao
--     `author` de `bw_query_top_authors`/`bw_query_top_tweeters`/`mentions`
--     (ver `author-linking.md`, "Mecanismo de vínculo": o JOIN é só por
--     `username` de handle, nunca por domínio) — um domínio de site NÃO
--     teria efeito nenhum se gravado como `entity_accounts.platform =
--     'website'`, então não foi gravado lá, para não sugerir um vínculo
--     que na prática não existe.
--   - `state` (tag_type já existente): só para os 2 veículos com caráter
--     regional claro (Gazeta do Povo → PR, Correio Braziliense → DF) — os
--     demais são de alcance nacional, sem `state` associado.
--
-- `entity_accounts` (o vínculo que de fato habilita o enriquecimento em
-- `get_authors_ranking`, ver `author-linking.md`): 51 contas — handle do
-- Twitter/X e/ou Instagram, só quando confirmados no Wikidata (P2002/
-- P2003). Plataforma gravada como 'twitter' (não 'x') — mesmo vocabulário
-- já usado pelo restante do projeto (`mentions.content_source`, seed de
-- deputados). `url` sempre reconstruída a partir do handle
-- (`https://twitter.com/<handle>`/`https://instagram.com/<handle>`), não
-- lida do Wikidata (que às vezes aponta para um encurtador/redirect).
--
-- ⚠️ Deliberadamente FORA deste seed, por não ter fonte confiável em lote
-- (mesma cautela do seed de partidos/parlamentares):
--   - `influence_level` — campo manual/subjetivo por design, não
--     preenchido por um seed automatizado.
--   - `ideologia`/espectro político dos veículos de imprensa — não pedido
--     nesta sessão; classificar a linha editorial de um veículo de
--     imprensa é uma inferência de opinião bem mais contestável do que a
--     de um partido político (já feita, com o mesmo aviso de "melhor
--     esforço, revisável", em `20260731050000`) — deixado para o admin
--     classificar manualmente se/quando desejado.
--   - Institutos SEM handle em `entity_accounts` (Ipec, Quaest, Paraná
--     Pesquisas, FSB Pesquisa, Real Time Big Data, Ipespe, Modal
--     Pesquisas, PoderData, Instituto Ideia, MDA Pesquisa — 10 dos 12):
--     o Wikidata não tem um item verificável com essas propriedades para
--     eles nesta sessão (várias tentativas de busca, termos alternativos,
--     ver histórico da sessão) — são empresas menores/mais recentes, sem
--     artigo na Wikipédia/item completo no Wikidata. Ficam cadastrados
--     como Entity (para já existirem no catálogo e permitirem cadastro
--     manual de conta depois, `/admin/entities`), só sem vínculo
--     automático ainda.
--   - `Ipec` especificamente: o item mais próximo encontrado no Wikidata
--     (Q21206655) está de fato sobre o "IBOPE" histórico (sitelinks
--     enwiki/ptwiki = "IBOPE"), com "Ipec" listado só como alias — e seu
--     P856 aponta para kantaribopemedia.com, que é o site da Kantar IBOPE
--     MEDIA (mensuração de audiência), uma empresa distinta da Ipec
--     (Inteligência em Pesquisa e Consultoria, pesquisa eleitoral) desde a
--     cisão de 2020. Risco real de atribuir site/conta da empresa errada
--     — por isso `website`/`entity_accounts` ficam de fora da Ipec neste
--     seed, mesmo a Entity existindo.
--   - Veículos com Entity criada mas sem `entity_accounts` (IstoÉ, Agência
--     Brasil): Wikidata confirma o item e o site oficial, mas não tem
--     P2002/P2003 preenchido para eles.
--
-- Idempotência: `on conflict do nothing` nas 3 tabelas, mesmo padrão do
-- seed de partidos/parlamentares — pode ser reexecutado sem duplicar
-- linhas (a chave de conflito de `entities` é o `id` fixo gerado nesta
-- sessão).

-- Institutos de pesquisa eleitoral (type = company)
insert into entities (id, type, name, is_active) values
  ('f98763ed-9e1a-499a-80c5-18828e003229', 'company', 'Datafolha', true),
  ('964434f3-972e-40cb-880b-530fcff64989', 'company', 'Ipec', true),
  ('f32c3e7e-30d7-46ca-b794-93b01e9a1a5a', 'company', 'Quaest', true),
  ('c7f40880-749f-4642-a222-b5a1ac45d61d', 'company', 'AtlasIntel', true),
  ('cd1112fd-d476-4ae0-93de-1398203454a0', 'company', 'Paraná Pesquisas', true),
  ('5297899f-111d-4d0e-98e4-3e5df61e0885', 'company', 'FSB Pesquisa', true),
  ('18d25430-528a-4da0-9160-40a49be94f08', 'company', 'Real Time Big Data', true),
  ('f9e4eeb4-5f2e-4ac0-8be6-e29a15a9daa1', 'company', 'Ipespe', true),
  ('789c26f0-9782-4c30-aea1-072161770c61', 'company', 'Modal Pesquisas', true),
  ('e87691f4-e132-4dcd-9e13-5784d90201ac', 'company', 'PoderData', true),
  ('eecbd166-3519-4842-ade1-5f37c361e1f6', 'company', 'Instituto Ideia', true),
  ('e13f4b83-3f32-4dfa-9f02-baa90b6aee96', 'company', 'MDA Pesquisa', true)
on conflict (id) do nothing;

-- Veículos de imprensa / mídia (type = media_outlet)
insert into entities (id, type, name, is_active) values
  ('4ffdebbb-c5ae-418c-9158-4fc3b476cf93', 'media_outlet', 'G1', true),
  ('b85e1b31-1f79-4294-a844-93d2cead2c9f', 'media_outlet', 'O Globo', true),
  ('747c53a0-97a4-4819-8aee-836fa425c7d0', 'media_outlet', 'GloboNews', true),
  ('804951c4-af95-4700-a7f6-ea05deacf410', 'media_outlet', 'Folha de S.Paulo', true),
  ('6978addf-bd38-4a6a-a928-997db4945858', 'media_outlet', 'UOL', true),
  ('8451b694-113a-448f-8c03-80a4d8b70447', 'media_outlet', 'Estadão', true),
  ('99cd54f1-1aa6-4cee-818c-0fbb9423f5a3', 'media_outlet', 'Terra', true),
  ('a3c94c54-3a68-48bf-8089-e42ed501d71a', 'media_outlet', 'R7', true),
  ('dda3716d-04a4-4a8b-8d86-dda70cf0b40e', 'media_outlet', 'SBT', true),
  ('6a0eb9a9-d87f-4e2a-8a47-98ff4c2d98d3', 'media_outlet', 'Band', true),
  ('f2ec917a-f9c5-470b-845d-f50a8f59ab99', 'media_outlet', 'CNN Brasil', true),
  ('abdcbdff-028f-40a9-987e-b352d38bc10f', 'media_outlet', 'Veja', true),
  ('b7c26c5b-1f59-45f3-96a0-8e8f08d44725', 'media_outlet', 'IstoÉ', true),
  ('339dc067-71ce-48c3-876f-38344d81e91f', 'media_outlet', 'CartaCapital', true),
  ('4458293d-8755-4a52-b8c4-448d9a11dd64', 'media_outlet', 'Poder360', true),
  ('d8ad904c-dc9e-4ecc-8289-be586cb94e4d', 'media_outlet', 'Metrópoles', true),
  ('1730ba36-650e-411c-b9d5-909d973fc2d6', 'media_outlet', 'Congresso em Foco', true),
  ('1c226376-1b07-4f68-b733-9f6eb92d53b4', 'media_outlet', 'Brasil 247', true),
  ('ad20533d-e7e2-443a-9a49-841463c0e496', 'media_outlet', 'Gazeta do Povo', true),
  ('dcaff94a-8b62-48fa-af43-fc4bdf973867', 'media_outlet', 'Jovem Pan', true),
  ('4d386035-349e-4995-9658-c0c4ff83e7a1', 'media_outlet', 'Agência Brasil', true),
  ('2e7e7cc8-ae05-4087-8074-16a4cad7d88c', 'media_outlet', 'Correio Braziliense', true),
  ('fee905ce-418a-429d-87ed-0a3be87d157b', 'media_outlet', 'O Antagonista', true),
  ('5966c1bc-fc6b-40a2-9fd2-3563ffde1288', 'media_outlet', 'Exame', true),
  ('18350851-d5f2-4466-a8ec-c74a3a5de4f8', 'media_outlet', 'InfoMoney', true),
  ('cd35bdd6-8f3e-4077-9bd2-d3ef30757a84', 'media_outlet', 'Valor Econômico', true),
  ('fcd723c3-8a70-4c68-8c7c-d73992e6ed64', 'media_outlet', 'BBC News Brasil', true),
  ('8d33d084-074d-4aae-a86b-643c4011fda0', 'media_outlet', 'Nexo Jornal', true),
  ('1d368143-b3f0-42fd-9e61-e49834dbfc14', 'media_outlet', 'Agência Pública', true),
  ('f1cbccd1-711e-43c6-a7f9-e3ea2c959a3a', 'media_outlet', 'The Intercept Brasil', true)
on conflict (id) do nothing;

-- Contas oficiais em redes sociais (entity_accounts) — só handles
-- confirmados via Wikidata (P2002 Twitter-X / P2003 Instagram) nesta sessão.
insert into entity_accounts (entity_id, platform, username, url) values
  ('c7f40880-749f-4642-a222-b5a1ac45d61d', 'twitter', 'atlas_intel', 'https://twitter.com/atlas_intel'),
  ('4ffdebbb-c5ae-418c-9158-4fc3b476cf93', 'twitter', 'g1', 'https://twitter.com/g1'),
  ('4ffdebbb-c5ae-418c-9158-4fc3b476cf93', 'instagram', 'portalg1', 'https://instagram.com/portalg1'),
  ('b85e1b31-1f79-4294-a844-93d2cead2c9f', 'twitter', 'JornalOGlobo', 'https://twitter.com/JornalOGlobo'),
  ('b85e1b31-1f79-4294-a844-93d2cead2c9f', 'instagram', 'jornaloglobo', 'https://instagram.com/jornaloglobo'),
  ('747c53a0-97a4-4819-8aee-836fa425c7d0', 'twitter', 'GloboNews', 'https://twitter.com/GloboNews'),
  ('747c53a0-97a4-4819-8aee-836fa425c7d0', 'instagram', 'globonews', 'https://instagram.com/globonews'),
  ('804951c4-af95-4700-a7f6-ea05deacf410', 'twitter', 'folha', 'https://twitter.com/folha'),
  ('804951c4-af95-4700-a7f6-ea05deacf410', 'instagram', 'folhadespaulo', 'https://instagram.com/folhadespaulo'),
  ('6978addf-bd38-4a6a-a928-997db4945858', 'twitter', 'UOL', 'https://twitter.com/UOL'),
  ('6978addf-bd38-4a6a-a928-997db4945858', 'instagram', 'uoloficial', 'https://instagram.com/uoloficial'),
  ('8451b694-113a-448f-8c03-80a4d8b70447', 'twitter', 'estadao', 'https://twitter.com/estadao'),
  ('8451b694-113a-448f-8c03-80a4d8b70447', 'instagram', 'estadao', 'https://instagram.com/estadao'),
  ('99cd54f1-1aa6-4cee-818c-0fbb9423f5a3', 'twitter', 'Terra', 'https://twitter.com/Terra'),
  ('99cd54f1-1aa6-4cee-818c-0fbb9423f5a3', 'instagram', 'terrabrasil', 'https://instagram.com/terrabrasil'),
  ('a3c94c54-3a68-48bf-8089-e42ed501d71a', 'twitter', 'PortalR7', 'https://twitter.com/PortalR7'),
  ('a3c94c54-3a68-48bf-8089-e42ed501d71a', 'instagram', 'portalr7', 'https://instagram.com/portalr7'),
  ('dda3716d-04a4-4a8b-8d86-dda70cf0b40e', 'twitter', 'SBTonline', 'https://twitter.com/SBTonline'),
  ('dda3716d-04a4-4a8b-8d86-dda70cf0b40e', 'instagram', 'sbt', 'https://instagram.com/sbt'),
  ('6a0eb9a9-d87f-4e2a-8a47-98ff4c2d98d3', 'twitter', 'BandTV', 'https://twitter.com/BandTV'),
  ('6a0eb9a9-d87f-4e2a-8a47-98ff4c2d98d3', 'instagram', 'bandtv', 'https://instagram.com/bandtv'),
  ('f2ec917a-f9c5-470b-845d-f50a8f59ab99', 'twitter', 'cnnbrasil', 'https://twitter.com/cnnbrasil'),
  ('f2ec917a-f9c5-470b-845d-f50a8f59ab99', 'instagram', 'cnnbrasil', 'https://instagram.com/cnnbrasil'),
  ('abdcbdff-028f-40a9-987e-b352d38bc10f', 'twitter', 'VEJA', 'https://twitter.com/VEJA'),
  ('abdcbdff-028f-40a9-987e-b352d38bc10f', 'instagram', 'vejanoinsta', 'https://instagram.com/vejanoinsta'),
  ('339dc067-71ce-48c3-876f-38344d81e91f', 'twitter', 'cartacapital', 'https://twitter.com/cartacapital'),
  ('339dc067-71ce-48c3-876f-38344d81e91f', 'instagram', 'cartacapital', 'https://instagram.com/cartacapital'),
  ('4458293d-8755-4a52-b8c4-448d9a11dd64', 'twitter', 'Poder360', 'https://twitter.com/Poder360'),
  ('d8ad904c-dc9e-4ecc-8289-be586cb94e4d', 'instagram', 'metropoles', 'https://instagram.com/metropoles'),
  ('1730ba36-650e-411c-b9d5-909d973fc2d6', 'twitter', 'congressoemfoco', 'https://twitter.com/congressoemfoco'),
  ('1730ba36-650e-411c-b9d5-909d973fc2d6', 'instagram', 'congressoemfoco', 'https://instagram.com/congressoemfoco'),
  ('1c226376-1b07-4f68-b733-9f6eb92d53b4', 'twitter', 'brasil247', 'https://twitter.com/brasil247'),
  ('1c226376-1b07-4f68-b733-9f6eb92d53b4', 'instagram', 'brasil_247', 'https://instagram.com/brasil_247'),
  ('ad20533d-e7e2-443a-9a49-841463c0e496', 'twitter', 'gazetadopovo', 'https://twitter.com/gazetadopovo'),
  ('dcaff94a-8b62-48fa-af43-fc4bdf973867', 'twitter', 'radiojovempan', 'https://twitter.com/radiojovempan'),
  ('dcaff94a-8b62-48fa-af43-fc4bdf973867', 'instagram', 'radiojovempan', 'https://instagram.com/radiojovempan'),
  ('2e7e7cc8-ae05-4087-8074-16a4cad7d88c', 'twitter', 'cbonlinedf', 'https://twitter.com/cbonlinedf'),
  ('2e7e7cc8-ae05-4087-8074-16a4cad7d88c', 'instagram', 'correio.braziliense', 'https://instagram.com/correio.braziliense'),
  ('fee905ce-418a-429d-87ed-0a3be87d157b', 'twitter', 'o_antagonista', 'https://twitter.com/o_antagonista'),
  ('fee905ce-418a-429d-87ed-0a3be87d157b', 'instagram', 'o_antagonista', 'https://instagram.com/o_antagonista'),
  ('5966c1bc-fc6b-40a2-9fd2-3563ffde1288', 'twitter', 'exame', 'https://twitter.com/exame'),
  ('18350851-d5f2-4466-a8ec-c74a3a5de4f8', 'twitter', 'infomoney', 'https://twitter.com/infomoney'),
  ('18350851-d5f2-4466-a8ec-c74a3a5de4f8', 'instagram', 'infomoney', 'https://instagram.com/infomoney'),
  ('cd35bdd6-8f3e-4077-9bd2-d3ef30757a84', 'twitter', 'valoreconomico', 'https://twitter.com/valoreconomico'),
  ('cd35bdd6-8f3e-4077-9bd2-d3ef30757a84', 'instagram', 'valoreconomico', 'https://instagram.com/valoreconomico'),
  ('fcd723c3-8a70-4c68-8c7c-d73992e6ed64', 'twitter', 'bbcbrasil', 'https://twitter.com/bbcbrasil'),
  ('8d33d084-074d-4aae-a86b-643c4011fda0', 'twitter', 'nexojornal', 'https://twitter.com/nexojornal'),
  ('8d33d084-074d-4aae-a86b-643c4011fda0', 'instagram', 'nexojornal', 'https://instagram.com/nexojornal'),
  ('1d368143-b3f0-42fd-9e61-e49834dbfc14', 'twitter', 'agenciapublica', 'https://twitter.com/agenciapublica'),
  ('1d368143-b3f0-42fd-9e61-e49834dbfc14', 'instagram', 'agenciapublica', 'https://instagram.com/agenciapublica'),
  ('f1cbccd1-711e-43c6-a7f9-e3ea2c959a3a', 'instagram', 'theinterceptbrasil', 'https://instagram.com/theinterceptbrasil')
on conflict (platform, username) do nothing;

-- Classificação EAV (entity_tags): segment (tag_type novo)/power_branch/website/state
insert into entity_tags (entity_id, tag_type, tag_value) values
  ('f98763ed-9e1a-499a-80c5-18828e003229', 'segment', 'Pesquisa Eleitoral'),
  ('f98763ed-9e1a-499a-80c5-18828e003229', 'power_branch', 'Setor Privado'),
  ('f98763ed-9e1a-499a-80c5-18828e003229', 'website', 'https://datafolha.folha.uol.com.br/'),
  ('964434f3-972e-40cb-880b-530fcff64989', 'segment', 'Pesquisa Eleitoral'),
  ('964434f3-972e-40cb-880b-530fcff64989', 'power_branch', 'Setor Privado'),
  ('f32c3e7e-30d7-46ca-b794-93b01e9a1a5a', 'segment', 'Pesquisa Eleitoral'),
  ('f32c3e7e-30d7-46ca-b794-93b01e9a1a5a', 'power_branch', 'Setor Privado'),
  ('c7f40880-749f-4642-a222-b5a1ac45d61d', 'segment', 'Pesquisa Eleitoral'),
  ('c7f40880-749f-4642-a222-b5a1ac45d61d', 'power_branch', 'Setor Privado'),
  ('c7f40880-749f-4642-a222-b5a1ac45d61d', 'website', 'https://atlasintel.org/'),
  ('cd1112fd-d476-4ae0-93de-1398203454a0', 'segment', 'Pesquisa Eleitoral'),
  ('cd1112fd-d476-4ae0-93de-1398203454a0', 'power_branch', 'Setor Privado'),
  ('5297899f-111d-4d0e-98e4-3e5df61e0885', 'segment', 'Pesquisa Eleitoral'),
  ('5297899f-111d-4d0e-98e4-3e5df61e0885', 'power_branch', 'Setor Privado'),
  ('18d25430-528a-4da0-9160-40a49be94f08', 'segment', 'Pesquisa Eleitoral'),
  ('18d25430-528a-4da0-9160-40a49be94f08', 'power_branch', 'Setor Privado'),
  ('f9e4eeb4-5f2e-4ac0-8be6-e29a15a9daa1', 'segment', 'Pesquisa Eleitoral'),
  ('f9e4eeb4-5f2e-4ac0-8be6-e29a15a9daa1', 'power_branch', 'Setor Privado'),
  ('789c26f0-9782-4c30-aea1-072161770c61', 'segment', 'Pesquisa Eleitoral'),
  ('789c26f0-9782-4c30-aea1-072161770c61', 'power_branch', 'Setor Privado'),
  ('e87691f4-e132-4dcd-9e13-5784d90201ac', 'segment', 'Pesquisa Eleitoral'),
  ('e87691f4-e132-4dcd-9e13-5784d90201ac', 'power_branch', 'Setor Privado'),
  ('eecbd166-3519-4842-ade1-5f37c361e1f6', 'segment', 'Pesquisa Eleitoral'),
  ('eecbd166-3519-4842-ade1-5f37c361e1f6', 'power_branch', 'Setor Privado'),
  ('e13f4b83-3f32-4dfa-9f02-baa90b6aee96', 'segment', 'Pesquisa Eleitoral'),
  ('e13f4b83-3f32-4dfa-9f02-baa90b6aee96', 'power_branch', 'Setor Privado'),
  ('4ffdebbb-c5ae-418c-9158-4fc3b476cf93', 'segment', 'Portal de Notícias'),
  ('4ffdebbb-c5ae-418c-9158-4fc3b476cf93', 'power_branch', 'Mídia'),
  ('4ffdebbb-c5ae-418c-9158-4fc3b476cf93', 'website', 'https://g1.globo.com'),
  ('b85e1b31-1f79-4294-a844-93d2cead2c9f', 'segment', 'Jornal Impresso'),
  ('b85e1b31-1f79-4294-a844-93d2cead2c9f', 'power_branch', 'Mídia'),
  ('b85e1b31-1f79-4294-a844-93d2cead2c9f', 'website', 'https://oglobo.globo.com/'),
  ('747c53a0-97a4-4819-8aee-836fa425c7d0', 'segment', 'TV a Cabo/Notícias 24h'),
  ('747c53a0-97a4-4819-8aee-836fa425c7d0', 'power_branch', 'Mídia'),
  ('747c53a0-97a4-4819-8aee-836fa425c7d0', 'website', 'https://g1.globo.com/globo-news/'),
  ('804951c4-af95-4700-a7f6-ea05deacf410', 'segment', 'Jornal Impresso'),
  ('804951c4-af95-4700-a7f6-ea05deacf410', 'power_branch', 'Mídia'),
  ('804951c4-af95-4700-a7f6-ea05deacf410', 'website', 'https://www.folha.uol.com.br/'),
  ('6978addf-bd38-4a6a-a928-997db4945858', 'segment', 'Portal de Notícias'),
  ('6978addf-bd38-4a6a-a928-997db4945858', 'power_branch', 'Mídia'),
  ('6978addf-bd38-4a6a-a928-997db4945858', 'website', 'https://www.uol.com.br/'),
  ('8451b694-113a-448f-8c03-80a4d8b70447', 'segment', 'Jornal Impresso'),
  ('8451b694-113a-448f-8c03-80a4d8b70447', 'power_branch', 'Mídia'),
  ('8451b694-113a-448f-8c03-80a4d8b70447', 'website', 'https://www.estadao.com.br'),
  ('99cd54f1-1aa6-4cee-818c-0fbb9423f5a3', 'segment', 'Portal de Notícias'),
  ('99cd54f1-1aa6-4cee-818c-0fbb9423f5a3', 'power_branch', 'Mídia'),
  ('99cd54f1-1aa6-4cee-818c-0fbb9423f5a3', 'website', 'https://www.terra.com.br/'),
  ('a3c94c54-3a68-48bf-8089-e42ed501d71a', 'segment', 'Portal de Notícias'),
  ('a3c94c54-3a68-48bf-8089-e42ed501d71a', 'power_branch', 'Mídia'),
  ('a3c94c54-3a68-48bf-8089-e42ed501d71a', 'website', 'https://www.r7.com/'),
  ('dda3716d-04a4-4a8b-8d86-dda70cf0b40e', 'segment', 'TV Aberta'),
  ('dda3716d-04a4-4a8b-8d86-dda70cf0b40e', 'power_branch', 'Mídia'),
  ('dda3716d-04a4-4a8b-8d86-dda70cf0b40e', 'website', 'https://www.sbt.com.br/'),
  ('6a0eb9a9-d87f-4e2a-8a47-98ff4c2d98d3', 'segment', 'TV Aberta'),
  ('6a0eb9a9-d87f-4e2a-8a47-98ff4c2d98d3', 'power_branch', 'Mídia'),
  ('6a0eb9a9-d87f-4e2a-8a47-98ff4c2d98d3', 'website', 'https://www.band.uol.com.br/'),
  ('f2ec917a-f9c5-470b-845d-f50a8f59ab99', 'segment', 'TV Aberta/Notícias 24h'),
  ('f2ec917a-f9c5-470b-845d-f50a8f59ab99', 'power_branch', 'Mídia'),
  ('f2ec917a-f9c5-470b-845d-f50a8f59ab99', 'website', 'https://www.cnnbrasil.com.br'),
  ('abdcbdff-028f-40a9-987e-b352d38bc10f', 'segment', 'Revista'),
  ('abdcbdff-028f-40a9-987e-b352d38bc10f', 'power_branch', 'Mídia'),
  ('abdcbdff-028f-40a9-987e-b352d38bc10f', 'website', 'https://veja.abril.com.br'),
  ('b7c26c5b-1f59-45f3-96a0-8e8f08d44725', 'segment', 'Revista'),
  ('b7c26c5b-1f59-45f3-96a0-8e8f08d44725', 'power_branch', 'Mídia'),
  ('b7c26c5b-1f59-45f3-96a0-8e8f08d44725', 'website', 'https://istoe.com.br'),
  ('339dc067-71ce-48c3-876f-38344d81e91f', 'segment', 'Revista'),
  ('339dc067-71ce-48c3-876f-38344d81e91f', 'power_branch', 'Mídia'),
  ('339dc067-71ce-48c3-876f-38344d81e91f', 'website', 'https://www.cartacapital.com.br/'),
  ('4458293d-8755-4a52-b8c4-448d9a11dd64', 'segment', 'Portal de Notícias'),
  ('4458293d-8755-4a52-b8c4-448d9a11dd64', 'power_branch', 'Mídia'),
  ('4458293d-8755-4a52-b8c4-448d9a11dd64', 'website', 'https://www.poder360.com.br'),
  ('d8ad904c-dc9e-4ecc-8289-be586cb94e4d', 'segment', 'Portal de Notícias'),
  ('d8ad904c-dc9e-4ecc-8289-be586cb94e4d', 'power_branch', 'Mídia'),
  ('d8ad904c-dc9e-4ecc-8289-be586cb94e4d', 'website', 'https://www.metropoles.com/'),
  ('1730ba36-650e-411c-b9d5-909d973fc2d6', 'segment', 'Portal de Notícias'),
  ('1730ba36-650e-411c-b9d5-909d973fc2d6', 'power_branch', 'Mídia'),
  ('1730ba36-650e-411c-b9d5-909d973fc2d6', 'website', 'https://www.congressoemfoco.com.br'),
  ('1c226376-1b07-4f68-b733-9f6eb92d53b4', 'segment', 'Portal de Notícias'),
  ('1c226376-1b07-4f68-b733-9f6eb92d53b4', 'power_branch', 'Mídia'),
  ('1c226376-1b07-4f68-b733-9f6eb92d53b4', 'website', 'https://www.brasil247.com/'),
  ('ad20533d-e7e2-443a-9a49-841463c0e496', 'segment', 'Jornal Impresso'),
  ('ad20533d-e7e2-443a-9a49-841463c0e496', 'power_branch', 'Mídia'),
  ('ad20533d-e7e2-443a-9a49-841463c0e496', 'website', 'https://www.gazetadopovo.com.br'),
  ('ad20533d-e7e2-443a-9a49-841463c0e496', 'state', 'PR'),
  ('dcaff94a-8b62-48fa-af43-fc4bdf973867', 'segment', 'Rádio'),
  ('dcaff94a-8b62-48fa-af43-fc4bdf973867', 'power_branch', 'Mídia'),
  ('dcaff94a-8b62-48fa-af43-fc4bdf973867', 'website', 'https://jovempan.com.br/'),
  ('4d386035-349e-4995-9658-c0c4ff83e7a1', 'segment', 'Agência de Notícias'),
  ('4d386035-349e-4995-9658-c0c4ff83e7a1', 'power_branch', 'Mídia'),
  ('4d386035-349e-4995-9658-c0c4ff83e7a1', 'website', 'https://agenciabrasil.ebc.com.br/'),
  ('2e7e7cc8-ae05-4087-8074-16a4cad7d88c', 'segment', 'Jornal Impresso'),
  ('2e7e7cc8-ae05-4087-8074-16a4cad7d88c', 'power_branch', 'Mídia'),
  ('2e7e7cc8-ae05-4087-8074-16a4cad7d88c', 'website', 'https://www.correiobraziliense.com.br/'),
  ('2e7e7cc8-ae05-4087-8074-16a4cad7d88c', 'state', 'DF'),
  ('fee905ce-418a-429d-87ed-0a3be87d157b', 'segment', 'Portal de Notícias'),
  ('fee905ce-418a-429d-87ed-0a3be87d157b', 'power_branch', 'Mídia'),
  ('fee905ce-418a-429d-87ed-0a3be87d157b', 'website', 'https://www.oantagonista.com.br/'),
  ('5966c1bc-fc6b-40a2-9fd2-3563ffde1288', 'segment', 'Revista'),
  ('5966c1bc-fc6b-40a2-9fd2-3563ffde1288', 'power_branch', 'Mídia'),
  ('5966c1bc-fc6b-40a2-9fd2-3563ffde1288', 'website', 'https://exame.com/'),
  ('18350851-d5f2-4466-a8ec-c74a3a5de4f8', 'segment', 'Portal de Notícias'),
  ('18350851-d5f2-4466-a8ec-c74a3a5de4f8', 'power_branch', 'Mídia'),
  ('18350851-d5f2-4466-a8ec-c74a3a5de4f8', 'website', 'https://www.infomoney.com.br'),
  ('cd35bdd6-8f3e-4077-9bd2-d3ef30757a84', 'segment', 'Jornal Impresso'),
  ('cd35bdd6-8f3e-4077-9bd2-d3ef30757a84', 'power_branch', 'Mídia'),
  ('cd35bdd6-8f3e-4077-9bd2-d3ef30757a84', 'website', 'https://valor.globo.com'),
  ('fcd723c3-8a70-4c68-8c7c-d73992e6ed64', 'segment', 'Portal de Notícias'),
  ('fcd723c3-8a70-4c68-8c7c-d73992e6ed64', 'power_branch', 'Mídia'),
  ('fcd723c3-8a70-4c68-8c7c-d73992e6ed64', 'website', 'https://www.bbc.com/portuguese'),
  ('8d33d084-074d-4aae-a86b-643c4011fda0', 'segment', 'Portal de Notícias'),
  ('8d33d084-074d-4aae-a86b-643c4011fda0', 'power_branch', 'Mídia'),
  ('8d33d084-074d-4aae-a86b-643c4011fda0', 'website', 'https://www.nexojornal.com.br/'),
  ('1d368143-b3f0-42fd-9e61-e49834dbfc14', 'segment', 'Jornalismo Investigativo'),
  ('1d368143-b3f0-42fd-9e61-e49834dbfc14', 'power_branch', 'Mídia'),
  ('1d368143-b3f0-42fd-9e61-e49834dbfc14', 'website', 'https://apublica.org/'),
  ('f1cbccd1-711e-43c6-a7f9-e3ea2c959a3a', 'segment', 'Jornalismo Investigativo'),
  ('f1cbccd1-711e-43c6-a7f9-e3ea2c959a3a', 'power_branch', 'Mídia'),
  ('f1cbccd1-711e-43c6-a7f9-e3ea2c959a3a', 'website', 'https://www.intercept.com.br')
on conflict (entity_id, tag_type, tag_value) do nothing;
