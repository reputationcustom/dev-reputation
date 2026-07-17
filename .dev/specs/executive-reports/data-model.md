---
tipo: data-model
módulo: executive-reports
status: pronto
atualizado: 2026-07-17
---

# Data model: executive-reports

## `reports_generated`

Histórico de toda exportação de relatório — nunca guarda o conteúdo do
relatório como texto/HTML, só um ponteiro para o PDF já gerado e o
suficiente para reabri-lo depois. Nome/colunas herdados do schema anexo do
Dia 1 (`_index.md`, tabela de renomeação: `report_gerados` →
`reports_generated`), estendido com o que faltava para os 2 tipos de
relatório desta spec (`params`, `title`).

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `organization_id` | `uuid` | `references organizations(id) on delete cascade` — todo relatório pertence a uma organização (diferente de `finops`, que é plataforma inteira) |
| `type` | `text` | `check in ('executive', 'custom')` — texto, não enum, mesmo raciocínio já usado em `communication_types`/`ai_usage_log.source`: mais barato de estender que um enum Postgres. `'crisis'` (reservado desde o schema anexo do Dia 1) e outros tipos futuros entram aqui quando pedidos, sem migration de tipo — só alargar o `check` |
| `title` | `text` | Para o Executivo: gerado automaticamente (ex: "Relatório Executivo — 01/07 a 31/07/2026"). Para o Personalizado: editável pelo usuário no construtor (passo 1, ver `custom-report.md`) |
| `period_start` / `period_end` | `date` | Sempre um intervalo explícito escolhido pelo usuário nesta página — nunca os presets Diário/Semanal/Mensal do header global de `intelligence-center` |
| `params` | `jsonb` nullable | `null` para `type = 'executive'` (nada a guardar além do período). Para `type = 'custom'`: `{ sections: string[], include_ai_summary: boolean, notes: string \| null }` — as escolhas feitas no construtor, guardadas para uma eventual futura "reabrir com as mesmas opções" (não implementado nesta rodada, só o dado já fica disponível para isso) |
| `storage_path` | `text` | Caminho dentro do bucket `reports` — `{organization_id}/{id}.pdf` |
| `generated_by` | `uuid` nullable | `references user_profiles(id) on delete set null` |
| `generated_at` | `timestamptz` | Quando a exportação foi de fato concluída (upload ao Storage bem-sucedido) — não quando o usuário abriu a tela |
| `created_at`/`updated_at` | `timestamptz` | Padrão do projeto (Princípio técnico 4) — `updated_at` nunca muda de fato na prática (linha append-only, sem edição pela UI) |

RLS: `organization_id in (select auth_organization_ids())` para SELECT —
qualquer membro da organização vê o histórico de relatórios da própria
organização (mesmo padrão de `communications`). Sem policy de
INSERT/UPDATE/DELETE para o client — a única escrita vem da Edge Function
`export-report` (chave secreta), nunca direto do client (Princípio técnico
2), e um relatório gerado é um registro permanente (mesmo espírito de
`feed_event_feedback` — nada aqui é editado depois de criado).

## Bucket de Storage `reports`

Primeiro bucket de Storage deste projeto — nenhum existia antes desta
spec (ver CLAUDE.md, "Database security (Security Advisor)", regra 4).
**Privado** (`public: false`) — relatórios contêm dado reputacional de
campanhas políticas; nunca um bucket público com URL previsível para esse
tipo de conteúdo. Caminho de cada objeto: `{organization_id}/{report_id}.pdf`.

Policy em `storage.objects` — escopada por organização via o primeiro
segmento do path, não uma policy ampla de listagem (ver mesma regra 4 do
CLAUDE.md sobre "Public Bucket Allows Listing", ainda mais relevante aqui
por não ser sequer um bucket público):

```sql
create policy "reports: leitura por membro da organização"
on storage.objects for select
using (
  bucket_id = 'reports'
  and (storage.foldername(name))[1]::uuid in (select auth_organization_ids())
);
```

Upload e emissão de URL assinada acontecem exclusivamente via a Edge
Function `export-report` (chave secreta, bypassa RLS) — o client nunca
faz upload direto ao bucket nem lê `storage_path` cru; toda entrega de PDF
passa por uma URL assinada de validade curta (ex: 5 minutos), nunca um
link permanente/adivinhável.

## `get_volume_trend` — novo `p_grain_mode` (extensão em `aggregated-metrics/sql-aggregation.md`)

O Relatório Executivo usa uma regra de granularidade **diferente** da
regra genérica já usada pelos dashboards (`≤31d → dia, 32-186d → semana,
>186d → mês`) — aqui não existe grão semanal, só hora (exatamente 1
dia)/dia (≤31 dias)/mês (>31 dias), conforme pedido explícito do usuário:
"mais de 1 mês... mensal, menos de 1 mês... diário, apenas 1 dia... por
hora". Em vez de duplicar `get_volume_trend` numa function paralela
(violaria o "não duplicar a lógica" já registrado na spec original desta
function), ela ganha um parâmetro adicional, aditivo:

