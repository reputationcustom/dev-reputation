---
tipo: setup-guide
módulo: foundation
status: pronto
atualizado: 2026-07-11
---

# Brandwatch — Configuração Necessária (Fundação de Dados)

> Nota de tipo: não é um `feature-spec` nem um `data-model` (não é código nem
> schema Supabase) — é um checklist operacional de **configuração manual na
> Brandwatch**, pré-requisito para `sync-brandwatch`/`narratives`/
> `executive-overview` terem dado real para consumir. Segue as convenções de
> frontmatter da skill `spec-driven-dev` adaptadas a este novo tipo de
> artefato.

## Objetivo

Listar tudo que precisa existir **dentro da Brandwatch** (Consumer Research)
antes do primeiro sync de uma organização, com **exemplos concretos** de como
configurar cada peça — não só o quê, mas como, calibrado para as
necessidades já especificadas em `narratives.md`, `executive-overview.md` e
`overview.md` (cobertura em X/Reddit/LinkedIn, Share of Voice, sampling).

## Cenário de exemplo usado neste documento

Para tornar cada seção concreta, todos os exemplos abaixo seguem o mesmo
cenário fictício — uma organização cliente da Lidi:

> **Campanha do candidato Ricardo Alencar ao Governo de SP, 2026.**
> Concorrentes diretos: Fernanda Dias e Marcos Prado.
> Narrativas de exemplo (as mesmas do mockup de referência do usuário):
> **"Pesquisas"**, **"Diplomacia"**, **"Banco Master"** (esta última
> inspirada no caso real de intervenção do Banco Central no Banco Master em
> 2025 — um exemplo de narrativa de crise, alto risco, volume explosivo).

Troque os nomes pelo cliente/campanha real ao aplicar — a estrutura e a
lógica de calibração são o que deve ser reaproveitado.

## Regra de ouro

