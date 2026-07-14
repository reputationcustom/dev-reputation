---
tipo: feature-spec
módulo: communications
funcionalidade: narrative-impact-tracking
status: implementado
atualizado: 2026-07-25
---

# Acompanhamento Pós-Comunicação/Decisão (Linha do Tempo de Impacto)

> ✅ **Implementado (2026-07-25)** — migration
> `20260726010000_communication_impact_functions.sql` (extensão
> `p_reference_at` em `get_narratives_table`, `get_communication_impact`,
> `get_narrative_communication_timeline`), Edge Function
> `get-narrative-communication-timeline`,
> `app/(intelligence-center)/(analytics)/communications/[narrativeId]/page.tsx`,
> `components/communications/impact-timeline.tsx` (reaproveitado também no
> resumo compacto do detalhe de Narrativa, via
> `narrative-communications-section.tsx`). Fiel ao desenho desta spec,
> incluindo `risk_label`/`trend_label` antes/depois (adicionados ao retorno
> das functions além do que o esqueleto original desenhava, para que
> `RiskBadge`/`TrendIndicator` no frontend tivessem o rótulo, não só o
> score). Não executado contra um banco real nesta sessão (sem
> credenciais) — revisado manualmente; `npx tsc --noEmit`/`npm run build`
> passam limpos do lado frontend.
>
> ✅ **Bug real de produção encontrado e corrigido (2026-07-26)**, via
> `supabase db push` real do usuário: `get_communication_impact` falhava
> na criação (`ERROR: column reference "id" is ambiguous`) porque
> `before_scores`/`after_scores` traziam `gnt.*` (saída de
> `get_narratives_table`, que já tem sua própria coluna `id` — o id da
> Narrativa) junto de `w.id` (id da comunicação/decisão), duplicando o
> nome `id` dentro da mesma CTE. Corrigido listando explicitamente as 7
> colunas de `gnt` realmente usadas em vez de `gnt.*`. Ver `CLAUDE.md`,
> "Módulo communications (Sprint 2.1)", para o detalhe completo — inclui
> a lição geral para futuras functions que façam `left join lateral`
> sobre outra function.

## Objetivo

Para cada registro (Comunicação **ou** Decisão, `communications`, ver
[data-model.md](data-model.md) — ✅ ampliado 2026-07-25 para cobrir os dois
`record_type` igualmente, mesma mecânica de cálculo para ambos), responder
objetivamente 4 perguntas — pedido literal do usuário — comparando uma
janela **antes** e uma janela **depois** da data do registro
(`occurred_at`):

1. O sentimento, a partir do registro, está positivo, negativo ou neutro?
2. As menções sobre aquele tema aumentaram ou diminuíram?
3. O risco aumentou ou diminuiu?
4. O momentum aumentou ou diminuiu?

Quando uma Narrativa tem mais de um registro (Comunicações e Decisões
juntos), mostrar isso como uma **linha do tempo** — cada um com seus
próprios indicadores antes/depois, em ordem cronológica, misturados sem
distinção especial de tratamento entre os dois tipos (só o rótulo/ícone
identifica qual é qual — ver "Interface (UI)").

## Conceito: janelas de comparação

Para um registro com `occurred_at = D`, com uma janela de `N` dias
(✅ **default definitivo: 7**, ver decisão abaixo):

- **Janela "antes"**: `[D - N dias, D)` — sempre completa (dado já
  sincronizado/histórico).
- **Janela "depois"**: `[D, D + N dias)`, mas **truncada em `now()`**
  quando a comunicação é recente e a janela completa ainda não decorreu.
  Nesse caso, a resposta é marcada `after_window_complete = false` e a UI
  mostra "Ainda em observação — faltam X dias" em vez de tratar o parcial
  como definitivo.

✅ Todas as métricas somadas ao longo de uma janela (menções, engajamento,
alcance) são normalizadas para **média por dia**, não soma bruta — porque
a janela "depois" pode ser mais curta que a "antes" (truncamento acima);
comparar somas de janelas de tamanhos diferentes produziria um viés
sistemático a favor de "diminuiu". Os scores 0-100 (Momentum/Tendência/
Risco) e o `net_sentiment` (-100 a 100) já são normalizados por definição
— não precisam desse ajuste.

