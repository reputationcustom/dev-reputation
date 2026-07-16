-- Seed — Complemento de veículos de mídia/TV/rádio + canais legislativos
-- .dev/specs/entities/data-model.md
--
-- Pedido do usuário: expandir uma lista de "50 canais mais relevantes de
-- notícias e política" (fornecida por esta mesma conversa, curadoria de
-- conhecimento geral, não verificada) contra o Cadastro Nacional de
-- Entidades já existente, adicionando só o que ainda não estava
-- semeado. Comparado item a item contra `20260731010000` (partidos/
-- parlamentares), `20260807010000` (12 institutos de pesquisa + 30
-- veículos de imprensa) e `20260731050000` (cargo/partido/ideologia) —
-- 39 dos 50 itens da lista já existiam (todos os 30 veículos + os 12
-- institutos + Jovem Pan já cobrem boa parte de rádio/portal/revista).
-- Esta migration adiciona só os 10 itens genuinamente novos + Politize!
-- (11 Entities), com a mesma disciplina de fonte real já usada no seed
-- anterior: cada um verificado ao vivo nesta sessão contra a API pública
-- do Wikidata (wbsearchentities + Special:EntityData, propriedades P856
-- website oficial/P2002 usuário do Twitter-X/P2003 usuário do
-- Instagram) — nenhum handle completado de memória.
--
-- Escopo (10 com item Wikidata confirmado, type = media_outlet exceto os
-- 2 canais legislativos que são institution):
--   - Record TV / Rede Record (Q1458581) — media_outlet, TV Aberta
--   - RecordNews (Q3056409) — media_outlet, TV a Cabo/Notícias 24h
--   - BandNews TV (Q4854203) — media_outlet, TV a Cabo/Notícias 24h
--   - TV Cultura (Q3069919) — media_outlet, TV Pública
--   - TV Câmara (Q6137650) — institution, TV Legislativa (Câmara dos
--     Deputados, poder Legislativo — não é mídia privada/pública comum,
--     por isso `power_branch = 'Legislativo'`, valor já existente no
--     vocabulário de `data-model.md`, não `'Mídia'`)
--   - TV Senado (Q7672422) — institution, TV Legislativa (Senado
--     Federal, mesmo raciocínio de power_branch acima)
--   - Época (Q287432) — media_outlet, Revista. ⚠️ O próprio Wikidata
--     descreve como "revista semanal brasileira (1998-2021)", hoje
--     integrada como seção do site de O Globo (oglobo.globo.com/epoca)
--     — sem P2002/P2003 próprios no Wikidata, só `website`.
--   - CBN (Q7385857) — media_outlet, Rádio
--   - BandNews FM (Q4854200) — media_outlet, Rádio
--   - Flow Podcast (Q104777974) — media_outlet, Podcast/YouTube
--
-- 1 sem item Wikidata verificável (mesma situação já aceita para 10 dos
-- 12 institutos em `20260807010000` — a Entity é real e conhecida, só
-- sem cobertura no Wikidata para confirmar handle/site em lote):
--   - Politize! — institution, Educação Política, power_branch
--     'Sociedade Civil'. Nenhuma busca (pt/en, com e sem "!") encontrou
--     um item Wikidata correspondente — cadastrada sem `website`/
--     `entity_accounts`, mesmo tratamento já dado a Ipec/Quaest/Paraná
--     Pesquisas/etc. no seed anterior (existe no catálogo para permitir
--     cadastro manual de conta depois, `/admin/entities`).
--
-- `entity_accounts`: só Twitter/Instagram (mesmo vocabulário de
-- plataforma já usado no seed anterior — nunca 'youtube' nesta
-- migration, ver nota abaixo). Época e Politize! ficam sem nenhuma
-- conta.
--
-- ⚠️ Deliberadamente NÃO adicionado como `entity_accounts`: os canais do
-- YouTube confirmados via Wikidata P2397 para Record TV
-- (UCu_a6PAzp30Bn2mM-Ll09LA), TV Cultura (UCjOJvvYe6tyEHY21OD33h8A),
-- BandNews FM (UCWijW6tW0iI5ghsAbWDFtTg) e Flow Podcast
-- (UC4ncvgh5hFr5O83MH7-jRJg). Esse campo do Wikidata guarda o ID bruto
-- do canal (`UC...`), não o handle legível que a Brandwatch de fato
-- grava em `mentions.author`/`bw_query_top_authors.author` para
-- publicações do YouTube — gravar o ID bruto como `username` quase
-- certamente nunca casaria no JOIN por texto que `author-linking.md`
-- define (`lower(trim(username)) = lower(trim(author))`), diferente de
-- Twitter/Instagram, onde o handle do Wikidata já é o mesmo texto que a
-- Brandwatch usa. Registrar mesmo assim sugeriria um vínculo que não
-- funciona na prática — mesmo cuidado já tomado com `website` (nunca
-- gravado em `entity_accounts`, só em `entity_tags`, por não ser o
-- campo que o JOIN usa). Revisitar se/quando a Brandwatch confirmar que
-- expõe o handle legível do YouTube em vez do ID de canal.
--
-- Idempotência: `on conflict do nothing` nas 3 tabelas, mesmo padrão dos
-- 2 seeds anteriores.

