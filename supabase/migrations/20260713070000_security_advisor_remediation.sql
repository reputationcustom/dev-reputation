-- Módulo: transversal (segurança)
-- Fonte: pedido do usuário (2026-07-13) — regras globais do Supabase
-- Security Advisor (ver CLAUDE.md, "Segurança de banco de dados (Security
-- Advisor)"). Corrige 3 achados reais encontrados na auditoria desta
-- revisão, não simulados:
--
-- 1) ⚠️ VAZAMENTO CROSS-TENANT REAL: public.narratives_overview (e os dois
--    espelhos em `reporting`) foram criadas sem `security_invoker = true`.
--    No Postgres, uma view sem essa opção executa com o privilégio do DONO
--    da view (não de quem consulta) para fins de permissão — o que faz a
--    RLS das tabelas base (narratives/narrative_metrics) ser IGNORADA.
--    Como public.narratives_overview é exposta via PostgREST pro role
--    `authenticated` (consumida pela UI do Executive Overview), isso
--    significa que qualquer usuário autenticado, de qualquer organização,
--    via PostgREST enxergava as Narrativas de TODAS as organizações, não
--    só a(s) sua(s) — o comentário antigo deixado na view
--    ("RLS das tabelas base se aplica normalmente pois é uma view sem
--    security_invoker/definer especial") estava com a premissa invertida:
--    é exatamente a AUSÊNCIA de security_invoker que faz a RLS ser
--    ignorada, não o contrário. Corrigido via ALTER VIEW (não precisa
--    recriar a view inteira, evita o risco de reordenar colunas descrito
--    nos comentários de 20260713030000).
--    `reporting.*` não é exposta via PostgREST (só bi_reader, conexão
--    Postgres direta, Princípio técnico 6 — nunca em db.schemas) e
--    bi_reader já é bypassrls por atributo de role — não é um vazamento
--    ali (bypassrls do role vale independente do modo invoker/definer da
--    view), mas security_invoker = true é aplicado do mesmo jeito por
--    consistência/defesa em profundidade, sem custo.
alter view public.narratives_overview set (security_invoker = true);
alter view reporting.narratives_overview set (security_invoker = true);
alter view reporting.mentions_daily set (security_invoker = true);

-- 2) 6 functions vivas foram criadas sem `set search_path`, vulnerável a
--    "search path hijacking". Corrigido via ALTER FUNCTION (não precisa
--    recriar o corpo) — mesmo padrão (`search_path = public`) já usado
--    pelas 3 functions que já tinham isso corretamente
--    (auth_organization_ids, create_mentions_partition,
--    is_current_user_admin); search_path vazio quebraria estas, que
--    referenciam tabelas do próprio schema sem qualificar.
alter function set_updated_at() set search_path = public;
alter function narrative_matched_mentions(uuid, timestamptz, timestamptz) set search_path = public;
alter function refresh_narrative_metrics(date, date) set search_path = public;
alter function try_acquire_bw_sync_lock(integer) set search_path = public;
alter function release_bw_sync_lock() set search_path = public;
alter function protect_principal_account() set search_path = public;

-- 3) bw_sync_lock/sync_cursors/sync_log têm RLS ativa e são deny-all por
--    design (só SUPABASE_SECRET_KEY acessa, ver CLAUDE.md "Brandwatch sync
--    model") mas nunca tiveram nenhuma CREATE POLICY — o Advisor não
--    consegue diferenciar "esqueceram de criar a policy" de "é
--    intencional", então fica flagado como RLS sem policy. Declarado
--    explicitamente para deixar a intenção auto-documentada no banco.
create policy "bw_sync_lock: sem acesso direto"
  on bw_sync_lock for all using (false);

create policy "sync_cursors: sem acesso direto"
  on sync_cursors for all using (false);

create policy "sync_log: sem acesso direto"
  on sync_log for all using (false);
