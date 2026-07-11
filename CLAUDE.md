# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Reputation OS — a reputational-intelligence platform built on top of Brandwatch
(Consumer Research API), for Brazilian political campaigns / reputation
management.

## Spec-driven development is mandatory

Specs live in `.dev/specs/` and must be read (and be `status: pronto`) before
implementing anything. Do not implement a feature whose spec is still
`rascunho` without checking with the user first — the `⚠️ DECISÃO PENDENTE`
markers inside specs mark open product decisions, not implementation details
to invent silently.

- `.dev/specs/_index.md` — stack, the 6 mandatory technical principles (see
  below), module map, sprint scope.
- `.dev/specs/_glossary.md` — domain terms (Project, Query, Query Group,
  Category/Narrativa, Mention) and the Portuguese↔English naming mapping.
- `.dev/specs/[module]/overview.md`, `[feature].md`, `data-model.md` — per
  module. Only `foundation` (Sprint 1) exists so far.

Sprint scope is fixed (do not scope-creep without the user). **Reconfirmed
2026-07-10**: Sprint 1 is *entirely* the Brandwatch integration —
`sync-brandwatch` + `narratives` (`foundation`), no UI. It's substantially
implemented — see "Brandwatch sync model" below for the current state.
Sprint 2 is the web interface with the charts/dashboards, opening with
`executive-overview` (`foundation/executive-overview.md` — spec exists,
implementation not started) and continuing with `entities`,
`command-center`, `intelligence-center`. Sprints 3-4 (`threshold-engine`,
`intelligent-feed`, `propagation-graph`, `decision-center`,
`executive-reports`) are not started.

## Commands

```bash
npm install
npm run dev      # Next.js dev server
npm run build    # production build + typecheck (strict TS)
npm run lint
```

No test framework is configured yet.

Supabase: **do not use local Docker** (`supabase start`/`db reset`) for this
project — deploy is via the GitHub Action already configured on the
`reputationcustom/dev-reputation` repo, which syncs `supabase/migrations/`
and `supabase/functions/` to the real remote Supabase project on push to
`develop`. Write/edit migration and function files locally, commit, and push
— don't attempt `supabase link`/`db push`/`functions deploy` from this
machine unless the user explicitly provides remote credentials for that
session.

## Non-negotiable technical principles

These apply project-wide, to every sprint (from `.dev/specs/_index.md`):

1. **No hardcoded credentials.** Edge Functions read secrets via
   `Deno.env.get`; Next.js via `process.env`. Frontend only touches
   `NEXT_PUBLIC_*` vars. Secrets (Supabase secret key, Brandwatch tokens)
   live only in Edge Functions, never in the Next.js server or client.
2. **No business logic in the frontend.** Validation/business rules live in
   Edge Functions or Postgres (constraints/triggers/RLS). Next.js is
   presentation/formatting/navigation only.
3. **Supabase key naming**: Edge Functions use `SUPABASE_SECRET_KEY`
   (bypasses RLS); frontend uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Do
   not reintroduce the old `anon`/`service_role` naming.
4. **Every table** needs `created_at`/`updated_at timestamptz not null
   default now()` plus a `set_updated_at` trigger (defined once in the
   foundation migration, reused by every later module).
5. **Edge Functions are self-sufficient.** Supabase SaaS does not support a
   shared `supabase/functions/_shared/` folder in production. Never
   `import` from `../_shared/` — duplicate helper code per function, or
   import via `npm:`/`https://deno.land/x/`/`jsr:` URLs.
6. **BI/reporting layer** (`reporting` schema) is read-only, exposed only via
   direct Postgres connection (Session pooler) to a `bi_reader` role — never
   added to `db.schemas`/PostgREST. `bi_reader` has `bypassrls` by design
   (single cross-org role for internal BI use), which is why the frontend
   never queries `reporting.*` directly — see the `public.narratives_overview`
   split below.

## Architecture

- **Frontend**: Next.js App Router + TypeScript + Tailwind, deployed on
  **Hostinger** (managed Node.js), not Vercel — so no backend automation may
  depend on Vercel Cron/Functions.
- **Backend/DB**: Supabase (Auth, Postgres + RLS, Storage, Realtime, Edge
  Functions/Deno). All scheduled/background jobs (e.g. the Brandwatch sync)
  run as Edge Functions triggered by `pg_cron`, never in the Next.js process.
- **Supabase client split** (adapted from the `web-app-structure` skill,
  which assumes Vite — this project uses `@supabase/ssr` instead):
  `lib/supabase/client.ts` (browser) and `lib/supabase/server.ts` (server
  components, via `next/headers` cookies). Components never import a
  Supabase client directly.