**O sync nunca cria nada na Brandwatch — só lê.** Tudo neste documento é
configuração manual, feita por um analista/admin da conta Brandwatch, nunca
pela aplicação. Isso já estava fixado desde a primeira spec do produto
("Narrativas = Categories/Subcategories criadas manualmente na Brandwatch
pelo analista; o sync só lê, nunca cria") e se estende aqui a Queries, Query
Groups e credenciais.

## Quem faz e quando

- Analista Brandwatch (ou account manager da Lidi responsável pela conta do
  cliente) — diretamente na UI do Consumer Research ou via chamadas manuais
  à API (nunca pelo `sync-brandwatch`).
- **Repetir este checklist para cada organização/cliente novo** — o produto é
  multi-tenant e cada organização tem seu próprio Project/Client Brandwatch
  (ver `brandwatch_credentials` em [data-model.md](data-model.md)).
- Fazer **antes** de rodar o primeiro `sync-brandwatch` para aquela
  organização (ver checklist de aceite ao final).

---

## 1. Conta e credenciais de API

- Usuário com permissão **Regular** ou **Admin** habilitado para a API.
- Anotar `bw_client_id` (o Client da Brandwatch — o rate limit de 30
  chamadas/10min é compartilhado por todas as integrações daquele Client) e,
  se a conta usa organization switching, o `bw_platform_client_id`.

> ⚠️ **Correção (2026-07-07)**: a primeira versão desta seção assumia um
> access token de longa duração gerado manualmente uma única vez (via
> curl/portal) e colado no Supabase Vault. Para este MVP a Lidi ainda não tem
> acesso a um token desse tipo — o token é gerado **em tempo de execução**
> pela própria Edge Function `bw-sync`, a cada vez que o cache expira, via
> `grant_type=api-password`:
>
> ```
> POST https://api.brandwatch.com/oauth/token
>   ?grant_type=api-password
>   &client_id=brandwatch-api-client   (literal fixo da Brandwatch, não é segredo)
>   &platform_client_id=1997437816     (Client da Lidi/organization switching)
>   &username=<usuário Brandwatch>
> Body (x-www-form-urlencoded): password=<senha Brandwatch>
> ```
>
> Usuário e senha da conta Brandwatch **não vivem em `brandwatch_credentials`
> nem no Vault por organização neste MVP** — ficam como **secrets da Edge
> Function** (`BRANDWATCH_USERNAME`, `BRANDWATCH_PASSWORD`,
> `BRANDWATCH_PLATFORM_CLIENT_ID`), configurados via
> `supabase secrets set` (ou Dashboard → Edge Functions → Secrets), nunca
> commitados (Princípio técnico 1). Isso assume um único Client Brandwatch
> para o MVP inteiro (adequado ao estágio atual — um cliente/campanha); se o
> produto precisar de credenciais Brandwatch distintas por organização no
> futuro, essas três variáveis migram para colunas dedicadas em
> `brandwatch_credentials` (com a senha em Vault) — não implementado agora
> por não ser necessário ainda.
>
> `brandwatch_credentials.access_token_secret_ref`/`token_expires_at`
> continuam existindo, mas mudam de papel: deixam de ser preenchidos
> manualmente e passam a ser o **cache** do token mintado em runtime — a
> ideia é a Edge Function checar `token_expires_at` a cada invocação e só
> chamar `/oauth/token` de novo quando o cache está ausente/expirado,
> evitando gastar parte do rate limit de 30 chamadas/10min só renovando
> token. ⚠️ Ainda não implementado (write-back pro Vault é TODO, ver
> CLAUDE.md "Brandwatch sync model") — hoje `bw-sync` minta um token novo
> toda vez que algum par está "devido" (a cada `BW_SYNC_INTERVAL_HOURS`,
> default 3h, não mais a cada ~20-30s como o desenho original previa — ver
> `sync-brandwatch.md` passo 0.5b), o que já é barato o bastante mesmo sem
> cache. Cachear continua economizando 1 chamada por par devido, só deixou
> de ser pré-requisito para agendar via `pg_cron`. Ver `sync-brandwatch.md`
> para o fluxo completo.

- Criar a linha correspondente em `brandwatch_credentials` (só o vínculo com
  a organização e o Client — sem token ainda, ele é preenchido pela primeira
  execução do `bw-sync`):

  | Campo | Exemplo |
  |---|---|
  | `organization_id` | uuid da organização "Campanha Ricardo Alencar 2026" já criada no Supabase |
  | `bw_client_id` | `127732` |
  | `access_token_secret_ref` | `null` (preenchido automaticamente no primeiro sync) |
  | `token_expires_at` | `null` (idem) |

## 2. Project

- **1 Project por organização** — mapeamento 1:1 com `organizations`
  (`bw_projects.organization_id`).
- Nome: `Campanha Ricardo Alencar 2026 — Digital Intelligent Communication`
  (padrão: `[nome do cliente/campanha] — Digital Intelligent Communication`).
- Timezone do Project: `America/Sao_Paulo`.

## 3. Queries (a base de tudo)

- **≥ 1 Query booleana por tema/candidato/marca** monitorado.
- Sempre rodar `query-validation` antes de criar de verdade — uma Query
  criada já conta no limite do Client imediatamente, e validar não conta
  para esse limite.

### Exemplo — Query do próprio candidato

```json
POST /projects/{projectId}/queries/
{
  "name": "Ricardo Alencar — Geral",
  "booleanQuery": "\"Ricardo Alencar\" OR \"R. Alencar\" OR @ricardoalencar OR #RicardoAlencar OR #Alencar26 OR Alenc*",
  "languages": ["pt"],
  "startDate": "2025-06-01",
  "contentSources": ["twitter", "news", "blog", "forum", "facebook", "instagram", "youtube"],
  "locationFilter": { "includedLocations": ["BRA.SP"] }
}
```

- `Alenc*` (wildcard) captura variações/erros de grafia sem precisar listar
  cada uma manualmente — mas aumenta ruído, então combine com `sentiment`/
  revisão manual das primeiras semanas antes de confiar 100% no volume.
- **Content sources**: `twitter`, `news`, `blog`, `forum`, `facebook`,
  `instagram`, `youtube` — cobre as fontes relevantes para política
  brasileira. **Excluído `reviews`**: é voltado a produtos/serviços, não
  relevante para uma campanha política.
- **Idioma**: `pt` — só adicionar `en`/`es` se o tema ganhar repercussão
  internacional (não é o caso de uma disputa estadual).
- **Location filter**: `BRA.SP` (o estado da disputa) — não `BRA` inteiro,
  já que é uma eleição estadual; use `BRA` sem refinamento só em disputas
  nacionais (ex: Presidência).
- **`startDate`**: `2025-06-01` — um ano antes da eleição de 2026, para ter
  base histórica de "volume normal" antes de calibrar Custom Alerts (seção
  7) e antes do período de campanha intensificar o volume.

### Exemplo — Queries dos concorrentes (para o Query Group da seção 4)

```json
{ "name": "Fernanda Dias — Geral", "booleanQuery": "\"Fernanda Dias\" OR @fernandadias OR #FernandaDias OR #Dias26", ... }
{ "name": "Marcos Prado — Geral", "booleanQuery": "\"Marcos Prado\" OR @marcosprado OR #MarcosPrado OR #Prado26", ... }
```

Mesmos `contentSources`/`languages`/`locationFilter` da Query principal —
manter os parâmetros consistentes entre concorrentes é o que torna a
comparação de Share of Voice (seção 4) válida.

### Nota de sampling — por que várias Queries granulares, não uma "guarda-chuva"

Uma Query única `"Ricardo Alencar" OR "Fernanda Dias" OR "Marcos Prado" OR "Banco Master" OR ...`
pareceria mais simples, mas:
- Mistura o volume de 4+ temas distintos numa única Query, empurrando-a mais
  rápido para o teto de amostragem de mentions individuais (`sampled=true`).
- Impede o vínculo 1:1 limpo de Category↔Narrativa usado em
  `narratives.bw_category_id` (uma Category vive dentro de um Project, mas
  o filtro `category=<id>` é aplicado sobre uma Query específica — ver
  `references/filters.md`).
- Isso **não muda** o comportamento de `bw_query_metrics_daily` (os
  agregados nunca são amostrados, valem para qualquer volume), mas Queries
  granulares mantêm a amostra de mentions individuais mais representativa
  por recorte, e a estrutura mais fácil de auditar.

**Prefira**: 1 Query por candidato + 1 Category por narrativa dentro da
Query relevante (ver seção 5), em vez de 1 Query gigante com tudo dentro.

## 4. Query Groups (Share of Voice)

- Necessário sempre que o Executive Overview for mostrar o card de Share of
  Voice (já especificado em `executive-overview.md`) — sem Query Group, o
  card só mostra estado vazio.

### Exemplo

```json
POST /projects/{projectId}/query-groups
{
  "name": "Disputa Governo SP 2026",
  "queryIds": [
    1010001,  // Ricardo Alencar — Geral
    1010002,  // Fernanda Dias — Geral
    1010003   // Marcos Prado — Geral
  ]
}
```

Usado em `data/volume/queryGroups/weeks?queryGroupId=...` (já especificado
em `sync-brandwatch.md`) para o card de SOV do Executive Overview — 3
candidatos é o recomendado (o próprio + até 3 concorrentes diretos); mais que
isso deixa o gráfico de SOV ilegível.

## 5. Categories/Subcategories (Narrativas com `bw_category_id`)

- Regra da Brandwatch: **toda Category precisa de ao menos 1 Subcategory**
  (`children`) — Category sem Subcategory não é uma configuração válida.
- Convenção: nomear a Category com o **mesmo texto de `narratives.title`** —
  não há vínculo automático de nome entre os dois sistemas (o vínculo real é
  `narratives.bw_category_id`), mas nomes alinhados evitam confusão numa
  auditoria manual.

### Exemplo 1 — "Pesquisas" (narrativa recorrente, baixo risco, alto volume previsível)

```json
POST /projects/{projectId}/rulecategories
{
  "name": "Pesquisas",
  "queryIds": [1010001],
  "matchingType": "keywords",
  "children": [
    { "name": "Datafolha" },
    { "name": "Quaest" },
    { "name": "Ipec/Ipespe" },
    { "name": "Outros institutos" }
  ]
}
```

Subcategorias por **instituto de pesquisa** (não por sentimento) — é o corte
que um analista de campanha realmente usa no dia a dia ("o que saiu na
Quaest esta semana?"). Regra de exemplo para a subcategory "Quaest":
`filter.search: "Quaest" AND ("Alencar" OR "governo SP")`.

`matchingType: keywords` (regra automática) faz sentido aqui porque
"Pesquisas" é um padrão bem definido e recorrente — baixo risco de falso
positivo.

### Exemplo 2 — "Diplomacia" (narrativa emergente, ainda incerta)

```json
POST /projects/{projectId}/rulecategories
{
  "name": "Diplomacia",
  "queryIds": [1010001],
  "matchingType": "manual",
  "children": [
    { "name": "Declarações internacionais" },
    { "name": "Repercussão política" }
  ]
}
```

`matchingType: manual` aqui — a narrativa ainda está sendo formada, é melhor
o analista aplicar a Category caso a caso nas primeiras semanas antes de
promover para `keywords` (evita categorizar automaticamente algo que ainda
não tem um padrão de texto estável).

### Exemplo 3 — "Banco Master" (narrativa de crise, alto risco, volume explosivo)

```json
POST /projects/{projectId}/rulecategories
{
  "name": "Banco Master",
  "queryIds": [1010001],
  "matchingType": "keywords",
  "children": [
    { "name": "Intervenção do Banco Central" },
    { "name": "Investidores e correntistas" },
    { "name": "Repercussão política" }
  ]
}
```

Regras de exemplo:
- "Intervenção do Banco Central": `search: "Banco Master" AND ("intervenção" OR "liquidação" OR "Banco Central")`
- "Investidores e correntistas": `search: "Banco Master" AND ("correntistas" OR "investidores" OR "calote" OR "prejuízo")`
- "Repercussão política": `search: "Banco Master" AND ("Ricardo Alencar" OR "governo" OR "eleição")`

`matchingType: keywords` desde o início — uma narrativa de crise já com
padrão de texto conhecido (o nome do banco) se beneficia de captura
automática imediata, sem depender de aplicação manual mention a mention.

### Depois de criar cada Category — vincular no Supabase

| `narratives.title` | Category na Brandwatch | `bw_category_id` (exemplo) |
|---|---|---|
| Pesquisas | "Pesquisas" | `14205369` |
| Diplomacia | "Diplomacia" | `14205412` |
| Banco Master | "Banco Master" | `14205488` |

Passo manual, sem automação no MVP — mesmo padrão já aplicado a
`organization_members` (estrutura pronta, população manual).

### Exemplo de Narrativa **sem** Category — só sinais

Nem toda narrativa emergente já merece uma Category na Brandwatch. Exemplo:
uma menção crescente a um boato pontual ainda não confirmado como relevante
("suposto vídeo vazado") pode nascer só com `narrative_signals`, sem
`bw_category_id`:

| `signal_type` | `signal_value` |
|---|---|
| `keyword` | `"vídeo vazado Alencar"` |
| `hashtag` | `#AlencarVídeo` |
| `author_handle` | `perfil_denuncia_sp` |

Métricas dessa narrativa vêm da via `mentions_sample` (agregação local, ver
`narratives.md`) até que, se o volume confirmar que vale a pena, o analista
crie a Category correspondente e promova a narrativa para `bw_aggregate`.

## 6. Tags — não fazem parte do Sprint 1

- Tags (`ruletags`) são triagem operacional rápida — diferente de
  Category/Narrativa. Exemplo de uso futuro (CRUD completo de `cases`,
  `intelligence-center`): Tag `"Precisa resposta"` aplicada manualmente a
  mentions críticas dentro de um Caso. Não crie Tags agora sem essa
  necessidade concreta.

## 7. Custom Alerts — fora do Sprint 1, nota de compatibilidade

- O `threshold-engine` (Sprint 3) é o motor de risco **próprio** do produto
  — não depende de Custom Alerts nativos da Brandwatch para funcionar.
- Exemplo de calibração, se o cliente quiser essa camada extra desde já:
  se o volume histórico normal da Query "Ricardo Alencar — Geral" é
  ~300 mentions/dia (visível no histórico coletado desde `startDate`), um
  Custom Alert razoável é:

  ```json
  POST /projects/{projectId}/alerts
  {
    "name": "Alerta Sentimento Negativo — Ricardo Alencar",
    "queryIds": [1010001],
    "alertTypes": ["threshold"],
    "thresholdVolume": 900,
    "repeatOnHourOfDay": 8,
    "filter": { "sentiment": ["negative"] },
    "additionalRecipients": []
  }
  ```

  `900` = 3× o volume normal diário — um ponto de partida razoável para
  distinguir crise real de ruído (ajustar depois de observar 2-3 picos
  reais). Verificado uma vez por dia às 8h (`repeatOnHourOfDay`).
- ⚠️ Se/quando isso for feito: o campo `queryId` singular de um Custom Alert
  está **depreciado** (remoção após 12/01/2026) — usar sempre `queryIds`
  (array), como no exemplo acima.

## 8. Author/Site/Location Lists — explicitamente fora de escopo

- Reforça decisão já tomada no Dia 1: a classificação de Entities (tipo,
  espectro, partido, cargo, estado — ex: marcar `@fernandadias` como
  "Partido X, Espectro Y") vive **somente no Supabase**
  (`entities`/`entity_tags`, Sprint 2) — nunca sincronizada de volta como
  Author List da Brandwatch no MVP.
- **Não criar** nenhuma Author/Site/Location List agora.

---

## Checklist de aceite (Definition of Ready) — por organização

> Repetir para cada organização/cliente antes do primeiro `sync-brandwatch`.

- [ ] Usuário API com permissão Regular/Admin
- [ ] `bw_client_id` (+ `bw_platform_client_id` se aplicável) anotado
- [ ] `BRANDWATCH_USERNAME`/`BRANDWATCH_PASSWORD`/`BRANDWATCH_PLATFORM_CLIENT_ID`
      cadastrados como secrets da Edge Function `bw-sync` (`supabase secrets
      set`, nunca no Vault/DB neste MVP — ver ⚠️ correção em §1: token gerado
      em tempo de execução, não pré-gerado)
- [ ] Linha em `brandwatch_credentials` criada (só `organization_id`/`bw_client_id`
      — sem token, preenchido automaticamente no primeiro sync)
- [ ] Project criado, timezone `America/Sao_Paulo`
- [ ] ≥ 1 Query criada e validada (`query-validation` rodado antes de criar),
      com `contentSources`/`languages`/`locationFilter` explícitos (não
      default) — ver exemplo "Ricardo Alencar — Geral"
- [ ] `BRANDWATCH_PROJECT_ID`/`BRANDWATCH_QUERY_IDS` (lista separada por
      vírgula) cadastrados como secrets da Edge Function `bw-sync` — semeia
      `sync_cursors` na primeira execução (ver ⚠️ correção em
      `sync-brandwatch.md`, passo 0)
- [ ] `BW_SYNC_INTERVAL_HOURS` cadastrado como secret da Edge Function
      `bw-sync` (opcional — default `3` se omitido; controla de quanto em
      quanto tempo cada par `(project_id, query_id)` é recapturado, ver
      `sync-brandwatch.md` passo 0.5b)
- [x] Heartbeat de `pg_cron` (`bw-sync-heartbeat`, a cada 15min) já vem
      pronto na migration `20260711020000` — URL da function hardcoded na
      migration (não é segredo, mesmo valor já exposto via
      `NEXT_PUBLIC_SUPABASE_URL`), sem passo manual pós-deploy. Só revisar
      se o projeto Supabase for recriado/migrado no futuro (nesse caso, uma
      nova migration troca a URL).
- [ ] Queries dos concorrentes criadas com os mesmos parâmetros, se houver
      necessidade de Share of Voice
- [ ] Query Group criado (ex: "Disputa Governo SP 2026")
- [ ] Category + ≥ 1 Subcategory criada para cada Narrativa que precisa de
      cobertura confiável em X/Reddit/LinkedIn/News (ver exemplos
      "Pesquisas"/"Diplomacia"/"Banco Master")
- [ ] `narratives.bw_category_id` populado no Supabase apontando para a
      Category correspondente (ver tabela de vínculo acima)
- [ ] Nenhuma Author/Site/Location List criada (fora de escopo)

## Referências relacionadas

- Skill `brandwatch-api`: `references/queries-and-projects.md`,
  `references/alerts-tags-categories.md`, `references/lists.md`,
  `references/data-restrictions-compliance.md`.
- [overview.md](overview.md) — validação de viabilidade, decisão de
  sampling.
- [narratives.md](narratives.md), [sync-brandwatch.md](sync-brandwatch.md),
  [data-model.md](data-model.md).