✅ **Decidido (2026-07-25)**: "Seguir o recomendado" — tamanho padrão da
janela (`N`) é **7 dias**, mesma granularidade já usada nos atalhos de
período do produto (Diário/Semanal/Mensal), com um **seletor 3/7/14 dias
na própria tela** (`/communications/[narrativeId]`, "Fluxo principal"
item 2) para o usuário ajustar a sensibilidade da comparação sem exigir
nova migration ou parâmetro adicional no envelope — `p_window_days` já é
parâmetro de `get_communication_impact`/`get_narrative_communication_timeline`
(ver "Dependências técnicas" abaixo), então os 3 valores já são
suportados pela mesma function, só a UI escolhe qual passar. `7` é usado
sempre que o usuário não trocar o seletor manualmente.

## Regras de negócio

- **Correlação, não causalidade.** A tela precisa deixar isso explícito
  (texto fixo abaixo do indicador, não apenas um tooltip) — outros eventos
  concorrentes no mesmo intervalo (outra Comunicação/Decisão da mesma
  Narrativa, notícia externa, ação de terceiros) também influenciam
  sentimento/menções/risco/momentum. O produto **nunca** apresenta a
  comparação antes/depois como prova de que o registro causou a variação —
  só como "isto é o que a métrica fez no intervalo observado". Vale
  igualmente para uma Decisão (ex: "decidimos não comentar publicamente")
  quanto para uma Comunicação.
- **Janelas sobrepostas** (dois registros da mesma Narrativa — Comunicação
  e/ou Decisão, em qualquer combinação — a menos de `N` dias um do outro):
  aceito como limitação, mesma natureza de outras ressalvas de agregação
  já registradas no projeto (ex: dupla contagem de reach/engagement quando
  um autor aparece em mais de uma pauta, `_pending.md`/`electoral-themes.md`)
  — os deltas de cada registro refletem o efeito combinado do período, não
  um efeito isolado atribuível só àquela ação.
- **Sem histórico suficiente "antes"** (Narrativa criada há menos de `N`
  dias antes do registro, ou sem `narrative_metrics` sincronizado nesse
  intervalo): os campos "antes" voltam `null` ("sem dado suficiente"), não
  um `0`/"neutro" fabricado — mesmo princípio já aplicado a `trend_score`
  quando não há histórico de 14 dias (`sql-aggregation.md`, "Tendência").