- **Types**: `types/database.types.ts` is a placeholder until a real
  Supabase project is linked and `supabase gen types typescript` is run
  against it — do not hand-write types that belong there.

### Multi-tenancy

`organizations` ←→ `organization_members` (N:N, a user can belong to more
than one org). All org-scoped tables use RLS policy
`organization_id in (select auth_organization_ids())`, where
`auth_organization_ids()` is a `security definer stable` SQL function
(avoids RLS recursion, cacheable per statement). Tables one level removed
from `organizations` (e.g. `bw_queries`, satellites of `narratives`) resolve
org membership via a subquery through their parent FK rather than
duplicating `organization_id`.

### Brandwatch sync model

`bw-sync` (`supabase/functions/bw-sync/index.ts`, ~1950 lines) is Sprint 1's
core deliverable and is substantially built out as of 2026-07-10 — well
past the "not a skeleton" milestone from 2026-07-07. ✅ **`bw-sync` is now
scheduled via `pg_cron` (2026-07-11, migration `20260711020000`)** — see
"Scheduled cadence (`BW_SYNC_INTERVAL_HOURS`)" below for the mechanism;
this replaces the "invoked manually" state from 2026-07-07/10.
(`refresh_narrative_metrics()`, the SQL-only function that computes
`narrative_metrics`, has been on `pg_cron` since 2026-07-10 — it doesn't
call Brandwatch, so it was never blocked by the same prerequisite that
used to apply to `bw-sync`.)

- **Phased execution per pair (2026-07-11, migration `20260711030000`)** —
  fixes a production "CPU Time exceeded" crash (Deno's synchronous-compute
  budget, distinct from the `WORKER_RESOURCE_LIMIT` memory crash fixed
  earlier): one invocation used to process one `(project_id, query_id)`
  pair end-to-end — seed → token → metadata bootstrap (conditional) →
  mentions poll (paginated, backfill-aware) → daily metrics incl.
  non-sampled reach/engagement (always) → weekly/monthly metrics +
  platform breakdown + topics + top-authors (per Narrativa) + Query Group
  SOV (throttled) — chaining tens of thousands of JSON objects processed
  synchronously in one invocation (one `reachEstimate` call alone returned
  4825 rows in one response in production). Now each invocation executes
  exactly one phase from `SYNC_STEPS` (`metadata → mentions →
  daily_metrics → weekly_monthly → topics → top_authors → sov`, tracked in
  `sync_cursors.next_step`) and advances the cursor; `last_synced_at` (and
  the `BW_SYNC_INTERVAL_HOURS` gate) only advances once the last phase
  closes the cycle. Since all state lives in Postgres, not the isolate's
  memory, a manual invocation (Dashboard "Invoke" button, used heavily
  during testing) behaves identically to a heartbeat tick — same cursor,
  same next-phase logic. Trade-off: `weekly_monthly`/`topics`/
  `top_authors`/`sov` now advance at most one `categoryTarget` per
  invocation, so fully covering every `categoryTarget` for a newly-created
  Narrativa can take several full cycles instead of one. Complementary fix:
  `syncCategoryDailyAggregate()` (the 4825-row case) now upserts in
  1000-row chunks instead of one giant batch.

- **Rate limit budget (30 calls/10min per Client)**: every Brandwatch call
  goes through `callBrandwatch()`, which is sequential (never parallel —
  official best practice) and retries up to 3× on `429` honoring
  `retry-after`. Per-invocation call count varies: mentions poll (up to
  `MAX_MENTIONS_PAGES_PER_INVOCATION` = 10 pages) + daily sentiment metrics
  (1 + 1 per narrative-linked Category) + daily reach/engagement (2 calls
  total, covers every Category via the `categories` dimension — added
  2026-07-10) + daily platform breakdown (1, `data/volume/pageTypes/days`)
  run *every* invocation; metadata bootstrap (~4 calls) only when
  `bw_projects.synced_at` is >24h stale *or* `bw_categories` is empty for
  the project (added 2026-07-10); weekly/monthly sentiment/SOV/topics
  (`data/topics`)/top-authors (`data/volume/topauthors/queries`, now once
  per `categoryTarget` — added 2026-07-10) only when no "fresh" row exists
  yet for the current week (`isGrainStale()`/`isQueryGroupSovStale()`/
  `isTopicsStale()`/`isTopAuthorsStale()`) — this throttle is what keeps
  steady-state invocations cheap despite covering 6+ aggregate types.
