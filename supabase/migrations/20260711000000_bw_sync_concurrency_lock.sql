-- Pedido do usuário (2026-07-10/11): "Acho que o código violou alguma
-- regra da brandwatch. Se for necessário quebre o sync em mais de uma
-- edge function, respeitando os limites da API."
--
-- Logs reais mostraram HTTP 429 encadeado em DUAS chamadas diferentes
-- (data/mentions e data/volume/topauthors/queries) intercaladas — sinal de
-- DUAS invocações de bw-sync rodando ao mesmo tempo, cada uma fazendo
-- chamadas sequenciais à Brandwatch (como já é o padrão dentro de uma
-- invocação), mas competindo pelo mesmo orçamento de 30 chamadas/10min
-- (o rate limit é por Client, não por invocação) — nada no código impedia
-- duas invocações concorrentes de rodar juntas.
--
-- Em vez de quebrar em múltiplas Edge Functions (Princípio técnico 5 exige
-- que cada uma seja autossuficiente, duplicando ainda mais código, e não
-- resolveria a concorrência por si só — duas instâncias da MESMA function
-- já bastam pra estourar o limite), a correção é um lock de mutual
-- exclusion: só uma invocação pode estar ativamente chamando a Brandwatch
-- por vez. Implementado como uma linha única numa tabela, reivindicada via
-- UPDATE atômico (só um UPDATE concorrente "ganha" a linha por vez —
-- garantia do próprio MVCC do Postgres, sem depender de advisory locks,
-- que não são confiáveis via PostgREST/pooling de conexão).

create table if not exists bw_sync_lock (
  id             boolean primary key default true,
  locked_at      timestamptz,
  locked_until   timestamptz,
  constraint bw_sync_lock_single_row check (id)
);

insert into bw_sync_lock (id, locked_at, locked_until)
values (true, null, null)
on conflict (id) do nothing;

alter table bw_sync_lock enable row level security;
-- Deny-all, mesmo padrão de sync_cursors/sync_log — só SUPABASE_SECRET_KEY
-- (que bypassa RLS) acessa.

-- Reivindica o lock por até p_duration_seconds (default 5min — bem acima
-- do tempo esperado de uma invocação, mas com auto-expiração pra nunca
-- travar pra sempre se uma invocação cair no meio do caminho sem chamar
-- release_bw_sync_lock()). Retorna true só se conseguiu reivindicar.
create or replace function try_acquire_bw_sync_lock(p_duration_seconds integer default 300)
returns boolean
language plpgsql
as $$
declare
  v_acquired boolean;
begin
  update bw_sync_lock
  set locked_at = now(),
      locked_until = now() + (p_duration_seconds || ' seconds')::interval
  where id = true
    and (locked_until is null or locked_until < now())
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function release_bw_sync_lock()
returns void
language sql
as $$
  update bw_sync_lock set locked_until = null where id = true;
$$;
