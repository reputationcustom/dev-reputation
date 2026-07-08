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

- The Brandwatch API rate limit (30 calls/10min per Client) is enforced by
  `pg_cron` invoking the `bw-sync` Edge Function every ~20-30s in
  round-robin over `(project_id, query_id)` pairs tracked in
  `sync_cursors`/`sync_log` — there is no in-memory queue between
  invocations (the function is stateless between runs).
- **Brandwatch auth (MVP, corrected 2026-07-07)**: no long-lived pre-generated
  token yet, so `bw-sync` mints one at runtime via `grant_type=api-password`
  against `POST https://api.brandwatch.com/oauth/token` (see
  `mintBrandwatchAccessToken()` in `supabase/functions/bw-sync/index.ts`).
  Credentials are **Edge Function secrets** — `BRANDWATCH_USERNAME`,
  `BRANDWATCH_PASSWORD`, `BRANDWATCH_PLATFORM_CLIENT_ID` — not per-org DB
  columns, since the MVP assumes a single Brandwatch Client. The minted token
  is meant to be cached in `brandwatch_credentials.access_token_secret_ref`
  (Vault) + `token_expires_at` so `bw-sync` doesn't burn the 30-calls/10min
  budget re-minting a token every ~20-30s cron tick — **that caching/Vault
  write-back is not implemented yet** (still a TODO in the function; today it
  mints a fresh token on every invocation, which is fine for testing the
  OAuth call in isolation but not safe to schedule on a real cron yet).
- **`sync_cursors` bootstrap seeding (MVP, corrected 2026-07-07)**:
  `sync_cursors` starts empty and nothing else populates it (the full
  `projects/summary` auto-discovery bootstrap is still a TODO), so without a
  seed step the sync would never start. `ensureBootstrapSeed()` in
  `bw-sync/index.ts` runs first on every invocation and, if
  `BRANDWATCH_PROJECT_ID`/`BRANDWATCH_QUERY_IDS` (Edge Function secrets,
  `QUERY_IDS` comma-separated) are set, idempotently upserts placeholder
  `bw_projects`/`bw_queries` rows plus the matching `sync_cursors` pair(s) —
  it resolves `organization_id` from the single row in
  `brandwatch_credentials` (MVP assumes one organization). All five
  Brandwatch secrets currently configured on the project: `BRANDWATCH_USERNAME`,
  `BRANDWATCH_PASSWORD`, `BRANDWATCH_PLATFORM_CLIENT_ID`,
  `BRANDWATCH_PROJECT_ID`, `BRANDWATCH_QUERY_IDS`.
- `bw-sync` logs every step via `console.log`/`console.error` (prefixed
  `[bw-sync]`, visible in Supabase Dashboard → Edge Functions → Logs) since
  there's no UI yet and `sync_log` is only written once the polling logic
  (TODO step 6) exists. Never log `password`/`access_token` values — only
  metadata like token length/expiry.
- Volume/sentiment numbers must never be derived by summing locally synced
  `mentions` — high-volume Queries are sampled by Brandwatch (individual
  mentions), but the aggregate endpoints (`data/volume/sentiment/days`) are
  not. Always read pre-aggregated numbers from `bw_query_metrics_daily` /
  `narrative_metrics` (`source = 'bw_aggregate'` when a Narrativa has a
  `bw_category_id`, else `'mentions_sample'` from local aggregation).
- `mentions` is partitioned by month (`mention_date`); the natural
  dedup key is `(query_id, resource_id, mention_date)`, not just
  `(query_id, resource_id)` — Postgres requires the partition key in any
  unique index on a partitioned table.
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
