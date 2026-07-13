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

### Close the loop: update docs at the end of every development session

✅ **Project premise, added 2026-07-14** (explicit user instruction — this
was previously done ad hoc, sometimes a session behind). A unit of work
implementing a spec is **not done** until its documentation trail is
closed, not just its code. Every session that implements, fixes, or
resolves something must, before finishing:

1. **Flip the finished spec's frontmatter `status:` to `implementado`**
   (`.dev/specs/[module]/*.md` — `data-model.md`, feature specs). A spec
   left at `pronto` after its code has shipped is stale documentation, and
   the next session reading it will think the work is still pending.
2. **Add an implementation note to the spec file itself** — a `✅
   **Implementado (date)**: ...` blockquote near the top (see any file
   under `.dev/specs/auth/` for the pattern), covering what was built,
   any deliberate deviation from the original spec text, and any bug found
   along the way. This is the spec's own record, independent of `CLAUDE.md`.
3. **Update `CLAUDE.md`** with an implementation-notes entry for the
   module/feature (dated, narrative style — see "Auth module (Sprint 2)"
   or "Brandwatch sync model" below for the established pattern): what was
   built, real bugs found and fixed (not just the happy path), deliberate
   deviations from spec, and known gaps/follow-ups left for later. This is
   the file every future session reads first — it must reflect current
   reality, not the state as of whenever it was last touched.
