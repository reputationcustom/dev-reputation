# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Digital Intelligent Communication (renamed from "Reputation OS" 2026-07-12) —
a reputational-intelligence platform built on top of Brandwatch (Consumer
Research API), for Brazilian political campaigns / reputation management.

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
  module. See `.dev/specs/_index.md` "Módulos" for the full, current list
  and status of every module — this file's own module list below is a
  summary, not the source of truth; check `_index.md` when in doubt.

Sprint scope is fixed (do not scope-creep without the user). Sprint 1
(`foundation` — Brandwatch integration, no UI) and the `auth` module (login,
password recovery, user administration — see "Auth module (Sprint 2)"
below) are both implemented. The rest of Sprint 2 is `intelligence-center`
(5 pages: Executive Overview, Narrativas, Sentimento, Plataformas, Pautas
Eleitorais) plus the `aggregated-metrics` backend it depends on — see
`_index.md` "Sequência de implantação — Sprint 2" for the exact build
order. Sprints 3-4 (`event-radar`, `propagation-graph`, `decision-center`,
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

## Deploy (Hostinger) — global rules

✅ **Added 2026-07-13**, after the `auth` middleware (see "Auth module
(Sprint 2)" below) briefly broke this without anyone noticing until it was
reviewed: `middleware.ts` redirected *every* unauthenticated request,
including Hostinger's health check hitting `/`, to `/login`. A 307 on `/`
reads as "unhealthy" to the platform, which restarts the container in a
loop — it never stabilizes, so users only ever see a persistent 503. Fixed
in `middleware.ts` (early `return NextResponse.next()` when
`pathname === "/"`, before any auth check runs) and `app/page.tsx` (now a
client component, see rule 2 below). These four rules are why — apply them
to any future change that touches routing, the root page, `next.config.ts`,
or app icons, not just at initial setup:

1. **Node.js version is pinned to `>=24.0.0`** — `.nvmrc` (`24`) and
   `package.json#engines.node`. When deploying via hPanel, the Node version
   selector in the panel must also be set to 24.x — the panel doesn't read
   `.nvmrc` automatically, it's a separate setting that has to match.
2. **Never set `output: 'standalone'` in `next.config.ts`.** Hostinger's own
   builder runs `npm install` + `npm run build` and starts the app with
   `npm start` (`next start`) — the standard non-standalone server. `output:
   'standalone'` instead produces `.next/standalone/server.js`, which only
   works if the deploy process knows to run that exact file *and* manually
   copies `public/` and `.next/static/` into it — the panel does neither.
   Result: the build succeeds, but `npm start` never actually serves the
   app. Keep `next.config.ts` without an `output` override.
3. **`/` must never redirect on the server** — not from `middleware.ts`
   (this project's proxy layer), not from `redirect()` in a Server
   Component. Hostinger's health check requests `/` and requires a bare
   HTTP 200; a 307/308 there is read as "app not healthy" and triggers the
   restart loop described above, which never resolves into an available
   app. Correct pattern (see `middleware.ts` and `app/page.tsx`):
   `middleware.ts` lets `/` pass straight through
   (`return NextResponse.next()`, before the auth check), and
   `app/page.tsx` is a **client component** that renders nothing and
   redirects via `router.replace()` inside a `useEffect` — i.e. only after
   the server has already answered 200 with an (empty) HTML body. Any
   route that legitimately needs a server-side redirect is fine anywhere
   *except* `/` itself.
4. **Next.js App Router icon/favicon file-name conventions are exact and
   silent when violated.** An icon is only served automatically if the
   filename matches the convention precisely: `app/favicon.ico`,
   `app/icon.{ico,jpg,jpeg,png,svg}`, `app/apple-icon.{jpg,jpeg,png}`. A
   file with any other name (e.g. `favicon.svg`, `app-icon.png`) sits in
   the directory unused and is **never served**, even if it's referenced
   manually in `metadata.icons` — there's no error or warning, it just
   silently doesn't work. No icon exists in this project yet; when one is
   added, name it per this convention from the start.

## User timezone — global rules

Added 2026-07-13. All dates in the product are stored in UTC
(`timestamptz`) — never store local/wall-clock time in any table. Every
display of a date converts UTC → the viewing user's timezone exclusively in
the frontend; the server (Postgres, Edge Functions) always works in and
returns UTC, never does timezone math for display purposes.

- **Where the user's timezone lives**: `user_profiles.timezone` (migration
  `20260713060000`, IANA name, default `America/Sao_Paulo`). Read via
  `hooks/use-user-profile.ts` (`useUserProfile()` — 3-state, see "Backend
  communication failures" below), written via the `update-my-timezone`
  Edge Function — the only Edge Function in the project that lets a user
  write their own `user_profiles` row directly, as opposed to the
  `admin-*` functions, which are all administrative actions on *other*
  users' rows.
- **`/perfil`** (`app/perfil/page.tsx`) is the only UI that edits this —
  an IANA timezone `<select>` populated via
  `Intl.supportedValuesOf('timeZone')` (built into the JS/Deno runtime, no
  extra dependency needed for the list itself; `update-my-timezone`
  validates against the same API server-side).
- **Formatting utilities**: `lib/date/format.ts` — `formatDate`
  (`dd/MM/yyyy`, transaction dates), `formatDateTime` (`dd/MM/yyyy HH:mm`),
  `formatRelativeDate` (`Hoje`/`Ontem`/`há N dias`, falls back to
  `formatDate` beyond that), `getMonthRange` (start/end of a given month,
  computed in the user's timezone, returned as real UTC `Date` instants
  ready to use as `gte`/`lte` filters against a `timestamptz` column — this
  is what "Este mês"/"Mês anterior" period filters must use, never a naive
  server-local month boundary). Built on `date-fns-tz`
  (`toZonedTime`/`fromZonedTime`/`formatInTimeZone`) + `date-fns`.
- **Pattern**: `const { timezone } = useUserProfile()`, then
  `formatDate(someUtcDate, timezone)` — never format a date without an
  explicit timezone; the functions' `America/Sao_Paulo` default is a
  last-resort fallback, not the intended normal path.

## Cross-cutting UX rules

Added 2026-07-13, apply to every page/component going forward, not just
`auth`:

1. **Skeleton loading, never a blank screen**, while data loads. See
   `components/ui/skeleton.tsx` and its use in
   `app/admin/users/users-admin-view.tsx` (renders `SKELETON_ROWS` fake
   table rows shaped like the real table, not a bare spinner) — the
   pattern any future data table should copy. A spinner-in-button is still
   correct for *submit* actions (rule 5 below), just not for a page's
   initial data load.
2. **Empty state always shows the page's primary action**, never just a
   "nothing here" message with no way forward. In `/admin/users` this is
   automatic by construction — "Convidar usuário" lives in the page
   header, outside the loading/error/empty/loaded conditional, so it's
   always visible regardless of table state.
3. **Every side-effecting user action produces a toast** (confirmation or
   error) — `components/ui/toast.tsx`. This includes actions the original
   per-feature spec text marked "no toast" before this rule existed — e.g.
   `user-management.md`'s admin-toggle was originally "sem toast"
   (optimistic, silent unless it fails); this rule supersedes that, and
   `users-admin-view.tsx`'s `handleToggleAdmin` now toasts on success too.
   If a future spec explicitly says "no toast" for a new action, treat
   that as a conflict with this rule and flag it rather than silently
   picking one.
4. **Form validation**: client-side check before submit, but the server is
   always authoritative (Edge Function/Postgres re-validates everything —
   Principle 2). Server-returned errors render next to the relevant field,
   not as a generic banner — see `invite-user-modal.tsx`/
   `edit-organizations-modal.tsx` (`emailError`/`organizationsError`
   inline under their respective inputs; a `formError` banner is reserved
   for errors that genuinely aren't attributable to one field).
   **Exception**: `login.md`'s credential error ("E-mail ou senha
   incorretos") stays a generic top-of-form banner on purpose —
   attributing it to email-vs-password specifically would leak which one
   was wrong, defeating the account-enumeration protection that's the
   whole point of that message (`login.md`, "Fluxos alternativos e
   erros"). Security-motivated spec decisions like this one win over the
   generic UX rule.
5. **Buttons disable + show a spinner while their action is in flight**,
   and nothing with a side effect can be double-clicked into firing twice.
   Beyond the obvious (every submit button in this project's forms), this
   also covers non-button controls: `users-admin-view.tsx` tracks
   `pendingUserIds` and disables both the admin-toggle checkbox and the
   row's `⋮` actions menu for a user while a toggle/revoke call for that
   row is in flight.
6. **Pagination defaults to 10 items per page** on every list, unless a
   different value is explicitly called for. `components/ui/pagination.tsx`
   exports `DEFAULT_PAGE_SIZE = 10` — import it rather than hardcoding
   `10` again in a new list. `users-admin-view.tsx` is the reference
   implementation (client-side slicing over the already-fetched
   `admin-list-users` result; a list backed by a paginated query instead
   would page at the query level, but the constant/component are the
   same).

## Backend communication failures

Added 2026-07-13. Any failure talking to the backend — an Edge Function
call, a direct PostgREST/`supabase-js` query, or any other `fetch` — must
surface a friendly message to the user. **A UI stuck in an indefinite
loading spinner after a failed request is always a bug**, never an
acceptable state.

- **Every initial-mount data fetch** (`useEffect` on mount, or a Server
  Component `await`) must have 3 states, never 2: **loading**, **error**
  (friendly message + "Tentar novamente"/retry — see
  `components/ui/error-message.tsx`'s `onRetry` prop — never leave the
  previous spinner/skeleton showing forever, never silently fall back to a
  default value), **success**. `hooks/use-user-profile.ts`,
  `app/admin/users/users-admin-view.tsx`'s `loadUsers`, and
  `app/reset-password/reset-password-form.tsx`'s session check are the
  reference implementations.
- **Forbidden anti-pattern** (the most common cause of the "stuck loading
  forever" bug): reading only `data` from a Supabase client call and
  ignoring `error`. `.single()` and most `supabase-js` methods **don't
  throw** — they resolve `{ data: null, error }` — so `error` must be
  checked explicitly; a `try/catch` alone does not catch this. Two real
  instances of this exact bug were found and fixed in this same revision:
  `app/admin/users/page.tsx` (Server Component reading
  `user_profiles.is_admin` — used to silently redirect a real admin to
  `/overview` on a transient DB error, now throws and lets `app/error.tsx`
  handle it) and `app/reset-password/reset-password-form.tsx`
  (`getSession()` — used to render "link expired" on a connectivity
  error, now has a distinct `error` session-state with its own retry).
- **User-triggered actions** (form submit, button click) are already
  correctly handled by the existing `try/catch` + `setError()`/toast
  pattern used throughout `login`/`password-recovery`/`user-management` —
  this rule doesn't change that pattern, it targets the initial-load case
  specifically, which historically didn't have equivalent treatment.
- **`app/error.tsx`** is the root error boundary — catches any uncaught
  Server Component exception (e.g. the `admin/users/page.tsx` case above)
  anywhere under the root layout that doesn't have a more specific
  `error.tsx`, and renders `BACKEND_ERROR_MESSAGE` + retry instead of
  Next's default crash page.
- **`lib/errors.ts`** exports `BACKEND_ERROR_MESSAGE` ("Não foi possível
  conectar ao servidor. Tente novamente em instantes.") — the fallback
  wording when no more specific message applies to the context. Prefer a
  specific contextual message when one is available (e.g. "Não foi
  possível carregar os usuários." in `users-admin-view.tsx`) — this
  constant is for the generic case, not a replacement for good per-screen
  messages.
- **`lib/supabase/call-function.ts`**'s `callFunction()` is the shared
  wrapper for calling any Edge Function from the browser — always checks
  `error` from `supabase.functions.invoke()`, decodes the Edge Function's
  JSON error body when present, and falls back to `BACKEND_ERROR_MESSAGE`
  otherwise. Use this instead of calling `supabase.functions.invoke()`
  directly in new code — `users-admin-view.tsx` and `app/perfil/page.tsx`
  both go through it.

## Database security (Security Advisor)

Added 2026-07-13. Running Supabase's Security Advisor (Dashboard →
Advisors → Security) is a mandatory part of validating any phase that
creates tables, views, functions, or Storage buckets — before marking that
phase done. The rules below prevent the findings this audit already turned
up once (migration `20260713070000` fixes all three real findings — see
that file for the full rationale on each):

1. **Every view over an RLS-protected table needs `security_invoker =
   true`.** Postgres runs a view without this option as the view *owner*,
   not the querying user — which makes the view **ignore the base tables'
   RLS**. ⚠️ **This was a real, confirmed cross-tenant data leak in this
   project**: `public.narratives_overview` (exposed to `authenticated` via
   PostgREST, consumed by the Executive Overview UI) had no
   `security_invoker`, so any authenticated user of any organization could
   see every organization's Narrativas through it — the view's own old
   comment claimed the opposite ("RLS applies normally since there's no
   special security_invoker/definer"), which was backwards. Fixed via
   `ALTER VIEW ... SET (security_invoker = true)` on
   `public.narratives_overview` and, for defense-in-depth/consistency (not
   because they were exploitable — `reporting.*` is never in
   `db.schemas`/PostgREST and `bi_reader` bypasses RLS by role attribute
   regardless of view mode, Principle 6), `reporting.narratives_overview`
   and `reporting.mentions_daily` too. New views over RLS tables must
   include this from the start — `create or replace view ... with
   (security_invoker = true) as ...`, or an `alter view` right after if
   the tool/pattern being used generates `create or replace view` without
   inline reloptions.
2. **Every function needs a fixed `search_path`.** Without one, a function
   is vulnerable to search-path hijacking — an unqualified reference
   inside it can resolve to an object planted in a schema that comes first
   in the *caller's* session search path instead of the intended one. Use
   `set search_path = public` (this project's tables are referenced
   unqualified inside function bodies, so `search_path = ''` would break
   them) — matches the pattern already used by `auth_organization_ids()`,
   `create_mentions_partition()`, `is_current_user_admin()` since earlier
   migrations. 6 functions were missing this and got it added via `alter
   function ... set search_path = public` in `20260713070000`:
   `set_updated_at`, `narrative_matched_mentions`,
   `refresh_narrative_metrics`, `try_acquire_bw_sync_lock`,
   `release_bw_sync_lock`, `protect_principal_account`.
3. **Every RLS-enabled table needs at least one explicit policy**, even a
   deny-all one. `enable row level security` with zero policies already
   denies everyone but `service_role`/`SUPABASE_SECRET_KEY` — correct for
   `bw_sync_lock`/`sync_cursors`/`sync_log` (internal, Edge-Function-only
   tables, see "Brandwatch sync model" above) — but the Advisor can't tell
   "forgot the policy" from "deliberately admin-only", so it flags either
   way. Make the intent explicit: `create policy "<table>: sem acesso
   direto" on <table> for all using (false);` — added for those 3 tables
   in `20260713070000`.
4. **Public Storage buckets don't need (and shouldn't have) a broad
   SELECT policy on `storage.objects`.** A `public = true` bucket already
   serves files by URL via `getPublicUrl()` without going through RLS at
   all — a permissive `SELECT` policy on top of that doesn't enable that,
   it only additionally allows *listing/enumerating* every file in the
   bucket via the API (names, dates, metadata), a separate Advisor finding
   ("Public Bucket Allows Listing"). Don't add one unless the use case
   genuinely needs API-driven listing, not just serving an image by URL.
   No Storage buckets exist in this project yet — apply this the first
   time one is added.
5. **Leaked Password Protection** (Dashboard → Authentication →
   Policies/Attack Protection) should be enabled — checks a chosen
   password against the HaveIBeenPwned breach corpus on signup/password
   change. This is a Dashboard toggle, not something a migration or this
   codebase can set — noted here so it doesn't get missed during setup,
   not something that can be applied from code.
6. **Supabase-internal `SECURITY DEFINER` functions** (not defined in any
   of this project's migrations — e.g. platform-managed functions the
   Advisor may still flag) should never be altered/dropped directly. If
   one doesn't need to be callable via the API, revoke `EXECUTE` from the
   API roles only (`PUBLIC`, `anon`, `authenticated`), always guarded:
   `do $$ begin if exists (...) then revoke execute on function ... from
   public, anon, authenticated; end if; end $$;` — the guard is needed
   because the function may not exist in every environment.

This audit (`20260713070000`) covered functions/views/policies added
through 2026-07-13 — it is not a guarantee every migration ever written
passes the Advisor with zero findings; run the Advisor for real against
the Supabase Dashboard periodically. This migration just fixes what a
grep-based pass from this codebase could confirm without live DB access.

## Edge Function error handling

Added 2026-07-13, applies to every Edge Function (not just `admin-*` — the
principle already existed informally via `bw-sync`'s try/catch, this makes
it explicit):

- **Every handler is wrapped in one top-level `try/catch`.** Without it,
  an uncaught exception (a malformed body breaking `req.json()`, `atob()`
  on invalid base64, etc.) crashes the response *before* `corsHeaders` are
  attached — the client sees a confusing CORS error instead of the real
  failure, exactly the kind of symptom that wastes debugging time chasing
  the wrong cause. All `admin-*` functions and `update-my-timezone`
  already follow this — see any of them for the pattern (`Deno.serve(async
  (req) => { if (OPTIONS) ...; try { ... } catch (err) {
  console.error(...); return jsonResponse({ error: "..." }, 500); } })`).
- **Log every DB/Storage/Auth error** with `console.error('[function-name]
  context', error)` before responding — passing the raw error object, not
  just `.message` (preserves stack/detail) — this is what shows up in
  Dashboard → Edge Functions → Logs and is the only way to debug
  production without reproducing the issue locally.
- **Never return a raw Postgres/PostgREST `error.message` to the client.**
  Messages like `Could not find the 'phone_verified' column of
  'user_profiles' in the schema cache` are internal jargon that means
  nothing to an end user and leaks schema details. Always translate to a
  generic, friendly message (`"Não foi possível salvar. Tente novamente."`
  is the standard wording used across `admin-*`/`update-my-timezone`),
  reserving the technical detail exclusively for the `console.error` call.
  Where a function needs to distinguish cases for the *client* (e.g.
  "e-mail já cadastrado" vs. a generic failure), inspect the raw error
  server-side to decide which friendly string to send — never forward the
  raw string itself (see `admin-invite-user`/`admin-set-user-role`/
  `admin-delete-user` checking `error.message` content internally to pick
  between two fixed friendly strings, never echoing the checked message
  back).
- **Exception**: operational/monitoring endpoints not meant for end users
  (e.g. a health check) may return technical detail in the body — whoever
  consumes those is a monitoring tool, not a person looking at a screen.

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
  daily_metrics → weekly_monthly → topics → platform_by_narrative →
  x_insights → top_authors → author_enrichment → top_sites →
  demographics → sov`, tracked in `sync_cursors.next_step`) and
  advances the cursor; `last_synced_at` (and the `BW_SYNC_INTERVAL_HOURS`
  gate) only advances once the last phase closes the cycle. Since all
  state lives in Postgres, not the isolate's memory, a manual invocation
  (Dashboard "Invoke" button, used heavily during testing) behaves
  identically to a heartbeat tick — same cursor, same next-phase logic.
  Trade-off: `weekly_monthly`/`topics`/`top_authors`/`sov` now advance at
  most one `categoryTarget` per invocation, so fully covering every
  `categoryTarget` for a newly-created Narrativa can take several full
  cycles instead of one. Complementary fix: `syncCategoryDailyAggregate()`
  (the 4825-row case) now upserts in 1000-row chunks instead of one giant
  batch.

- **Per-author impressions and themes (2026-07-11, migration
  `20260711040000`)** — user request: "impressões por autor e temas por
  autor. Incluir no MVP". First read of this same review had concluded
  neither had an official non-sampled source (Top Authors doesn't expose
  impressions; `data/topics` is aggregated at Query/Category level, not
  per author) — **reversed** after deeper research: `impressions` is a
  documented chart aggregate (`chart-dimensions-and-aggregates`, same
  table that already confirmed `reachEstimate`/`engagementScore`), and the
  `author` filter is documented (`available-filters.md`) as valid on
  "Mention or Data Retrieval calls" — same generic evidence already
  accepted in this project for the `category` filter. Combining both:
  `data/impressions/queries/days?queryId=X&author=<handle>` (same
  `queries`-dimension pattern already used by `syncQueryGroupSov()`) and
  `data/topics?queryId=X&author=<handle>` give official, non-sampled,
  author-scoped aggregates — Brandwatch's own aggregation engine filtered
  by author, not a local sum over sampled `mentions`, so this doesn't
  violate the sampling premise. New `author_enrichment` phase (between
  `top_authors` and `sov`) enriches, one at a time, the top 10 authors by
  volume for the whole-query scope (`bw_query_top_authors.impressions`
  column + new `bw_query_author_topics` table) — scoped to top 10 as a
  budget safeguard (2 extra calls per author), no per-Narrativa breakdown
  yet.

- **Real SOV scoping bug found and fixed (2026-07-11, migration
  `20260711080000`)** — user request: verify that SOV = Narrativa mentions
  / total mentions, and correct any divergence. There was a real one:
  `public.narratives_overview.sov_percent` divided by the sum of every
  Narrativa's `total_mentions` across the **entire organization**
  (grouped only by `organization_id`), not by the Narrativa's own Query
  (candidate/monitoring effort). Correct only by coincidence when an org
  has a single Query — wrong as soon as a Project tracks more than one
  (confirmed as the real scenario by the dashboard PDF validation above —
  6 candidates, 6 Queries). Root cause ran deeper than the view:
  `fetchNarrativeCategoryIds()` returned *every* Narrativa in the Project
  for *whichever* Query was being synced, with no notion of which Query a
  Category belongs to — wasting call budget and letting
  `refresh_narrative_metrics()` (joined on `category_id` alone, no
  `query_id`) pull `total_mentions` from the wrong Query for a Narrativa.
  Fix: `bw_categories.query_ids` (Brandwatch already returns this in `GET
  .../rulecategories` as `queryIds` — no new call), `fetchNarrativeCategoryIds()`
  now filters by Query, `narrative_metrics.query_id` (populated only when
  a Category maps to exactly one Query — the pattern
  `brandwatch-setup.md` already recommends), and the SOV view now groups
  its denominator by `query_id` instead of `organization_id`. Also closed,
  same request ("share of voice por plataforma... por narrativa... por
  autores"): SOV by author was already answerable from existing data
  (`bw_query_top_authors.volume` ÷ `bw_query_metrics_daily.total_mentions`,
  no new capture); SOV by platform was a real gap —
  `bw_query_metrics_daily_by_platform` gained `category_id` and a new
  `platform_by_narrative` phase (migration `20260711090000`).

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
- **Sprint 2 kickoff + full Brandwatch aggregate audit (2026-07-12)** —
  user imported a frontend prototype ("Comunicação Inteligente",
  claude.ai/design) via the `claude_design` MCP and asked for Sprint 2 to
  be spec'd from it. This produced a new `intelligence-center` module
  (4 specs: Narrativas exploration, Sentiment analysis, Platform analysis,
  Electoral themes/"Pautas") plus a `_design-tokens.md` (colors/typography
  from the prototype) and a `command-center/overview.md` stub — see
  `.dev/specs/_index.md` for the full note. Mid-review, the user asked
  for a rolling audit of every Brandwatch aggregate/endpoint actually
  documented against `developers.brandwatch.com`, which found and fixed
  several real gaps (not just spec omissions — some were silent data
  bugs), all in migrations `20260712020000`–`20260712040000`:
  - `bw_query_metrics_daily.reach_estimate`/`engagement_score` had
    **never** been populated for `category_id is null` (the whole-query
    row the Executive Overview KPI cards read) — `syncCategoryDailyAggregate()`
    only covers the `categories` dimension, which structurally never
    returns a whole-query total. Fixed with a new `syncQueryDailyAggregate()`
    (dimension `queries`, single `queryId`).
  - `unique_authors` (chart aggregate `authors`, "distinct authors who
    posted") and `impressions` (at Narrativa/whole-query level, previously
    only captured per-author/per-mention) were missing despite being
    official, non-sampled Brandwatch aggregates — added to
    `bw_query_metrics_daily`/`narrative_metrics` via the same
    `categories`/`queries` dimension mechanism as reach/engagement.
  - `bw_query_metrics_daily_by_platform` gained `unique_authors`/
    `engagement_score`/`net_sentiment` (via `pageTypes` dimension);
    `bw_query_demographics_daily` gained `net_sentiment` for the 4
    location dimensions. `net_sentiment` is a single net score, not the
    positive/neutral/negative split used elsewhere (no 3-dimension chart
    call exists) — must render as visually distinct in any UI.
  - **`data/volume/topauthors/queries` ("Top Authors") and
    `data/volume/toptweeters/queries` ("Top Tweeters"/"Top X (Twitter)
    Authors") are two distinct endpoints**, not the same endpoint under
    two doc pages as a prior read (curated summary in the
    `brandwatch-api` skill, not this file) had assumed — confirmed via
    literal payload quotes from both doc pages. `topauthors` ranks by
    volume across all platforms; `toptweeters` ranks specifically X
    authors, which can surface high-follower/low-volume X accounts that
    `topauthors` misses. Added `bw_query_top_tweeters` as its own table
    (mirrors `bw_query_top_authors`'s shape exactly) rather than a column
    on the existing table, since the same author can rank differently in
    each universe.
  - Same pattern found for **topics**: `data/topics` ("Topics (New)",
    already implemented as `bw_query_topics`) and
    `data/volume/topics/queries` ("Topics" legacy) are different
    endpoints with different payload shapes — a 2026-07-11 spec revision
    had planned `bw_query_topics.daily_series`/`page_type_breakdown`
    (`days`/`pageType` fields) as if they came from the New endpoint's
    response, but those fields only exist on the **legacy** endpoint's
    payload. Never shipped in code, so no data corruption — caught before
    it could ship. Fixed by adding a real call to the legacy endpoint
    (`syncLegacyTopicsData()`, stored as `topic_type = 'legacy_mixed'`
    rows in the same table) alongside the existing New-endpoint call.
  - **`data/sharedsites` ("Top Shared Sites")** is a real, previously
    uncaptured endpoint, distinct from `data/volume/topsites/queries`
    ("Top Sites") — measures domains most linked/shared *within* mention
    content, not domains mentions originate from. Added
    `bw_query_top_shared_sites`.
  - **"Top Shared URLs" is the exact same endpoint as X Insights'
    "Stories"** (`data/urls`) — already correctly covered by
    `bw_query_x_insights` (`insight_type = 'url'`), just documented under
    two different doc pages by Brandwatch. No gap, no code change, just a
    clarifying note (and the caveat that `bw-sync` only fetches it when
    the Query/Narrativa has X volume, even though the endpoint itself
    isn't X-exclusive).
  - `SYNC_STEPS` gained two new phases (`top_tweeters` after
    `top_authors`, `top_shared_sites` after `top_sites`); `sync_cursors_next_step_check`
    widened accordingly (migration `20260712040000`).
  - Bonus: confirmed the exact Reddit karma field names
    (`redditAwardeeKarma`/`redditAwarderKarma`/`redditKarma`) on Top
    Authors, resolving a prior "not confirmed" note in
    `sync-brandwatch.md` — already flowing through `platform_stats` jsonb,
    no code change needed.
  - See `foundation/data-model.md` §5 for the full per-endpoint rationale
    and confirmation evidence on every item above.

- **`foundation` gap closure + a production bug fix (2026-07-13)** — user
  request: "Implemente as pendências do módulo foundation" (implement the
  remaining pending items of the foundation module), tracked in
  `.dev/specs/_pending.md`. Two genuine gaps closed (a third,
  `bw_query_topics.daily_series`/`page_type_breakdown`, turned out to
  already be implemented since migration `20260712040000` — the tracker
  just hadn't been updated; token caching in Vault stays deferred per the
  user's own 2026-07-13 note in `_pending.md`):
  - **`bw_query_metrics_hourly` + new `hourly_metrics` phase** (migration
    `20260713040000`) — hourly volume/sentiment/`net_sentiment`, rolling
    30-day window fetched on every invocation (not stale-gated — the whole
    point is staying fresh for short-term detection), 3 fixed Brandwatch
    calls regardless of Narrativa count (whole-query volume/sentiment +
    `netSentiment` via the `categories` dimension, covering every
    Narrativa in one call, same pattern as `syncCategoryDailyAggregate` +
    `netSentiment` via `queries` for the whole-query row). Schema and the
    "no retention/pruning job" decision were already fully specified in
    `foundation/data-model.md` from an earlier revision — this migration
    only materializes it. Feeds `event-radar`'s intraday detection and
    `aggregated-metrics`' Velocidade indicator.
  - **Selective `full_text` enrichment** (new `full_text_enrichment`
    phase, no migration — `mentions.full_text` already existed as a
    column, always `null`). For each Narrativa (`bw_category_id`), finds
    the most recent day with mentions still missing `full_text` from a
    non-redacted source (`content_source` outside
    `twitter`/`reddit`/`linkedin`/`news` — same 4 sources
    `data-restrictions-compliance.md` flags as redacted/limited; a still-`null`
    `content_source`, e.g. from before migration `20260710010000`, is
    treated as eligible rather than excluded), picks the top 8 by
    `reach_estimate` **locally** (an `ORDER BY` over mentions already
    synced — not a new aggregate call, so it doesn't reopen the
    "never sum/aggregate over sampled `mentions`" premise), and calls
    `/data/mentions/fulltext` scoped to that single day + Category to
    update just those rows. Bounded to one Narrativa×day per invocation,
    same "stop at the first that needs work" pattern as the other
    stale-gated phases. ⚠️ Two things not confirmed against a real
    payload: the response field name (`fullText`) and the exact
    `content_source` string values for `reddit`/`linkedin` specifically —
    inferred from the same naming convention already used for
    `contentSource`/`pageType` elsewhere in this file.
  - **Production bug found and fixed while implementing the above**: user
    reported `HTTP 429` on `data/netSentiment/queries/days`, retries
    exhausted, invocation failing outright. Root cause:
    `runDailyMetricsStep()` (the `daily_metrics` phase) was the *only*
    phase in the whole file with no `hasBrandwatchCallBudget()` guard
    anywhere — it always made 1 sentiment call per `categoryTarget` (every
    Narrativa + the whole query) plus 10 fixed aggregate calls
    (`reachEstimate`/`engagementScore`/`unique_authors`/`impressions`/
    `net_sentiment` × the `categories`+`queries` dimensions, the last pair
    added just the day before by the `net_sentiment` work) plus 4 platform
    calls. With enough Narrativas that total alone can exceed Brandwatch's
    real 30-calls/10min ceiling in a single invocation, before even
    accounting for other recent invocations in the same window. Fixed by
    guarding every call in this phase with `hasBrandwatchCallBudget()`,
    the same pattern every other phase already uses — once the budget
    runs out the phase stops (`didWork: true`, invocation ends there) and
    whatever's left is picked up on the next full cycle through this same
    phase (idempotent upserts, no data lost, just delayed).

### Reporting/BI split

`reporting.narratives_overview` and `reporting.mentions_daily` exist for
external BI (Power BI/Qlik) via direct Postgres connection only. Because the
frontend reads through PostgREST (which never exposes `reporting`), the
canonical view logic lives in `public.narratives_overview` — RLS-respecting,
used by the Executive Overview UI — and `reporting.narratives_overview` is a
thin `select *` wrapper over it for the `bi_reader` role.

### Auth module (Sprint 2)

Implemented 2026-07-13 from `.dev/specs/auth/{login,password-recovery,
user-management}.md` (`data-model.md` — `user_profiles` + principal-admin
protection — was already implemented, see migration `20260713000000`
above). This is the first frontend code in the project (Sprint 1 was
backend-only) and the first Edge Functions besides `bw-sync`.

- **Route protection is exactly one gate**: `middleware.ts` (project root)
  redirects any unauthenticated request to `/login?next=<path>`, except
  `PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password']` (plus
  static assets via the `matcher` config). An authenticated user hitting
  `/login` is redirected to `next` or `/overview`. No other page
  re-implements this check — per `login.md`, "Proteção de rota". Uses the
  standard `@supabase/ssr` middleware pattern (mutable `response`
  re-created inside `cookies.setAll` so refreshed auth cookies propagate).
- **⚠️ Known gap, not fixed here (out of this module's scope)**: the
  post-login redirect target is `/overview`
  (`intelligence-center/executive-overview.md`), which doesn't exist yet —
  hitting it 404s until that page is built. Login itself still works
  (session is created); only the redirect destination is a dead route for
  now. `/admin/users` does exist and is reachable directly.
- **`/admin/users` gate is a second, independent check** — `is_admin` is
  read server-side in `app/admin/users/page.tsx` via a bare
  `select('is_admin')` (no explicit `.eq('id', ...)` — RLS's
  `user_profiles_select_own` policy already scopes it to the caller) and
  `redirect('/overview')`s non-admins before the page ever renders, per
  `user-management.md` ("a rota nunca renderiza para não-admin"). The
  client-side table itself trusts nothing — every mutation goes through an
  Edge Function that re-checks `is_admin` again server-side.
- **Edge Function admin-auth pattern** (all 6 `admin-*` functions,
  self-sufficient per Principle 5 — the boilerplate below is duplicated,
  not shared): read the `Authorization: Bearer <jwt>` header the browser
  client attaches automatically via `supabase.functions.invoke()`, then
  call `supabaseAdmin.auth.getUser(token)` (the **service-role client's**
  `getUser(jwt)` overload validates an arbitrary JWT directly) instead of
  building a second client with the publishable/anon key just to identify
  the caller — one fewer env var to wire up per function. Only after
  confirming `user_profiles.is_admin = true` for that caller does the
  function touch `auth.admin.*`.
- **Resolved the `user-management.md` ⚠️ DECISÃO PENDENTE** (banning the
  principal admin isn't blocked by `protect_principal_account_trigger`,
  which only covers `user_profiles`, not `auth.users.banned_until`):
  implemented the spec's own recommended mitigation —
  `admin-revoke-user-access` checks `user_profiles.is_principal` and
  refuses `revoke: true` for that account, on top of the UI already hiding
  the action on that row. Low-cost (one extra query), closes a real gap the
  spec flagged but left optional.
- **`SITE_URL`** (new Edge Function secret, optional): `admin-invite-user`
  passes `redirectTo: \`${SITE_URL}/reset-password\`` to
  `inviteUserByEmail()` when set, so invite emails land on this app's reset
  page instead of Supabase's default. Falls back to whatever redirect URL
  is configured in the Supabase Dashboard when unset — not a hard
  dependency, no migration or `.env.local.example` change needed (it's an
  Edge Function secret, not a `NEXT_PUBLIC_*`/Next.js var).
- **No toast library introduced**: `/admin/users` needs transient
  success/error feedback (spec's "Notificações / Feedback ao usuário"
  table) but the project had no toast system yet. Built the smallest thing
  that satisfies the spec — `components/ui/toast.tsx`, one fixed-position
  message driven by local state in `users-admin-view.tsx`, auto-dismissed
  after 4s via `setTimeout`. Revisit if a second page needs the same thing
  and duplication starts to hurt.
- **Design tokens landed in code for the first time**: `tailwind.config.ts`
  gained the neutral/accent colors from `_design-tokens.md` that the auth
  screens actually use (`bg-page`, `bg-card`, `border-default`,
  `text-primary/secondary/tertiary`, `accent-blue`, `accent-blue-bg` — not
  the full sentiment/risk/platform palette, which has no consumer yet) plus
  `fontFamily.sans` wired to Manrope; `app/layout.tsx` loads the font via
  `next/font/google`. `intelligence-center` pages should extend this same
  config rather than redefining tokens locally.
- **Shared UI primitives** (`components/ui/`): `Spinner`, `ErrorMessage`
  (with optional retry), `EmptyState`, `Modal`, `ConfirmDialog`,
  `OrganizationsMultiSelect`, `Toast`, `AuthCard` (login/forgot/reset
  card shell). `OrganizationsMultiSelect` is reused as-is between the
  invite modal and the "editar organizações" modal, per
  `user-management.md`'s explicit "não duplicar UI" instruction.
- **`admin-update-user-organizations` does a real diff**, never a blind
  replace: fetches current `organization_members` rows for the user,
  computes which org IDs to insert vs. delete, and only touches those —
  matches the spec's explicit requirement, and avoids clobbering
  `created_at` on unrelated existing memberships.
- **`admin-list-users`** is the only function that reads (never writes) —
  combines `auth.admin.listUsers({ perPage: 1000 })` (no pagination UI;
  fine at MVP scale, revisit if the platform user count grows past that)
  with `user_profiles` and `organization_members`/`organizations` into one
  response, so the frontend never makes 3 separate calls per
  `user-management.md`.

**Later additions to this module (2026-07-13, same day, after global rules
were dictated post-implementation)** — each has its own full write-up in
the dedicated section linked below; this is just the map from "auth module
file" to "which rule drove the change":
- `middleware.ts`/`app/page.tsx` — Hostinger `/` health-check restart-loop
  fix, see "Deploy (Hostinger) — global rules" above.
- `user_profiles.timezone`, `app/perfil/`, `hooks/use-user-profile.ts`,
  `update-my-timezone` Edge Function — new self-service timezone feature,
  see "User timezone — global rules" above (`auth/data-model.md` documents
  the column/RLS impact).
- `app/admin/users/*` skeleton loading, pagination, toast-on-toggle,
  disable-during-inflight, inline modal field errors — see "Cross-cutting
  UX rules" above.
- `app/error.tsx`, `lib/errors.ts`, fixes to `app/admin/users/page.tsx` and
  `app/reset-password/reset-password-form.tsx`'s `error`-field handling —
  see "Backend communication failures" above.
- `is_current_user_admin()`/`protect_principal_account()` gaining
  `search_path`, `public.narratives_overview` gaining `security_invoker`
  (not an auth-module table, but found during the same Security Advisor
  pass) — see "Database security (Security Advisor)" above.
- `console.error` logging in all 6 `admin-*` functions aligned to pass the
  raw error object — see "Edge Function error handling" above.

### aggregated-metrics module (Sprint 2)

Implementation started 2026-07-12 from `.dev/specs/aggregated-metrics/`, in
the order that module's `overview.md` prescribes — `standard-json-envelope.md`
first, since every later piece (`sql-aggregation`, `service-layer-aggregation`,
`edge-functions-per-page`, `ai-synthesis`) depends on this contract.

- **`@reputation/shared-types` (`packages/shared-types/src/envelope.ts`)**
  is the canonical TypeScript type for the page envelope (`PageEnvelope`) —
  one interface/type per top-level block (`MetricCard`, `Breakdown`,
  `Trend`, `NarrativeRow`, `AuthorRow`, `Highlight`, `TermSignal`,
  `DisseminationGraph`), matching `standard-json-envelope.md` field-for-field,
  plus `createEmptyEnvelope()` (every page returns all 8 top-level
  array/object fields, even empty) and `toAiPayload()` (strips
  `ui_meta`/`narrative_text` before the envelope goes to the AI synthesis
  step, per that spec's "Regras de negócio"). `RiskLevel` reuses the same
  `low|medium|high|critical` enum already established in `_index.md`'s
  nomenclature table, shared by `narratives[].risk_label`,
  `authors[].risk_level`, and `highlights[].severity` — one enum, three
  field names.
- **`_pending.md` decision #2 resolved 2026-07-14** (user: "em
  aggregated-metrics utilizar Tipos TS do envelope: pacote compartilhado
  para facilitar a organização e manutenção") — first implemented
  2026-07-12 as a single `types/envelope.ts` file (no workspace existed
  yet), then moved the same day the decision was made explicit. First npm
  workspace in this repo: root `package.json` gained `"workspaces":
  ["packages/*"]` and a `"@reputation/shared-types": "*"` dependency;
  `packages/shared-types/package.json` points `main`/`types` straight at
  `./src/index.ts` (no build step — it's consumed as raw TS); `next.config.ts`
  gained `transpilePackages: ["@reputation/shared-types"]` so Next compiles
  it like local app code instead of expecting pre-built `node_modules`.
  `types/envelope.ts` no longer exists — `types/` is back to holding only
  `database.types.ts` (a different concern: Supabase-CLI-generated, not
  hand-maintained contract types). **This resolves the frontend side only.**
  Edge Functions still can't import it in production — Principle 5 (no
  bundle reaches code outside its own `supabase/functions/<name>/` folder)
  applies to a local *unpublished* workspace package exactly as it did to a
  single file; `npm:`/`deno.land/x`/`jsr` specifiers only resolve published
  packages. So the Deno side (`supabase/functions-shared-source/
  aggregated-metrics-service.ts`, see below) still carries its own inline
  copy of these types, kept in sync by hand — "shared package" only ever
  had one real audience (Next.js/Node code), and this now covers it.
- `period.granularity`/`period.comparison` are typed as plain `string`, not
  a literal union — no spec anywhere enumerates their valid values yet (only
  the example values `"day"`/`"previous_period"` appear in
  `standard-json-envelope.md`). Tighten once `sql-aggregation.md` or the
  header/period-selector UI defines the real set.
- `term_signals[].sentiment_associated` is similarly left as plain `string`
  — the spec doesn't say whether it reuses the 7-value `SentimentLabel` or a
  simpler 3-way split, and inventing one would violate this project's "don't
  invent shape without a real source" rule (same caution the spec itself
  applies to `graph` edge types).

**`sql-aggregation.md` + `service-layer-aggregation.md` implemented
2026-07-14** (migration `20260714000000_aggregated_metrics_sql_functions.sql`
+ `supabase/functions-shared-source/aggregated-metrics-service.ts`):

- **9 of the 10 functions `sql-aggregation.md` calls for are implemented**:
  `get_metrics_cards`, `get_sentiment_breakdown`, `get_platform_breakdown`,
  `get_theme_breakdown`, `get_volume_trend`, `get_narratives_table` (full
  Momentum/Velocity/Risk formulas from "Scores de Narrativa", copied
  verbatim), `get_authors_ranking`, `get_dissemination_graph`,
  `get_term_signals` — plus `norm_growth` (copied verbatim from the spec)
  and two new internal helpers not in the spec text but implied by its
  "Uma organização pode ter 1+ Queries" rule: `org_query_ids(organization_id)`
  (resolves the org's Queries via `bw_queries → bw_projects`, reused by
  every function that needs to sum across Queries) and
  `filter_category_ids(organization_id, filters)` (resolves
  `filters.narratives` — the only `EnvelopeFilters` dimension actually wired
  up this round — to the matching `bw_category_id[]`, letting the same
  function serve both "whole Query" and "one Narrativa" scope depending on
  what's passed). All `security invoker` (default) + `stable`, never
  `security definer`, per the spec's explicit RLS rule.
- **`get_active_highlights` deliberately NOT implemented** — depends on
  `feed_events`, which doesn't exist until `event-radar` (Sprint 3, still
  `rascunho`) is built. Tracked as gap #8 in `_pending.md`. The service
  layer's `fetchHighlights()` already exists and returns `[]` — swapping in
  the real RPC call later is the only change needed once that table exists.
- **Two real gaps found between `sql-aggregation.md` and
  `block-mapping-per-page.md`**, not invented around: (1) breakdown type
  `'region'` (`narrative_detail`/`sentiment` pages) has no backing function
  — `bw_query_demographics_daily` exists but `sql-aggregation.md`'s function
  table never lists a `get_region_breakdown`; (2) "volume por
  plataforma"/"SOV por pauta" **over time** (trends block, `platforms`/
  `themes` pages) — `get_volume_trend` only covers the whole-query/
  whole-Narrativa series, not a per-platform or per-Pauta time series (only
  a static snapshot exists via `get_platform_breakdown`/`get_theme_breakdown`).
  Both are gaps #9/#10 in `_pending.md`. The service layer's
  `fetchOneBreakdown('region', ...)`/`fetchTrends('platforms'|'themes', ...)`
  log and return `null`/`[]` for exactly these cases rather than fabricating
  data — same resilience pattern the spec already mandates for a failed RPC
  call, just extended to "RPC doesn't exist yet."
- **`get_volume_trend`'s granularity rule is an inference, flagged in the
  migration's own comment**: `sql-aggregation.md` cites a rule from
  `foundation/overview.md` ("≤7 dias por dia, >31 dias por semana") that a
  full-repo grep couldn't locate as literal text anywhere — the product
  header only ever offers 7/14/30-day periods (`executive-overview.md`), so
  the >31-day branch is untested by any page today. Adopted ≤31d → daily,
  32–186d → weekly, >186d → monthly; revisit if a future spec makes the
  exact rule explicit (matters once `executive-reports`, Sprint 4, needs
  longer ranges).
- **`get_dissemination_graph` returns `jsonb`, not `setof`** — the only way
  for one Postgres function to hand back both `nodes[]` and `edges[]` as a
  single RPC result matching `DisseminationGraph` directly, no reshaping
  needed on the TS side. `'mention'` edges come from `mentions.insights_mentioned`
  (confirmed real field, author handles). `'reply'`/`'retweet'` edges are
  best-effort only: `mentions.reply_to`/`retweet_of` store the **target
  post's URL**, not its author (Brandwatch doesn't expose that resolution —
  see `20260710050000_influencer_and_participation_tracking.sql`'s own
  comment on this), so an edge is only produced when that URL also matches
  another mention already in the same Narrativa's matched set, via
  `mentions.raw ->> 'url'`. ⚠️ The `url` key inside `raw` is **not confirmed
  against a real payload** in this implementation (same risk category as
  other unconfirmed `raw` field names already flagged elsewhere in this
  file) — if wrong, the function silently produces zero reply/retweet edges
  (mention edges keep working), never errors.
- **`authors[].risk_level` is always `null`** — confirmed as a real spec
  gap, not an oversight: unlike `narratives` (full "Scores de Narrativa"
  formula), no spec anywhere defines how an individual author's risk should
  be computed. `@reputation/shared-types`'s `AuthorRow.risk_level` was
  widened to `RiskLevel | null` to reflect this honestly. Tracked as gap
  #11.
- **`supabase/functions-shared-source/aggregated-metrics-service.ts`** is
  the canonical/master copy of `service-layer-aggregation.md`'s TS layer
  (`assemblePageResponse`, `PAGE_BLOCKS`, the 8 `fetchX` functions) — it is
  **never deployed**: it lives outside `supabase/functions/` on purpose
  (`supabase functions deploy` only scans that directory, and Deno code
  there would fail the Next.js `tsc` pass otherwise — both `tsconfig.json`'s
  `exclude` and the deploy tooling's scope stop at `supabase/functions/`).
  When `edge-functions-per-page.md` is implemented, each `get-page-*`
  function must **copy** this file's contents into its own directory, per
  Principle 5 — never import it relatively, same as every other Edge
  Function helper in this project. Confirms the note above: even after
  `_pending.md` decision #2 landed in favor of a shared package, the
  `packages/shared-types` workspace still can't be imported by a deployed
  Edge Function (Principle 5 blocks that regardless of packaging), so
  duplication was never really optional for the Deno side —
  `@reputation/shared-types` (frontend) and this file's inlined type
  copies (Deno) are the two canonical sources, kept in sync by hand.
- **`PAGE_BLOCKS` mirrors `block-mapping-per-page.md` exactly** (verified
  cell-by-cell against that table, including catching that `narrative_detail`
  does **not** get a `highlights` block — easy to miscopy since `overview`/
  `sentiment`/`themes` all do). `PAGE_BREAKDOWN_TYPES` is an addition beyond
  what any spec enumerates explicitly — `block-mapping-per-page.md` names
  breakdown *flavors* in prose ("sentimento/plataforma/localização da
  narrativa") but never as a structured table, so this constant is this
  session's best-faith transcription of that prose into code.
- **`effectiveFilters(ctx)`**: when `PageContext.narrativeId` is set (only
  meaningful for `narrative_detail`), every block's SQL call automatically
  scopes to `filters.narratives = [narrativeId]` — reuses the exact
  mechanism `sql-aggregation.md` already defines for `filters.narratives`
  rather than special-casing "detail page" logic per block. The future
  `get-narrative-detail` Edge Function only needs to set `narrativeId` in
  the context; no per-block branching required.

## Directory structure

```
app/                          Next.js App Router pages (auth: login,
                               forgot-password, reset-password, admin/users)
lib/supabase/{client,server}.ts   The only two files that import @supabase/ssr
types/database.types.ts       Placeholder — regenerate once linked to a real project
supabase/migrations/          One SQL file per logical schema change
supabase/functions/<name>/    One self-sufficient Edge Function per directory
supabase/seed.sql             Intentionally empty — orgs/credentials are seeded manually
.dev/specs/                   Spec-driven-dev source of truth (read before implementing)
.claude/skills/               Project-specific skills (packaged as .skill zip files)
```
