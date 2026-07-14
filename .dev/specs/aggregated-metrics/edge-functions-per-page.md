---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: edge-functions-per-page
status: implementado
atualizado: 2026-07-25
---

# Edge Functions por Página

> ✅ **Implementado (2026-07-15)**: as 6 Edge Functions que o Sprint 2
> precisa (`get-page-{overview,narratives,sentiment,platforms,themes}`,
> `get-narrative-detail`) estão em produção, seguindo exatamente o padrão
> de autenticação descrito abaixo (client com a chave publicável + JWT
> repassado, nunca `SUPABASE_SECRET_KEY`). `get-page-authors`/
> `get-page-alerts`/`get-page-reports` continuam não implementadas —
> dependem de `entities`/`event-radar`/`executive-reports` (Sprint 3-4,
> ainda `rascunho`), por desenho (ver `overview.md`).
>
> ✅ **Cache de página implementado (2026-07-25, gap #21)** — tabela
> `page_cache` (migration `20260725040000`) + `getPageEnvelopeWithCache()`
> na service layer, chamada por todas as 6 Edge Functions no lugar de
> `assemblePageResponse()` diretamente. **Escopo reduzido, deliberado**: só
> o TTL de 5 minutos está implementado — a invalidação antecipada por
> "sync da Brandwatch concluiu um ciclo" ou "usuário clicou 'Atualizar
> dados'" descrita na regra de negócio abaixo **não está implementada**,
> porque nenhum dos dois gatilhos existe hoje no produto (`bw-sync` não
> conhece `page_cache`; não existe botão "Atualizar dados" no header do
> frontend). Revisitar se o TTL sozinho se mostrar insuficiente na
> prática.
>
> ⚠️ **Desabilitado 2026-07-14** (pedido do usuário) — investigando um bug
> real de `/narratives` retornando `narratives: []` mesmo com dado
> confirmado por SQL direto (Narrativas-folha ativas com
> `narrative_metrics` reais na janela pedida), `page_cache` era o suspeito
> ainda não descartado quando o usuário pediu para tirar o cache do
> caminho e retomar depois. `getPageEnvelopeWithCache()` (service layer +
> as 7 Edge Functions, incluindo `get-page-authors` que não existia em
> 2026-07-25) agora só chama `assemblePageResponse()` direto — nunca lê/
> grava `page_cache`. Tabela/migration/RLS intactas, só não usadas;
> reativar é restaurar o corpo original da function (ver histórico do
> git). Ver `_pending.md`, gap #34.

## Objetivo

Uma Edge Function fina por página do frontend, responsável apenas por orquestrar a chamada à
`service-layer-aggregation` e devolver o envelope — nunca por conter lógica de agregação própria.

## Usuários afetados

Frontend autenticado (todas as 8 páginas do menu lateral) e o job/hook de síntese de IA (ver
[ai-synthesis.md](ai-synthesis.md)), que reaproveita o mesmo envelope.

## Fluxo principal

1. O frontend chama a Edge Function da página (ex: `get-page-overview`) passando
   `Authorization: Bearer <access_token do usuário>` (sempre — nunca uma chamada anônima),
   `organization_id`, `period` e `filters_applied` (vindos do header global). **Sem `query_id`**
   — Queries são resolvidas internamente pela function SQL a partir da organização (ver
   `standard-json-envelope.md`, "Regras de negócio"), nunca recebidas do client.
2. A Edge Function cria o client Supabase **repassando o JWT do usuário** (ver "Autenticação do
   client Supabase" abaixo) — não com `SUPABASE_SECRET_KEY`. Isso faz a Postgres RLS de
   `foundation` (`organization_id in (select auth_organization_ids())`) valer de verdade: se
   `organization_id` no payload não for uma organização do usuário, toda query desse client
   retorna vazio, automaticamente, sem a Edge Function reimplementar a checagem.
3. A Edge Function confirma que o resultado não veio vazio por falta de acesso (ver "Fluxos
   alternativos" — distinguir "organização sem dado ainda" de "organização que o usuário não
   pode ver").
4. A Edge Function verifica cache (ver regra de cache abaixo). Se houver cache válido, retorna
   direto.
5. Caso não haja cache, chama `assemblePageResponse('overview', context)` da service layer.
6. Grava o resultado em cache.
7. Retorna o envelope completo ao frontend.

## Autenticação do client Supabase (exceção ao padrão do Princípio técnico 5)

> ✅ Corrigido 2026-07-13 — revisão pedida pelo usuário: "O RLS do Supabase obrigatoriamente
> precisa respeitar user_id e organization_id no acesso aos dados." O padrão de código do
> Princípio técnico 5 (`_index.md`) usa `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` como
> default em todo Edge Function — correto para `bw-sync` (job de `pg_cron`, sem usuário) e para
> as Edge Functions administrativas de `auth/user-management.md` (`auth.admin.*`, que exigem
> privilégio). **Não é correto aqui**: usar a chave secreta nas `get-page-*` bypassaria a RLS
> de `foundation` inteira, e a única coisa que sobraria pra impedir um usuário de pedir dado de
> uma organização que não é dele seria a Edge Function lembrar de checar isso na mão — frágil,
> fácil de esquecer numa função nova.
>
> Por isso as Edge Functions deste módulo (`get-page-*`, todas as 9) criam o client Supabase
> assim:
> ```ts
> const supabase = createClient(
>   Deno.env.get('SUPABASE_URL')!,
>   Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
>   { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
> )
> ```
> — client com a chave **publicável**, mas autenticado como o usuário da requisição (JWT
> repassado). Toda query desse client roda com `auth.uid()` = o usuário real, então
> `auth_organization_ids()`/RLS é a garantia — mesma garantia que já protege qualquer acesso
> direto do frontend a `foundation`, sem duplicar lógica. As functions SQL de
> `sql-aggregation.md` **não são `security definer`** justamente para preservar isso — rodam
> como o chamador, nunca com privilégio elevado.

## Fluxos alternativos e erros

| Situação                                      | Comportamento esperado                                       |
|------------------------------------------------|----------------------------------------------------------------|
| Sem `Authorization` header / token inválido    | HTTP 401, sem chamar a service layer                          |
| `organization_id` não pertence ao usuário (RLS filtra tudo) | HTTP 403 com mensagem clara — a Edge Function checa isso explicitamente (uma query leve em `organization_members`, não confia em "envelope vazio" pra decidir entre 403 e vazio-de-verdade) |
| Usuário sem organização ativa                  | HTTP 400 com mensagem clara, sem chamar a service layer       |
| Organização sem nenhuma Query cadastrada        | Envelope retorna normalmente com todos os blocos vazios (mesmo tratamento de "sem dado sincronizado ainda", não é erro) |
| Período inválido (start > end)                 | HTTP 400, validação antes de qualquer chamada SQL              |
| Falha em bloco individual dentro do envelope   | Envelope retorna normalmente com aquele bloco vazio (ver `service-layer-aggregation.md`) |
| Falha total (ex: banco fora do ar)             | HTTP 503, frontend deve exibir estado de erro, não travar a página |

## Regras de negócio

- Cada página tem exatamente uma Edge Function — não criar uma Edge Function genérica
  `get-page?page=X`. Funções separadas facilitam permissão, cache e evolução independente por
  página.
- Cache: TTL padrão de 5 minutos por combinação de `(organization_id, page, period, filters)`.
  Deve ser invalidado antes do TTL quando: (a) o sync da Brandwatch concluir um ciclo para
  aquela organização, ou (b) o usuário disparar "Atualizar dados" manualmente no header global.
- `get-narrative-detail` é a única Edge Function que recebe `narrative_id` como parâmetro
  obrigatório, além do contexto padrão.
- Nenhuma Edge Function deve durar mais que alguns segundos — se um bloco (ex: `graph`) for
  pesado, considerar pré-cálculo assíncrono em vez de cálculo síncrono na chamada.

## Permissões

| Ação                                  | Quem pode                                        |
|-----------------------------------------|----------------------------------------------------|
| Chamar qualquer `get-page-*`            | usuário autenticado com acesso à `organization_id` solicitada |
| Chamar `get-narrative-detail`           | mesmo acima + narrativa pertence à mesma organização |

## Dependências técnicas

- `service-layer-aggregation.md` (montagem do envelope)
- Tabela/mecanismo de cache (ex: cache do Supabase Edge Functions ou tabela `page_cache`)
- RLS por `organization_id`/`auth_organization_ids()` já definida em `foundation` (confirmada
  aplicada em todas as tabelas, ver `_index.md`, "Decisões pendentes globais") — é a garantia
  real de isolamento, não o parâmetro `organization_id` recebido no payload (ver "Autenticação
  do client Supabase" acima)

## Referências relacionadas

- [overview.md](overview.md)
- [standard-json-envelope.md](standard-json-envelope.md)
- [service-layer-aggregation.md](service-layer-aggregation.md)
- [block-mapping-per-page.md](block-mapping-per-page.md)