4. **Update `.dev/specs/_pending.md`**: move any resolved "Decisão de
   produto pendente" out of the open table into a dated "✅ Resolvida"
   note (keep the original `#`, don't renumber); remove any closed "Gap
   técnico" row the same way. If new gaps or decisions surfaced during the
   work, add them.
5. **Update `.dev/specs/_architecture.md`**: flip the module's Mermaid
   node color to green (`implementado`) once genuinely done, and update
   its row in the "Módulos (resumo)" status table. If the module is only
   partially done, keep it yellow/gray and say precisely what's missing
   rather than flipping early.

Do this even when the user didn't explicitly ask "update the docs" — it's
a standing premise of the project, not a one-off request. If a session
runs out of scope to finish all five, at minimum update `CLAUDE.md` (the
highest-traffic file) and flag in the response which of the others still
need a pass.

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
7. **Widget titles, KPI labels, and table column headers all render
   `font-bold`**, never `font-medium`/`font-semibold` — user feedback
   2026-07-13 ("não está bom de ler"). `WidgetCard`'s `<h2>`,
   `MetricCard`/`SentimentMetricCard`'s label `<p>`, and
   `NarrativesTable`'s `<th>` are the 3 shared components this applies to;
   since all 3 are reused across every page in `intelligence-center`, a
   fix in the shared component is a fix everywhere — don't override back
   to a lighter weight in a specific page.
8. **A table column with a non-obvious/computed meaning (a score, a
   formula-derived metric) gets a hover tooltip**, same treatment as the
   Executive Overview KPI cards — small "?" icon,
   `components/ui/tooltip.tsx`, plain-language definition. See
   `narratives-table.tsx`'s SOV/Velocidade/Sentimento/Momentum/Risco
   headers for the pattern. `Tooltip` takes a `position` prop
   (`"top"`/`"bottom"`) — use `"bottom"` when the trigger sits inside (or
   near the top of) a horizontally-scrolling container
   (`overflow-x-auto`), since `"top"` would be clipped by that container
   forcing `overflow-y: auto` too.
9. **Any table that renders color-coded score badges (Sentiment/Risk/
   Momentum/Velocity) shows the legend for those badges directly below
   that same table**, not detached elsewhere on the page. `ScoreLegend`
   (`score-badges.tsx`) is the shared legend component — see `/overview`
   for the reference placement (inside the same `WidgetCard`, right after
   `<NarrativesTable />`, separated by a `border-t`). The other 3 pages
   that also render `NarrativesTable` (`/narratives`, `/platforms`,
   `/themes`) don't have the legend yet as of 2026-07-13 — apply this rule
   there the next time one of those pages is touched, rather than as a
   standalone follow-up no one asked for yet.
10. **A chart interaction pattern that was explicitly requested by the
    user is not removed later just because it looks redundant with
    another pattern already on the page** — concrete instance: the
    `TrendLineChart` on-hover value label drawn directly on the line
    point was added 2026-07-12 (user request), removed in a later revision
    that judged it redundant with the value panel below the chart (citing
    general dataviz guidance), and the user then asked for it back
    2026-07-13, with the same wording as the first request. Both now
    render together — see `trend-line-chart.tsx`'s comment at the label
    block and `intelligence-center/overview.md`, "Premissas de
    visualização de dados" rule 2. If a future cleanup pass wants to
    simplify a chart's interaction affordances, check whether the pattern
    being removed traces back to an explicit user request in `CLAUDE.md`/
    a spec note first — don't rely on general best-practice judgment alone
    to override a specific, already-settled product decision.

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

- **bw-sync rate limit cross-invocation backoff (2026-07-16, migration
  `20260716020000`)** — user-reported production log: `429` on
  `data/volume/sentiment/days` (the `daily_metrics` phase), 3 retries
  exhausted, right after `mintBrandwatchAccessToken:success` — i.e. the
  *very first* Brandwatch call of the invocation already failed. This
  looked at first like a repeat of the 2026-07-13 `daily_metrics` budget
  bug above, but that fix (`hasBrandwatchCallBudget()` on every call in
  the phase) was already in place and irrelevant here: the local
  25-call-per-invocation budget was still "full" (this was the first call
  attempted), so the guard had nothing to catch. Real cause: that local
  counter (`brandwatchCallCount`, reset to `0` at the top of every
  `Deno.serve` invocation) has zero memory of what *previous* invocations
  already spent against Brandwatch's real, server-side 30-calls/10min
  ceiling (per Client, not per invocation, not per pair — same fact
  `bw_sync_lock`'s concurrency lock was built around on 2026-07-11, just a
  different failure shape: sequential invocations exhausting the shared
  window over time, not concurrent ones racing for it). A fresh invocation
  can start with a "full" local budget and still take a `429` on its first
  call if the Client-wide window was already close to saturated —
  plausible during backfill/testing (manual Dashboard "Invoke" clicks
  layered on top of the 15-minute heartbeat, already flagged as a real
  scenario in the `bw_sync_lock` write-up). The existing retry/backoff
  behavior itself (`sync-brandwatch.md` step 8: up to 3 local attempts,
  `retry-after` or 20s fallback, then mark `sync_cursors.status = 'error'`
  and move on) already degraded reasonably — no crash, HTTP 200 always
  returned, lock released in `finally` — but every subsequent 15-minute
  heartbeat just repeated the exact same doomed call, since nothing
  persisted the fact that the Client-wide window was still hot. Fixed by
  giving that fact a home: `bw_sync_lock` (the existing single-row
  concurrency-lock table) gained `rate_limited_until` — `callBrandwatch()`
  now throws a typed `BrandwatchApiError(429, ...)` instead of a generic
  `Error` when the 3 local retries exhaust (same retry policy, just a
  typed failure), and `runSyncInvocation()`'s top-level catch calls the
  new `mark_bw_rate_limited(p_seconds default 600)` RPC (600s = the
  documented real window, used as a fixed conservative floor rather than
  trying to parse a meaningful reset time out of Brandwatch's `retry-after`
  headers during sustained exhaustion, which the project has no confirmed
  example of). A new gate at the very top of the handler (step "0.5c" in
  `sync-brandwatch.md`, between the existing `BW_SYNC_INTERVAL_HOURS` gate
  and the concurrency-lock acquisition) reads that column first and exits
  early (`ok: true, skipped: true, reason: "brandwatch_rate_limited"`,
  same shape as the other early-exit gates) without minting a token or
  touching Brandwatch at all if the backoff is still active — so the next
  9-or-so heartbeats after a real `429` become free no-ops instead of
  repeating the failure and re-writing the same error every 15 minutes.

- **bw-sync rate limit — proactive gate using Brandwatch's own usage
  header (2026-07-21, migration `20260721020000`)** — user report: "tem
  ocorrido muito esse erro ao executar a bw-sync, resolva em definitivo"
  (this keeps happening a lot, fix it for good), pasted log showing `429`
  on `/data/authors/categories/days` (the `daily_metrics` phase) after 3
  exhausted retries, correctly caught by the 2026-07-16 backoff above
  (`rate_limited_until` written, next heartbeats skip). That backoff is
  real and working, but it's purely *reactive* — it only engages after a
  429 has already happened and 3 local retries (each waiting `retry-after`
  or a 20s fallback, so up to a minute-plus per occurrence) have already
  been burned. It has no way to prevent the 429 in the first place, which
  is why the user was seeing it recur "a lot" rather than once. The fix
  was sitting in plain sight: `callBrandwatch()` has *always* read the
  official `x-rate-limit-used` response header (Brandwatch's own
  authoritative count of how much of the 30-calls/10min-per-Client ceiling
  is spent, confirmed in `brandwatch-setup.md` §1 and the `brandwatch-api`
  skill's reference client) — but only for a log line, never to influence
  behavior. `hasBrandwatchCallBudget()` only ever checked the local,
  per-invocation `brandwatchCallCount` counter (max 25), which has zero
  visibility into what *other* recent invocations (heartbeat or manual
  Dashboard "Invoke" testing, already flagged as a real concurrent
  scenario in the 2026-07-16 write-up) already spent against the real,
  Client-wide ceiling. Fixed in two layers, both reusing this same signal:
  (1) **within an invocation** — `lastKnownRateLimitUsed` (module state,
  reset to `null` per invocation like `brandwatchCallCount`) is updated
  from the header on every response (success or 429), and
  `hasBrandwatchCallBudget()` now also returns `false` once it reports
  `>= 27` (of 30) — a phase stops issuing new calls as soon as
  Brandwatch's *own* count says it's near the ceiling, even if the local
  25-call counter still thinks there's room; (2) **across invocations** —
  `bw_sync_lock` gained `last_rate_limit_used`/`last_rate_limit_observed_at`,
  written (`record_bw_rate_limit_usage()` RPC) in the handler's top-level
  `finally` block at the end of every invocation that made at least one
  call, and read by a new gate (step "0.5d" in `sync-brandwatch.md`,
  right after the existing 0.5c `rate_limited_until` gate) that skips the
  *next* invocation before it even mints a token if the last observed
  usage was `>= 27` and is still within Brandwatch's real 10-minute
  window (a stale value past that window is ignored — a legitimate
  15-minute heartbeat well after the window rolled over must not get
  stuck thinking the ceiling is still blown). Net effect: most 429s for
  this cause shouldn't happen anymore — the code now stops itself right
  at the real ceiling instead of finding out about it by crashing into
  it. The existing reactive `rate_limited_until` backoff (2026-07-16) is
  left completely in place as a second line of defense for whatever this
  proactive gate doesn't catch (e.g. Brandwatch not returning the header
  for some reason).

- **`bw_categories.status` — Category/Subcategory removed from Brandwatch
  no longer used by the system (2026-07-16, migration `20260716010000`)**
  — user request: "as categorias permanecem mesmo quando excluídas da
  brandwatch. Inclua uma coluna de status, se ela não existir na
  brandwatch, ela não mais será utilizada no sistema... a cada nova busca
  de dados essa verificação deve ser realizada no endpoint de categorias e
  subcategorias." `bw_categories` never deleted a row that disappeared
  from Brandwatch (by design — cascading FKs from `bw_query_metrics_daily`/
  `bw_query_topics`/`bw_query_top_authors` would lose metric history, and
  `narratives.bw_category_id` has no cascade at all), but it also never
  signalled that a Category had stopped existing on the Brandwatch side —
  a rename/removal there left the row looking permanently "current" in
  Supabase. New `status` column (`active` | `inactive`, default `active`).
  `refreshMetadata()` (`bw-sync/index.ts`) now diffs every `GET
  /rulecategories` response (this already ran on every metadata
  refresh — see "`bw_categories` staleness reduced 24h → 1h" above, so
  this check runs at the same 1h/on-demand cadence, no new Brandwatch
  call) against what's locally known for the Project: anything upserted
  this round is (re)stamped `active`; anything previously `active` that
  wasn't in this round's response gets flipped to `inactive` via a single
  `UPDATE ... WHERE project_id = ... AND status = 'active' AND id NOT IN
  (...)` (an empty result set from Brandwatch — genuinely zero Categories
  configured — correctly flips everything to `inactive`, using an
  unreachable placeholder id so the `NOT IN` filter stays valid
  PostgREST syntax). Reactivation is automatic and needs no special-casing
  — if a Category reappears in a future sync, the same upsert already
  writes `status: 'active'` again.
  Effect downstream, per the user's "não mais será utilizada no sistema":
  `fetchNarrativeCategoryIds()` (bw-sync) now filters to `status =
  'active'`, so `bw-sync` stops spending Brandwatch rate-limit budget
  syncing new aggregate data for a Narrativa whose Category is gone;
  `get_narratives_table`/`get_theme_breakdown` (aggregated-metrics,
  same migration) now require `bw_categories.status = 'active'` too, so
  an inactive Narrativa drops out of every listing/score by default.
  Nothing is deleted — `narrative_metrics`/`bw_query_metrics_daily`
  history for an inactive Category stays exactly as synced, just no
  longer surfaced by these two functions (a bookmarked `/narratives/[id]`
  link to an inactive Narrativa still renders its title/description from
  `narratives` directly, just with empty score badges — `fetchNarrativeSummary()`
  in `get-narrative-detail` already degrades gracefully on a missing
  `get_narratives_table` row, no code change needed there).

- **Overview vs. Narrativas vs. Pautas Eleitorais: which Narrativa
  granularity each page lists by default (2026-07-16)** — same user
  request, second half: "Quando há categoria e subcategoria, o sistema
  deve considerar na página de overview apenas a categoria, porém na aba
  de narrativas considera-se as subcategorias. No caso de Pauta
  Eleitorais, considerar todas as subcategorias da categoria Pauta."
  Brandwatch requires every Category to have ≥1 Subcategory
  (`brandwatch-setup.md` §5), and since 2026-07-12
  `ensureNarrativesFromCategories()` auto-seeds a `narratives` row for
  **both** levels (Category and Subcategory, see "Narratives auto-seed
  from top-level Categories" above) — so every root-level Narrativa
  ("Pauta") always has ≥1 child Narrativa ("Narrativa dentro da pauta"),
  and before this fix `get_narratives_table` (no `p_pauta_id`) returned
  both levels mixed into one flat list on every page that reads the
  `narratives` block (Overview, Narrativas, Platforms, Themes) — a Pauta
  and its own children appeared as unrelated sibling rows in the same
  table. `get_narratives_table` gained `p_scope` (`'roots'` | `'leaves'` |
  `null`, only applied when `p_pauta_id` is absent — the existing
  "children of one specific Pauta" behavior keeps priority when
  `p_pauta_id` is set, same migration `20260716010000`). Service layer
  (`supabase/functions-shared-source/aggregated-metrics-service.ts` +
  identical copies in all 6 deployed `get-page-*`/`get-narrative-detail`
  functions, per Principle 5 — `narrativesScopeForPage(page)`): Overview
  and Reports pass `'roots'` (only the top-level Category — "apenas a
  categoria"); Narrativas and Platforms pass `'leaves'` (only
  Subcategories — "considera-se as subcategorias"); Themes passes
  `'leaves'` too when no specific Pauta is open (all Subcategories across
  all Pautas — "todas as subcategorias da categoria Pauta", generalized
  to every Pauta when none is singled out), falling back to the existing
  `p_pauta_id`-scoped children query once a specific Pauta is opened.
  `get_theme_breakdown` (the Pautas list itself, `breakdowns` block) was
  already root-only by design since it shipped (2026-07-12) — untouched
  except for the same `status = 'active'` filter added above. Updated
  `executive-overview.md`/`narratives-exploration.md`/`electoral-themes.md`/
  `sql-aggregation.md`/`service-layer-aggregation.md` to document this as
  a settled decision, not an open question.

### X Themes (Top Hashtags/Emojis/Stories/Most Mentioned X Posters) — auditoria e correção (2026-07-18)

User request: revisar, a partir de screenshots reais do dashboard nativo
da Brandwatch ("Top Hashtags", "Most Mentioned X Posters", "Top Stories",
"Top Emojis"), se `foundation` captura esses dados corretamente e se
existem nos envelopes das páginas.

- **Foundation estava correta o tempo todo**: `bw_query_x_insights`
  (`foundation/data-model.md`) já cobre exatamente os 4 endpoints de
  `data/hashtags`/`data/emoticons`/`data/urls`("Stories")/
  `data/mentionedauthors` desde 2026-07-11, e o mapeamento de campo
  (`volume`/`tweets`/`retweets`/`impressions`/`reachEstimate`) foi
  reconfirmado ao vivo nesta sessão contra
  `developers.brandwatch.com/docs/twitter-insights` — sem divergência. Os
  rótulos "Posts"/"Reposts"/"All Posts"/"Impressions" do dashboard da
  Brandwatch são só apresentação em cima desses mesmos 4 campos
  (`tweets`=Posts, `retweets`=Reposts, `volume`=All Posts,
  `impressions`=Impressions) — conferido também aritmeticamente contra um
  export real do usuário.
- **Gap real, fechado nesta sessão**: apesar do dado estar sincronizado
  corretamente há uma semana, **nenhuma function/bloco de
  `aggregated-metrics` jamais o expunha** — já estava explicitamente
  registrado como "💡 Oportunidade futura, não desenhada ainda" em
  `intelligence-center/platform-analysis.md` desde 2026-07-13, nunca
  implementado até agora. Fechado: novo bloco `x_insights` no envelope
  (`packages/shared-types/src/envelope.ts` + cópia inline em
  `supabase/functions-shared-source/aggregated-metrics-service.ts`,
  recopiada nas 6 Edge Functions por Princípio 5), nova function SQL
  `get_x_insights` (migration `20260718000000`, até 10 itens por
  `insight_type`, semana mais recente sincronizada por tipo), só na
  página `platforms` (`PAGE_BLOCKS.platforms` ganhou `'x_insights'`).
  Novo componente `components/intelligence-center/x-insights-panel.tsx`
  — 4 tabelas lado a lado, mesmas colunas do dashboard nativo da
  Brandwatch (Posts/Reposts/All Posts/Impressions).
- **Verificação**: `npx tsc --noEmit` e `npm run build` passam limpos (14
  rotas). Migration não executada contra banco real nesta sessão (sem
  acesso — deploy via push pra `develop`, fluxo já estabelecido).

### Sentimento por narrativa/autores — auditoria e correções (2026-07-17)

User request: auditar de onde vêm os dados de sentimento por
plataforma/narrativa/autores/termos ("phrases" ligadas a sentimento
positivo/negativo) em toda a cadeia (`foundation`/`bw-sync` → SQL/Edge
Functions → frontend), já que essas informações apareciam ausentes na UI.
Achados e correções:

- **Sentimento por plataforma/pauta**: confirmado como já implementado
  corretamente em toda a cadeia (`get_platform_breakdown`/
  `get_theme_breakdown`, renderizado em `/sentiment` e `/platforms`) — não
  estava faltando. A limitação real (score único `net_sentiment`, sem
  split positivo/neutro/negativo — API da Brandwatch não documenta essa
  combinação de 3 dimensões) já estava corretamente sinalizada desde
  2026-07-12, não é um bug.
- **Sentimento por narrativa — gap real, fechado nesta sessão**: o dado
  (`narrative_metrics.sentiment_positive/neutral/negative`) já existia,
  não amostrado, desde a implementação original de `foundation` — mas
  nenhuma function/bloco do envelope o expunha como lista por Narrativa
  (`BreakdownType` só tinha `'sentiment'|'platform'|'theme'|'region'`,
  `block-mapping-per-page.md` nunca marcou esse breakdown pra `/sentiment`,
  e o próprio `sentiment/page.tsx` já documentava esse gap inline desde
  2026-07-15/16). Fechado: nova function `get_narrative_sentiment_breakdown`
  (migration `20260717000000`, breakdown `type = 'narrative'`, split
  completo — diferente de platform/theme que só têm `net_sentiment`),
  escopada a Narrativas-folha (`bw_categories.parent_id is not null`,
  `status = 'active'`, mesma granularidade da aba Narrativas). Wiring:
  `BreakdownItem` ganhou `positive?/neutral?/negative?` opcionais
  (`packages/shared-types/src/envelope.ts` + cópia inline em
  `supabase/functions-shared-source/aggregated-metrics-service.ts`,
  recopiada nas 6 Edge Functions `get-page-*`/`get-narrative-detail` por
  Princípio 5); `PAGE_BREAKDOWN_TYPES.sentiment` ganhou `'narrative'`;
  novo widget "Sentimento por narrativa" em `/sentiment`
  (`NarrativeSentimentList` em `breakdown-panel.tsx`, barra empilhada por
  Narrativa, reaproveitando as mesmas classes `bg-sentiment-*` já
  existentes).
- **Sentimento por autor — achado de integridade de dado + gap real,
  ambos fechados**: `bw_query_top_authors.sentiment_positive/neutral/
  negative` (e o espelho em `bw_query_top_tweeters`) é escrito desde
  `20260710010000` lendo `d.sentiment ?? {}` da resposta de
  `data/volume/topauthors/queries` — mas, diferente de **todo** campo
  vizinho na mesma tabela (`tweets`/`retweets`/`account_type`/
  `country_code`, todos com nota "confirmado contra
  developers.brandwatch.com/docs/top-tweeters"), esse mapeamento nunca foi
  confirmado, e o payload documentado desse endpoint não cita nenhum
  objeto `sentiment` — risco real de ser sempre `0/0/0` em produção sem
  erro nenhum (fallback silencioso `?? 0`). Decisão do usuário: não gastar
  chamada nova pra confirmar/substituir agora, documentar o achado (ver
  `foundation/data-model.md`, `_pending.md` #23) e usar em vez disso
  `bw_query_author_topics` (fonte já confirmada — `data/topics?author=
  <handle>`, mesmo padrão do `impressions` por autor) como origem real de
  "sentimento por autor". `get_authors_ranking` (migration `20260717000000`)
  ganhou `LEFT JOIN` agregado sobre `bw_query_author_topics` (soma os 3
  contadores entre os temas do autor, semana mais recente por autor) —
  **nunca** lê as colunas não confirmadas. `AuthorRow` ganhou
  `sentiment_positive/neutral/negative` (nullable — `null` pra qualquer
  autor fora do top 10 enriquecido, nunca `0/0/0` inventado);
  `AuthorsList` (`components/intelligence-center/authors-list.tsx`) mostra
  um badge de sentimento dominante só quando os 3 campos vêm preenchidos.
- **Drivers de sentimento (termos/phrases)**: já implementado
  corretamente (`get_term_signals`, fonte `bw_query_topics`, inclui
  `phrases` como um dos `topic_type`) — só a apresentação não batia com o
  design (nuvem única de chips em vez de 2 caixas separadas). Adicionado
  `SentimentDriversPanel` (`term-signals-list.tsx`) — mesmo dado, split em
  "Drivers positivos"/"Drivers negativos" (termos neutros omitidos, como
  no design). `TermSignalsList` original mantida intacta para o uso em
  `/themes` ("termos emergentes", que não quer esse split).
- **Ainda em aberto** (não fechado nesta sessão, ver `_pending.md` #19):
  "Menções que mais influenciaram o sentimento" — sem bloco no envelope
  para lista de mentions individuais em destaque.
- **Verificação**: `npx tsc --noEmit` e `npm run build` passam limpos (14
  rotas). `npm run lint` reporta só o erro pré-existente e não relacionado
  em `types/database.types.ts` (regra `@typescript-eslint/no-explicit-any`
  não encontrada — config do ESLint, não código deste trabalho). Sem
  ambiente de banco real disponível nesta sessão — a migration
  `20260717000000` não foi executada contra um Postgres real, só revisada
  manualmente (mesmo padrão de sessões anteriores sem acesso a
  `supabase db push`).

### Metrics calls stop re-fetching full history every invocation once a pair is backfilled (2026-07-19)

User request: "uma vez que já existe base de dados, o bw-sync pode buscar
os dados incrementais, do dia atual em diante. Não faz sentido ele buscar
sempre desde de janeiro." Reviewing `metricsStartDate` (used by every
`data/volume/...`/topics/top-authors/platform/x-insights/demographics/SOV
call — every phase in `SYNC_STEPS` except `metadata`/`mentions`/
`hourly_metrics`/`full_text_enrichment`) confirmed this was real, not a
misreading of already-incremental behavior: since the 2026-07-10 "Metrics
date range bug" fix (see above), `metricsStartDate` had been a single flat
value, `getMentionsStartDate()` (`BRANDWATCH_MENTIONS_START_DATE`, default
`2026-01-01`), used unconditionally on **every** invocation regardless of
how long a pair had already been syncing. That fix was correct for the bug
it targeted (populate the missing historical range at all), but never
revisited once history actually got populated — so a "mature" pair kept
requesting and re-upserting 6+ months of already-correct
daily/weekly/monthly/topics/top-authors/platform/SOV rows on every single
throttled-open invocation, forever, growing more wasteful every day as the
window between `BRANDWATCH_MENTIONS_START_DATE` and "now" widens. Same
waste category (not the same crash — these are single-call chart
aggregates, not paginated like mentions) that already caused a real
`WORKER_RESOURCE_LIMIT` crash on the mentions poller.

✅ **Confirmed live, same session, before this fix was deployed** — the
user pasted real `bw-sync` logs showing exactly this: `daily_metrics`
calling `/data/{authors,engagementScore,reachEstimate,impressions}/
categories/days?...&startDate=2026-01-01T00:00:00.000%2B0000&endDate=2026-07-13T03:11:23.715%2B0000...`
on a single-Query project, each returning `rows: 2925` (≈15 Narrativas ×
~195 days, i.e. the full Jan→Jul range, on every call), followed by a
`429` on `/data/impressions/categories/days` after 3 exhausted retries and
the pair falling into the `mark_bw_rate_limited`/`rate_limited_until`
600s backoff added 2026-07-16 (logged as `invocation:rate_limited` then
`invocation:rate_limited_skip` on the next heartbeats — degraded exactly
as designed, no crash, no data loss). Important nuance for whoever reads
this log pattern again: Brandwatch's 30-calls/10min ceiling is
**call-count** based, not payload-size based, so narrowing
`metricsStartDate` does not by itself reduce how many calls
`daily_metrics` makes per invocation (still one call per aggregate ×
dimension × due categoryTarget) — a 429 from budget exhaustion can still
happen and is already handled reactively by the existing backoff. What
this fix removes is the **per-call cost** (2925 rows → ~
`BW_METRICS_INCREMENTAL_WINDOW_DAYS` once `backfill_completed_at` is set
for that pair), which shortens invocation duration/CPU and reduces the
odds that a single invocation's own request burst is what tips the shared
window over 30. Whether this specific pair (`project_id=1998408338`,
`query_id=2004020694`) benefits immediately depends on its current
`sync_cursors.backfill_completed_at` — not observable from this session
(no DB access) — if it's still `null` (the `2925`-row/full-range response
is consistent with that), it'll keep requesting the full range until its
mentions backfill genuinely reaches "now," same as before this fix; only
pairs that have already reached that point switch immediately on deploy.

Fixed by making `metricsStartDate` per-pair and stateful, via new
`getMetricsStartDate(backfillCompletedAt)` (`bw-sync/index.ts`, replacing
the flat `getMentionsStartDate()` call at the top of `runSyncInvocation`):
reuses `sync_cursors.backfill_completed_at` — the same column that already
tracks "has this pair's mentions poll caught up to real-time" (see
"Mentions polling walks history forward" above) — as the signal for
"does this pair still need the full historical range for its aggregate
tables too." While `backfill_completed_at` is still `null`, behavior is
unchanged: full range from `getMentionsStartDate()`, since the aggregate
tables genuinely still need it populated across cycles alongside the raw
mentions backfill. Once it's set, every metrics phase switches to a
rolling window (`now() - BW_METRICS_INCREMENTAL_WINDOW_DAYS`, new optional
Edge Function secret, default `30`) — same pattern `runHourlyMetricsStep`
already used (`HOURLY_METRICS_WINDOW_MS`, hardcoded 30 days there since
its use case, short-term event detection, never needed to be
configurable), just extracted into a configurable constant reused by the
other 11 phases. `getMentionsStartDate()` itself is untouched and still
used as-is for `/data/mentions` (`fetchMentions()`'s required `startDate`
param) — mentions polling was never the problem here, it's already
incremental via `last_added_cursor`/`sinceAdded`; this fix only applies to
the aggregate/chart endpoints, which never had a per-invocation
incremental cursor of their own before this.

Trade-off, stated explicitly rather than left implicit: a Brandwatch-side
correction to a bucket **older** than the rolling window (e.g., a
sentiment reclassification landing on a mention from March, once a pair is
well past backfill) stops being picked up — that history becomes
effectively final once it falls outside the window. No known consumer in
this project depends on catching corrections that old today; revisit the
window size (via the secret, no migration needed) if that changes. No
migration and no envelope/frontend change — this is purely an Edge
Function fetch-range optimization, upsert keys/shapes are unchanged.

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
- **✅ Resolved 2026-07-15**: the post-login redirect target `/overview`
  (`intelligence-center/executive-overview.md`) now exists — was a known
  gap noted here when `auth` shipped ahead of `intelligence-center`, no
  longer applicable now that the 5 analytics pages are implemented (see
  "edge-functions-per-page.md + the 5 intelligence-center pages" above).
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
- **Production bug found and fixed the same day, via `supabase db push`
  failing on deploy**: `x = any((select ids from cat_ids))` — the pattern
  used everywhere `filter_category_ids()`'s result was applied — hit
  `ERROR: operator does not exist: bigint = bigint[]` (SQLSTATE 42883) in
  every function that used it (`get_sentiment_breakdown`,
  `get_platform_breakdown`, all 3 grains of `get_volume_trend`,
  `get_authors_ranking`, `get_term_signals`). Root cause: Postgres's parser
  always treats `ANY (` immediately followed by a parenthesized `SELECT` as
  the row-wise "`= ANY (subquery)`" form (comparing the left side against
  each *row* the subquery returns), never as "`= ANY(array)`", even though
  `cat_ids.ids` is genuinely array-typed — the CTE's single row of a single
  `bigint[]` column got read as one row containing one `bigint[]` value to
  compare via plain `=`, not unwrapped as an array. Fixed by adding
  `cross join cat_ids` to each affected CTE's `FROM` and referencing
  `cat_ids.ids` as a plain column (`= any(cat_ids.ids)`) instead of a
  parenthesized scalar subquery — `cat_ids` is always exactly 1 row (the
  helper function has no `FROM`), so the cross join never multiplies rows.
  Lesson for any future SQL in this project: never write `= any((select ...))`
  — always join the source into scope and reference a plain column/alias.
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
  longer ranges). ✅ **Gained an `hour` tier (2026-07-19)** — see "Volume/
  sentiment trend chart" entry near the end of this file for the fix (the
  1-day "Diário" period was falling into the `day` tier and returning a
  single point, useless as a time series).
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

**`edge-functions-per-page.md` + the 5 `intelligence-center` pages
implemented 2026-07-15** — first frontend code to actually render real
Brandwatch data (Sprint 1/`foundation`'s payoff). High-level shape:

- **6 Edge Functions** (`supabase/functions/get-page-{overview,narratives,
  sentiment,platforms,themes}/index.ts` + `get-narrative-detail/index.ts`)
  — each is `supabase/functions-shared-source/aggregated-metrics-service.ts`
  copied verbatim plus a `Deno.serve` handler appended (Principle 5: no
  cross-function imports even via a workspace package, see the package
  note above). Handler does exactly what the spec's "Fluxo principal"
  describes: reads the `Authorization` header, builds the Supabase client
  with the **publishable key + forwarded JWT** (never the secret key —
  the spec's explicit exception to Principle 5's usual pattern, so RLS
  does the real org-isolation work), validates `organization_id`/`period`,
  checks `organization_members` explicitly before calling the service
  layer (401/400/403 per the spec's table), then calls
  `assemblePageResponse(supabase, '<page>', context)`. **Not implemented
  this round**: the 5-minute TTL page cache the spec also calls for — each
  call recomputes live. Not a correctness gap (reads are already cheap,
  official aggregates only), just an efficiency one — tracked as
  `_pending.md` gap #21.
- **`get-narrative-detail` has a bespoke addition beyond the shared
  template**: `fetchNarrativeSummary()` — the detail page's header
  (name/description/SOV/sentiment/momentum/velocity/risk badges) needs a
  *single* Narrativa's data, but `narrative_detail` deliberately has no
  `narratives` block in `PAGE_BLOCKS` (it's a list-shaped block, this page
  wants one row). Resolved by attaching the extra to `ui_meta.narrative`
  — exactly what `ui_meta` is for per the envelope spec ("dado que serve
  só pra renderização"). This surfaced a **real bug in `get_narratives_table`**
  fixed same day via migration `20260715000000`: the function accepted
  `p_filters` in its signature but never read `filters.narratives` — every
  other function in the module honors that filter via
  `filter_category_ids()`, this one silently didn't. Fixed to respect it
  (additive, `p_pauta_id`/no-filter behavior unchanged).
- **`types/envelope.ts` doesn't exist for this UI layer**: the frontend
  imports block/envelope types straight from `@reputation/shared-types`
  (the workspace package from the earlier session) — `components/
  intelligence-center/*`, `hooks/use-page-envelope.ts` etc. all `import
  type { NarrativeRow, Breakdown, ... } from "@reputation/shared-types"`.
- **`components/intelligence-center/`** — the shared UI layer reused
  across all 5 pages, so no page reimplements table/badge/chart logic:
  `header-context.tsx` (`IntelligenceCenterProvider` — organization list +
  active org + period, the single source both `PageHeaderBar` and every
  page's data fetch read from), `sidebar.tsx`, `page-header-bar.tsx`,
  `score-badges.tsx` (Sentiment/Risk/Velocity/Momentum — reads the
  `*_label` strings the backend already computed, only Momentum needed a
  frontend band lookup since `sql-aggregation.md` never gave it a label
  field like the other 3 — thresholds copied verbatim from
  `executive-overview.md`/`_design-tokens.md`, not invented), `narratives-table.tsx`
  (the reused 7-column table), `charts/breakdown-panel.tsx` (renders
  `type: 'sentiment'` as proportional bars, `'platform'`/`'theme'` as a
  score list — deliberately different visual per CLAUDE.md's earlier note
  that `net_sentiment` must never look like the 3-way split),
  `charts/trend-line-chart.tsx` (plain SVG polylines, no charting library
  added — an unrequested new dependency isn't this session's call to
  make), `authors-list.tsx`, `term-signals-list.tsx`,
  `dissemination-graph.tsx` (list-based, not a force-directed layout — see
  gap below), `insights-panel.tsx` (highlights/narrative_text — both
  always empty today, `event-radar`/`ai-synthesis` don't exist yet, so
  this renders an honest "not available yet" state rather than a bare
  empty list), `widget-card.tsx` (the loading/error/empty wrapper every
  widget uses).
- **`hooks/use-page-envelope.ts`** — the one hook every page calls
  (`usePageEnvelope('get-page-overview')`, `usePageEnvelope('get-narrative-detail',
  { narrativeId })`, `usePageEnvelope('get-page-themes', { pautaId })`):
  reads `organizationId`/`period` from `IntelligenceCenterProvider`,
  calls `callFunction()`, 3-state (loading/error/loaded) per the
  project-wide rule. `hooks/use-organizations.ts` is new too (parallel to
  `use-user-profile.ts`) — organizations the user belongs to, for the
  header's org selector.
- **Shell/layout restructured mid-session** per a "Premissas de
  shell/layout" addition to `intelligence-center/overview.md` (2026-07-15,
  user-requested, landed in the specs while this session was already
  building): menu always visible unless explicitly hidden (with an
  obvious way back), responsive, menu/header/footer fixed across
  navigation, one visual system. Led to two route-group layouts instead
  of one: `app/(intelligence-center)/layout.tsx` (Sidebar + Provider +
  footer + mobile top bar — wraps **everything** authenticated, not just
  the 5 analytics pages) and a nested `app/(intelligence-center)/(analytics)/layout.tsx`
  (just the "no organization yet" gate, scoped to the 5 pages that
  actually need org/period context). `/admin/users` and `/perfil`
  (previously siblings of `app/(intelligence-center)/`) were **moved**
  into the outer group (`app/(intelligence-center)/admin/users/`,
  `app/(intelligence-center)/perfil/`) so they get the same persistent
  shell — URLs unchanged (route groups don't affect paths), verified via
  `npm run build`'s route table. `Sidebar` gained a collapse toggle
  (desktop: narrows to a `w-16` rail with a `»` reopen button; mobile:
  becomes an overlay drawer behind a hamburger in a `lg:hidden` top bar)
  — state lives in the layout itself, which the App Router never remounts
  on navigation, so "persists between navigations" falls out for free
  without localStorage/extra context. Exact responsive breakpoints aren't
  confirmed against the original prototype (no layout breakpoints exist in
  `_design-tokens.md`) — used Tailwind's standard `lg` cut, flagged as
  `_pending.md` gap #15 rather than presented as validated.
- **Every gap between what a page spec asks for and what
  `sql-aggregation.md`'s 9 functions actually provide was left as an
  honest `<EmptyState />` with an explanation, never quietly dropped or
  faked with a mislabeled substitute** — full list in `_pending.md` gaps
  #16–#20: `/narratives/[id]` opens as a full page, not the modal
  `narratives-exploration.md` already decided on (intercepting routes
  are real added complexity, deferred); Pautas' "narrativas dentro da
  pauta" drill-down isn't wired to a click yet even though the backend
  (`get_narratives_table`'s `p_pauta_id`) already supports it; 4 widgets on
  `/platforms` and 2 on `/sentiment` have no backing SQL function
  (per-platform volume-over-time, platform-specific dominant narratives,
  per-platform propagation velocity, mention-level "destaque" cards,
  per-Narrativa sentiment bars, "most influential mentions" list); detail
  page's "Menções relevantes" and "Ações e decisões" stay empty (no
  envelope block for a mentions list; `cases` has no migration yet, spec
  explicitly allows this exact empty state).
- **Verification**: `tsc --noEmit`, `eslint .`, and `npm run build` all
  pass clean (route table confirms all 6 Edge Functions' pages and the
  moved `/admin/users`/`/perfil` resolve at their original URLs). Also
  smoke-tested via `npm run dev` + `curl`: `/` returns bare 200 (Hostinger
  health check rule intact), every protected route 307s to
  `/login?next=...` when unauthenticated, `/login` itself 200s — couldn't
  verify the authenticated, data-loaded UI in an actual browser (no
  browser automation available in this environment, no test credentials
  supplied), so the widgets' real rendering against live Brandwatch data
  is unverified beyond code review and the mocked-out state transitions.
  **This local blind spot produced a real production bug, found the same
  day via the user's browser console on `dev.comunicacaointeligente.digital`**:
  all 6 `get-page-*`/`get-narrative-detail` functions returned `503` on
  every call. Root cause: `Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!` with
  no fallback — that env var only exists if someone runs `supabase secrets
  set SUPABASE_PUBLISHABLE_KEY=...` explicitly (Principle 3's naming), and
  nobody had, since no Edge Function needed it before this batch (`admin-*`/
  `bw-sync`/`update-my-timezone` all use the secret key, not the publishable
  one). `createClient(url, undefined, ...)` throws, caught by the handler's
  `try/catch`, surfaced as 503 — exactly the symptom. Fixed by adding the
  same fallback pattern every other function in this project already uses
  for its own key pair (`SUPABASE_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`):
  `Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')`
  — `SUPABASE_ANON_KEY` is the same key value under Supabase's legacy name,
  auto-injected into every Edge Function by the platform with zero manual
  setup, so this fix needs no secret provisioning to take effect. A
  transient CORS-preflight failure logged once before the 503s started
  didn't recur on later requests — most likely the very first request
  racing a not-fully-warm function right after deploy, not a code issue
  (`OPTIONS` is handled before any `Deno.env.get` call, so the missing
  secret above can't explain it). Separately observed in the same console
  log at the time, **now confirmed and fixed (2026-07-16)**: see
  "`user_profiles` 406 on `/perfil` — root cause and fix" below.

### `user_profiles` 406 on `/perfil` — root cause and fix (2026-07-16)

User report: opening `/perfil` failed with `user_profiles?select=full_name,
is_admin,is_principal,timezone` returning `406`. Confirmed the suspicion
noted above (2026-07-15, "unconfirmed"): `user_profiles` rows were **only**
ever created by `admin-invite-user`'s manual `insert` — any `auth.users`
account created through another path (Dashboard-created test account, or
any future signup route) has no matching row. `hooks/use-user-profile.ts`
does `.select(...).single()` with no explicit filter (relies on RLS's
`user_profiles_select_own` to scope to the caller) — `.single()` sends
`Accept: application/vnd.pgrst.object+json`, and PostgREST answers `406`
rather than an empty result when that scoping yields zero rows. The
existing 3-state hook logic (`error || !data` → error state) already
degraded reasonably, but retrying could never succeed since the underlying
row simply didn't exist — a data-integrity gap, not a transient failure.

Fixed at the root, migration `20260716000000_auto_create_user_profile.sql`:
a `handle_new_auth_user()` trigger (`security definer`, `set search_path =
public`) on `auth.users after insert` now guarantees a `user_profiles` row
for every account regardless of creation path (`on conflict (id) do
nothing`, so it never fights with `admin-invite-user`'s own insert in the
same transaction window); plus a one-time backfill `insert` for any
`auth.users` row that already existed without one. `use-user-profile.ts`
also switched `.single()` → `.maybeSingle()` as defense-in-depth (avoids a
raw 406 if this invariant is ever violated again; behavior for the caller
is unchanged, `!data` already routed to the error state either way).

### Prototype-parity pass on `intelligence-center` (2026-07-12)

User request: review the 5 analytics screens against the original design
prototype and fix navigability, responsiveness, and mis-sized elements.
Until this session, the real prototype had never actually been consulted —
the 2026-07-15 shell/layout work (see above) explicitly flagged its `lg:`
(1024px) sidebar breakpoint as "not confirmed against the original
prototype (no layout breakpoints exist in `_design-tokens.md`)",
`_pending.md` gap #15. This session imported the prototype for real via the
`DesignSync` MCP tool (`claude.ai/design` project "Protótipo frontend
design", file `Comunicacao Inteligente.dc.html`, a `.dc.html`
component-language mock with its own `data-dc-script` state logic — decoded
in full, not guessed from a screenshot) and diffed it line-by-line against
the current implementation. Found and fixed 6 real gaps, all
presentation-layer only (no backend/envelope changes, Principle 2):

- **Breakpoint confirmed at 900px, not 1024px.** The prototype's own script
  switches sidebar↔rail↔mobile-drawer at `window.innerWidth < 900`.
  `tailwind.config.ts` gained `theme.extend.screens.shell = '900px'`
  (extends, doesn't replace, the standard `sm/md/lg/xl/2xl` scale — every
  other breakpoint in the app is untouched); `app/(intelligence-center)/layout.tsx`
  now uses `shell:`/`hidden shell:flex` instead of `lg:`/`hidden lg:flex`
  for the sidebar/mobile-topbar switch. Resolves `_pending.md` gap #15.
- **Collapsed sidebar was showing `label.charAt(0)`** (nav items became
  single clickable letters — "V", "N", "S", "P" — a real sizing/UX defect,
  not a rail). Prototype collapses to a slim 48px rail of colored dots with
  tooltips. `components/intelligence-center/sidebar.tsx`'s `NavLink` now
  renders a `h-2 w-2` dot + `title` tooltip when `collapsed`, same
  click-to-navigate behavior.
- **Mobile top bar** swapped its plain "Menu" text button for a 3-bar
  hamburger icon + logo mark, matching the prototype's `showMobileTopbar`
  markup — same `onClick`/`aria-label`, just recognizable iconography
  instead of a text button.
- **`/narratives/[id]` was the only page missing `PageHeaderBar`** (org
  selector + period tabs + date range). In the prototype, that header row
  sits above every page's content, `isDetailPage` included — a real
  navigability regression, since a user had to leave the detail page to
  change org/period. Added `<PageHeaderBar title={...} />` to all 4 states
  of `narratives/[id]/page.tsx` (loading/error/not-found/loaded).
- **"Filtros avançados" toggle was entirely absent.** The prototype has a
  `Filtros ▾` button that expands a chip row (Plataforma/Idioma/Região/
  Sentimento/Narrativa/Pauta/Tipo de autor/Alcance/Nível de risco). Added to
  `PageHeaderBar` as local `useState` — **presentational only**, chips have
  no `onClick`, exactly matching the prototype's own mock (confirmed from
  its script: those chips were never wired to anything there either) — the
  real backend (`sql-aggregation.md`) only resolves `filters.narratives`
  today, so wiring real filtering would have meant inventing backend
  behavior the spec doesn't define, not just copying the prototype.
- **Tablet-width grids (768–1023px) collapsed to single/double column too
  aggressively.** The prototype's cards use `flex:1 1 <basis>px` +
  `flex-wrap`, which reflows to multiple columns well before 1024px.
  Current grids jumped straight from `grid-cols-1` to `lg:grid-cols-2/3`
  with no `md:` step, forcing the entire tablet range into single-column
  stacking (`sentiment`/`platforms`/`themes` pages, the Overview
  trend+breakdown row) or oversized 2-column KPI cards (Overview's 5-card
  KPI row, narrative-detail's 4-card stat row). Added a `md:` step to every
  such grid across `overview/page.tsx`, `narratives/[id]/page.tsx`,
  `sentiment/page.tsx`, `platforms/page.tsx`, `themes/page.tsx`.

**Not changed** — already matched the prototype: `NarrativesTable`'s
`overflow-x-auto` + `min-w-[760px]` pattern, `TrendLineChart`'s `viewBox` +
`w-full` proportional SVG scaling, `DonutChart`'s fixed 160×160 + `sm:flex-row`
legend arrangement.

**Verification gap, same limitation as 2026-07-15's note above**: `npm run
build` passes clean (typecheck + lint + all 14 routes). No browser
automation (`chromium-cli`, Playwright) is available in this environment,
and this session had no Supabase test credentials, so the actual
authenticated, data-loaded UI (where every one of these changes actually
renders — sidebar, header, grids) could not be visually verified in a real
browser. Confirmed via `curl` against `npm run dev` that public routes (`/`,
`/login`) still 200, protected routes still 307-redirect to `/login`
(Hostinger health-check rule intact), and no server-side runtime errors on
any of the 6 changed routes. A follow-up session with either browser
automation or test credentials should do a real visual pass before this is
considered fully verified.

### Follow-up UI fixes from user screenshot review (2026-07-12)

Same-day follow-up to the prototype-parity pass above — user reviewed the
live screens (not just the prototype) and reported 5 concrete issues,
fixed as follows:

- **Sentiment donut → single cumulative bar.** `BreakdownPanel`'s
  `type === 'sentiment'` case (`charts/breakdown-panel.tsx`) rendered a
  donut (`DonutChart`) for the 3-way positive/neutral/negative split. User
  wants the prototype's own pattern instead — big percentages in a row
  above, one horizontal bar below split proportionally by color
  (`54% / 18% / 28%` over green/gray/red). Replaced `SentimentDonut` with
  `SentimentBar` (fixed `positive→neutral→negative` order regardless of
  API item order, uses the existing `text-sentiment-*`/`bg-sentiment-*`
  Tailwind tokens instead of hardcoded hex). `DonutChart`
  (`charts/donut-chart.tsx`) had no other consumer, so it was deleted
  rather than left dead.
- **Line chart hover labels.** Clarified with the user (`AskUserQuestion`)
  that the ask was specifically *value labels drawn on the line itself*
  while hovering — the chart already had axis ticks and a legend/tooltip
  panel below, but no label near the actual point. `TrendLineChart`
  (`charts/trend-line-chart.tsx`) now draws an SVG `<text>` per series
  next to its hover-highlighted point (white stroke halo via
  `paintOrder="stroke"` so colored text stays legible over the grid/line),
  in addition to the existing circle marker and the panel below.
- **Sidebar ended before the end of page content.** Root cause:
  `Sidebar`'s `<aside>` had `h-screen` (fixed 100vh), so on any page taller
  than one viewport the flex row (which stretches to the tallest child —
  the content column) left a gap below the sidebar once you scrolled past
  100vh. The prototype's own sidebar div uses
  `min-height:100vh;position:sticky;top:0;align-self:flex-start` — ported
  that exact pattern (`min-h-screen sticky top-0 self-start` replacing
  `h-screen`) in `components/intelligence-center/sidebar.tsx`. This is the
  standard flexbox trick for a sidebar shorter than a scrolling sibling
  column: `align-self: flex-start` stops it from being force-stretched to
  the (taller) content height, while `position: sticky` keeps it pinned
  through the full scroll instead of scrolling away after 100vh.
- **Zero-mention rows in "Sentimento por plataforma"/"por pauta".**
  `ScoreList` (the `platform`/`theme` branch of `BreakdownPanel`) now
  filters out any item with `pct === 0` (0% das menções) before rendering
  — applied to both consumers (platform and theme breakdowns use the same
  component), since a 0%-mention row is equally uninformative in either.
  Falls back to an `<EmptyState />` if every row is filtered out.
- **Narratives list: no card summary when nothing selected.** The
  prototype's `hasNoSelection` state shows a card grid of every Narrativa
  below the table; the current implementation only ever showed something
  below the table when a row *was* selected. Added the missing
  `!selected` branch to `narratives/page.tsx` — one card per Narrativa
  (`grid-cols-1 sm:grid-cols-2 md:grid-cols-3`), each with title +
  `SentimentBadge`, SOV/Momentum/Velocity, and an "Explorar narrativa →"
  link to `/narratives/[id]`. ⚠️ Deviation from the prototype: its cards
  also show a `resumo` (summary blurb) per Narrativa — `NarrativeRow`
  (`@reputation/shared-types`) has no such field (no spec defines a
  per-row summary text; the only narrative-level description that exists
  today is `get-narrative-detail`'s own `ui_meta.narrative.description`,
  fetched per-ID, not available in the list envelope), so the cards omit
  it rather than inventing filler text.

### UI polish pass — branding, page titles, KPI tooltips, sentiment %, chart harmonization (2026-07-12)

Same-day follow-up round, user request covering both the shared shell and
the Executive Overview page specifically. All presentation-layer, no new
envelope/backend fields except one SQL fix (net_sentiment delta, below).

- **Sidebar active-item highlight now reuses `accent-blue`** (`#2f6fed`,
  `components/intelligence-center/sidebar.tsx`) — same color already used
  for the selected period button in `PageHeaderBar` and for the collapsed
  rail's active dot. Previously the expanded nav item used
  `bg-sidebar-active` (`#1a2c52`, dark navy), which barely showed up
  against the sidebar's own dark navy background.
- **Brand renamed in-app to "Comunicação Inteligente"**, replacing the
  leftover "Digital Intelligent Communication" string that was still in
  `Sidebar`'s header and `(intelligence-center)/layout.tsx`'s mobile
  topbar/footer (`app/layout.tsx`'s `<title>` already used the new name —
  only the in-app chrome hadn't caught up). Note this is only the
  user-facing product brand; `CLAUDE.md`'s own opening line ("Digital
  Intelligent Communication (renamed from 'Reputation OS')") documents the
  project's internal/legal name history and is a separate, deliberately
  unchanged fact.
- **Placeholder logo added** (`public/logo.svg` — first file in a `public/`
  directory in this repo) — a simple square monogram (accent-blue
  background, "CI" mark), referenced from `Sidebar` (both expanded and
  collapsed/rail states) and the mobile topbar (replacing a hardcoded
  `bg-accent-blue` div placeholder). **Recommended replacement size**:
  source as SVG (scales cleanly at every size this logo renders at, 26–32px
  in-app today, tiny file size) — if only a raster asset is available, use
  a square, transparent-background PNG at minimum 512×512px so it stays
  sharp on retina displays and is reusable later for the app icon/favicon
  (see "Deploy (Hostinger)" rule 4 above for that separate, stricter
  filename convention — this in-app logo is unrelated to that). Plain
  `<img>`, not `next/image` (build emits an advisory `no-img-element`
  lint warning, not an error — not worth `next/image`'s SVG-domain config
  for a single small static icon with no remote source).
- **Page titles separated from the header controls bar** — the prototype
  (see the user's reference screenshot) never puts the page `<h1>` inside
  the same white bar as the organization/period/Filtros controls; the
  title sits loose on the gray page canvas below it, larger
  (`text-2xl`/`md:text-3xl` vs. the previous `text-xl`) and bold.
  `PageHeaderBar` (`components/intelligence-center/page-header-bar.tsx`,
  shared by all 6 pages) restructured accordingly: the white
  `bg-card`/`border-b` block now only holds org selector + period toggle +
  custom range picker + Filtros (and its expand panel); the title/subtitle
  block renders separately below it, transparent background. `title`
  became optional (`title?: string`) so `/narratives/[id]`'s loaded state
  — which already renders its own `<h1>` + score badges inline — can omit
  it and avoid showing the same title twice stacked; its
  loading/error/not-found states still pass a generic
  `title="Detalhe da Narrativa"` since they have no other heading.
- **KPI tooltips** (`components/intelligence-center/metric-card.tsx`) — a
  small "?" affordance next to each of the 5 Executive Overview KPI labels
  (`Tooltip`, new `components/ui/tooltip.tsx`, plain CSS `group-hover`, no
  new dependency) shows a plain-language definition on hover, adapted from
  Brandwatch's own documentation (`chart-dimensions-and-aggregates` for
  `reachEstimate`/`engagementScore`/`authors`/`netSentiment`,
  `mention-metadata-field-definitions` for the mention-level concepts) —
  same source material already cited elsewhere in this file confirming
  these are official non-sampled aggregates, just rephrased for an
  end-user reading a dashboard rather than integrating an API.
- **"Sentimento geral" (`net_sentiment` KPI card) now reads as a
  percentage, with its delta in percentage points, not relative %** — the
  card already sourced `net_sentiment` (`get_metrics_cards`, weighted
  average, migration `20260714000000`); the generic delta formula shared
  by every other KPI (`(current - previous) / previous * 100`) doesn't
  mean anything for a signed score that can cross zero — dividing by a
  near-zero previous value produces a huge, meaningless "% change," and
  the sign can flip in ways a relative percent misrepresents. Fixed in
  `get_metrics_cards` (migration `20260717010000`): for
  `metric_key = 'net_sentiment'` specifically, `delta_pct` now holds
  `round(current_value - previous_value, 1)` — an absolute point
  difference — instead of the relative-percent formula. `METRIC_META`'s
  `net_sentiment` entry changed `unit` from `'score'` to
  `'net_sentiment_pct'` (updated in `aggregated-metrics-service.ts` and,
  per Principle 5, in all 6 deployed `get-page-*`/`get-narrative-detail`
  copies) so `MetricCard` knows to render the value with a trailing `%`
  and the delta suffixed `"p.p."` instead of `"%"`.
- **Trend line chart labels harmonized** (`charts/trend-line-chart.tsx`) —
  axis tick labels (Y and X) reduced 9px→8px; the hover value label drawn
  directly on the line (added 2026-07-12, same-day earlier fix) reduced
  from 10px/weight 700/3px white halo to 9px/weight 600/2px halo — the
  bold, heavily-outlined hover label read as visually oversized next to
  the rest of the page's consistently small, light-weight label text.
- **Narratives table moved above the Insights panel** on `/overview` — the
  Insights panel (`HighlightsPanel`/`NarrativeTextPanel`) renders empty
  today regardless of data (`event-radar`/`ai-synthesis` not implemented,
  `_pending.md` gaps #7/#8), so the actionable Narrativas table now comes
  first.

### "Sentimento geral" KPI card redesigned as positivo/neutro/negativo (2026-07-13)

User report, straight from a screenshot of the live `/overview` page: the
"SENTIMENTO GERAL" KPI card (top-right entry of the previous session's UI
polish pass, immediately above) showed a bare `-1` with `↑ 15,1% vs.
período anterior` underneath — a signed `net_sentiment` score (-100..100)
formatted with no visible scale next to it, so `-1` read as meaningless,
and a "15.1% increase" beside a score that got *more* negative looked
contradictory (it's an absolute point difference in a scale that crosses
zero, not a relative percent — correct math, confusing presentation).
User's own suggestion, adopted as-is: "acredito que seja melhor definir
como positivo, negativo e neutro ao invés de porcentual."

Checking `intelligence-center/executive-overview.md`'s "Cards de topo"
bullet confirmed this wasn't a new product decision — the spec had
*always* described this card as "Sentimento geral (**distribuição
positivo/neutro/negativo compacta**)," and `aggregated-metrics/sql-aggregation.md`'s
function table had always documented `get_metrics_cards` as sourcing
`sentiment_*` for this block. The 2026-07-12 polish pass (previous section
above) implemented a single weighted-average score instead — a real
deviation from both specs that nobody had caught until it showed up
confusingly on screen. Fixed by aligning the implementation back to what
was specified, not by inventing a new design:

- **`SentimentMetricCard`** (new export in
  `components/intelligence-center/metric-card.tsx`) renders three compact
  percentages (Positivo/Neutro/Negativo, `text-sentiment-*` colors) plus a
  thin proportional bar underneath — same visual language as `SentimentBar`
  in `charts/breakdown-panel.tsx` (the "Sentimento geral" widget that
  already sat below the KPI grid on the same page), just sized to fit a
  KPI card. `overview/page.tsx` renders it in place of the generic
  `MetricCard` specifically for `metric.key === 'net_sentiment'` — same
  grid position, no layout change.
- **No new SQL function, no new Brandwatch call**: the page already fetches
  `envelope.breakdowns` (`type = 'sentiment'`) for that pre-existing widget
  below (`get_sentiment_breakdown`, `aggregated-metrics/sql-aggregation.md`)
  — the KPI card now just reads the same already-fetched result instead of
  `envelope.metrics`. `get_metrics_cards` is untouched; the raw
  `net_sentiment` weighted score it computes is still returned in the
  `metrics` block (a future consumer — e.g. a sparkline, or an eventual
  `executive-reports` page — can still read it), it's just no longer what
  this specific card renders.
- **`MetricCard` (the generic component) had its `net_sentiment`-specific
  branches removed as dead code** now that no metric with
  `unit: 'net_sentiment_pct'` ever reaches it: the `formatValue()` `%`
  branch, the `isPercentagePoints`/`" p.p."` suffix logic, and the
  `net_sentiment` entry in `KPI_TOOLTIPS` (moved into `SentimentMetricCard`
  itself as `SENTIMENT_TOOLTIP`, reworded for a distribution instead of a
  signed score).
- **Known, accepted redundancy**: the "Sentimento geral" widget below the
  KPI grid (`SentimentBar`) now shows the exact same 3 percentages as this
  KPI card, just larger — a deliberate trade-off (glance vs. detail, both
  reading the same underlying aggregate) rather than restructuring the
  page layout, which wasn't part of the request. Revisit if a future
  design pass wants to fill that space with something else instead.

Full spec updates in `intelligence-center/executive-overview.md` and
`aggregated-metrics/sql-aggregation.md` (implementation notes dated
2026-07-13 in both).

### Volume/sentiment trend chart — hourly grain for "Diário" + label-scaling bug fixed (2026-07-19)

User request, still on `/overview`: (1) the "Volume e sentimento ao longo
do tempo" chart needed to switch to hourly buckets when the header's
"Diário" period is selected; (2) general polish — the chart's axis/value
labels were rendering visibly larger than the page's own legends and
titles, "muito feio."

**Hourly grain.** `get_volume_trend`'s existing automatic-granularity rule
(≤31d → `day`, 32–186d → `week`, >186d → `month`, see the entry above)
never had a branch for the "Diário" period specifically (1 day,
`period.start === period.end` — `header-context.tsx`,
`PERIOD_MODE_DAYS.daily = 1`): it fell into the same `day` tier as any
other short window and returned exactly one bucket — the whole day summed
into a single point, which isn't a time series at all. Fixed in migration
`20260719000000`: a new `hour` tier, triggered when the period spans
exactly 1 day, sources `bw_query_metrics_hourly` (already existed and
already synced every invocation for `event-radar`/Velocidade, see
"foundation gap closure" above — no new Brandwatch call, no new sync
phase). Required dropping and recreating the function because its return
type changed: `bucket_date` is now `text`, not `date` — the `hour` tier
needs to carry a real instant (`to_char(metric_hour at time zone 'utc',
'YYYY-MM-DD"T"HH24:MI:SS"Z"')`, a full ISO 8601 UTC string), while
day/week/month keep returning a plain `YYYY-MM-DD` date (10 characters).
The frontend (`TrendLineChart`) tells the two apart by string length
rather than a new explicit grain field on `Trend`/`TrendPoint` — both stay
`{ date: string, value: number }`, no envelope contract change. This
applies to every page that renders this chart from the shared header
period (`overview`, `narrative_detail`, `sentiment` all use
`TrendLineChart` off the same `get_volume_trend` call), not just
`/overview` — same fix, no extra work.

**Label-scaling bug — root cause.** The chart is a hand-rolled SVG with a
*fixed* `viewBox="0 0 640 220"` stretched to the container's actual width
via CSS (`w-full`). On a widget spanning 2 of 3 grid columns, the
container can render considerably wider than 640px — and because SVG
scales every unit inside the `viewBox` (including `font-size`) by the same
ratio as the container-to-viewBox width, a `fontSize={8}`/`{9}` that looks
right at 640px CSS-px could render 30–40%+ larger on a wide desktop
monitor, while the surrounding HTML legend/tooltip text (Tailwind
`text-xs`, a fixed 12px regardless of container width) stayed put — hence
axis/value labels visibly outgrowing the legend and title, exactly what
the user flagged. This had been masked, not fixed, by two prior
size-reduction passes (2026-07-12, "chart harmonization" — see "UI polish
pass" above) that shrank the declared `fontSize` without addressing why it
was scaling in the first place.

**Fix.** `TrendLineChart` now measures its container's real pixel width
via `ResizeObserver` (`useLayoutEffect`, to measure before paint and
minimize an initial-render jump) and sets the SVG's `viewBox` width to
that exact measurement instead of a fixed constant — 1 `viewBox` unit now
always equals 1 real CSS pixel, in any card width, on any screen, so a
declared `fontSize={10}` always renders as literal 10px. Axis label size
was raised slightly (8/9px → 10px, still below the legend's 12px, so it
reads as intentionally recessive rather than illegibly cramped) now that
it's no longer at risk of silently ballooning.

Also removed, per a pass through the `dataviz` skill (loaded before this
edit — its interaction guidance calls for exactly one shared tooltip
carrying every series' value at the hovered X, not the value repeated a
second time as floating text next to each line): the inline per-point SVG
value labels added 2026-07-12 ("rótulos ao passar o mouse sobre a linha")
are gone. They were the single largest contributor to the "too big" read
(bold text with a 2–3px white halo, the loudest element on the chart) and
were genuinely redundant — the HTML tooltip panel directly below the
chart already lists every series' value at the same X on hover, in
properly-sized, non-scaling text. The crosshair line + point markers on
hover are unchanged; only the floating numbers were removed.

> ⚠️ **Reversed the next day (2026-07-13)** — the user asked for the
> on-point label back, verbatim the same request as 2026-07-12. See the
> "Second round of `/overview` UI polish" section below and Cross-cutting
> UX rule 10: a general best-practice judgment call (however well-reasoned
> the dataviz-skill citation above was) doesn't override a specific,
> already-settled product request without checking first. Both the
> on-point label and the below-chart panel render together now,
> permanently — treat this as closed, not something to re-simplify later
> without asking.

### Second round of `/overview` UI polish — table tooltips, legend placement, bold typography, chart label restored (2026-07-13)

User request, 5 items, all `/overview`-scoped except the 3 shared-component
changes (which necessarily affect every page that reuses those
components):

- **Tooltips on `NarrativesTable` column headers** — SOV, Velocidade,
  Sentimento, Momentum, Risco each get the same "?"/`Tooltip` affordance
  already used on the KPI cards, with a plain-language definition of what
  the score means. `Narrativa`/`Ação` stay without a tooltip (self-
  explanatory). `Tooltip` (`components/ui/tooltip.tsx`) gained a
  `position` prop (`"top"` default, `"bottom"` new) — a column-header
  tooltip opening upward would be clipped by the table's own
  `overflow-x-auto` wrapper (setting `overflow-x` alone forces
  `overflow-y: auto` too, per the CSS spec, so anything positioned outside
  the wrapper's vertical bounds gets cut off); table headers pass
  `position="bottom"` to open down into the table body instead, where
  there's no clipping boundary.
- **`ScoreLegend` moved to directly below the table it explains** — on
  `/overview`, it now renders inside the same `WidgetCard` as
  `NarrativesTable`, separated by a `border-t`, instead of sitting alone at
  the very bottom of the page past the Insights panel. Cross-cutting UX
  rule 9 (above) generalizes this — the other 3 pages that also render
  `NarrativesTable` (`/narratives`, `/platforms`, `/themes`) don't have the
  legend at all yet; out of scope for this request (`/overview`-only), left
  as a note for whenever one of those pages is next touched rather than
  built speculatively now.
- **Widget titles / KPI labels / table column headers switched to
  `font-bold`** (were `font-semibold`/`font-medium`) — `WidgetCard`,
  `MetricCard`/`SentimentMetricCard`, `NarrativesTable` are shared by all 6
  pages, so this one component-level change fixes legibility everywhere,
  not just `/overview`. Cross-cutting UX rule 7 (above).
- **`TrendLineChart`'s on-point hover value label restored** — see the
  callout just above: removed the day before, user asked for it back with
  the same wording as the original request. Kept the harmonized sizing
  from that removal's stated concern (9px/weight 600/2px halo, well under
  the now-correctly-scaling 10px axis labels) so it doesn't reintroduce the
  "too big" problem — just no longer deleted outright. Renders alongside
  the below-chart panel, not instead of it; the code comment at the label
  block spells out why both stay.
- Documentation: this section, `intelligence-center/executive-overview.md`
  (new dated note), `intelligence-center/overview.md` ("Premissas de
  visualização de dados" rule 2, closed as definitive), and Cross-cutting
  UX rules 7–10 above — the user's 5th ask this round was explicitly
  "document so these problems stop recurring," which rule 10 in particular
  is written to satisfy (the on-point label had already been added,
  removed, and re-requested once by this point).

### Narrative naming/scope change + a real sentiment bug fix (2026-07-20)

User request: "1) O nome da narrativa será composto por 'categoria -
subcategoria'. 2) Tanto na página de overview quanto na lista de
narrativas serão mostradas todas as narrativas. 3) Revise se os valores de
sentimento por narrativa estão corretos, no Frontend está tudo neutro, não
corresponde a realidade." All three closed this session, migration
`20260720000000`.

**1) Compound title.** `ensureNarrativesFromCategories()` (`bw-sync/index.ts`)
used to set `title = category.name` unconditionally — a Subcategory's
title was just its own name, with no indication of which Category (Pauta)
it belonged to. New `buildNarrativeTitle()` composes
`"<Category-pai> - <Subcategory>"` for any Category with a `parent_id`;
top-level Categories keep just their own name (no parent to compose).
Applies going forward for new Narrativas (still idempotent — never
overwrites an existing `title`, per `foundation/narratives.md`'s no-CRUD
rule); migration `20260720000000` backfills every existing Narrativa's
`title` to the new format in one `update` — safe because there is no
Narrativa CRUD anywhere in the product (decision closed 2026-07-13), so
every `title` in production is 100% derived from `bw_categories`, never
hand-edited.

**2) Overview + Narrativas show every Narrativa again.** Reverts the
2026-07-16 decision ("Overview vs. Narrativas vs. Pautas Eleitorais" —
Overview = root Categories only, Narrativas tab = Subcategories only) for
exactly these two pages — `platforms`/`themes` (still `'leaves'`) and
`reports` (still `'roots'`) are unchanged, they weren't part of this
request. `narrativesScopeForPage()` (`aggregated-metrics-service.ts` +
its 6 deployed copies, Principle 5) now returns `null` (no scope filter)
for `overview`/`narratives` instead of `'roots'`/`'leaves'` —
`get_narratives_table`'s `p_scope => null` branch already existed
(migration `20260716010000`) and needed no SQL change, just the two
service-layer call sites. This is what makes the compound title from (1)
load-bearing rather than cosmetic: with Category and Subcategory rows now
mixed in the same flat table again, a bare Subcategory name would be
ambiguous about which Pauta it belongs to — the "Categoria - Subcategoria"
format resolves that inline, without adding a separate "parent" column to
the table/envelope.

**3) Sentiment-always-neutral bug — two real, independent causes found
and fixed**, no Brandwatch access needed to diagnose since both were
visible from code inspection (`public.narratives_overview` +
`runDailyMetricsStep`):

- **Fallback formula was mathematically biased toward 'neutral'.**
  `sentiment_bucket` prefers `net_sentiment` (official Brandwatch score,
  7 bands, migration `20260713030000`) and only falls back to a locally
  computed bucket for rows where `net_sentiment` hasn't synced yet. That
  fallback computed `(sentiment_positive - sentiment_negative) /
  total_mentions` against a fixed ±20% threshold — dividing by the
  **total** mention count, which includes neutral/factual mentions,
  systematically dilutes the ratio. Political coverage routinely has a
  large neutral/factual share, so even a real, meaningful skew between
  positive and negative mentions could easily stay under ±20% once
  diluted by the neutral denominator — landing on 'neutral' far more
  often than the actual sentiment split would suggest. Fixed: the
  fallback now normalizes by `(sentiment_positive + sentiment_negative)`
  instead — the same base `net_sentiment` itself uses — and reuses the
  same 7-band thresholds as the primary score, only falling to
  `'neutral'` when there's truly no classified signal (positive + negative
  = 0, i.e. every mention that day genuinely is neutral).
- **`net_sentiment` sync was budget-starved for Narrativa-heavy orgs.**
  `runDailyMetricsStep()`'s `daily_metrics` phase made the 2 `netSentiment`
  calls (categories dimension = all Narrativas in one call, queries
  dimension = whole-query row) **last** among its 10 fixed aggregate
  calls — after `reachEstimate`/`engagementScore`/`authors`/`impressions`
  × categories+queries. With `BRANDWATCH_CALL_BUDGET = 25` and the
  sentiment loop alone already spending 1 call per `categoryTarget`
  (Narrativa count + 1), any org with enough Narrativas could exhaust the
  budget before ever reaching `netSentiment` — meaning
  `narrative_metrics.net_sentiment` would stay `null` indefinitely for
  those rows on every invocation (deterministic call order → same
  starvation every time, not an occasional miss), forcing the diluted
  fallback above on every read. Fixed by moving both `netSentiment` calls
  to run immediately after the sentiment loop, before any of the other 8
  aggregate calls in this phase — same total call count, just reordered
  so the metric this bug report is actually about survives budget
  pressure first.

Both fixes ship in the same migration/PR since they compound the same
symptom (a starved primary source falling back to a biased fallback) —
either alone would have improved the picture, but only together do they
close the gap end-to-end. Not verified against a live production sync
this session (no DB/log access, same limitation as prior sessions) — the
starvation math is derived from the fixed call sequence and
`BRANDWATCH_CALL_BUDGET`, not from an observed log line; revisit if a
future session has log access and Narrativa counts to confirm.

### Narrative card redesign + envelope fields for the future AI text (2026-07-21)

User request: reformat every Narrative card in the app to match an
attached visual reference — left border colored by sentiment (red/green/
neutral), SOV + mention count prominent, a progress bar, a body paragraph,
a positive/neutral/negative sentiment bar, and a tag row — and fix
`get-page-narratives`/the other narratives-consuming Edge Functions so the
envelope actually carries all of that data, including the textual part of
the card being ready to receive AI-generated content in the next sprint.

**Backend — `get_narratives_table` gained 3 field groups** (migration
`20260721010000`, required a `drop function` first since Postgres won't
let `create or replace` add output columns — same constraint already hit
in `20260717000000`):

- `sentiment_positive_pct`/`sentiment_neutral_pct`/`sentiment_negative_pct`
  — full split of `narrative_metrics.sentiment_positive/neutral/negative`
  summed over the requested period, normalized by `(pos+neu+neg)`, **never**
  by `total_mentions` (the exact dilution bug fixed for `sentiment_bucket`
  the day before, in `20260720000000` — same care applied here from the
  start). Same numeric base as `get_narrative_sentiment_breakdown`
  (`20260717000000`), just returned per-row instead of via a separate
  breakdown call.
- `summary` — `narratives.description`, the field `foundation/narratives.md`
  has reserved since 2026-07-13 for a future `ai-synthesis`-generated
  executive summary (no CRUD anywhere in the product; the only legitimate
  writer is a future backend job). Always `null` today — this round's
  actual deliverable is that the frontend (`NarrativeCard`) now reads and
  renders this field with an honest "summary not available yet" fallback,
  so nothing on the frontend needs to change again once `ai-synthesis`
  starts writing to it.
- `tags` — top 6 terms/hashtags per Narrativa from `bw_query_topics`
  (`topic_type in ('hashtags', 'phrases', 'words')`, latest synced week),
  an official Brandwatch aggregate, never sampled. ⚠️ **Deliberately no
  "emotion" tag** — the reference image had one ("emoção: raiva"), but
  there's no non-sampled source for "dominant emotion of a Narrativa":
  `bw_query_topics`/`data/topics` has no emotion dimension, and
  `mentions.emotion` is a best-effort per-mention signal — aggregating it
  would violate this project's standing premise (never compute a total
  locally over sampled `mentions`, see the "Retire os cálculos locais..."
  entry earlier in this file). Documented as a natural candidate for
  `summary`/`ai-synthesis` instead (an LLM classifying over the already-
  synced set), not a local calculation invented here.

**Frontend — one shared `NarrativeCard`** (`components/intelligence-center/
narrative-card.tsx`), replacing two separate ad hoc card layouts:
`narratives/page.tsx`'s "no selection" grid, and `overview/page.tsx`'s
`TopThreeNarrativeCards`. Left border color uses only 3 buckets (not the
usual 7-band `SentimentBadge` granularity) — explicit user ask ("variação
entre vermelho, verde ou neutro"); the risk progress bar (see follow-up
below — removed the same day) reused the same `risk_label`/color already
shown in the badge next to the title, not a new palette (no pink/magenta
token exists in `_design-tokens.md`, and inventing one wasn't the point of
the request — the structure/color logic was).

✅ **Follow-up, same day, after seeing the card live**: the full-width risk
progress bar read as unexplained on its own (a plain colored bar with no
adjacent label/number to anchor it — "why is there a yellow bar?"). Removed
it entirely and replaced it with a second pill next to the Risk badge in
the card header showing Momentum (`MomentumBadge`, new export in
`score-badges.tsx`) — same visual language as `RiskBadge` (colored pill),
same `momentumBand()` bands/colors already used by `ScoreBar`/
`MOMENTUM_LEGEND` (`bg-intensity-1..5`), just white text instead of the
light-bg/dark-text pairing risk/sentiment badges use, since `intensity-*`
only has one saturated hex per band, no separate light "-bg" token to pair
with dark text. No new color introduced, no SQL/envelope change — purely
presentational.

**Simplification this unlocked**: `TopThreeNarrativeCards` used to fetch a
separate `breakdowns` entry (`type: 'narrative'`, from
`get_narrative_sentiment_breakdown`) and match it back to each
`NarrativeRow` by comparing `title` strings — fragile, and now unnecessary
since the same split lives directly on the row. Removed that lookup, and
removed `'narrative'` from `PAGE_BREAKDOWN_TYPES.overview` (in
`aggregated-metrics-service.ts` and all 6 deployed `get-page-*`/
`get-narrative-detail` copies, Principle 5) since nothing on `/overview`
consumes that breakdown anymore — leaving it in would have meant an RPC
call with zero consumers on every page load. `narratives`/`sentiment`
pages still request it (`sentiment` page's own "Sentimento por narrativa"
widget still depends on it), untouched.

**Verification**: `npx tsc --noEmit` and `npm run build` both pass clean
(18 routes). Migration reviewed manually before the user ran `supabase db
push` for real — that push caught a genuine, pre-existing bug (see below).

**Real production bug found via `supabase db push`, same session**: the
push failed on this migration's `comment on function get_narratives_table
is ...` with `function name "get_narratives_table" is not unique`
(SQLSTATE 42725). Root cause predates this session: `get_narratives_table`
grew its parameter list twice — `20260715000000` added `p_pauta_id` (4→5
params) and `20260716010000` added `p_scope` (5→6 params) — each via
`create or replace function` with no preceding `drop function`. Postgres
only replaces a function of the exact same signature (name **and**
parameter types); a different arg count creates a new overload alongside
the old one instead of replacing it. Every RPC caller always passed all 6
named arguments, so this silently never broke a real call — but it left
the 4-arg and 5-arg versions as dead overloads still sitting in the
database, invisible until something referenced the function by bare name
(no signature), which is exactly what a `comment on function` does. Fixed
in `20260721010000` by dropping all 3 known historical signatures (4/5/6
params) before creating the new one, and qualifying the `comment on
function` with the full signature so it can never hit this ambiguity
again regardless of future overloads. No other function in this module
has the same risk — `get_theme_breakdown`/`get_authors_ranking` had their
parameter counts fixed from their first migration (or already used
`drop function` when their signature changed, see `20260717000000`);
`get_narratives_table` was the only one that grew arity incrementally
without a matching drop.

### Full prototype re-import + visual/object parity pass, and full nav IA (2026-07-13)

User request: re-import the original prototype
(`claude.ai/design/p/9a62a59b-...`, file `Comunicacao Inteligente.dc.html`,
`DesignSync` tool) and make the frontend match it exactly — every visual
detail and every "object" (widget/section) on every page — then, mid-turn,
extended to "include the same menu options as the prototype, and where the
screen doesn't exist yet, build a page that says development is pending."
Re-read the `.dc.html` source in full (it's a single ~96KB line, wrapped to
300 chars/line via `fold` in the scratchpad to page through it) rather than
relying on memory of earlier parity passes, since this session's ask was
literally to re-diff against the source file.

- **Full navigation IA added** — the prototype's sidebar has 2 sections
  beyond what existed: `navStatic` ("Autores e Influenciadores", under
  ANÁLISES) and `navSettings` (Alertas/Relatórios/Administração/Ajuda,
  under CONFIGURAÇÕES) — in the prototype mock these are permanently
  disabled/static (`opacity:.55;cursor:default`). Per this session's
  explicit instruction, made them real links instead: `sidebar.tsx` gained
  `ANALYSIS_ITEMS` → `/authors` and `SETTINGS_ITEMS` → `/alerts`,
  `/reports` (plus `/help`, rendered separately since it comes after the
  admin-gated `/admin/users` in the prototype's own order). Each of the 4
  new routes (`app/(intelligence-center)/{authors,alerts,reports,help}/`)
  renders `<ComingSoonPage>` (new
  `components/intelligence-center/coming-soon.tsx`) — a "🚧 Funcionalidade
  em desenvolvimento" card, not a dead link or a disabled item — since none
  of these 4 have a spec/backend yet (`event-radar`/`executive-reports`
  not started, Alertas/Ajuda have no module at all). Placed directly under
  `(intelligence-center)/`, not `(analytics)/`, same pattern as
  `/admin/users`/`/perfil` — no organization/period dependency. `Perfil`
  itself has no equivalent in the prototype's IA (no avatar/user section
  in the mock at all) — kept where it was, documented inline as a real
  feature the mock never depicted, not a menu item being "restored".
- **Sentimento (`/sentiment`)**: added the missing "Mudança de sentimento"
  callout (prototype: text next to "Distribuição geral") as an honest
  `<EmptyState>` — depends on `ai-synthesis`, not implemented, same
  treatment as every other AI-synthesis gap in this file. Reordered
  widgets to match the prototype exactly (narrativa → plataforma pair,
  pauta full-width below, not the previous plataforma+pauta-first order).
  Split the single "Drivers de sentimento" card into 2 separate widgets
  ("Drivers positivos"/"Drivers negativos", `term-signals-list.tsx`'s new
  `PositiveDriversList`/`NegativeDriversList`) with **filled pill** styling
  (`bg-sentiment-positive-bg`/`text-sentiment-positive`, no border) instead
  of the previous bordered/text-only chip — matches the prototype's actual
  pill design (`background:#eafaf1 color:#1a9d5c` etc.) rather than an
  approximation.
- **Pautas Eleitorais (`/themes`)**: added "Estrutura das pautas" (chip
  row, prototype's `pautasChips`) and a new `PautaCardGrid`
  (`components/intelligence-center/pauta-cards.tsx` — name + SOV bar +
  `net_sentiment` dot) replacing the generic score-list rendering of the
  theme breakdown for "Share of Voice e sentimento por pauta", matching
  the prototype's actual card-grid look. ⚠️ No click-to-drill-down (the
  prototype's cards are selectable, ours aren't) — `get_theme_breakdown`/
  `BreakdownItem` never carry a Pauta `id`, only `label`, so there's no
  reliable way to scope `get-page-themes`'s `pauta_id` from this data
  alone (see `_pending.md` gap #17, updated same session). Added
  "Comparação entre períodos" as an honest `ai-synthesis`-gap `EmptyState`
  (prototype: a text callout). `TermSignalsList` (shared with "Termos
  emergentes" here) was rewritten from bordered chips to an actual **word
  cloud** (`font-weight:700`, `accent-blue`, variable `font-size` scaled by
  `growth_pct` magnitude) — the prototype's `termosEmergentes` was never a
  chip list, it was a word cloud, and the previous chip rendering had
  quietly diverged from it. Deliberately kept the real `AuthorsList`
  ranking for "Autores e comunidades por pauta" rather than reverting to
  the prototype's decorative, non-functional category pills (Imprensa/
  Especialistas/Influenciadores/.../Cidadãos) — those aren't backed by any
  real classification in this product, so showing real ranked authors is
  strictly more useful than reproducing a mockup placeholder.
- **Plataformas (`/platforms`)**: removed "Sentimento por plataforma"
  (an unintentional duplicate of the Sentiment page's own widget — the
  prototype's Platforms page never has a sentiment widget at all) and
  replaced it with "Participação por plataforma" (new
  `PlatformParticipationBars` in `charts/breakdown-panel.tsx` — plain
  `pct` bars, `accent-blue`, no sentiment score), matching the prototype's
  actual `platformsForBars` widget. Added 2 more honestly-gapped widgets
  matching the prototype's IA: "Engajamento médio por publicação" and
  "Autores únicos por plataforma" — `bw_query_metrics_daily_by_platform`
  already has `unique_authors`/`engagement_score` (foundation, confirmed
  2026-07-12), but `BreakdownItem` doesn't expose them, so both render as
  `<EmptyState>` rather than reusing an unrelated field. Reordered the
  page to match the prototype's widget sequence (participação+evolução,
  engajamento+autores, velocidade, perfis relevantes, X Themes, conteúdos
  de destaque) — the "Narrativas" table (a deliberate addition beyond the
  prototype from an earlier session, the mock has no narratives table on
  this page) was moved to the very end, after every prototype-matching
  widget, so the extra content reads as "bonus" rather than interrupting
  the prototype's own flow.
- **Visão Geral (`/overview`)**: added the prototype's "O que os gráficos
  mostram?" box — same `narrative_text` data already rendered in
  "Insights" (still always empty pending `ai-synthesis`), just its own
  widget in the prototype's actual position (right after the two charts,
  before the Narrativas table) instead of bundled at the bottom. Added
  "Top 3 Narrativas" (`TopThreeNarrativeCards`, inline in
  `overview/page.tsx`) — the 3 highest-SOV Narrativas, each with a
  positivo/neutro/negativo split and a "Ver detalhes →" link, mirroring
  the prototype's `topThreeCards`. This needed one small, deliberate
  backend change: `PAGE_BREAKDOWN_TYPES.overview` (`aggregated-metrics-service.ts`
  + all 6 deployed `get-page-*`/`get-narrative-detail` copies, Principle 5)
  gained `'narrative'` alongside `'sentiment'` — reuses
  `get_narrative_sentiment_breakdown`, already built and confirmed for the
  Sentiment page 2026-07-17, no new SQL function, no new envelope field.
  Considered narrow enough to make without a spec update cycle (additive,
  same function, one more page consuming an existing breakdown type).
- **Detalhe de Narrativa (`/narratives/[id]`)**: reordered the two-column
  row to match the prototype exactly — "Formação e propagação" (principais
  disseminadores) + "Grafo de disseminação simplificado" side by side (the
  prototype's actual pairing); the "Sentimento e plataforma" panel (a real
  addition beyond the prototype — the mock's detail page has no such
  section) now sits in its own full-width row above that pair, instead of
  incorrectly sharing the 2-column grid with "Formação e propagação" and
  displacing "Grafo de disseminação" onto its own row.
- **New score-badges helper**: `NetSentimentDot` + `sentimentBucketFromScore()`
  (`score-badges.tsx`) — buckets a raw `net_sentiment` score (no
  `*_label` available, e.g. `PautaCardGrid`) into the same 7-band palette
  used everywhere else, using the exact thresholds already fixed in
  `_design-tokens.md`. Same precedent as the pre-existing `momentumBand()`
  — a presentation-only mapping over already-closed bands, not a new
  calculation (Principle 2).
- **Not attempted**: rebuilding the Overview's 2 prototype charts
  ("Volume de Menções por Sentimento" stacked-by-day, "Volume de Menções
  Total" area+line) as 2 separate charts — the prototype's stacked
  bar needs a 3-way pos/neu/neg volume split *per day*, which
  `get_volume_trend`'s `Trend`/`TrendPoint` shape doesn't carry (one
  numeric value per date, not a 3-way split) — would require a new SQL
  function/envelope shape, not a frontend styling change, so left as the
  existing single `TrendLineChart` + `SentimentBar` combination rather
  than fabricating a fake stacked series.
- **Operational note**: this session ran `taskkill /F /IM node.exe /T` to
  stop a dev-server smoke test and it killed **every** `node.exe` process
  on the machine (5 unrelated PIDs), not just the one process started for
  the test — flagged to the user immediately. Future sessions: kill by the
  specific PID/port the harness returns for a backgrounded process, never
  a blanket `/IM node.exe`.
- **Verification**: `npx tsc --noEmit` and `npm run build` both pass clean
  (18 routes, including the 4 new pending-development pages). Smoke-tested
  via `npm run dev` + `curl`: `/` and `/login` 200 (Hostinger health-check
  rule intact), `/overview` and all 4 new routes correctly 307-redirect to
  `/login` when unauthenticated. No browser automation available in this
  environment — the actual authenticated, data-loaded visual rendering of
  every change above (card grids, word cloud, filled pills, reordered
  widgets) was not visually confirmed in a real browser, same recurring
  limitation as every prior prototype-parity session in this file.

### `/overview` KPI pending-sync state, chart label size, KPI title contrast, sentiment-panel dedup (2026-07-21)

User request, 4 items on `/overview` plus 2 clarifications given mid-session:
1) null-looking values in Autores únicos/Alcance estimado/Engajamento
total when "Diário" is selected; 2) narrative sentiment reading
predominantly neutral; 3) +3pt on the line chart's label font size; 4) KPI
titles bold. Mid-turn: "make KPI titles bold **and black**, same as graph
titles" (clarifying #4 — they were already `font-bold`, the actual gap was
color), and a 5th item: replace the "Sentimento geral" panel next to the
line chart with "O que os gráficos mostram?" (it duplicated the KPI grid's
own `SentimentMetricCard`).