-- Entities novas
insert into entities (id, type, name, is_active) values
  ('a7ddb4a2-6675-4f84-9853-4dcce7335f33', 'media_outlet', 'Record TV', true),
  ('e693a908-59a2-4e46-890a-61fc6f938725', 'media_outlet', 'RecordNews', true),
  ('8a038c2f-0546-4847-9a02-898e7b28e939', 'media_outlet', 'BandNews TV', true),
  ('3b691ec8-cfee-4d83-b50d-2ddc0ced35c3', 'media_outlet', 'TV Cultura', true),
  ('524a5455-2ae2-45c2-b5d6-91bcfb84a4a5', 'institution', 'TV Câmara', true),
  ('a6404427-050e-4c87-9837-c08e7f9b4b98', 'institution', 'TV Senado', true),
  ('dfea8315-86b3-406b-b3d4-9fed86701c6a', 'media_outlet', 'Época', true),
  ('531b01f2-9f76-4f17-80d4-37062ed63276', 'media_outlet', 'CBN', true),
  ('c20ac57a-aff6-4dd2-b36e-3bca1c94165e', 'media_outlet', 'BandNews FM', true),
  ('e4f1dfdd-a084-43d6-8ce7-b57212c35c45', 'media_outlet', 'Flow Podcast', true),
  ('0f3641ed-7441-4e04-8937-47d18cdb7aac', 'institution', 'Politize!', true)
on conflict (id) do nothing;

-- Contas oficiais em redes sociais (entity_accounts) — só handles
-- confirmados via Wikidata (P2002 Twitter-X / P2003 Instagram) nesta
-- sessão. Época e Politize! ficam sem nenhuma linha aqui.
insert into entity_accounts (entity_id, platform, username, url) values
  ('a7ddb4a2-6675-4f84-9853-4dcce7335f33', 'twitter', 'siga_record', 'https://twitter.com/siga_record'),
  ('a7ddb4a2-6675-4f84-9853-4dcce7335f33', 'instagram', 'sigarecord', 'https://instagram.com/sigarecord'),
  ('e693a908-59a2-4e46-890a-61fc6f938725', 'twitter', 'recordnews', 'https://twitter.com/recordnews'),
  ('e693a908-59a2-4e46-890a-61fc6f938725', 'instagram', 'recordnews', 'https://instagram.com/recordnews'),
  ('8a038c2f-0546-4847-9a02-898e7b28e939', 'twitter', 'BandnewsTV', 'https://twitter.com/BandnewsTV'),
  ('8a038c2f-0546-4847-9a02-898e7b28e939', 'instagram', 'bandnewstv', 'https://instagram.com/bandnewstv'),
  ('3b691ec8-cfee-4d83-b50d-2ddc0ced35c3', 'twitter', 'tvcultura', 'https://twitter.com/tvcultura'),
  ('3b691ec8-cfee-4d83-b50d-2ddc0ced35c3', 'instagram', 'tvcultura', 'https://instagram.com/tvcultura'),
  ('524a5455-2ae2-45c2-b5d6-91bcfb84a4a5', 'twitter', 'tvcamara', 'https://twitter.com/tvcamara'),
  ('a6404427-050e-4c87-9837-c08e7f9b4b98', 'twitter', 'tvsenado', 'https://twitter.com/tvsenado'),
  ('a6404427-050e-4c87-9837-c08e7f9b4b98', 'instagram', 'tvsenado', 'https://instagram.com/tvsenado'),
  ('531b01f2-9f76-4f17-80d4-37062ed63276', 'twitter', 'cbnoficial', 'https://twitter.com/cbnoficial'),
  ('531b01f2-9f76-4f17-80d4-37062ed63276', 'instagram', 'cbnoficial', 'https://instagram.com/cbnoficial'),
  ('c20ac57a-aff6-4dd2-b36e-3bca1c94165e', 'twitter', 'radiobandnewsfm', 'https://twitter.com/radiobandnewsfm'),
  ('c20ac57a-aff6-4dd2-b36e-3bca1c94165e', 'instagram', 'radiobandnewsfm', 'https://instagram.com/radiobandnewsfm'),
  ('e4f1dfdd-a084-43d6-8ce7-b57212c35c45', 'twitter', 'flowpdc', 'https://twitter.com/flowpdc'),
  ('e4f1dfdd-a084-43d6-8ce7-b57212c35c45', 'instagram', 'flowpdc', 'https://instagram.com/flowpdc')
