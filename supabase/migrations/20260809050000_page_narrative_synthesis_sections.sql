-- ai-synthesis.md — generaliza page_narrative_synthesis pra guardar mais de
-- um texto composto por (organization_id, page, period), não só o
-- "narrative_text" genérico ('main'). Pedido do usuário (2026-07-14, mesmo
-- dia da mudança "acompanha o radar"): preencher, via ai-synthesis, 3
-- widgets que hoje são EmptyState/gap documentado por não terem
-- equivalente no radar (event-radar) — "Conteúdos de destaque"
-- (`platforms`), "Comparação entre períodos" (`themes`), e uma visão geral
-- sucinta de "Autores e Influenciadores" (`authors`). Nenhum desses é sobre
-- um evento discreto do radar — são leituras de `breakdowns`/`trends`/
-- `authors` sem evento associado, exatamente o caso que `ai-synthesis.md`
-- já reserva pra "Camada 2" ("precisa de justificativa" — ver o próprio
-- arquivo de spec pra cada uma).
--
-- Em vez de 3 tabelas/mecanismos novos, uma única coluna nova, `section`
-- (default 'main' — todo consumidor existente do narrative_text
-- genérico), generaliza a chave: (organization_id, page, section,
-- period_start, period_end, filters_hash). O código (aggregated-metrics-
-- service.ts) passou a filtrar/gravar `section = 'main'` explicitamente em
-- todo o fluxo já existente (nunca confiar no default silenciosamente),
-- pra nunca colidir com uma linha de section diferente pra essa mesma
-- (page, period, filters_hash) — sem isso, um .maybeSingle() sem filtro de
-- section explícito quebraria (2+ linhas) assim que a primeira seção nova
-- fosse gravada pra uma página que também tem 'main'.

alter table page_narrative_synthesis
  add column if not exists section text not null default 'main';

drop index if exists idx_page_narrative_synthesis_key;

create unique index if not exists idx_page_narrative_synthesis_key
  on page_narrative_synthesis (organization_id, page, section, period_start, period_end, filters_hash);

comment on column page_narrative_synthesis.section is
  'Qual "pedaço" da página este texto composto representa — ''main'' é o narrative_text genérico de sempre (Camada 0/1, "O que os gráficos mostram?"/"Insights"); outros valores (''featured_content'', ''period_comparison'', ''overview'') são seções específicas de uma página só, sempre Camada 2 (ver ai-synthesis.md).';