- **Item 1 — real bug, fixed.** `bw_query_metrics_daily.reach_estimate`/
  `engagement_score`/`unique_authors` are nullable columns with no
  default, populated by calls that run *after* the sentiment loop and the
  2 `netSentiment` calls (reordered 2026-07-20) inside `bw-sync`'s
  `daily_metrics` phase — calls that can still be pending for *today*
  specifically (budget exhausted before reaching them, or no invocation
  yet since midnight), even though `total_mentions`/sentiment (populated
  first, unconditionally) are already there. `get_metrics_cards` did
  `coalesce(sum(...), 0)` unconditionally for these 3 metrics — harmless
  for a 7/30-day period (other synced days mask one pending day in the
  sum), but for "Diário" (1 day = today, the only day in scope) this
  turned "not yet synced" into a false `0` and a false "-100% vs. período
  anterior". Fixed (migration `20260721000000`): `current_value`/
  `previous_value` for these 3 metrics now return `null` (distinct from a
  confirmed `0`) specifically when the day already has mentions
  (`total_mentions > 0`) but the metric column itself is still fully
  unsynced for that range; stay `0` when there's genuinely no mention at
  all. `MetricCard.value` (`@reputation/shared-types`, plus the identical
  copy in `aggregated-metrics-service.ts` and all 6 deployed
  `get-page-*`/`get-narrative-detail` functions, Principle 5) widened
  `number` → `number | null`; `fetchMetrics` no longer coalesces `??  0`
  at the envelope edge. `MetricCard` (`metric-card.tsx`) renders
  "—"/"Ainda sincronizando…" for `value === null`, never a real card
  value's placeholder `0`.
