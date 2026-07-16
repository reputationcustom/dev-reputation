-- foundation/narratives.md, "Resumo executivo (produtor)" — pedido do
-- usuário: "permita que eu consiga executar a atualização do resumo
-- executivo... por algo disponível na sessão do administrador." Até agora
-- `narrative_summary_due_ids()` só rodava via o cron de 30min
-- (`narrative-summary-composer`), sempre respeitando a mesma janela de
-- staleness (nunca gerado / >7 dias / evento novo do radar/Comunicação) e
-- sem filtro de organização (processa o lote mais antigo de TODAS as
-- organizações junto). Um admin que queira forçar a atualização AGORA,
-- pra sua organização, não tinha como — precisava esperar o próximo tick
-- do cron E que sua organização calhasse de ser a mais "devida" no
-- momento.
--
-- drop function necessário — muda de 1 pra 3 parâmetros (mesma regra de
-- sempre pra mudança de aridade).

drop function if exists narrative_summary_due_ids(integer);

create or replace function narrative_summary_due_ids(
  p_batch_size integer default 5,
  p_organization_id uuid default null,
  p_force boolean default false
)
returns table (narrative_id uuid)
language sql
stable
set search_path = public
as $$
  select n.id
  from narratives n
  join bw_categories bc on bc.id = n.bw_category_id
  where bc.status = 'active'
    and (p_organization_id is null or n.organization_id = p_organization_id)
    and (
      p_force
      or n.description_generated_at is null
      or n.description_generated_at < now() - interval '7 days'
      or exists (
        select 1 from feed_events fe
        where fe.related_narrative_id = n.id
          and fe.created_at > n.description_generated_at
      )
      or exists (
        select 1 from communications c
        where c.narrative_id = n.id
          and c.created_at > n.description_generated_at
      )
    )
  order by (n.description_generated_at is null) desc, n.description_generated_at asc nulls first
  limit p_batch_size
$$;

comment on function narrative_summary_due_ids(integer, uuid, boolean) is
  'Narrativas cujo narratives.description precisa ser (re)gerado. Sem p_organization_id/p_force (chamada do pg_cron via narrative-summary-composer): mesmas 4 condições de staleness de sempre, sem filtro de organização. Com p_organization_id + p_force=true (chamada da Edge Function admin-refresh-narrative-summaries, admin-only): ignora staleness e devolve toda Narrativa ativa daquela organização, até p_batch_size — "atualizar agora", não "atualizar o que já estava devido".';
