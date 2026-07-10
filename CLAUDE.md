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

Sprint scope is fixed (do not scope-creep without the user): Sprint 1 =
Brandwatch→Supabase sync + Executive Overview (`foundation`, in progress).
Sprints 2-4 (`entities`, `command-center`, `intelligence-center`,
`threshold-engine`, `intelligent-feed`, `propagation-graph`,
`decision-center`, `executive-reports`) are not started.

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

`bw-sync` (`supabase/functions/bw-sync/index.ts`) is fully implemented as of
2026-07-07 — not a skeleton. One invocation processes one
`(project_id, query_id)` pair end-to-end: seed → token → metadata bootstrap
(conditional) → mentions poll → daily metrics (always) → weekly/monthly
metrics + Query Group SOV (throttled). `pg_cron` isn't actually scheduled
yet (no migration sets it up) — for now the function is invoked manually.

- **Rate limit budget (30 calls/10min per Client)**: every Brandwatch call
  goes through `callBrandwatch()`, which is sequential (never parallel —
  official best practice) and retries up to 3× on `429` honoring
  `retry-after`. Per-invocation call count varies: mentions poll (1) +
  daily sentiment metrics (1 + 1 per narrative-linked Category) + daily
  platform breakdown (1, added 2026-07-10, `data/volume/pageTypes/days`)
  run *every* invocation; metadata bootstrap (~4 calls) only when
  `bw_projects.synced_at` is >24h stale; weekly/monthly sentiment/SOV/topics
  (`data/topics`, added 2026-07-10)/top-authors (`data/volume/
  topauthors/queries`, added 2026-07-10) only when no "fresh" row exists
  yet for the current week (`isGrainStale()`/`isQueryGroupSovStale()`/
  `isTopicsStale()`/`isTopAuthorsStale()`) — this throttle is what keeps
  steady-state invocations cheap despite covering 5 aggregate types.
- **Brandwatch auth**: no long-lived pre-generated token, so `bw-sync` mints
  one at runtime via `grant_type=api-password` (`mintBrandwatchAccessToken()`)
  using Edge Function secrets `BRANDWATCH_USERNAME`/`BRANDWATCH_PASSWORD`/
  `BRANDWATCH_PLATFORM_CLIENT_ID` — not per-org DB columns (MVP assumes a
  single Brandwatch Client). **Known gap**: mints a fresh token on *every*
  invocation — `brandwatch_credentials.access_token_secret_ref`/
  `token_expires_at` exist to cache it, but the Vault write-back is still a
  TODO. Must be fixed before scheduling `bw-sync` on a real `pg_cron`
  cadence (~20-30s), or the mint call alone burns much of the rate budget.
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
- **Mentions polling walks history forward, resumed from the DB, not just
  `sync_cursors`** (fixed 2026-07-10 — the original `orderDirection=desc`
  bootstrap grabbed only the newest 100 mentions and the cursor jumped
  straight to "now," permanently skipping the Jan–Jun/26 backlog).
  `fetchMentions()` always uses `orderDirection=asc` from
  `BRANDWATCH_MENTIONS_START_DATE` forward, ~100 mentions/invocation.
  `resolveMentionsResumePoint()` picks the resume point: prefer
  `sync_cursors.last_added_cursor`; if empty, fall back to `MAX(added)`
  already in `mentions` for that `query_id` (so a lost/reset cursor never
  re-walks — and doesn't overwrite, upsert is idempotent anyway — months
  already collected); only true first-ever poll for a pair falls back to
  `BRANDWATCH_MENTIONS_START_DATE` itself.
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