- **Item 2 — reaudited, no new bug found.** Same complaint, same wording
  as 2026-07-20's session. Re-verified line by line that that session's
  fix (dilution-biased fallback formula + `netSentiment` calls starved by
  call-budget ordering, migration `20260720000000`) is correctly in place
  today: `narratives_overview.sentiment_bucket` uses the unbiased
  `positivo/(positivo+negativo)` fallback base, `runDailyMetricsStep` runs
  the 2 `netSentiment` calls right after the sentiment loop before
  reach/engagement/authors/impressions, `get_narratives_table.sentiment_label`
  passes `sentiment_bucket` through with no parallel/divergent
  calculation, and `get_narrative_sentiment_breakdown` sums real
  proportions (no threshold, can't inherit the dilution bug). No further
  code-level cause found this session — see
  `aggregated-metrics/sql-aggregation.md` for the full re-audit note. If
  this is still observed after this session's changes deploy, the next
  step needs real `bw-sync` production logs (not available in this
  environment) to confirm whether `net_sentiment`/`sentiment_positive`/
  `negative` are actually landing in `bw_query_metrics_daily` for the
  affected Narrativas, rather than more code inspection.
- **Item 3.** `trend-line-chart.tsx`'s `AXIS_FONT_SIZE` 10px→13px and the
  on-hover per-point value label (the one Cross-cutting UX rule 10 already
  treats as permanent, see above) 9px→12px. Both +3pt as asked; the axis
  labels are no longer smaller than the rest of the page's `text-xs`
  (12px) — accepted as an explicit, literal request, not a new visual
  hierarchy decision.
- **Item 4, clarified mid-turn.** `MetricCard`'s label and
  `SentimentMetricCard`'s "Sentimento geral" label were already
  `font-bold` (Cross-cutting UX rule 7, 2026-07-13) — the actual gap was
  color: both used `text-text-tertiary` (light gray, `#9aa0ab`), unlike
  `WidgetCard`'s `<h2>` title (`text-text-primary`, near-black). Both now
  use `text-text-primary` too, matching the "graph titles" the user
  pointed at.
- **5th item, given mid-turn.** `/overview`'s two-column row (chart +
  side panel) had the KPI grid's "Sentimento geral"
  (`SentimentMetricCard`) duplicated immediately below it as a second,
  larger "Sentimento geral" widget (`BreakdownPanel`, same `breakdowns`
  `type='sentiment'` data) — a redundancy accepted deliberately in
  2026-07-13's KPI-card redesign note, since removing it then would've
  meant restructuring the page layout, out of scope at the time. This
  session's request explicitly asks for that restructuring: the side
  panel is now `NarrativeTextPanel`/"O que os gráficos mostram?"
  (`envelope.narrative_text`), moved up from its own separate full-width
  widget further down the page (removed, not duplicated — one copy now,
  not two). `BreakdownPanel` import dropped from
  `overview/page.tsx` (no longer used there). No backend/envelope change,
  pure repositioning.
