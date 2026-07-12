-- Bug de produção: "Erro upsertando bw_query_top_sites: value
-- \"6000000000\" is out of range for type integer" — mesma classe de bug
-- da migration 20260712000000 (reach_estimate/impressions), mas
-- `monthly_visitors` (data/volume/topsites/queries, campo `monthlyVisitors`
-- da Brandwatch, valor nativo, não somado localmente) ficou de fora
-- daquela correção. Grandes domínios (ex.: sites de notícia/redes sociais
-- de alcance nacional) podem facilmente passar de 2^31-1 (~2.1 bilhões)
-- de visitantes mensais estimados.

alter table bw_query_top_sites
  alter column monthly_visitors type bigint;