- **Brandwatch auth**: no long-lived pre-generated token, so `bw-sync` mints
  one at runtime via `grant_type=api-password` (`mintBrandwatchAccessToken()`)
  using Edge Function secrets `BRANDWATCH_USERNAME`/`BRANDWATCH_PASSWORD`/
  `BRANDWATCH_PLATFORM_CLIENT_ID` — not per-org DB columns (MVP assumes a
  single Brandwatch Client). **Known gap, no longer blocking**: mints a
  fresh token on every invocation that passes the interval gate (see below)
  — `brandwatch_credentials.access_token_secret_ref`/`token_expires_at`
  exist to cache it, but the Vault write-back is still a TODO. This used to
  be a hard prerequisite for scheduling `bw-sync` on `pg_cron` at all
  (original plan assumed a ~20-30s cadence, where an uncached mint alone
  would burn much of the 30-calls/10min budget) — resolved instead by
  scheduling at hours-scale cadence (see below), where a mint per due pair
  is negligible. Caching the token is still worth doing (saves 1 call per
  due pair), just not a blocker anymore.
- **Scheduled cadence (`BW_SYNC_INTERVAL_HOURS`)** — added 2026-07-11, user
  request: "a cada 3 horas as rotinas de integração com a Brandwatch sejam
  executadas para capturar o cenário atual", configurable via environment
  variable. `pg_cron` invokes `bw-sync` every 15 minutes (fixed heartbeat,
  `bw-sync-heartbeat`, migration `20260711020000`, via `net.http_post` —
  `bw-sync` runs with `verify_jwt = false` so no Authorization header is
  needed). Most heartbeats do nothing: at the top of the handler (before
  the concurrency lock, before minting any token), `bw-sync` checks whether
  any `sync_cursors` row is "due" — `last_synced_at is null or
  last_synced_at < now() - BW_SYNC_INTERVAL_HOURS` (Edge Function secret,
  default `3`) — and exits immediately if not. This makes the actual
  capture cadence a pure env-var change (`supabase secrets set
  BW_SYNC_INTERVAL_HOURS=...`), no migration needed; only the 15-minute
  heartbeat itself is fixed in SQL (an infra-cadence detail, not the
  business parameter). The round-robin pair picker (`sync_cursors` ordered
  by oldest `last_synced_at`) now also filters to only "due" pairs — one
  pair is still processed per invocation, so with several due pairs at
  once each is picked up on a subsequent 15-minute heartbeat rather than
  all at once; at MVP scale (one Project, a handful of Queries) that drift
  is at most a few multiples of 15 minutes, negligible against an
  hours-scale interval. One consequence: historical mentions backfill
  (`BRANDWATCH_MENTIONS_START_DATE` onward) now only advances when a pair
  is due, so it progresses slower in wall-clock time than a hypothetical
  continuous-polling design would — accepted trade-off, since the explicit
  ask is capturing the *current* scenario on a schedule, not backfill
  speed. `bw-sync-heartbeat`'s `net.http_post` hardcodes the function's
  invocation URL directly in the migration — not a secret (same value
  already exposed to every browser via `NEXT_PUBLIC_SUPABASE_URL`;
  Principle 1 is about credentials, not the project's public URL), and
  this project only ever deploys to one Supabase project, so there's no
  ambiguity to resolve at deploy time. No manual post-deploy step needed.
- **Data storage is historical by design, already sufficient for future AI
  use** — confirmed 2026-07-11 (user request: ensure daily/weekly/monthly
  Brandwatch data is stored as history for eventual AI use). No code change
  needed: `bw_query_metrics_daily`/`weekly`/`monthly`,
  `bw_query_group_metrics_weekly`, `bw_query_metrics_daily_by_platform`,
  `bw_query_topics`, `bw_query_top_authors`, and `narrative_metrics` are all
  upserted on a unique key that includes the date/week/month grain, so every
  period gets its own row, never overwritten by a later sync of the same
  pair (only corrected if the *same* period is re-synced). No retention/
  pruning job exists anywhere — history accumulates indefinitely by design.
- **`sync_cursors` seeding**: nothing else populates `sync_cursors`
  (`projects/summary` auto-discovery was never built — Client is known
  upfront instead). `ensureBootstrapSeed()` runs first every invocation and,
  from `BRANDWATCH_PROJECT_ID`/`BRANDWATCH_QUERY_IDS` (comma-separated)
  secrets, idempotently seeds placeholder `bw_projects`/`bw_queries` +
  `sync_cursors` rows, resolving `organization_id` from the single row in
  `brandwatch_credentials` (MVP: one organization). All 5 Brandwatch secrets
  configured on the project: `BRANDWATCH_USERNAME`, `BRANDWATCH_PASSWORD`,
  `BRANDWATCH_PLATFORM_CLIENT_ID`, `BRANDWATCH_PROJECT_ID`, `BRANDWATCH_QUERY_IDS`.
- **Mention field mapping** (`upsertMentions()`): `resourceId→resource_id`,
  `categories→category_ids`, `tags→tag_names`, `sentiment`, `author`,
  `reachEstimate→reach_estimate`, `domain`, `snippet`, `added`,
  `date→mention_date`, full raw object → `raw` jsonb. `full_text` is
  deliberately left `null` — fetching it means a second call per poll
  (`/data/mentions/fulltext`); revisit if the product needs full text (e.g.
  `keyword` narrative signals on unrestricted sources).
- **Mention enrichment fields** (added 2026-07-10, field names confirmed
  against `developers.brandwatch.com/docs/mention-metadata-field-definitions`
  directly — not just the skill's curated summary, which had several field
  names wrong): `gender`, `countryCode/region/city/continentCode`,
  `contentSource→content_source` (`pageType` is deprecated by Brandwatch —
  don't use it for new code), `language`, `impressions`, `impact`,
  `classifications` (raw array; `emotion` is a best-effort derived column,
  not a real API field — first classifier whose name matches
  `emotions:...`), `insightsHashtag→insights_hashtag`,
  `insightsMentioned→insights_mentioned`, `replyTo→reply_to`,
  `retweetOf→retweet_of`, `engagement` (compact jsonb — Brandwatch has no
  generic engagement field, it's per-platform: `twitterFollowers/
  twitterLikeCount/twitterRetweets/twitterReplyCount`, `instagramFollowerCount/
  instagramLikeCount/instagramCommentCount`, `facebookLikes/Comments/Shares`,
  `tiktokLikes/Comments/Shares`, `blueskyFollowers/Likes/Replies/Reposts`,
  `linkedinLikes/Comments/Shares/Impressions` — stored as jsonb rather than
  ~20 typed columns since there's no consumer yet to justify it).
- **New aggregate tables** (added 2026-07-10, `bw_query_metrics_daily_by_platform`/
  `bw_query_topics`/`bw_query_top_authors`): platform breakdown via
  `data/volume/pageTypes/days` (chart dimension `pageTypes`, plural —
  distinct from the deprecated per-mention `pageType` field); topic/theme
  extraction via `data/topics` (`extract=words,phrases,hashtags,entities,
  people,places,organisations`, `metrics=volume,percentageVolume,sentiment,
  trending`) — this is the closest thing Brandwatch's *standard* API offers
  to automatic theme/narrative clustering (see "Iris" investigation in
  `.dev/specs/_index.md` "Fora de escopo do MVP" — there is no separate
  Iris API); native author ranking via `data/volume/topauthors/queries`
  (better than computing "top authors" locally over the synced mentions
  sample, which the skill recommended as a fallback but is subject to
  sampling on high-volume Queries). All three throttled weekly like
  `bw_query_metrics_weekly` (`isTopicsStale()`/`isTopAuthorsStale()`).
- **`syncQueryGroupSov()` dimension bug fixed** (2026-07-10): originally
  called `data/volume/queryGroups/weeks?queryGroupId=X`, assuming one
  result item per Query inside the group. The confirmed real example in
  Brandwatch's `basic-charts` docs shows the opposite — `queryGroups` as a
  dimension returns **one item for the whole group** (aggregated volume),
  not a per-Query breakdown, so the SOV table was very likely storing the
  wrong shape of data since it shipped. Fixed to
  `data/volume/queries/weeks?queryGroupId=X` (dimension `queries`, group
  used as scope/filter) — still not confirmed against a real payload (no
  official example shows both params together), but grounded in a real
  documented bug rather than a guess. Verify against real logs after this
  deploys.
- **Mentions polling walks history forward, tracked via
  `sync_cursors.backfill_completed_at`** (fixed 2026-07-10, then corrected
  again same day after user testing). First fix: the original
  `orderDirection=desc` bootstrap grabbed only the newest 100 mentions and
  the cursor jumped straight to "now," permanently skipping the
  Jan–Jun/26 backlog — switched `fetchMentions()` to `orderDirection=asc`
  from `BRANDWATCH_MENTIONS_START_DATE` forward. **But** that first fix's
  resume logic (fall back to `MAX(added)` in `mentions` when the cursor is
  empty) turned out to be a second bug: `last_added_cursor` had *already*
  been advanced to "now" by the old buggy bootstrap before this fix
  shipped, and `MAX(added)` in `mentions` carried the exact same
  contaminated data (the most recent mentions, not the oldest) — so
  neither signal could tell "fully backfilled" apart from "cursor skipped
  ahead by the old bug." Real fix: `sync_cursors.backfill_completed_at`
  (migration `20260710020000`, which also resets `last_added_cursor` to
  `null` on every row). While `backfill_completed_at` is `null`,
  `resolveMentionsSinceAdded()` trusts *only* `last_added_cursor` (real
  progress within the corrected ascending walk) and never falls back to
  `MAX(added)` in `mentions`. It's set (once, permanently) the first time
  a page comes back shorter than `pageSize` — genuinely caught up to
  `now`. Only then does the `MAX(added)` fallback become safe again
  (normal incremental polling mode: 5-minute buffer + `sourceType=new`).
- **Mentions pagination: page size + in-invocation loop, sized to fit Edge
  Function resource limits** (fixed 2026-07-10, tuned same day after
  hitting production limits). `pageSize` was `100` and each invocation
  only fetched *one page*, so with invocations still triggered manually
  (no `pg_cron` yet) progress was ~100 mentions per manual click. First
  fix looped up to `MAX_MENTIONS_PAGES_PER_INVOCATION = 20` pages at
  `pageSize = 5000` (Brandwatch's documented max) — up to ~100k
  mentions/invocation. **That crashed the function in production**: `HTTP
  546 WORKER_RESOURCE_LIMIT` ("está dando erro de memória excedida") —
  each mention carries a fairly large payload (full `raw` + engagement/
  classifications arrays), and serializing 5000 of them per upsert call
  was too much for the Deno isolate's memory/CPU budget. Tuned down to
  `MENTIONS_PAGE_SIZE = 1000` / `MAX_MENTIONS_PAGES_PER_INVOCATION = 10`
  (up to ~10k mentions/invocation — still 10x the original, comfortably
  under the limit that broke at 5000×20). Also added
  `MENTIONS_LOOP_BUDGET_MS = 20_000`: the loop voluntarily stops once
  elapsed wall-clock time crosses this, *before* the runtime can kill it —
  important because a `WORKER_RESOURCE_LIMIT` kill isn't a catchable JS
  exception, so the handler's `try/catch` never runs and `sync_cursors`
  never gets updated, meaning the same pair would keep retrying and
  crashing on every future invocation. Voluntarily stopping persists
  whatever progress was made and lets the next invocation continue
  cleanly. `sinceAdded` advances after each page with no 5-minute buffer
  in-loop (that buffer only matters *between* invocations, for
  Brandwatch's async indexing lag) until either a short page signals
  "caught up to now" (see `backfill_completed_at` above), the page count
  limit, or the time budget — whichever comes first.
- **Metrics date range bug** (fixed 2026-07-10 — user report: "as métricas
  não estão sendo trazidas corretamente" / "Data início 01/01/2026 até a
  data de hj"): every `data/volume/...` call (`syncSentimentMetrics` daily/
  weekly/monthly, `syncPlatformMetrics`, `syncTopicsData`, `syncTopAuthors`,
  `syncQueryGroupSov`) was using a hardcoded trailing 7-day window
  (`sevenDaysAgo`/`now`) as `startDate`/`endDate`, regardless of
  `BRANDWATCH_MENTIONS_START_DATE` — so none of the aggregate tables ever
  got data older than a week. Fixed by passing `metricsStartDate =
  getMentionsStartDate()` (same config as mentions) as `startDate`
  everywhere — these chart endpoints return every bucket in the requested
  range in a *single* call, so widening the window doesn't cost more rate
  limit, it just actually covers the configured history.
- **`category_id` nullable-uniqueness bug**: `bw_query_metrics_{daily,weekly,monthly}`
  originally had `unique(..., category_id, ...)` with nullable `category_id`
  — SQL treats `NULL <> NULL`, so the "whole query" (no category) row would
  never actually dedupe. Fixed via a generated `category_id_key
  bigint generated always as (coalesce(category_id, 0)) stored` column and
  constraining on that instead (migration `20260707030000`). Any new
  nullable column that's part of a uniqueness/upsert key needs the same
  treatment.
- **Narratives auto-seed from top-level Categories** (fixed 2026-07-10 —
  `narratives.md` originally only allowed manual/seed creation, which in
  practice left the table permanently empty with no Sprint 1 UI to populate
  it). `ensureNarrativesFromCategories()` runs at the end of metadata
  bootstrap/refresh: every top-level `bw_categories` row (`parent_id is
  null`) without a matching `narratives.bw_category_id` yet gets one
  auto-created (`title` = Category name). Idempotent and never overwrites
  `title`/`stage`/`risk_level` on rows that already exist — manual curation
  (deactivating a Category as a Narrativa, adding subcategory-level
  Narrativas, editing risk/priority) still works on top. Subcategories are
  *not* auto-seeded, left for manual curation.
  **If `narratives` is still empty after a successful sync**: check the
  `refreshMetadata:done` log line's `categoriesCount` — if it's `0` (also
  logged explicitly as `refreshMetadata:no_categories_found`), the
  Brandwatch Project genuinely has no Categories configured yet. `bw-sync`
  only mirrors Categories that already exist in Brandwatch (`GET
  /rulecategories`) — it can't invent them; they have to be created in the
  Brandwatch UI first (see `brandwatch-setup.md`).
  **Second fix, same day**: `needsMetadataRefresh()` originally only
  checked the placeholder name / 24h staleness — so if Categories were
  configured in Brandwatch *after* the first (empty) metadata refresh, the
  24h throttle would keep skipping the refresh and `narratives` would stay
  empty for up to a day even with real Categories now on the Brandwatch
  side (user hit this exact case: "Existem categorias e tags configuradas
  na Brandwatch, portanto narrativas deve ser capturada corretamente").
  Fixed: `needsMetadataRefresh()` now also returns `true` whenever
  `bw_categories` has zero rows for the project, regardless of
  `synced_at` — self-correcting, stops forcing extra refreshes as soon as
  Categories exist and sync successfully once.
- **`refresh_narrative_metrics()` was never actually scheduled** (found
  2026-07-10 while investigating "narrativas continuam nulas" further —
  user asked how narratives get their numbers and to add engagement/
  repost/comment metrics per narrative). The function existed since the
  first migration but no `cron.schedule` ever called it — `narrative_metrics`
  (what the Executive Overview actually reads, via `narratives_overview`)
  was *always* empty, independent of the Categories/`narratives`-row fixes
  above. Migration `20260710030000` schedules `pg_cron`
  (`refresh_narrative_metrics_hourly`) and also runs an immediate one-time
  historical backfill call. Unlike `bw-sync`, this function makes zero
  Brandwatch API calls (pure Postgres aggregation over already-synced
  data) — it was never blocked by the token-caching prerequisite that
  blocks scheduling `bw-sync` itself.
- **⚠️ Project-wide premise, fixed by the user 2026-07-11**: "Retire os
  cálculos locais baseados em mentions, pois não fará sentido. Se tem na
  Brandwatch mantém, se não tem, não faça cálculo local confiando na
  mentions, pois não reflete a realidade, é apenas uma amostra. Isso deve
  ser premissa." (Remove local calculations based on mentions — if
  Brandwatch has it, keep it; if not, don't fake it locally, `mentions` is
  just a sample and doesn't reflect reality. This is a standing rule now,
  not a one-off fix.) `mentions` is sampled on high-volume Queries — this
  was already the reason `bw_query_metrics_daily` exists for
  `total_mentions`/sentiment instead of counting `mentions` rows, but over
  2026-07-10 several new features (below, now reverted) violated it by
  summing/counting over `mentions` to fill gaps Brandwatch doesn't expose
  as an official aggregate. **Going forward: never build a feature that
  sums/counts/aggregates over `mentions` to represent a total — either the
  data comes from a Brandwatch aggregate endpoint (`bw_query_metrics_daily`,
  `bw_query_topics`, `bw_query_top_authors`, etc.) or it doesn't exist.**
  The one thing that's fine to keep: per-mention classification that
  doesn't aggregate across the sample (e.g. `mentions.mention_role`,
  labelling one already-captured mention as `original`/`reply`/`retweet`
  from its own `reply_to`/`retweet_of` — a fact about that row, not a
  statistic extrapolated from an incomplete population).
  Removed as a direct result (migration `20260711010000`): `narrative_metrics`'s
  `unique_authors`/`top_domain`/`repost_count`/`comment_count` columns and
  the `mentions_sample` via of `refresh_narrative_metrics()` (a Narrativa
  without `bw_category_id` now gets **no** `narrative_metrics` row at all,
  rather than a locally-estimated one) — `total_mentions`/sentiment/
  `reach_estimated`/`engagement_total` are the only columns left, always
  from `bw_query_metrics_daily`; `bw_query_topics.engagement_total`/
  `reach_estimated` and `refresh_topic_engagement_reach()` (topics never
  had a non-sampled source for these — `data/topics`'s `metrics` param
  genuinely doesn't offer reach/engagement, confirmed against the docs —
  so there was no accurate way to provide them at all); `influential_author_activity()`
  (its useful part — `followers`/`is_influential`/`impact`/`reach_estimate`/
  `platform_stats` — was already sitting on `bw_query_top_authors` as
  Brandwatch-native, non-sampled columns; the function's *added* value was
  `original_count`/`reply_count`/`retweet_count`/`total_reach`/`max_reach`,
  all summed over `mentions`, so the whole function was removed).
  `mentions.mention_role` (added same batch as `influential_author_activity`)
  and `bw_query_top_authors.followers`/`is_influential` (native fields from
  the Top Authors endpoint) were kept — see below for what they still do.
- **Non-sampled reach/engagement per Narrativa, via the `categories`
  dimension** (added 2026-07-10, survived the reversal above because it's
  genuinely non-sampled). `bw_query_metrics_daily` gains
  `reach_estimate`/`engagement_score` via `data/reachEstimate/categories/days`
  and `data/engagementScore/categories/days` — the `categories`
  **dimension** returns every Narrativa's numbers in one call each, not
  one call per Narrativa. `refresh_narrative_metrics()` reads these two
  columns straight from there (no local fallback — see the premise above).
  ⚠️ The `categories`-dimension combination with `reachEstimate`/
  `engagementScore` has no confirmed example payload, same risk category
  as `syncPlatformMetrics`.
  **Hit in production**: the `categories` dimension returned category IDs
  `bw_categories` didn't have cached (outside `rulecategories`' scope, or
  stale since the last metadata refresh), crashing the upsert on the
  `bw_query_metrics_daily.category_id → bw_categories.id` FK.
  `syncCategoryDailyAggregate()` now looks up known category IDs first and
  skips (logging `unknown_categories_skipped`) anything outside that set
  instead of failing the whole invocation.
- **Influencer identification via native Top Authors fields** (added
  2026-07-10, user request: capture every top author with >100k followers
  as "most influential" and know the reach of their posts).
  `syncTopAuthors()`'s `limit` went from `100` to Brandwatch's documented
  max (`1000`) — better coverage, but not guaranteed: Top Authors is
  ordered by volume/relevance, not followers, so a high-follower/
  low-volume author can still be excluded even at the max limit (endpoint
  limitation, not a code gap — flag this to the user if it matters for a
  specific campaign). `bw_query_top_authors` gains `followers` (from
  `twitterFollowers` — the only followers field this endpoint's envelope
  actually has; Facebook/Reddit don't expose one here) and a generated
  `is_influential` (`followers >= 100000`). Reach of influential authors'
  posts is already answerable from this same table's `reach_estimate`
  (native, non-sampled, from the endpoint itself) — no join to `mentions`
  needed or wanted (see premise above).
- **`bw_categories` staleness reduced 24h → 1h** (fixed 2026-07-10, user
  report: "em categorias, não está refletindo as categorias existentes na
  brandwatch"). `needsMetadataRefresh()` already forced a refresh when
  `bw_categories` was empty, but once *any* categories existed it fell
  back to the 24h window regardless of edits made in Brandwatch afterward
  — during active configuration (the exact situation the user is in),
  that's a long, confusing lag. Reduced to 1h, still cheap on rate limit
  (~4 calls/hour/project at most). Deliberately does **not** delete
  categories removed from Brandwatch — `bw_query_metrics_daily`/
  `bw_query_topics`/`bw_query_top_authors` all cascade-delete on
  `bw_categories`, and `narratives.bw_category_id` has no cascade at all
  (a delete would FK-error once a Category became a Narrativa) — so a
  renamed/removed Category leaves an orphaned row instead of silently
  destroying metric history. If `categoriesCount` is still `0` after this,
  the next thing to check is whether `BRANDWATCH_PROJECT_ID` actually
  points at the Brandwatch Project where the Categories were created.
- **Concurrency lock + per-invocation call budget** (fixed 2026-07-10/11,
  user report: cascading `HTTP 429`s across two *different* endpoints
  interleaved in the logs — "acho que o código violou alguma regra da
  brandwatch"). Root cause was almost certainly two `bw-sync` invocations
  running at once, both making sequential Brandwatch calls but sharing the
  same 30-calls/10min Client-wide budget — nothing previously stopped two
  overlapping invocations. Fixed with a mutual-exclusion lock:
  `bw_sync_lock` (single row, migration `20260711000000`), claimed via an
  atomic `UPDATE ... WHERE locked_until IS NULL OR locked_until < now()`
  (not a Postgres advisory lock — those aren't reliable through
  PostgREST/connection pooling) in `try_acquire_bw_sync_lock()`, released
  in `release_bw_sync_lock()` via a `try/finally` around the whole
  invocation. Auto-expires after 5 minutes so a crashed invocation can't
  wedge the lock forever. A second invocation that finds the lock held
  exits immediately (`HTTP 200`, no Brandwatch calls at all) instead of
  competing for budget.
  Separately, the number of steps in one invocation had grown enough
  (mentions pagination + daily sentiment + reach/engagement + platform +
  weekly/monthly + topics + top-authors × `categoryTargets` + SOV) that a
  *single* cold invocation could approach or exceed 30 calls on its own.
  Added `brandwatchCallCount`/`BRANDWATCH_CALL_BUDGET = 25` (reset at the
  top of every invocation, incremented on every real attempt inside
  `callBrandwatch()` including ones that get `429`'d, since those still
  spend budget) — the mentions loop and the `categoryTargets` loop
  (weekly/monthly/topics/top-authors/SOV) both stop themselves once the
  budget is gone, deferring whatever's left to the next invocation (safe:
  throttled items just stay "stale" and get picked up naturally).
- **Data scope is deliberately bounded**: `foundation`/`bw-sync` covers all
  *pull* data later sprints need (projects, queries, query groups,
  categories, mentions, daily/weekly/monthly metrics, Query Group SOV).
  Tags, Custom Alerts, and Author/Site/Location Lists are Brandwatch
  features explicitly out of scope — the first two have no concrete need
  yet (Sprint 2/3), and Lists are a *push* mechanism (Lidi → Brandwatch)
  that depends on `entities`/`entity_tags` (Sprint 2) as a data source,
  which doesn't exist yet. See `.dev/specs/_index.md` "Fora de escopo do
  MVP".
- `bw-sync` logs every step via `console.log`/`console.error` (prefixed
  `[bw-sync]`, visible in Supabase Dashboard → Edge Functions → Logs) —
  primary observability today since there's no UI. Never log
  `password`/`access_token` values, only metadata like token length/expiry.
- Volume/sentiment numbers must never be derived by summing locally synced
  `mentions` — high-volume Queries are sampled by Brandwatch (individual
  mentions), but the aggregate endpoints (`data/volume/sentiment/days`) are
  not. Always read pre-aggregated numbers from `bw_query_metrics_daily` /
  `narrative_metrics` (`source = 'bw_aggregate'` when a Narrativa has a
  `bw_category_id`, else `'mentions_sample'` from local aggregation).
- `mentions` is partitioned by month (`mention_date`); the natural
  dedup key is `(query_id, resource_id, mention_date)`, not just
  `(query_id, resource_id)` — Postgres requires the partition key in any
  unique index on a partitioned table. The foundation migration only
  pre-creates partitions for its deploy month +1; polling historical data
  (`BRANDWATCH_MENTIONS_START_DATE`) needs partitions for earlier months
  too, so `bw-sync` calls `ensureMentionPartitions()` (RPC to
  `create_mentions_partition()`, now `security definer` so it doesn't
  depend on `service_role`'s DDL grants — migration `20260710000000`)
  before every mentions upsert, covering whatever months are in that
  batch. No `pg_cron` job pre-creates future partitions ahead of time yet
  — this per-invocation check is what makes it safe regardless.
- `narrative_matched_mentions(narrative_id)` is the single canonical
  definition of "which mentions belong to a Narrativa" — every consumer
  (`refresh_narrative_metrics()`, future `narrative_entities`, Intelligence
  Center drill-down) must reuse it rather than reimplementing the signal
  matching logic.

### Reporting/BI split

`reporting.narratives_overview` and `reporting.mentions_daily` exist for
external BI (Power BI/Qlik) via direct Postgres connection only. Because the
frontend reads through PostgREST (which never exposes `reporting`), the
canonical view logic lives in `public.narratives_overview` — RLS-respecting,
used by the Executive Overview UI — and `reporting.narratives_overview` is a
thin `select *` wrapper over it for the `bi_reader` role.

## Directory structure

```
app/                          Next.js App Router pages (minimal so far)
lib/supabase/{client,server}.ts   The only two files that import @supabase/ssr
types/database.types.ts       Placeholder — regenerate once linked to a real project
supabase/migrations/          One SQL file per logical schema change
supabase/functions/<name>/    One self-sufficient Edge Function per directory
supabase/seed.sql             Intentionally empty — orgs/credentials are seeded manually
.dev/specs/                   Spec-driven-dev source of truth (read before implementing)
.claude/skills/               Project-specific skills (packaged as .skill zip files)
```