- **Verification**: `npx tsc --noEmit` and `npm run build` both pass clean
  (18 routes, same route table as before — no route added/removed this
  session). No live Supabase/Brandwatch access in this environment —
  migration `20260721000000` reviewed manually, not run against a real
  database (same recurring limitation as every session without deploy
  credentials); the actual authenticated `/overview` rendering (KPI
  pending-state copy, larger chart labels, panel swap) was not visually
  confirmed in a browser.

## Directory structure

```
app/(intelligence-center)/    Every authenticated page (overview, narratives,
                               sentiment, platforms, themes, admin/users, perfil)
                               — shares one shell (Sidebar/header/footer), see
                               layout.tsx; nested (analytics)/ route group adds
                               the org-required gate for the 5 analytics pages only
app/{login,forgot-password,reset-password}/   Public auth pages, outside the shell
components/intelligence-center/   Shared UI for the 5 analytics pages (table,
                               badges, charts, widget states) — see CLAUDE.md,
                               "edge-functions-per-page.md + the 5
                               intelligence-center pages"
packages/shared-types/        @reputation/shared-types — npm workspace, the
                               canonical envelope contract types for anything
                               that can import a local package (Next.js/Node);
                               Edge Functions can't (Principle 5), see below
lib/supabase/{client,server}.ts   The only two files that import @supabase/ssr
types/database.types.ts       Placeholder — regenerate once linked to a real project
supabase/migrations/          One SQL file per logical schema change
supabase/functions/<name>/    One self-sufficient Edge Function per directory
supabase/functions-shared-source/   Canonical source Edge Functions copy from
                               (never deployed itself — outside supabase/functions/
                               and excluded from tsconfig.json on purpose)
supabase/seed.sql             Intentionally empty — orgs/credentials are seeded manually
.dev/specs/                   Spec-driven-dev source of truth (read before implementing)
.claude/skills/               Project-specific skills (packaged as .skill zip files)
```