```sql
get_volume_trend(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb,
  p_grain_mode text default 'auto_dashboard' -- 'auto_dashboard' | 'auto_report'
)
```

- `'auto_dashboard'` (default): comportamento atual, sem nenhuma mudança
  para as 6 páginas de `intelligence-center` que já chamam esta function
  sem passar o parâmetro novo.
- `'auto_report'`: `period_end - period_start = 0` → grão `hour`
  (`bw_query_metrics_hourly`); `<= 31` dias → grão `day`
  (`bw_query_metrics_daily`); `> 31` dias → grão `month`
  (`bw_query_metrics_monthly`). Nunca grão `week`.

⚠️ Extensão proposta aqui, ainda não implementada — a migration real (e a
atualização linha a linha de `sql-aggregation.md`) fica para quando este
módulo for implementado, não nesta sessão de spec. Mesmo padrão aditivo já
usado para `p_topic_sort`/`p_scope` nesta mesma function/`get_narratives_table`
(sempre com `drop function` explícito quando a aridade muda, por
"Migration hygiene" já documentado em `_index.md`).

## `PAGE_BLOCKS`/`PAGE_BREAKDOWN_TYPES` — extensões em `aggregated-metrics-service.ts`

- `PAGE_BLOCKS.reports` já existe no código
  (`['metrics', 'breakdowns', 'trends', 'narratives', 'highlights', 'narrative_text']`),
  nunca consumido por nenhuma Edge Function até hoje. Ganha `authors` e
  `term_signals` — "panorama geral" pede também os principais autores/
  influenciadores e os termos que mais moveram a conversa, não só os 6
  blocos originalmente previstos quando a constante foi escrita (2026-07-14,
  antes desta spec existir). `PAGE_BREAKDOWN_TYPES.reports` (hoje só
  `['sentiment']`) ganha `'platform'` e `'theme'` pelo mesmo motivo (ver
  `executive-report.md`, "Conteúdo do panorama").
- Novo page key **`reports_custom`**:
  `PAGE_BLOCKS.reports_custom = ['metrics', 'breakdowns', 'trends', 'narratives', 'authors', 'term_signals', 'x_insights', 'highlights', 'narrative_text']`
  — todo bloco relevante do envelope de uma vez (`graph` fica de fora — é
  uma visão de detalhe de 1 Narrativa, não faz sentido num relatório de
  organização inteira). Busca tudo em uma chamada e deixa o usuário
  escolher o que renderizar/exportar no construtor (ver
  `custom-report.md`) — nenhum round-trip adicional por checkbox marcada.
  `PAGE_BREAKDOWN_TYPES.reports_custom` = os 5 tipos existentes
  (`sentiment`/`platform`/`theme`/`narrative`/`region`).
- `narrativesScopeForPage()` retorna `'leaves'` para as duas páginas
  novas — mesmo padrão de toda página que lista Narrativas hoje fora de
  `themes` (único caso `'pautas'`).
- Ambas as páginas sempre passam `p_grain_mode: 'auto_report'` ao chamar
  `get_volume_trend` internamente — não é uma escolha do usuário, é fixo
  por página (o usuário escolhe o período, a granularidade decorre dele).

## Camada 2 nova — `reports:executive_summary` (extensão em `aggregated-metrics/ai-synthesis.md`)

Mesma mecânica genérica já usada pelas 5 seções Camada 2 existentes
(`fetchSectionText`/`composeAndPersistSection`, tabela `page_narrative_synthesis`
com a coluna `section` já existente desde 2026-07-14) — **nenhuma tabela
nova**. Diferente das 5 seções já implementadas (limitadas a ~900-1400
caracteres, pensadas para um widget de dashboard), esta seção é pensada
para ser lida como um resumo executivo de verdade dentro de um documento
PDF — orçamento maior: `max_tokens: 1200`, truncamento em
`truncateAtSentence(text, 2500)`.