on conflict (platform, username) do nothing;

-- Classificação EAV (entity_tags): segment/power_branch/website
insert into entity_tags (entity_id, tag_type, tag_value) values
  ('a7ddb4a2-6675-4f84-9853-4dcce7335f33', 'segment', 'TV Aberta'),
  ('a7ddb4a2-6675-4f84-9853-4dcce7335f33', 'power_branch', 'Mídia'),
  ('a7ddb4a2-6675-4f84-9853-4dcce7335f33', 'website', 'https://record.r7.com/'),

  ('e693a908-59a2-4e46-890a-61fc6f938725', 'segment', 'TV a Cabo/Notícias 24h'),
  ('e693a908-59a2-4e46-890a-61fc6f938725', 'power_branch', 'Mídia'),
  ('e693a908-59a2-4e46-890a-61fc6f938725', 'website', 'http://noticias.r7.com/record-news/'),

  ('8a038c2f-0546-4847-9a02-898e7b28e939', 'segment', 'TV a Cabo/Notícias 24h'),
  ('8a038c2f-0546-4847-9a02-898e7b28e939', 'power_branch', 'Mídia'),
  ('8a038c2f-0546-4847-9a02-898e7b28e939', 'website', 'http://bandnewstv.band.uol.com.br'),

  ('3b691ec8-cfee-4d83-b50d-2ddc0ced35c3', 'segment', 'TV Pública'),
  ('3b691ec8-cfee-4d83-b50d-2ddc0ced35c3', 'power_branch', 'Mídia'),
  ('3b691ec8-cfee-4d83-b50d-2ddc0ced35c3', 'website', 'https://cultura.uol.com.br/'),

  ('524a5455-2ae2-45c2-b5d6-91bcfb84a4a5', 'segment', 'TV Legislativa'),
  ('524a5455-2ae2-45c2-b5d6-91bcfb84a4a5', 'power_branch', 'Legislativo'),
  ('524a5455-2ae2-45c2-b5d6-91bcfb84a4a5', 'website', 'https://www.camara.leg.br/tv'),

  ('a6404427-050e-4c87-9837-c08e7f9b4b98', 'segment', 'TV Legislativa'),
  ('a6404427-050e-4c87-9837-c08e7f9b4b98', 'power_branch', 'Legislativo'),
  ('a6404427-050e-4c87-9837-c08e7f9b4b98', 'website', 'http://www.senado.gov.br/tv'),

  ('dfea8315-86b3-406b-b3d4-9fed86701c6a', 'segment', 'Revista'),
  ('dfea8315-86b3-406b-b3d4-9fed86701c6a', 'power_branch', 'Mídia'),
  ('dfea8315-86b3-406b-b3d4-9fed86701c6a', 'website', 'https://oglobo.globo.com/epoca'),

  ('531b01f2-9f76-4f17-80d4-37062ed63276', 'segment', 'Rádio'),
  ('531b01f2-9f76-4f17-80d4-37062ed63276', 'power_branch', 'Mídia'),
  ('531b01f2-9f76-4f17-80d4-37062ed63276', 'website', 'http://cbn.globoradio.globo.com/home/HOME.htm'),

  ('c20ac57a-aff6-4dd2-b36e-3bca1c94165e', 'segment', 'Rádio'),
  ('c20ac57a-aff6-4dd2-b36e-3bca1c94165e', 'power_branch', 'Mídia'),
  ('c20ac57a-aff6-4dd2-b36e-3bca1c94165e', 'website', 'http://www.bandnewsfm.com.br'),

  ('e4f1dfdd-a084-43d6-8ce7-b57212c35c45', 'segment', 'Podcast/YouTube'),
  ('e4f1dfdd-a084-43d6-8ce7-b57212c35c45', 'power_branch', 'Mídia'),
  ('e4f1dfdd-a084-43d6-8ce7-b57212c35c45', 'website', 'https://flowpodcast.com.br/'),

  ('0f3641ed-7441-4e04-8937-47d18cdb7aac', 'segment', 'Educação Política'),
  ('0f3641ed-7441-4e04-8937-47d18cdb7aac', 'power_branch', 'Sociedade Civil')
on conflict (entity_id, tag_type, tag_value) do nothing;