- Mesma regra de todo o produto: **nenhum número recalculado localmente
  sobre `mentions`** — todas as 4 métricas vêm de `narrative_metrics`/
  `bw_query_metrics_daily` (já sincronizados, históricos, nunca
  sobrescritos por período — ver `CLAUDE.md`, "Data storage is historical
  by design") e das fórmulas já fechadas em `aggregated-metrics/sql-aggregation.md`.
  Este módulo é 100% um **consumidor** dessas fórmulas, nunca uma segunda
  implementação divergente delas.

## Fluxo principal

1. Usuário chega em `/communications/[narrativeId]` — a partir do link
   "Ver impacto" na lista de comunicações, do link "Ver linha do tempo
   completa" no resumo do detalhe de Narrativa
   (`intelligence-center/narratives-exploration.md`), ou navegando direto.
2. Cabeçalho: nome da Narrativa, seletor de janela (3/7/14 dias, default
   7 — ver "Conceito: janelas de comparação" acima), botão **"+ Registrar"** (mesmo
   `CommunicationFormModal` de
   [communication-registration.md](communication-registration.md),
   "Entrada rápida a partir de uma Narrativa" — Narrativa pré-preenchida e
   travada, seletor "Tipo de registro" Comunicação/Decisão disponível
   normalmente, já que a tela inteira já é sobre esta Narrativa). Sempre
   visível, mesmo antes de existir qualquer registro (ver "Fluxos
   alternativos").
3. Linha do tempo: uma entrada por registro (Comunicação ou Decisão)
   daquela Narrativa, ordenada por `occurred_at` asc, cada uma mostrando:
   - Data/hora, tipo (rótulo de `communication_types.label` ou "Decisão"),
     título, canal quando aplicável (dados de `communications`).
   - **Sentimento**: rótulo antes → rótulo depois (reaproveita as 7 faixas
     e cores já definidas em `_design-tokens.md`/`sql-aggregation.md`),
     com seta de direção (↑ melhorou / ↓ piorou / → estável).
   - **Menções**: média/dia antes → média/dia depois, variação percentual,
     seta de direção.
   - **Risco**: score antes → depois (0-100, mesma faixa/cor de
     `_design-tokens.md`), seta de direção — **seta invertida
     semanticamente**: risco "diminuir" é a direção desejável, ao
     contrário de Sentimento/Momentum, onde "aumentar" costuma ser bom
     (ver nota de UI abaixo).
   - **Momentum**: score antes → depois, seta de direção.
   - Selo "Ainda em observação" quando `after_window_complete = false`,
     com o número de dias restantes.
4. A única escrita possível diretamente nesta tela é registrar uma nova
   Comunicação ou Decisão (item 2 acima, via modal) — a linha do tempo em
   si é somente leitura; editar ou excluir um registro já existente volta
   para `/communications` (ver
   [communication-registration.md](communication-registration.md)). Depois
   de registrar pelo modal, a linha do tempo desta página é recarregada no
   lugar (sem navegação), mostrando a nova entrada imediatamente.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Narrativa sem nenhum registro ainda | `<EmptyState />`: "Nenhuma comunicação ou decisão registrada para esta Narrativa ainda" — o botão "+ Registrar" do cabeçalho (item 2 do "Fluxo principal") continua visível independente do estado, regra transversal #2 |
| Registro sem histórico "antes" suficiente | Indicadores "antes" mostram "sem dado suficiente" (não um valor fabricado) — ver "Regras de negócio" |
| Janela "depois" ainda não fechou | Selo "Ainda em observação — faltam N dias", indicadores "depois" calculados só sobre os dias já decorridos, rotulados como parciais |
| Falha ao calcular o impacto (Edge Function) | `<ErrorMessage retry />` por linha da timeline (mesmo padrão de widget por item, não a página inteira) |
| `narrativeId` inválido/de outra organização | Mesmo tratamento 404/redirecionamento já usado em `/narratives/[id]` (`narratives-exploration.md`) |

## Interface (UI)

- Reaproveita os componentes de badge de score já existentes
  (`components/intelligence-center/score-badges.tsx`:
  `SentimentBadge`/`RiskBadge`/`MomentumBadge`, e os helpers
  `sentimentBucketFromScore()`/`momentumBand()`) aplicados aos valores
  "antes" e "depois" — nenhuma paleta de cor nova é necessária.
- **Direção semântica da seta** (regra de UI, não de dado): para
  Sentimento e Momentum, ↑ (aumentou) é visualmente "bom" (verde) e ↓ é
  "ruim" (vermelho); para Risco e Menções, essa polaridade **não é fixa**
  — "menções aumentaram" pode ser bom (mais alcance de uma comunicação
  positiva) ou ruim (crise crescendo), e "risco diminuiu" é sempre bom. A
  tela usa cor neutra (cinza) pra seta de Menções (é magnitude, não
  qualidade) e inverte a polaridade de cor pra Risco (↓ verde, ↑
  vermelho) — nunca reaproveitar cegamente a mesma polaridade de
  Sentimento/Momentum para os outros dois indicadores.
- Texto fixo de rodapé em cada card da timeline: "Comparação de
  correlação, não de causalidade — outros fatores no mesmo período também
  podem ter influenciado esta variação." (ver "Regras de negócio").

## Dados envolvidos

- **Lê**: `communications` (linha do tempo, Comunicações e Decisões
  juntas), `communication_types` (rótulo do Tipo, só para linhas
  `record_type = 'communication'`), `narrative_metrics`/
  `bw_query_metrics_daily` (via as functions abaixo).
- **Escreve**: só o registro de uma nova Comunicação/Decisão via o botão
  "+ Registrar" (ver "Fluxo principal" item 2) — a linha do tempo em si
  não tem escrita própria.

## Dependências técnicas

### Extensão aditiva em `get_narratives_table` — `p_reference_at`

`sql-aggregation.md` já define `momentum_score`/`risk_score` como
period-dependentes (`period_start`/`period_end` já são parâmetros da
function, então "antes"/"depois" já funcionam sem mudança nenhuma nesses
dois). **`trend_score` (Tendência) não** — por definição
(`sql-aggregation.md`, "Tendência"), é sempre calculado sobre os últimos
14 dias a partir de `now()`, independente do período selecionado na tela.
Isso funciona para "hoje", mas não serve para uma comparação histórica
ancorada numa data de registro (Comunicação ou Decisão) passada.

Proposta (não implementada nesta rodada de spec — trabalho de uma sessão
futura de `aggregated-metrics`): adicionar um parâmetro opcional
`p_reference_at timestamptz default now()` a `get_narratives_table`,
substituindo toda referência interna a `now()` no cálculo de Tendência por
`p_reference_at` (comportamento de todo consumidor existente
— `executive-overview`/`narratives-exploration`/`electoral-themes` —
**inalterado**, já que nenhum deles passa esse parâmetro, herdando o
default `now()`). Este módulo chamaria `get_narratives_table` duas vezes
por registro — uma com `period_start/end = janela antes`,
`p_reference_at = occurred_at`; outra com `period_start/end = janela
depois`, `p_reference_at = least(occurred_at + N dias, now())` — e leria
só `momentum_score`/`trend_score`/`risk_score`/`sentiment_label` de cada
chamada, descartando o resto do retorno (SOV, tags, etc., que não fazem
sentido fora do contexto das 5 páginas de `intelligence-center`).

⚠️ Até essa extensão existir, este módulo **não pode implementar a
Tendência histórica corretamente** — só Sentimento/Momentum/Risco (que já
funcionam com os parâmetros atuais). Se o time decidir implementar a
`v1` deste módulo antes dessa extensão, a UI deve omitir Tendência da
timeline (não inventar um valor), e este gap fica registrado em
`_pending.md`.

### Novas SQL functions deste módulo (não migradas ainda)

```sql
-- Um registro específico (Comunicação ou Decisão — mesma function pras
-- duas, o nome é herdado da versão anterior desta spec quando só existia
-- Comunicação; `p_communication_id` é o id de qualquer linha de
-- `communications`, independente de `record_type`)
create or replace function get_communication_impact(
  p_communication_id uuid,
  p_window_days integer default 7
)
returns table (
  communication_id uuid,
  narrative_id uuid,
  record_type communication_record_type,
  occurred_at timestamptz,
  before_start date,
  before_end date,
  after_start date,
  after_end date,
  after_window_complete boolean,
  mentions_per_day_before numeric,
  mentions_per_day_after numeric,
  mentions_delta_pct numeric,
  net_sentiment_before numeric,
  net_sentiment_after numeric,
  sentiment_label_before text,
  sentiment_label_after text,
  momentum_score_before numeric,
  momentum_score_after numeric,
  risk_score_before numeric,
  risk_score_after numeric,
  trend_score_before numeric,   -- null até a extensão p_reference_at existir
  trend_score_after numeric     -- idem
)
language sql
stable
as $$
  -- esqueleto: chama get_narratives_table(...) duas vezes (janela antes/depois)
  -- filtrado por filters.narratives = [narrative_id], e bw_query_metrics_daily
  -- agregado por dia (avg) para mentions_per_day_*. Detalhe de implementação
  -- fica para a sessão de código, não fechado nesta spec.
$$;

-- Todos os registros (Comunicações e Decisões) de uma Narrativa, para a
-- tela de linha do tempo
create or replace function get_narrative_communication_timeline(
  p_narrative_id uuid,
  p_organization_id uuid,
  p_window_days integer default 7
)
returns setof get_communication_impact
language sql
stable
as $$
  select (get_communication_impact(c.id, p_window_days)).*
  from communications c
  where c.narrative_id = p_narrative_id
    and c.organization_id = p_organization_id
  order by c.occurred_at asc;
$$;
```

> Ambas são esqueletos de intenção (mesmo espírito das funções
> `norm_growth`/`momentum_score` documentadas em `sql-aggregation.md` antes
> de existir migration) — a implementação exata de `mentions_per_day_*`
> (fonte: `avg` diário de `bw_query_metrics_daily.total_mentions` no
> intervalo, escopado pela mesma Narrativa) fica para a sessão que
> escrever a migration deste módulo.

### Edge Function

- `get-narrative-communication-timeline` — mesmo padrão de autenticação de
  `get-page-*` (`aggregated-metrics/edge-functions-per-page.md`: chave
  publicável + JWT encaminhado, RLS continua valendo; valida
  `organization_members` antes de chamar a function acima). Recebe
  `narrative_id`, `organization_id`, `window_days` (opcional, default 7).

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [communication-registration.md](communication-registration.md)
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md) — "Scores de Narrativa" (fórmulas reaproveitadas)
- [../intelligence-center/narratives-exploration.md](../intelligence-center/narratives-exploration.md) — ponto de entrada a partir do detalhe de Narrativa
- [../_design-tokens.md](../_design-tokens.md) — paleta de Sentimento/Risco reaproveitada