Payload combina, numa única chamada (mesmo espírito de `radar_summary`, a
seção Camada 2 mais parecida já implementada — ver CLAUDE.md, "Radar de
Eventos — 'Resumo executivo' reescrito de novo"): KPIs do período
(`metrics`), distribuição de sentimento geral/plataforma/pauta, top
Narrativas por menções/risco/momentum/tendência, top autores por alcance,
principais termos positivos/negativos, e os `highlights` (eventos do
radar) ocorridos dentro do período escolhido — **não** uma janela fixa de
72h como `radar_summary`, aqui é literalmente `period_start..period_end`
do relatório, o que quer que o usuário tenha escolhido.

Como as duas páginas deste módulo sempre operam em `period.mode: 'custom'`
(ver `executive-report.md`, "Regras de negócio") — nunca `daily`/`weekly`/
`monthly` —, a composição automática em background (que já não dispara
para período `custom`, `ai-synthesis.md`) nunca dispara sozinha aqui por
desenho, o mesmo comportamento que já existe hoje para qualquer página com
um período personalizado. Em vez disso, o botão "Gerar relatório"
(Executivo) ou a checkbox "Resumo executivo gerado por IA" + "Gerar
prévia" (Personalizado) chamam a mesma Edge Function síncrona já usada
pelo botão "Analisar com IA" nas outras páginas
(`compose-narrative-synthesis`), passando `section: 'executive_summary'`
— uma composição nova a cada clique explícito do usuário, nunca disparada
sem confirmação (consciência de custo, mesmo espírito do módulo `finops`).

## Edge Functions

- **`get-page-reports`** — já reservada em `overview.md`/
  `block-mapping-per-page.md`/`edge-functions-per-page.md` desde
  2026-07-12, nunca implementada. Mesmo padrão de auth de todo
  `get-page-*` (chave publicável + JWT do usuário encaminhado, RLS faz o
  isolamento real — exceção já documentada em `edge-functions-per-page.md`),
  `page: 'reports'`.
- **`get-page-reports-custom`** — mesmo padrão, `page: 'reports_custom'`.
- **`export-report`** — nova. Recebe o PDF já gerado no client (via
  `@react-pdf/renderer`, ver "Por que a geração do PDF é 100%
  client-side" abaixo) como um `Blob`/base64 + metadados (`type`,
  `title`, `period_start`/`end`, `params` quando aplicável), faz o upload
  para o bucket `reports` e o `insert` em `reports_generated` (chave
  secreta — o client nunca grava direto nessas 2 tabelas/bucket,
  Princípio técnico 1). Devolve uma URL assinada (`createSignedUrl`,
  validade curta) para o download imediato.
- **`list-generated-reports`** — leitura de `reports_generated` da
  organização ativa, filtrável por `type`. Poderia ser lida direto pelo
  client via RLS (a policy de SELECT já permitiria), mas passa por uma
  Edge Function fina mesmo assim, só para poder emitir uma nova URL
  assinada por item da lista sem expor `storage_path` bruto ao client —
  mesmo cuidado de nunca dar acesso direto a Storage a partir de um path
  previsível/guardado no cliente.

## Por que a geração do PDF é 100% client-side (decisão técnica, não pendência de produto)

Nenhuma biblioteca de PDF existe no projeto ainda — esta é a primeira
funcionalidade de exportação de arquivo do produto. Duas restrições reais
deste projeto eliminam a opção "renderizar a página num navegador headless
no servidor e converter para PDF": **Hostinger** (CLAUDE.md, "Deploy
(Hostinger)") não roda um processo adicional tipo Puppeteer/Chromium ao
lado do `next start` gerenciado pelo painel, e as **Edge Functions rodam
em Deno**, sem Chromium disponível.

Decisão: **`@react-pdf/renderer`**, executado inteiramente no navegador —
gera um PDF vetorial de verdade (texto selecionável, sem rasterização),
com primitivas próprias (`View`, `Text`, `Svg`, `Path`, `Rect`, `Line`,
`Circle`) suficientes para redesenhar os mesmos gráficos de barra/linha
que o produto já usa nas telas — mesma filosofia de "sem lib de
charting, SVG feito à mão" já adotada em todo o resto do produto
(`trend-line-chart.tsx`) — sem depender de rasterizar
(`html2canvas`) a tela real. Único novo pacote npm que este módulo precisa
(`npm install @react-pdf/renderer`, no momento da implementação) —
nenhuma outra abordagem evitaria adicionar alguma dependência nova, já
que "gerar um arquivo PDF real" não é algo que o navegador ou o Deno
resolvam nativamente sem biblioteca nenhuma.

Fluxo: o client já tem, na tela, o envelope + os textos de IA já
compostos (depois de "Gerar relatório"/"Gerar prévia") — monta o
documento React-PDF inteiramente no navegador, serializa para um `Blob`,
e só então chama `export-report` (enviando o `Blob` já pronto, não o
dado bruto de novo) para persistir no Storage + `reports_generated`. Se o
upload falhar, o `Blob` já existe no navegador antes dessa chamada — o
download local pode continuar sendo oferecido ao usuário mesmo que
salvar o histórico falhe (ver `executive-report.md`, "Fluxos alternativos
e erros").

Alternativa descartada, para registro: `window.print()`/impressão nativa
do navegador (zero dependência nova) foi considerada e rejeitada — o
pedido do usuário ("Exportar em PDF", nos dois relatórios) implica um
botão que baixa um arquivo diretamente, não um fluxo que depende do
usuário escolher "Salvar como PDF" na caixa de diálogo de impressão do
navegador, com controle de margem/paginação/cabeçalho inconsistente entre
navegadores.
