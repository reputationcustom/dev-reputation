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

- `.dev/specs/_index.md` — stack, the 7 mandatory technical principles (see
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
`executive-reports`) are not started. **Sprint 2.1** (`communications` —
logging Comunicações/Decisões per Narrativa + before/after impact
tracking on Sentiment/Mentions/Risk/Momentum) was spec'd and implemented
in the same session, 2026-07-25 — `status: implementado` in every spec
file (`.dev/specs/communications/`), migrations `20260726000000`/
`20260726010000`, 5 Edge Functions, and the full frontend (menu item,
`/communications`, `/communications/[narrativeId]`, the "Comunicações e
Decisões" section on the Narrativa detail page). See "Módulo
`communications` (Sprint 2.1)" below for the complete write-up, including
a real RLS gap found during implementation (fixed with a new
`list-organization-members` Edge Function) and 2 deliberate deviations
from the original spec text.

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

### `.github/workflows/deploy.yaml` — concurrency guard + self-healing migration push (2026-08-02)

Real production incident, found via the pipeline's own CI logs: every
deploy was failing with `ERROR: duplicate key value violates unique
constraint "schema_migrations_pkey" ... Key (version)=(20260731050000)
already exists.` — always the same migration version, across several
separate runs, with the list of pending migrations only growing each
time (more commits kept landing on `develop` while deploys kept failing
at the same spot). Root cause: `deploy.yaml` had **no `concurrency`
guard**, so every push to `develop` started a brand-new job even if the
previous one was still running (or had just run) `supabase db push`.
Two overlapping `supabase db push` invocations compute the same "pending
migrations" list at nearly the same instant and both race to apply the
oldest one first — whichever wins inserts the bookkeeping row into
`supabase_migrations.schema_migrations` successfully (the migration's
actual SQL, e.g. `create or replace function`, is idempotent and safe to
re-run — only the bookkeeping `INSERT` collides), and every other
concurrent/subsequent run then fails on that exact same version forever,
blocking every genuinely new migration queued behind it too.

Fixed with two independent layers:
1. **`concurrency: { group: supabase-deploy-${{ github.ref }},
   cancel-in-progress: false }`** at the workflow level — a new push no
   longer starts a parallel run; it queues behind whatever deploy is
   already in flight for the same branch. `cancel-in-progress: false` is
   deliberate: cancelling a `db push` mid-migration could leave the
   schema half-migrated, worse than just waiting.
2. **Self-healing "Push database migrations" step** — even with the race
   eliminated going forward, a stuck version needed a way to recover
   without a human manually running `supabase migration repair` in their
   own terminal each time (which is what was needed to unblock the
   pipeline in this incident). The step now loops (up to 5 attempts):
   runs `supabase db push`; on failure, checks whether the error matches
   `schema_migrations_pkey` specifically, and if so extracts the version
   number from the error text (`Key (version)=(NNNN) already exists.`,
   via `sed`) and runs `supabase migration repair "$version" --status
   applied --yes` (marks the bookkeeping as applied without re-running
   any SQL) before retrying the push. Any other kind of failure still
   fails the step immediately, unrepaired — this only auto-recovers from
   this one specific, well-understood bookkeeping-desync symptom, not
   from arbitrary migration errors.

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
7. **Migration hygiene** — added 2026-08-02 after a real string of deploy
   errors, all traced back to a small set of recurring patterns. Check
   this list before writing any migration that alters an existing
   function/constraint:
   - **Changing a function's arity (parameter count) requires an
     explicit `drop function` of the OLD signature before `create or
     replace` of the new one.** Without it, Postgres doesn't replace the
     function — it **creates a second, coexisting overload**, since
     `create or replace` only replaces a function of the exact same
     signature. This has already caused: (a) `comment on function`
     failing with "function name is not unique" (2026-07-21); (b) two
     conflicting `get_narratives_table` overloads (6 and 7 params) making
     PostgREST silently fail to resolve which one to call — the real
     root cause of `/narratives` returning empty for days (2026-07-14/
     2026-07-26, see above). Any migration that changes a function's
     parameter count must drop the old signature by its exact types
     (e.g. `drop function if exists foo(uuid, date, date, jsonb);`) —
     never assume an earlier migration "already handled this" without
     checking the signature actually live in the database.
   - **Never `select alias.*` inside a CTE/join when another source in
     the same CTE might also have a same-named generic column** (`id` is
     the classic case). `left join lateral get_x(...) gnt` followed by
     `select w.id, gnt.*` produces two `id` columns in the same CTE —
     valid inside it, but becomes `ERROR: column reference "id" is
     ambiguous` the moment the CTE is referenced from outside (real find
     in `get_communication_impact`, 2026-07-26). Always list `alias`'s
     columns explicitly by name.
   - **A nullable column that's part of a uniqueness constraint needs a
     generated non-null surrogate column for the constraint to actually
     work** — SQL treats `NULL <> NULL`, so two rows "equal" except for
     that null column never collide and dedup silently fails. Pattern:
     `col_key bigint generated always as (coalesce(col, 0)) stored`, and
     the `unique` constraint uses `col_key`, not `col` (real find in
     `bw_query_metrics_{daily,weekly,monthly}`, 2026-07-07).
   - **A division guarded by a denominator check must always use `CASE
     WHEN denom > 0 THEN a / denom END`, never `AND denom > 0` inside a
     `WHERE`/compound condition** — Postgres doesn't guarantee `AND`
     operand evaluation order, so the division could in principle be
     evaluated before the guard and divide by zero (real find in
     `event-radar`, 2026-07-27, fixed by extracting a `..._delta_pct()`
     helper with an internal `CASE`).
   - **Never write `column = any((select ...))`** expecting to unwrap an
     array returned by a scalar subquery — Postgres always parses `ANY (`
     immediately followed by a parenthesized `SELECT` as the row-wise
     form (compares against each ROW the subquery returns), never as
     `= ANY(array)`, even when the subquery genuinely returns one row of
     one array. Always `cross join` the source into scope and reference
     a plain column: `= any(source.column)` (real find in
     `aggregated-metrics`, migration `20260714000000`).
   - **CI/CD**: the deploy workflow (`.github/workflows/deploy.yaml`)
     needs `concurrency` (serialize deploys per branch) — without it,
     two close-together pushes trigger parallel `supabase db push` runs
     that both race to apply the same oldest pending migration; whichever
     loses gets stuck on "duplicate key... schema_migrations_pkey" for
     that same version, indefinitely, blocking every new migration queued
     behind it (real incident, 2026-08-02 — see
     "`.github/workflows/deploy.yaml`" above).
   - **Never pick a new migration's timestamp "from memory" — always
     check the actual state of the directory right before naming the
     file.** `supabase_migrations.schema_migrations.version` is a
     primary key — if two different migrations (written in different
     sessions/agents, possibly in parallel) happen to use the same
     timestamp, whichever reaches the remote database second can never
     be applied (collides with the first one's row), and `supabase
     migration repair` **does not fix this** — repair only
     confirms/updates whatever row already exists for that version, it
     can't make room for a second, different migration under the same
     number. Distinguishing symptom (different from a concurrent `db
     push` race, which the `concurrency` guard above already prevents):
     the same "duplicate key... schema_migrations_pkey" **repeats
     identically after every repair attempt**, never resolving on its
     own — if that happens, the first move is `ls supabase/migrations |
     sort | tail` looking for **two files sharing the same timestamp
     prefix**, not assuming it's just another race. Real find this
     session (2026-08-02): `20260731050000_narrative_sentiment_neutral_
     plurality.sql` collided with an unrelated `20260731050000_entities_
     cargo_partido_ideologia.sql` from parallel work on the `entities`
     module — fixed by renaming the file (`git mv`, preserves history)
     to a free timestamp later than anything else on disk. Always run
     `ls supabase/migrations | sort | tail` (or a fresh `git pull`)
     immediately before naming a new file — never trust "today's date"
     from memory.

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
   `font-bold` and `text-text-primary`** (near-black, `#1a1d29`), never
   `font-medium`/`font-semibold` or a gray tone (`text-text-secondary`/
   `text-text-tertiary`) — user feedback 2026-07-13 ("não está bom de
   ler"). `WidgetCard`'s `<h2>`, `MetricCard`/`SentimentMetricCard`'s label
   `<p>`, and `NarrativesTable`'s `<th>` were fixed the same day this rule
   was first written; **`XInsightsPanel`'s and `users-admin-view.tsx`'s
   `<th>` were missed at the time** (still `font-medium text-text-tertiary`)
   and only caught in a follow-up pass on 2026-07-25, after a report that
   some tables were still hard to read. Every `<table>` in this codebase
   (`NarrativesTable`, `XInsightsPanel`, the admin users table) now applies
   both classes on its `<th>` — check this rule specifically any time a
   new `<table>` is added, since it's easy to satisfy the weight half of
   the rule (`font-bold`) while missing the color half.
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
  ⚠️ "For the current week" is stale phrasing as of 2026-07-14 — see
  "Every 'stale-gated' phase's staleness window unified under
  `BW_SYNC_INTERVAL_HOURS`" further below: every one of these staleness
  checks now shares the single `BW_SYNC_INTERVAL_HOURS`-derived window,
  not a fixed week, so this throttle's actual cadence is whatever that
  secret is currently set to.
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

- **`daily_metrics` call-count reduction + sentiment burst spread across
  heartbeats (2026-07-22)** — user follow-up: "ainda com problemas de
  rate limit... verifique se a busca está incremental e se há algo a
  otimizar", with a real log showing the 2026-07-21 proactive gate firing
  as designed (`brandwatch_rate_limit_near_ceiling`, `lastRateLimitUsed:
  27`). The gate was working correctly — the actual problem is that
  `daily_metrics` alone still made up to 14 fixed calls
  (`reachEstimate`/`engagementScore`/`unique_authors`/`impressions`/
  `net_sentiment` × `categories`+`queries` dimensions, plus 4 for
  platform) *plus* 1 sentiment call per Narrativa, all in a single
  invocation — the 2026-07-13 fix only bounded the *total* per invocation
  (`hasBrandwatchCallBudget()`), never the *burst size*, which is what
  actually matters against Brandwatch's real 30-calls/**10-minute**
  ceiling. Two fixes, both Edge-Function-only (no migration):
  1. **Multi-aggregate consolidation.** Brandwatch documents a
     `data/multiAggregate/{dimension}/days?aggregate=a,b,c` endpoint
     ("Multiple Aggregate Charts") that returns one object per point
     keyed by aggregate name (e.g. `{volume: 12, reachEstimate: 12}`) —
     confirmed live against `developers.brandwatch.com/docs/
     multi-aggregate-charts` this session, not inferred. Replaced 5
     separate `categories`-dimension calls and 5 separate
     `queries`-dimension calls with one `multiAggregate` call each
     (`syncCategoryDailyMultiAggregate`/`syncQueryDailyMultiAggregate`),
     and 4 separate `pageTypes`-dimension calls with one more
     (`syncPlatformMultiAggregate`) — `syncCategoryDailyAggregate`/
     `syncQueryDailyAggregate`/`syncPlatformAggregate` are gone, no
     longer used anywhere. 14 fixed calls → 3. Bonus: since
     `netSentiment` is now bundled in the *same* call as reach/
     engagement/authors/impressions, the starvation bug fixed on
     2026-07-20 (reordering calls so `netSentiment` survives a budget cut)
     is now structurally impossible — there's no longer a "later" call
     for it to be starved out of. The positive/neutral/negative sentiment
     split (`syncSentimentMetrics`) can't join this consolidation — it
     isn't a combinable "aggregate," it's the `dimension1=sentiment` axis
     itself, and Brandwatch only accepts 2 dimensions per call (sentiment
     × days already uses both) — it has to stay 1 call per Narrativa.
  2. **That remaining per-Narrativa sentiment loop now spreads across
     multiple heartbeats instead of bursting in one invocation.** The
     whole-query (`category=null`) sentiment call still always runs, no
     freshness gate (cheap, feeds top-line KPIs). The rest of the
     Narrativas are capped to `MAX_SENTIMENT_TARGETS_PER_INVOCATION = 8`
     real calls per invocation and skip (no call spent) any Narrativa
     whose most recent `bw_query_metrics_daily.synced_at` is younger than
     `DAILY_SENTIMENT_FRESH_WINDOW_MS = 25min` (deliberately longer than
     the 15-minute heartbeat, so a Narrativa just processed isn't
     immediately reprocessed next tick) — checked in one batched query
     (`fetchDailySentimentFreshness`), not N queries. If Narrativas remain
     after the cap, the phase returns a new `StepResult.stayOnStep: true`
     — the dispatcher does **not** advance `next_step` (stays on
     `daily_metrics` instead of moving to `hourly_metrics`), so the next
     heartbeat resumes exactly where this one left off. Same "phased
     execution" principle already accepted for `weekly_monthly`/`topics`/
     `top_authors` (CLAUDE.md, "Phased execution per pair"), just applied
     *within* one phase instead of *between* phases. `last_synced_at`
     still only advances when the full 16-phase cycle closes, so a
     `daily_metrics` still mid-burst never closes the cycle early. For a
     moderate Narrativa count (dozens), this still fully refreshes well
     within the default 3-hour `BW_SYNC_INTERVAL_HOURS`.
  Not verified against a live Brandwatch response this session (no
  credentials) — the `multiAggregate` request/response shape is
  doc-confirmed (fetched directly from developers.brandwatch.com), but
  should still be checked against real `[bw-sync]` logs after deploy, same
  standing caveat as every other unconfirmed-payload item in this file.

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

- **Category deactivation wasn't actually running on any predictable
  cadence — decoupled from the phase cycle (2026-07-23)** — user report:
  "as categorias não estão sendo colocadas como inativas quando não
  existem mais na brandwatch." The deactivation logic itself (above) was
  correct — the bug was in *when it ever got a chance to run*.
  `refreshMetadata()` only executes from inside `runMetadataStep()`,
  called exclusively when a pair's `sync_cursors.next_step` equals
  `"metadata"` — the *first* phase of `SYNC_STEPS`, which is only
  re-evaluated once a full 16-phase cycle completes and wraps back around
  (`nextSyncStep()`'s `cycleComplete`). Every "stale-gated" phase
  (`weekly_monthly`/`topics`/`top_authors`/etc.) advances at most one
  `categoryTarget`/group per invocation by design (see "Phased execution
  per pair"), and since 2026-07-22 `daily_metrics` can also span several
  invocations via `stayOnStep` to spread its Brandwatch-call burst — both
  deliberate, accepted trade-offs for their own bugs, but their side
  effect compounds here: for an organization with enough Narrativas, one
  full cycle could stretch well past the nominal `BW_SYNC_INTERVAL_HOURS`
  (3h default), and `needsMetadataRefresh()`'s 1h staleness throttle never
  got a chance to matter, because `"metadata"` simply never came up again
  during that whole stretch. A Category removed in Brandwatch could stay
  `active` in Supabase for as long as one full cycle took to close —
  potentially much longer than the 1h the throttle constant implies.
  Fixed by decoupling the check from where the pair happens to sit in its
  phase rotation: `runSyncInvocation()` now calls
  `needsMetadataRefresh()`/`refreshMetadata()` unconditionally near the
  top of *every* invocation for the pair (right after resolving
  `organizationId`, before `fetchNarrativeCategoryIds()` — so a
  deactivation that happens to fire this same invocation is already
  reflected in this invocation's own `categoryTargets`), guarded by
  `hasBrandwatchCallBudget()` so it never competes for budget ahead of
  whatever the pair's current phase actually needs. Cheap when not due
  (`needsMetadataRefresh()` is just 2 Postgres reads); only spends real
  Brandwatch calls when the 1h throttle has genuinely elapsed. The
  `"metadata"` `SYNC_STEP` itself is left in place, unmodified — it's now
  just usually a harmless no-op (`needsMetadataRefresh()` returns `false`
  immediately after just having run moments earlier in the same
  invocation) — kept for backward compatibility with `next_step` values
  already persisted in `sync_cursors`, not worth a migration to remove.
  Separately, since there was previously **no success log at all** for the
  deactivation `UPDATE` (only a `throw` on error — impossible to confirm
  from Edge Function logs whether it ever ran or how many rows it
  touched), `refreshMetadata()` now chains `.select("id")` on that update
  and logs `refreshMetadata:categories_deactivated` with the affected
  count and IDs — this is what should be checked in production logs after
  a Category is removed in Brandwatch, to confirm the fix end-to-end
  (not done this session — no live credentials, same recurring
  limitation as every prior session without deploy access).

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

### Every "stale-gated" phase's staleness window unified under `BW_SYNC_INTERVAL_HOURS`

User request, follow-up to the ai-synthesis period-mode work above: "isso
deve ser alterado por execução tb, senão os dados ficam desencontrados...
o que eu quero é ter a opção de configurar atualização total com a
Brandwatch a cada 15min ou 30min ou 1h e assim por diante" — after being
told `BW_SYNC_INTERVAL_HOURS` only gates when a *new cycle* starts, the
user correctly flagged that this alone wasn't enough: 10 of `bw-sync`'s
15 phases (`weekly_monthly`'s weekly+monthly grains, `topics`,
`platform_by_narrative`, `x_insights`, `top_authors`, `top_tweeters`,
`top_sites`, `top_shared_sites`, `demographics`, `sov`) each had their own
staleness window hardcoded as a literal (`7 * 24 * 60 * 60 * 1000`, 30
days for the monthly grain) — completely decoupled from
`BW_SYNC_INTERVAL_HOURS`. Lowering the interval to get fresher data would
only have sped up `daily_metrics`/`hourly_metrics`/`mentions`, while
those 10 phases stayed stuck on their week-old snapshot — reproducing,
one layer up, the exact "dados desencontrados" symptom (SOV computed at
one moment, volume at another) that the 2026-08-06 "phase chaining" fix
had just solved at the single-invocation level.

Confirmed the design with the user before implementing (`AskUserQuestion`,
given the real production risk — this project has a documented history of
Brandwatch rate-limit incidents): reuse the single existing secret,
`BW_SYNC_INTERVAL_HOURS`, as the *only* staleness window for every
"stale-gated" phase, rather than adding a second, independent secret
(which would just reopen the mismatch risk if the two were ever set to
different values). New `getSyncStalenessWindowMs()`
(`bw-sync/index.ts`, right after `getSyncIntervalHours()`) —
`getSyncIntervalHours() * 3_600_000` — is now the sole source of the
window passed to all 11 call sites that used to hardcode
`7 * 24 * 60 * 60 * 1000`/`30 * 24 * 60 * 60 * 1000`. `getSyncIntervalHours()`
already parsed via bare `Number(raw)` with no rounding, so it already
accepted fractional hours (`0.25` = 15min, `0.5` = 30min) — no format
change needed, just a wider blast radius for the same value.
`HOURLY_METRICS_WINDOW_MS` (the *fetch range* for the rolling 30-day
hourly window, a different concept — not a staleness gate, deliberately
never throttled) and `needsMetadataRefresh()`'s 1h throttle (categories/
subcategories bootstrap, not a "score" that can look desencontrado next
to another) were both deliberately left untouched — out of scope for this
unification, different failure mode each.

User then asked directly: "mas como podemos fazer para não estourar as
chamadas com a brandwatch?" (how do we avoid exceeding Brandwatch's rate
limit with this). Answered without needing a code change — the existing
safety net already covers it: `hasBrandwatchCallBudget()` (local
25-call/invocation budget plus the real `x-rate-limit-used` header) still
guards every single call regardless of how low the interval is set, and
`SYNC_STEPS`' fixed order (`metadata → mentions → daily_metrics →
hourly_metrics → weekly_monthly → topics → ... → sov`) already means the
time-critical phases are always attempted first in every cycle — if the
call budget runs out, only the phases at the end of the list (the ones
this change makes stale more often) get deferred to the next heartbeat,
never `mentions`/`daily_metrics`/`hourly_metrics`. So a very low interval
for an organization with many Narrativas doesn't produce a 429 — it just
means the cycle takes more heartbeats to close (never idle), same
degradation already accepted for the 2026-08-06 fix. Recommended starting
conservative (e.g. 1h) and watching `[bw-sync]` logs/`lastRateLimitUsed`
before going lower, rather than guessing a value blind.

No migration — Edge-Function-only change (`bw-sync/index.ts`), same
`BW_SYNC_INTERVAL_HOURS` secret already provisioned. Not tested against a
live Brandwatch/Supabase environment this session (no credentials) — same
recurring caveat as every session in this file without deploy access;
`git push` to `develop` is the next step, and the signal to check
afterward is `[bw-sync]` logs showing `topics`/`top_authors`/`sov`/etc.
phases doing real work (`didWork: true`) far more often than once a week
once `BW_SYNC_INTERVAL_HOURS` is lowered.

### `narratives.description` finally gets a producer + a real silent regression found and fixed (2026-07-14)

User request: "O resumo executivo das narrativas ainda não está sendo
feito via IA... Verifique a documentação corrija e implemente o que
estiver faltando" — pasted screenshot showing every Narrative card
("Direita", "Esquerda", "Diplomacia", "Ronaldo Caiado", etc.) stuck on the
fallback string "Resumo automático ainda não disponível para esta
Narrativa." (`narrative-card.tsx`).

**Audit before any code**: `narratives.description` (= `summary` in the
`narratives` envelope block, `get_narratives_table`) has existed since the
very first migration (`20260707000000`) but grepping every migration and
Edge Function confirmed **zero write paths** anywhere — not `bw-sync`, not
any Edge Function, not any UI. `foundation/narratives.md` and
`intelligence-center/narratives-exploration.md` already documented this
explicitly as reserved-but-unpopulated, pointing at "a future `ai-synthesis`
job reusing `event-radar` highlights" as the natural producer — but
`ai-synthesis.md`'s actual scope (confirmed by reading it in full) only
ever covers page-level `narrative_text` ("O que os gráficos mostram?",
Camadas 0/1/2), never a per-Narrativa field. So this was a genuine,
previously-undocumented gap, not a pending product decision — the intended
design was already written down, just never built.

**Built**: `narrative-summary-composer`, a new self-sufficient Edge
Function (Principle 5), scheduled via its own `pg_cron` heartbeat every
30 minutes (migration `20260804010000`) — less urgent than the 15-minute
heartbeats of `bw-sync`/`event-radar` since an executive summary is a
snapshot of current state, not a real-time detection. Flow, mirroring
`event-radar-agent-orchestrator`'s conventions (own dedicated Anthropic
model secret, try/catch per item, never crash the whole invocation, never
write on a failed call):
1. `narrative_summary_due_ids(p_batch_size default 5)` (SQL) — a
   Narrativa is due when its Category/Subcategory is still `active` and
   either: never summarized; last summary is >7 days old (periodic
   refresh — sentiment/momentum/risk drift continuously, not just from
   discrete events); a new `feed_events` row landed for it since the last
   summary; or a new `communications` row (Comunicação/Decisão) landed
   for it since the last summary.
2. `narrative_summary_build_payload(id)` (SQL) — never raw `mentions`
   text, only: the Narrativa's own scores via `get_narratives_table`
   (same source the table/cards already show, so the prose can't
   contradict the numbers next to it), up to 5 recent `feed_events`, up
   to 5 recent `communications` rows.
3. One Claude Haiku 4.5 call per Narrativa (`NARRATIVE_SUMMARY_MODEL`
   secret, own default `claude-haiku-4-5` — same cost-conscious decision
   already made for `event-radar-agent-orchestrator`/`ai-synthesis`
   Camada 1), free-text output (not JSON Schema — this produces prose,
   not structured data, same pattern as `composeLayer1NarrativeText`),
   guarded by a `.slice(0, 500)` truncation in code, never trusted to the
   prompt alone.
4. `update narratives set description = ..., description_generated_at =
   now()` only on success — a failed composition writes nothing, the
   Narrativa stays eligible next invocation.

New column: `narratives.description_generated_at` (nullable timestamptz)
— deliberately not reusing `updated_at` (that trigger fires on any future
write to the row, not just this job's) so staleness detection stays
correct even if another writer touches `narratives` later.

**Real, silent regression found while reading the migration history to
build this** (not something the user reported — found by re-reading the
last few `get_narratives_table` migrations side by side before writing a
new one, per this project's own "always check the actual latest state,
never assume from memory" migration-hygiene habit): `20260802030000`
(the "Neutro predominante" sentiment fix, see "Sentiment label/border
still disagreeing..." above) was written as a `create or replace` copied
from `20260731040000` — the version **before** the `event-radar` risk
boost (`20260802010000`, Fase B/A2) — instead of from `20260802010000`
itself. Same signature, same output columns in both source versions, so
`create or replace` gave no warning: the `radar_boost` CTE and the
`greatest(risk_score, feed_events.severity_score)` wrapping were silently
deleted the same day they'd been added. `sql-aggregation.md` was never
updated to reflect the loss because the 2026-08-02 session only touched
the sentiment paragraph — so the doc kept claiming the boost was live
while the deployed function had already lost it. Fixed in migration
`20260804000000` (reunites both fixes — sentiment + risk boost — into one
`create or replace`, no other CTE touched). Lesson written into
`sql-aggregation.md`'s "Risco" section: before writing a new `create or
replace function <name>` for a function that's already been edited by
more than one prior migration, grep every `create or replace function
<name>` across `supabase/migrations/` and copy from the **highest
timestamp**, never from memory of an earlier session.

⚠️ Not tested against a real Anthropic or Supabase environment this
session (no credentials available) — reviewed manually, including a
parens/braces/`$$`-pair balance check on every new/changed file. `git
push` to `develop` is the next step for this to actually run; confirm via
`[narrative-summary-composer]` logs that `description` is populating
after deploy, same recurring caveat as every other session in this file
without deploy access.

### `narrative_text` (ai-synthesis.md) gains a period-mode-aware trigger + manual "Analisar com IA" for custom ranges

User request: "O resumo executivo gerado pela IA deve ter a
diferenciação, diário, semanal e mensal para suportar a navegação do
usuário. Em caso de período personalizado, vamos colocar um botão no
frontend para possibilitar o usuário final chamar a IA para analisar caso
ele queira."

**Diário/semanal/mensal already worked by construction** — each header
mode (`header-context.tsx`) produces a distinct `period.start`/`period.end`,
and `page_narrative_synthesis`'s key includes both, so switching tabs
already reads/writes its own composition, never reusing another mode's
text. Nothing to fix there. **The real gap was the second half of the
request**: `fetchNarrativeText()` (`aggregated-metrics-service.ts`)
unconditionally scheduled the Camada 1 background composition for *any*
period with 2+ highlights — including a custom range still being typed
into the header's 2 date fields, where every intermediate combination
could fire (and immediately waste) an AI call before the user settled on
a final range.

Fixed with a new optional `period.mode` field (`"daily" | "weekly" |
"monthly" | "custom"`, mirrors the header's `PeriodMode` — added to
`EnvelopePeriod` in `packages/shared-types/src/envelope.ts` and, per
Principle 5, in the canonical `aggregated-metrics-service.ts` plus all 7
deployed `get-page-*`/`get-narrative-detail` inline copies, propagated
mechanically via a scratch Node script and verified byte-identical to
canonical except the pre-existing per-function handler differences):
`fetchNarrativeText()` only calls `scheduleBackground(composeAndPersistLayer1(...))`
when `ctx.period.mode !== 'custom'` — for a custom range, the page always
loads with the Camada 0 deterministic fallback, never triggering AI on
its own (a previously-persisted row for that exact custom range is still
returned as-is, same as any other mode).

New 8th Edge Function, **`compose-narrative-synthesis`** (not a
`get-page-*` — doesn't assemble a full envelope, only the `narrative_text`
block) — a full copy of `aggregated-metrics-service.ts` plus its own
handler, backing a new "Analisar período com IA" button in
`NarrativeTextPanel` (`components/intelligence-center/insights-panel.tsx`,
now `"use client"`), shown only when `periodMode === "custom"`. Reuses a
new `composeNarrativeSynthesisOnDemand()` (same file) — same 2+-highlight
gate as the automatic path (below that, Camada 0 is already sufficient
and deterministic; paying for an AI call would add nothing), but runs
**synchronously** (awaits the Anthropic call before responding) since
this is an explicit, waited-for user action, not a page load that needs
to stay fast — and persists to the same `page_narrative_synthesis` row
`get-page-*` already reads. `NarrativeTextPanel` wires `page`/`onGenerated`
(the page's own `usePageEnvelope().retry`) from all 4 call sites
(`overview`, `sentiment`, `platforms`, `themes` — the only pages that
render this component today; `narrative_detail` has a separate,
pre-existing gap of never reading `narrative_text` at all, out of scope
here) — after a successful compose, the simplest way to show the new text
is just re-fetching the whole envelope, which now finds the freshly
persisted row on the first read, rather than threading a second copy of
`narrative_text` state through each page.

No migration — `page_narrative_synthesis` already had exactly the schema/
key needed. `npx tsc --noEmit` and `npm run build` (with `rm -rf .next`
first) both pass clean, 21 routes (no new Next.js route — the new
function is Edge-Function-only). Not tested against a live Supabase/
Anthropic environment this session (no credentials) — same recurring
caveat as every session in this file without deploy access; `git push` to
`develop` is the next step, and the signal to check afterward is a custom
period's "O que os gráficos mostram?"/"Mudança de sentimento"/"Insights"
widget staying on the Camada 0 template until the button is clicked, with
no `[aggregated-metrics] composeLayer1NarrativeText` log line firing on
its own for that request.

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

### Página Pautas Eleitorais: escopo corrigido para a categoria Pautas + simplificação global de narrativas-folha (2026-07-21)

User request, 3 parts in the same session: (1) "Página Pautas Eleitorais...
Essa página deve focar apenas na categoria Pautas. A ideia é que a análise
que compõe essa página venha de todas as subcategorias de Pautas. Corrija
a documentação e implementação"; (2) "em Autores e comunidades por pauta
deve aparece apenas os autores que citaram algo relacionado as Pautas e
deve ser informado a que pauta ele está associado, e poderá ser mais de
uma"; (3) "Estrutura das pautas / Deve mostrar as subcategorias da
categoria Pautas" (confirmation of (1)); mid-turn correction: "Para
facilitar vamos considerar apenas as subcategorias em todas as narrativas.
Retire a regra de 'categoria - subcategoria'. Em Pautas faz-se uma
restrição de todas as subcategorias da categoria Pautas."

**Root cause (1)**: `electoral-themes.md`'s original model (since
2026-07-12) treated *any* root-level `bw_categories` row as a "Pauta" —
its own "Achado principal" text justified this by noting the prototype's
example pauta names (Educação, Saúde, Segurança) happened to match example
Narrativa names elsewhere. In practice this meant `get_theme_breakdown`
and `/themes`'s `narratives` block mixed real electoral themes with
unrelated top-level Categories a campaign might configure for
crisis/monitoring purposes (`brandwatch-setup.md`'s own examples:
"Pesquisas", "Diplomacia", "Banco Master") — none of which are electoral
themes. Corrected model: there is one specific root Category, named
literally **"Pautas"** (by convention, same name-matching pattern already
used elsewhere in this project — see `brandwatch-setup.md` §5, "nomear a
Category com o mesmo texto de `narratives.title`"), and only **its**
Subcategories (Educação, Saúde, Segurança, Transporte...) are real
electoral themes. Migration `20260721030000` adds
`pautas_root_category_id(organization_id)` (resolves that Category by
`parent_id is null` + `lower(btrim(name)) = 'pautas'`, returns `null` if
not configured — every consumer treats that as "no pautas", never an
error) and rescopes `get_theme_breakdown` (was: `bc.parent_id is null`,
any root; now: `bc.parent_id = pautas_root_category_id(...)`) and
`get_narratives_table` (new `p_scope => 'pautas'` value, alongside
existing `'roots'`/`'leaves'`). Since Brandwatch only supports 2 levels
(Category → Subcategory, `brandwatch-setup.md` §5 — "toda Category precisa
de ao menos 1 Subcategory", never deeper), a pauta (already a Subcategory)
has no children of its own — the old "narrativas dentro da pauta"
drill-down concept (`_pending.md` gap #17) doesn't apply to the corrected
model and is closed as not-applicable rather than implemented.
`brandwatch-setup.md` gained an explicit operational note + Definition-of-
Ready checklist item: a client's Brandwatch Project needs a root Category
named exactly "Pautas" with one Subcategory per real electoral theme, or
`/themes` shows nothing.

**Root cause (2)**: `get_authors_ranking`'s `fetchAuthors()` call from the
`themes` page never passed any category-scoping filter (`ctx.filters`
stays whatever the header's presentational-only "Filtros avançados" sends,
normally empty) — so "Autores e comunidades por pauta" was silently
showing the exact same generic top-authors ranking as every other page,
with zero relation to Pautas. Fixed, same migration: `get_authors_ranking`
gains `p_scope` (`'pautas' | null`) — when `'pautas'`, scopes
`bw_query_top_authors`/`bw_query_top_tweeters` to the Subcategories of
"Pautas" directly (bypassing `filters.narratives`, since this page has no
single-Narrativa selector — it *is* the Pautas universe) instead of
"Query inteira" (the default when no filter is set). An author can have
activity under more than one pauta (e.g. cited both in "Saúde" and
"Segurança"), so the function now **groups by author** (previously one row
per matching category, silently duplicating an author if more than one
category matched — a latent bug now fixed everywhere, not just for
`'pautas'`) and returns a new column, `narrative_labels text[]` — every
pauta title the author appeared under in the requested scope, always an
array (empty when the scope has no Narrativa association, e.g. the normal
"Query inteira" case on other pages). ⚠️ Aggregating reach/engagement by
`sum()` across an author's matched pautas can double-count if a single
mention is categorized under more than one pauta simultaneously in
Brandwatch — same trade-off category already accepted project-wide for any
sum over per-Category aggregates (not a new local-aggregation-over-
`mentions` violation, since `bw_query_top_authors` is itself already an
official Brandwatch aggregate, never `mentions` rows). `AuthorRow`
(`@reputation/shared-types` + the inline Deno copy in
`aggregated-metrics-service.ts` and all 6 deployed `get-page-*`/
`get-narrative-detail` functions, Principle 5) gained `narrative_labels:
string[]`; `AuthorsList` (`authors-list.tsx`) renders them as a row of
small pill chips under the author's name, only when non-empty — harmless
on the other pages that reuse this same component (`platforms`,
`narrative_detail`), where the array normally has at most 1 item since
those scopes are already "Query inteira" or "1 Narrativa".

**Mid-turn simplification (3), superseding 2026-07-20's "Categoria -
Subcategoria" decision**: while implementing the above, the user asked to
simplify further — every page that lists Narrativas should show only
Subcategories (never mix in the root Category), which is exactly the
`'pautas'` scoping principle generalized to the whole product. This
reverses 2026-07-20's "mostrar todas as narrativas" change (`p_scope =>
null` on Overview/Narrativas, enabled by composing the Narrativa title as
"Category - Subcategory" to disambiguate a bare Subcategory name shown
next to its parent Pauta in the same flat list) — with the root Category
never appearing in the list again, that disambiguation need goes away.
`narrativesScopeForPage()` (`aggregated-metrics-service.ts` + its 6
deployed copies) simplified from `'roots' | 'leaves' | null` to `'leaves'
| 'pautas'` — every page now returns `'leaves'` except `themes`, which
returns the more restrictive `'pautas'`; `'roots'`/`null` have no more
callers (left in the SQL function's accepted values for signature
stability, just unused). `buildNarrativeTitle()` (`bw-sync/index.ts`)
reverted to returning just the Category/Subcategory's own name (dropped
the parent-name-prefix composition entirely, including its now-unused
`categoryRows` lookup parameter); migration `20260721030000` also backfills
every existing Narrativa-Subcategory's `title` back to the plain name (same
safety argument as 2026-07-20's original backfill in reverse: no Narrativa
CRUD exists anywhere in the product, so `title` is 100% derived and safe
to mass-update).

**Docs**: `intelligence-center/electoral-themes.md` (full rewrite of
"Mapeamento de conceito"/"Fluxo principal"/alt-flow table/"Interface"),
`aggregated-metrics/sql-aggregation.md` (`pautas_root_category_id`,
`get_theme_breakdown`, `get_narratives_table`'s `'pautas'` value,
`get_authors_ranking`'s `p_scope`/`narrative_labels`),
`service-layer-aggregation.md`, `narratives-exploration.md`,
`executive-overview.md`, `foundation/narratives.md` (title-rule reversal),
`foundation/brandwatch-setup.md` (operational note + checklist item for
the "Pautas" root Category), `_pending.md` (new ✅ Resolvida entry; gap
#17 closed as not-applicable to the corrected model).

**Verification**: migration `20260721030000` reviewed manually, not run
against a live database (no Supabase/Brandwatch access in this
environment, same recurring limitation as every prior session without
deploy credentials) — `npx tsc --noEmit`/`npm run build` should be run
before this ships to confirm the widened `AuthorRow`/`fetchAuthors`
signature changes compile clean across all 6 Edge Functions and the
frontend.

### Default organization — self-service, third `user_profiles` write (2026-07-22)

User request: "Permitir o usuário a escolher qual organização é a default.
Ele poderá alterar no menu de seleção da organização." No spec previously
covered this — `_glossary.md`'s "Organization Member" scope note was, in
fact, stale on a related point: it still said "troca de organização ativa
pela UI... continua fora do MVP," even though the header's org `<select>`
(`page-header-bar.tsx`) has switched the *session's* active organization
since Sprint 2 — nobody had corrected that note when the selector shipped.
Updated both problems at once: the note now reflects that switching
already exists, and documents this session's actual addition, which is
narrower — *persisting* which organization is the default across reloads,
not switching itself.

- **`user_profiles.default_organization_id`** (migration
  `20260722000000`) — nullable `uuid references organizations(id) on
  delete set null`. Nullable (unlike `timezone`, which has a sane default)
  because the user may never have chosen one; the frontend falls back to
  the first organization returned, same as before this change, whenever
  it's `null`. No RLS UPDATE policy added — same standing rule as every
  other `user_profiles` column (`auth/data-model.md`, "Nenhuma policy de
  INSERT/UPDATE/DELETE para o client é proposital"): the client can only
  read its own row; writing goes through a dedicated Edge Function.
- **`update-my-default-organization`** (new Edge Function, third
  self-service write to `user_profiles` after `update-my-timezone`) —
  copies that function's exact auth/error-handling template (Bearer token
  → `supabaseAdmin.auth.getUser(token)` → generic 500 on any Postgres
  error, never leak `error.message`). One real validation step beyond the
  timezone function's: it checks `organization_members` server-side
  (`user_id = caller`, `organization_id = <requested>`) and 403s if no row
  exists, rather than trusting the `organizations` list the client already
  has (Principle 2 — that list is RLS-scoped correctly today, but the
  Edge Function must not assume the client can't send back an arbitrary
  ID; the frontend never gets to be the source of truth for "is this user
  actually a member").
- **`useUserProfile()`** (`hooks/use-user-profile.ts`) gained
  `defaultOrganizationId: string | null` — added to `UserProfile`, the
  `.select(...)` string, `FALLBACK_PROFILE`, and the loaded-state mapping.
  Its existing `retry()` (already there for the 3-state loading pattern)
  is what lets the header refresh its view of `default_organization_id`
  right after a successful save, with no full page reload needed.
- **`header-context.tsx`**: the mount-time effect that used to
  unconditionally pick `organizations[0]` now prefers
  `defaultOrganizationId` first (only if the user is still a member of
  that organization — `organizations.find(...)`, so a since-revoked
  membership degrades to the old first-org fallback rather than dead-ending
  on an ID that's no longer in the list) before falling back to
  `organizations[0]`. New `setCurrentOrganizationAsDefault()` action
  (exposed via context) calls the Edge Function for the *currently active*
  organization and calls `retryUserProfile()` on success — deliberately
  lets its own error propagate to the caller (doesn't swallow it) so
  `PageHeaderBar` can show a real error toast rather than failing silently.
  Note this file's own long-standing "sem persistência entre reloads"
  comment was correct when written (2026-07-15) but is now only true for
  *period*, not organization — updated in place rather than left stale
  like the `_glossary.md` note above.
- **UI** (`page-header-bar.tsx`): a star toggle (`☆`/`★`) next to the
  existing organization `<select>` — only rendered alongside it (i.e. only
  when the user has >1 organization, same condition the select already
  uses). Filled + disabled when the active organization is already the
  default (nothing to do); outline + clickable otherwise. Follows every
  relevant Cross-cutting UX rule already established in this file: shows
  "…" and disables itself while the call is in flight (rule 5), and always
  ends in a toast (rule 3) — reused the exact local-state
  `Toast`/`setTimeout(4000)` pattern already used in
  `users-admin-view.tsx`, since this component had no toast plumbing of
  its own yet.
- **Deliberately not built**: no way to *unset* a default once chosen (no
  product ask for it), and no reconciliation if a user's membership in
  their current default organization is later revoked by an admin — the
  column just keeps pointing at an org they're no longer in, silently
  falls back to first-org behavior next time they load the app (the
  `organizations.find(...)` guard in `header-context.tsx` already handles
  that gracefully, it's just never explicitly cleared server-side). Not
  flagged as a gap needing a fix — low-value edge case (self-corrects on
  next load) versus the complexity of doing it from the membership-removal
  side, which is a different, currently-unbuilt admin flow.

> ✅ **Bug real encontrado e corrigido (2026-07-25)** — user report: "Sempre
> que utilizo ctrl+r ele vai para a última organização cadastrada e não
> para a que está marcada como default." Causa raiz: condição de corrida
> real entre os 2 fetches independentes que `header-context.tsx` depende —
> `useOrganizations()` e `useUserProfile()` (este último é quem carrega
> `defaultOrganizationId`). O efeito que decide a organização inicial só
> checava `organizationsStatus === "loaded"`, não o status do perfil — num
> reload frio (Ctrl+R remonta a árvore React inteira, refaz os 2 fetches do
> zero), se a lista de organizações resolvesse primeiro (comum, é a query
> mais simples das duas — `useUserProfile` também busca `full_name`/
> `is_admin`/`is_principal`/`timezone`), o efeito rodava com
> `defaultOrganizationId` ainda no fallback (`null`, perfil não tinha
> carregado de verdade ainda), travava em `organizations[0]` via seu guard
> `!organizationId`, e **nunca mais reavaliava** quando o valor real do
> perfil chegava um instante depois — a organização padrão salva parecia
> nunca ser respeitada, mas só em reload, nunca durante uma troca manual na
> mesma sessão (por isso não foi pego na sessão original). Corrigido
> adicionando `userProfileStatus !== "loading"` como condição extra do
> mesmo efeito — espera o perfil sair de "loading" (carregado OU erro; erro
> degrada pro mesmo fallback de sempre, `organizations[0]`) antes de decidir
> a organização inicial. Nenhuma mudança de schema/Edge Function — só o
> efeito em `header-context.tsx`. Sobre a segunda parte do pedido do
> usuário ("mesmo que o usuário limpe o cache, deve permanecer a
> organização default selecionada"): já era verdade antes deste fix e
> continua sendo — a preferência é lida do banco (`user_profiles`) a cada
> carregamento, nunca de `localStorage`/cookie local, então limpar cache do
> navegador não a afeta (só um logout de verdade removeria a sessão que
> permite ler o perfil).

**Verification**: `npx tsc --noEmit` passes clean. `npm run build` was
**not** confirmed clean this session — it currently fails on an unrelated,
pre-existing issue found in the working tree at the start of this session:
`app/(intelligence-center)/(analytics)/narratives/page.tsx` still
references `NarrativeRow.velocity_score`/`velocity_label`, which
`packages/shared-types/src/envelope.ts` no longer has (already renamed,
uncommitted, to `trend_score`/`trend_label` — `NarrativeTrendLabel`, dated
2026-07-13 in its own code comment) alongside an uncommitted migration
`20260722010000_velocity_to_statistical_trend.sql`. Neither of those files
was touched by this session's work and this session has no context on
that rename's intended final shape across every consumer — left
untouched rather than guessed at. Whoever picks this up next should finish
that rename (or revert it) before `npm run build` will pass again; it is
unrelated to the default-organization feature, which type-checks and
builds correctly in isolation. ✅ **Resolvido 2026-07-24** — ver "Velocidade
→ Tendência..." abaixo: a mesma migration foi completada (era de fato o
que essa migration/rename pendente estava fazendo) e todo consumidor
atualizado em conjunto.

### Velocidade → Tendência, modal de Detalhe de Narrativa, e cadência do event-radar (2026-07-24)

User request, 3 itens na mesma sessão: "1) Rota de `/narratives/[id]`:
página própria vs. modal... faça Modal e se o usuário quiser ele irá para
a tela com mais detalhes, deixa essa opção no modal. 2) Intervalo exato do
pg_cron do motor de detecção (15min vs. 30min) — Manter em 15min. 3) Vamos
retirar a opção de velocidade em narrativas e substituir por tendência, em
que, baseado nos valores é calculada uma tendência estatística da
narrativa, se ela tente a diminuir ou a aumentar. Dessa maneira os
indicadores de risco se mantém como risk_score e momentum." All three were
open items in `_pending.md` (decisions #1/#4) or an entirely new ask
(Velocity→Trend) — all three closed this session.

- **Modal for `/narratives/[id]`** — this picks up exactly where the
  2026-07-22 "Default organization" session above left off: the modal
  decision (`narratives-exploration.md`, "Fluxo principal" item 5) had
  been specified since 2026-07-12 but only ever shipped as a full page
  (`_pending.md` gap #16). Implemented as originally specced: Next.js
  parallel route `@modal` on `app/(intelligence-center)/(analytics)/layout.tsx`
  (new `default.tsx` returning `null` for every non-intercepted route) +
  intercepting route
  `app/(intelligence-center)/(analytics)/@modal/(.)narratives/[id]/page.tsx`.
  The loaded-state body of the old `narratives/[id]/page.tsx` was
  extracted into `components/intelligence-center/narrative-detail-content.tsx`
  (`NarrativeDetailContent`, an `isModal` prop toggles whether it renders
  its own `PageHeaderBar` and whether the top link is "← Voltar para
  Narrativas" or "Abrir página completa ↗") — the same component now
  backs both the full page (`narratives/[id]/page.tsx`, now a ~12-line
  wrapper) and the modal (`narrative-detail-modal.tsx`, the overlay/close
  chrome — `router.back()` on the ✕ button, backdrop click, and Esc). Per
  the user's explicit ask ("deixa essa opção no modal"), the modal's
  "Abrir página completa" is a plain `<a>`, not `next/link` — a
  client-side navigation to the same `/narratives/[id]` URL would just be
  re-intercepted by the same modal (Next.js interception is keyed off
  *how* the navigation happens, not the URL), so escaping it for real
  requires a hard/document navigation, which a native anchor forces.
  Because `@modal` is declared once on the shared `(analytics)` layout
  (not scoped to `/narratives` specifically), this interception fires for
  a click from **any** page under `(analytics)` — Overview's "Top 3
  Narrativas" cards, the shared `NarrativesTable` on `/platforms`/`/themes`,
  not just `/narratives` itself — since all of those already link to
  `/narratives/[id]` via the same `NarrativeCard`/`NarrativesTable`
  components. Direct/shared-link access to `/narratives/[id]` (or a hard
  reload) is unaffected — Next.js only renders the intercepted view for
  soft client-side navigations, so a fresh document load always resolves
  to the real, non-modal page. First use of both parallel routes and
  intercepting routes in this codebase.
- **`event-radar` pg_cron interval** — set to 15 minutes
  (`event-radar/detection-engine.md`, "Fluxo principal" item 1), same
  cadence already used by `bw-sync-heartbeat`. `event-radar` itself is
  still `rascunho`/unimplemented (Sprint 3) — this only closes the open
  product decision in the spec text, no code/migration involved (there's
  no `pg_cron.schedule(...)` call to write yet, the module has no
  tables).
- **Velocidade → Tendência** (migration `20260722010000_velocity_to_statistical_trend.sql`
  — this is the exact migration the 2026-07-22 session above found
  already created, uncommitted, with `envelope.ts` half-renamed and no
  consumers updated; this session is what actually built it out, not a
  coincidence of timestamp): `get_narratives_table` drops
  `velocity_score`/`velocity_label` (soma de `bw_query_metrics_hourly`
  últimas-3h vs. 3h-anteriores, 5 rótulos) for `trend_score`/`trend_label`
  — a real statistical trend, Postgres's built-in `regr_slope` (linear
  regression, standard SQL aggregate) over the last 14 days of
  `narrative_metrics.total_mentions`, normalized to 0-100 (50 = stable)
  the same way `norm_growth` normalizes a growth ratio, clamped at ±100%
  of the period's own average. Requires ≥4 daily data points to compute a
  regression at all (`null`/"sem histórico suficiente" otherwise, same
  treatment as every other score's missing-history case) — 3 labels
  (`decreasing`/`stable`/`increasing`) replace Velocity's 5
  (`shrinking_fast`/`declining`/`stable`/`growing`/`viral`). Independent
  of the header's selected period, same as Velocity was — just a fixed
  14-day window instead of a 3h/3h snapshot, deliberately less noisy.
  Function signature required a `drop function` before `create or
  replace` (same lesson as `20260721010000` — Postgres won't let you
  rename a return-table column via bare `create or replace`).
  `risk_score`'s formula/weights are **unchanged in shape** — Momentum and
  Risk explicitly "stay as indicators" per the user's own wording — only
  the *source* of the 20%-weighted "recent growth" term switches from
  `velocity_score` to `trend_score`; this specific substitution wasn't
  addressed directly by the request, so it's flagged as the conservative
  reading in `sql-aggregation.md`, "Risco", rather than silently assumed.
  The still-open ⚠️ DECISÃO PENDENTE about an interaction term (dampening
  Momentum/Trend's contribution to risk when sentiment is very positive)
  is untouched, just reworded.
  Propagated everywhere the old field names lived, since Principle 5 means
  there's no single source of truth on the Deno side: `packages/shared-types/src/envelope.ts`
  (`VelocityLabel` → `NarrativeTrendLabel`, deliberately not named `Trend`
  — that name is already taken by the unrelated time-series chart type
  `Trend`/`TrendPoint`, `PageEnvelope.trends`), the canonical Deno copy
  (`supabase/functions-shared-source/aggregated-metrics-service.ts`), and
  all 6 deployed Edge Functions' own inline copies
  (`get-page-{overview,narratives,sentiment,platforms,themes}`,
  `get-narrative-detail` — the latter also has a `NarrativeSummary`-shaped
  extra in `ui_meta.narrative` with its own copy of the same 2 fields).
  Frontend: `score-badges.tsx`'s `VelocityIndicator`/`VELOCITY_META` →
  `TrendIndicator`/`TREND_META` (3 entries now, not 5 — arrows
  ↓/→/↑, reusing the existing `intensity-2/3/4` tokens rather than
  inventing new colors), `narratives-table.tsx`'s "Velocidade" column →
  "Tendência" (tooltip rewritten to describe the regression), the
  row-selection summary panel and `narrative-detail-content.tsx`'s header
  badge. `_design-tokens.md` gained a dedicated "Tendência (3 faixas)"
  table (was folded into a shared "Momentum e Velocidade" table before —
  split apart since the two no longer share the same band boundaries),
  with the old 5-band table kept as a collapsed "Histórico" `<details>`
  rather than deleted outright. `NarrativeCard` (the redesigned card from
  2026-07-21) never showed a Velocity badge to begin with, so it's
  unaffected — the divergence between it and `narratives-exploration.md`'s
  card description (which still says "SOV, momentum, velocidade") predates
  this session and wasn't introduced by it, just left with a note pointing
  at the pre-existing gap instead of silently perpetuating it.
  `event-radar/severity.md`'s own unrelated "Velocidade" weight (20% of
  `severity_score`, a still-undesigned per-*event* escalation-speed
  factor, not the per-*narrative* indicator) was deliberately **not**
  renamed in lockstep — flagged inline as a distinct, still-`rascunho`
  concept instead, since renaming it would have implied it now reuses the
  14-day regression, which was never decided.
- **Verification**: `npx tsc --noEmit` and `npm run build` both confirmed
  clean this session (resolving the build breakage the 2026-07-22 session
  had flagged and left open). No live Supabase access — migration
  `20260722010000` reviewed manually, not run against a real database,
  same recurring limitation as every migration-only session in this file
  without deploy credentials. No browser automation available — the modal
  overlay's actual rendering (backdrop, close affordances, responsive
  width) was not visually confirmed in a browser, same standing limitation
  noted throughout this file's `intelligence-center` sessions.

### Narrative card border / table "Sentimento" column disagreeing with the card's own pos/neu/neg bar — real root cause found (2026-07-25)

User report, via screenshot: the Renan Santos card had a red (negative)
left border while its own pos/neu/neg bar showed neutro (62.8%) as
dominant; the Segurança Pública card had a gray (neutral) border while its
bar showed negativo (40.2%) as dominant — and the "Todas as Narrativas"
table's "Sentimento" column showed the same wrong-looking values. This is
the same user complaint already logged twice before (2026-07-20, migration
`20260720000000`; 2026-07-21, `_pending.md` gap #25, "reaudited, no new bug
found") — both prior sessions checked and fixed real things (a
diluted-fallback formula, a call-budget starvation bug) but neither was
the actual cause of *this* specific symptom, and neither had a concrete
screenshot to diagnose from.

**Real root cause**: `get_narratives_table`'s `net_sentiment`/
`sentiment_label` (what `NarrativeCard`'s left border and
`NarrativesTable`'s "Sentimento" column both read, `narrative-card.tsx:39`/
`narratives-table.tsx:153`) came from the `latest_day` CTE — a single-day
snapshot (`distinct on (narrative_id) order by metric_date desc`, i.e. the
most recent day inside the requested period) — while
`sentiment_positive_pct`/`neutral_pct`/`negative_pct` (the pos/neu/neg bar
rendered on the *same* card) came from `period_agg`, summed over the
*entire* requested period. Two different time windows feeding two visual
elements of the same card: a single recent day can easily read differently
in tone than the period as a whole, so the border color and the bar could
legitimately disagree — exactly what both screenshots showed. Neither
prior session (2026-07-20/21) had looked at this because both were
investigating *why net_sentiment might be wrong*, not *why net_sentiment
and the pct split might be computed over different date ranges*.

**Fix** (migration `20260725000000`, same file as the risk-score
interaction term added earlier that session — edited before it had been
deployed): new `sentiment_final`/`sentiment_labeled` CTEs compute
`net_sentiment` as a `total_mentions`-weighted average over the *same*
`period_start`/`period_end` window `period_agg` already uses (only over
days where `net_sentiment` synced), falling back to the same local
`positivo/(positivo+negativo)*100` formula the pct split's fallback
already uses (never dividing by total mentions — same care taken in
`20260720000000`) when no day in the period has `net_sentiment` synced.
`sentiment_label` buckets that same value into the existing 7 bands.
`risk_inputs.sentiment_risk` was also switched from `latest_day.net_sentiment`
to this new period-consistent value, so `risk_score` stays coherent with
what the card/table now show. `latest_day` no longer selects
`net_sentiment`/`sentiment_bucket` at all (dead columns removed, not just
unused). `_pending.md` gap #25 closed with the real cause on file, in case
this resurfaces a third time with a different, still-undiscovered cause —
see `aggregated-metrics/sql-aggregation.md`, "Sentimento (já um score, não
precisa de cálculo aqui)" for the corrected spec text (the original said
"repassa o valor do dia mais recente," which was the bug itself, not a
description of intended behavior).

**Also fixed the same session** (unrelated report, same message): two
`<table>` components had been missed by the 2026-07-13 "table headers must
be `font-bold`" rule (Cross-cutting UX rule 7) — `XInsightsPanel` and
`users-admin-view.tsx`'s users table both still had `font-medium
text-text-tertiary` headers. Both switched to `font-bold text-text-primary`,
matching `NarrativesTable`'s existing correct styling. Rule 7 above updated
to call out the color half of the rule explicitly (not just weight), since
that's the half that was actually missed.

**Verification**: `npx tsc --noEmit` passes clean. No live Supabase access
in this environment — migration reviewed manually, not run against a real
database, same recurring limitation as every migration-only session in
this file without deploy credentials.

### Narrative cards on `/narratives` grouped by category (2026-07-25)

User request: "os cards que ficam abaixo [na página de Narrativas], devem
ser organizados pela categoria. Podemos utilizar raia ou outro componente
que achar mais apropriado para facilitar o agrupamento e localização da
narrativa."

- **Backend**: `get_narratives_table` gained `category_label` (migration
  `20260725050000`, required a `drop function` first — same recurring
  Postgres constraint as every prior column addition to this function,
  see `20260721010000`/`20260725000000`). Value = the parent Category's
  name (`bw_categories.parent_id`, resolved in the `scope` CTE via
  `coalesce(parent_bc.name, bc.name)`) — the same relationship
  `pautas_root_category_id()` and the `'leaves'`/`'pautas'` scope filters
  already use, no new data, just never returned before. Falls back to the
  Category's own name for a `'roots'`-scope row (no parent) — never
  `null`, always a valid grouping key.
- **Propagation** (Principle 5 — no shared import for Edge Functions):
  `NarrativeRow`/`NarrativeTableRow` in `packages/shared-types/src/envelope.ts`,
  the canonical `supabase/functions-shared-source/aggregated-metrics-service.ts`,
  and all 6 deployed `get-page-*`/`get-narrative-detail` inline copies all
  gained the same `category_label: string` field — pure passthrough, no
  mapping code needed (`fetchNarratives`'s `{ ...row, tags: ... }` spread
  already carries any RPC column through).
- **Frontend**: new `components/intelligence-center/narrative-category-lanes.tsx`
  (`NarrativeCategoryLanes`) replaces the flat `grid-cols-1 sm:grid-cols-2
  md:grid-cols-3` card grid on `/narratives`' "no row selected" state
  (`app/(intelligence-center)/(analytics)/narratives/page.tsx`) — groups
  rows by `category_label` into sections, each with a header (category
  name + count) followed by that category's own grid of the same
  `NarrativeCard`s as before. Categories sorted alphabetically
  (`localeCompare('pt-BR')`) — the goal is finding a Narrativa quickly
  ("localização"), not re-ranking by risk (the interactive table above the
  cards already covers prioritization); within a category, the original
  risk-desc order from `get_narratives_table` is preserved.
- **Design call**: chose stacked sections with a wrapping grid per
  category over a literal horizontal-scroll swimlane ("raia" in the
  Kanban/roadmap sense). Reasoning: this app has no horizontal-scroll
  card-carousel pattern anywhere else (every list in `intelligence-center`
  wraps into a responsive grid), and a wrapping grid stays fully scannable
  without requiring drag/scroll — a better fit for "localização" than
  introducing a new interaction paradigm for one page. Documented as a
  design decision, not a closed product decision — revisit if the user
  specifically wants the horizontal-lane look.
- **Verification**: `npx tsc --noEmit` passes clean. No live Supabase
  access in this environment — migration reviewed manually, not run
  against a real database, same recurring limitation as every
  migration-only session in this file without deploy credentials. No
  browser automation available — the grouped layout's actual rendering
  was not visually confirmed in a browser.

**Follow-up, same day**: user asked for each category lane to be
expandable/collapsible. `NarrativeCategoryLanes` gained a `"use client"`
directive (needed `useState`) and a `Set<string>` of collapsed category
labels; the category header is now a `<button>`
(`aria-expanded`/`aria-controls`) that toggles membership in that set and
shows the same ▲/▼ indicator `page-header-bar.tsx`'s "Filtros" toggle
already uses — reused an existing visual convention rather than adding a
new icon. All lanes start expanded; state isn't persisted across
navigations, same as `filtrosOpen` in the header. `npx tsc --noEmit`
passes clean.

### Sentiment label/border still disagreeing with the card's own pos/neu/neg bar — second, different root cause (2026-07-25)

Same day, same symptom class as the "Narrative card border / table
Sentimento column" fix above, but a **different concrete bug** — the
first fix (migration `20260725000000`) closed a time-window mismatch
(`latest_day` snapshot vs. `period_agg` sum); this session's screenshot
("Economia": pos 17.1% / neu 40.3% / neg 42.5% — negative is the plurality
— with a neutral-looking border/label) proved that fix alone wasn't
enough — a second, independent cause was still live.

**Root cause**: even after the time-window fix, `sentiment_final` still
preferred a `total_mentions`-weighted average of `narrative_metrics.net_sentiment`
— **Brandwatch's own officially-synced score** — whenever it had synced
for the period, falling back to the local proportion formula only when it
hadn't. But `net_sentiment` is populated from a *different, independent*
Brandwatch API call (`data/netSentiment/categories/days`) than
`sentiment_positive`/`neutral`/`negative` (`data/volume/sentiment/days`)
— two separately-computed official aggregates with no guarantee of
reconciling with each other. That's exactly what happened for "Economia":
the official `net_sentiment` landed in the neutral band while the actual
proportion between classified mentions (the same 3 numbers the card's own
bar renders) has negative as the plurality — so the label/border
contradicted the numbers displayed right next to them on the same card.

**Fix** (migration `20260725060000`, `create or replace` only — no output
columns changed, so no `drop function` needed this time): `net_sentiment`/
`sentiment_label` now come **exclusively** from the local proportion
formula (`(positivo - negativo) * 100 / (positivo + negativo)`) over the
same `period_agg` sums already used for `sentiment_positive_pct`/etc. —
Brandwatch's officially-synced `net_sentiment` column is no longer read
by this function at all, not even as a preferred source. This isn't a
regression against Principle 2 ("never aggregate locally over sampled
`mentions`") — `sentiment_positive`/`neutral`/`negative` in
`narrative_metrics` are themselves an official, non-sampled Brandwatch
aggregate; this only derives a score from them, the same formula already
used as the fallback since `20260720000000`, now promoted to the only
source. By construction, the label/border can no longer disagree with the
bar on the same card — both are computed from the identical 3 numbers.
`risk_inputs.sentiment_risk` inherits the fix automatically (reads
`sentiment_labeled.net_sentiment`, no change of its own).

**Deliberately out of scope**: `public.narratives_overview.sentiment_bucket`/
`net_sentiment` (the per-day view, used only for `sov_percent`/
`total_mentions` in `get_narratives_table`'s `latest_day`, and mirrored to
`reporting.narratives_overview` for external BI) still prefers the
official `net_sentiment` with the same theoretical two-source risk — left
untouched because no UI in the product reads `sentiment_bucket` from that
view directly (confirmed by grep), so there's no visible symptom to fix
there today. Revisit if a BI consumer reports the same contradiction.

**Verification**: `npx tsc --noEmit` passes clean (no TypeScript changed
by this fix — SQL-only). No live Supabase access in this environment —
migration reviewed manually, not run against a real database, same
recurring limitation as every migration-only session in this file without
deploy credentials.

## Módulo `communications` (Sprint 2.1) — spec + implementação completa (2026-07-25)

Spec escrita e implementada na mesma sessão (usuário pediu a spec, depois,
em turnos seguintes da mesma conversa, refinou 2 decisões de produto e por
fim pediu "implemente o módulo completo de comunicação, backend e
frontend"). Ver `.dev/specs/communications/` para a spec completa
(`overview.md`/`data-model.md`/`communication-registration.md`/
`narrative-impact-tracking.md`, todos `status: implementado`).

**O que é**: time de comunicação registra duas coisas por Narrativa —
**Comunicações** (post/e-mail/propaganda de TV etc., campos completos) e
**Decisões** (data/título/responsável/detalhamento, campos reduzidos) —
mesma tabela (`communications.record_type`), mesmo formulário, mesma
tela. A partir da data de cada registro (`occurred_at`), o produto compara
uma janela antes/depois (default 7 dias, seletor 3/7/14) em Sentimento/
Menções/Risco/Momentum, reaproveitando as fórmulas já fechadas de
`aggregated-metrics` — nunca uma segunda implementação divergente delas.

**Backend**:
- `supabase/migrations/20260726000000_communications_schema.sql` —
  `communication_types` (tabela de referência com seed de 8 tipos, não
  enum — pedido explícito do usuário: "a lógica do módulo pega dela"),
  enum `communication_record_type` (`communication`\|`decision`, esse sim
  um enum — estrutural, só 2 valores, não se espera que cresça),
  `communications` (CHECK constraint garantindo que os 4 campos exclusivos
  de Comunicação — `communication_type_id`/`channel_detail`/
  `external_url`/`bw_resource_id` — ficam `null` numa Decisão e
  obrigatórios numa Comunicação), trigger `communications_set_organization`
  (`security definer`, deriva `organization_id` de `narrative_id` no
  servidor — nunca aceito do client), RLS sem restrição de papel/criador
  (decisão do usuário, evolução futura por perfis já anunciada).
- `supabase/migrations/20260726010000_communication_impact_functions.sql`
  — `get_narratives_table` ganhou `p_reference_at timestamptz default
  now()` (6→7 parâmetros, `drop function` explícito antes de recriar —
  mesmo cuidado de aridade já documentado na entrada de 2026-07-21 sobre
  esta mesma function), usado só pela Tendência (regressão de 14 dias
  passa a ser ancorada em `p_reference_at`, não sempre `current_date`) —
  aditivo, nenhum consumidor existente passa esse parâmetro.
  `get_communication_impact(id, window_days)` calcula as janelas antes/
  depois via CTEs + `left join lateral get_narratives_table(...)` (uma
  chamada por janela, `p_reference_at` = `occurred_at` na janela antes,
  `least(occurred_at + window_days, now())` na janela depois) +
  `avg(total_mentions)` direto de `narrative_metrics` pra menções/dia (não
  passa por `get_narratives_table`, que não expõe essa métrica
  normalizada). `get_narrative_communication_timeline(narrative_id,
  organization_id, window_days)` envolve a primeira numa linha do tempo
  completa. As duas devolvem `risk_label`/`trend_label` além do score —
  adição ao esqueleto original da spec, necessária pra `RiskBadge`/
  `TrendIndicator` no frontend renderizarem o rótulo, não só o número.
- 5 Edge Functions novas, todas autossuficientes (Princípio técnico 5):
  `create-communication`/`update-communication`/`delete-communication`
  (chave publicável + JWT encaminhado, RLS continua valendo — mesmo
  padrão de exceção de `get-page-*`), `get-narrative-communication-timeline`
  (mesmo padrão, chama a RPC acima), e uma **não prevista na spec
  original**: `list-organization-members`.

**Gap de RLS real, encontrado durante a implementação** (não na fase de
spec): `user_profiles` (`user_profiles_select_own`) e
`organization_members` (`organization_members_select_own`) só têm policy
de SELECT pra própria linha — nenhum membro comum de uma organização
consegue, via client direto, ver o nome de outro colega da mesma
organização. Isso bloqueava duas coisas: popular o select "Responsável" no
formulário, e resolver `assignee_id`/`created_by` → nome na tabela/timeline.
Diferente de `admin-list-users` (que lista TODOS os usuários da
plataforma, `is_admin`-only), a necessidade aqui é mais estreita — qualquer
membro vendo só os membros da própria organização — então uma Edge
Function nova e mais simples: `list-organization-members` (chave secreta,
já que a informação está fora do alcance de RLS por design; valida
manualmente que o chamador é membro da organização pedida antes de
devolver os demais). `hooks/use-organization-members.ts` consome essa
function; `communications-table.tsx`/`impact-timeline.tsx` recebem um
`Map<id, nome>` já resolvido, nunca tentam ler `user_profiles` de outro
usuário direto.

**Frontend**:
- Hooks (`hooks/`): `use-narratives-list.ts` (Narrativas-folha ativas,
  leitura direta — RLS permite), `use-communication-types.ts` (leitura
  direta, tabela global), `use-organization-members.ts` (via Edge
  Function, ver gap acima), `use-communications.ts` (listagem com
  filtros, leitura direta — `communications`/`narratives`/
  `communication_types` são todas legíveis via RLS/global, só nomes de
  responsável precisam da Edge Function), `use-narrative-communication-timeline.ts`
  (via Edge Function, cálculo real).
- Componentes (`components/communications/`): `narrative-combobox.tsx`
  (primeiro campo com busca/filtro por texto do produto), `communication-form-modal.tsx`
  (`CommunicationFormModal` — seletor "Tipo de registro" no topo, campos
  mudam dinamicamente, `lockedNarrative` substitui o combobox por um
  rótulo fixo quando aberto a partir de uma Narrativa já conhecida — nunca
  um combobox desabilitado), `communications-table.tsx`, `impact-timeline.tsx`
  (`ImpactTimeline`, `compact` prop reaproveitada tanto na página cheia
  quanto no resumo do detalhe de Narrativa), `narrative-communications-section.tsx`
  (a seção embutida no detalhe de Narrativa).
- `components/ui/modal.tsx` ganhou `maxWidthClassName` (opcional, default
  `max-w-md` — comportamento de todo modal existente inalterado); o
  formulário de Comunicação/Decisão usa `max-w-2xl` (muito mais campo que
  os modais existentes do produto).
- `lib/supabase/call-function.ts` teve o tipo do parâmetro `body` alargado
  de `Record<string, unknown>` pra `object` — um objeto vindo de uma
  interface nomeada (`CommunicationFormValues`) não é atribuível a um tipo
  com index signature explícito em TS mesmo quando estruturalmente
  compatível; nenhuma chamada existente (todas usam literais inline) muda
  de comportamento.
- Páginas: `app/(intelligence-center)/(analytics)/communications/page.tsx`
  (lista + CRUD) e `.../communications/[narrativeId]/page.tsx` (linha do
  tempo de impacto, seletor de janela 3/7/14). **Desvio deliberado do
  texto original da spec**: as duas vivem dentro de `(analytics)`, não
  direto em `(intelligence-center)` como a spec propunha (mesmo nível de
  `/admin/users`/`/perfil`) — `/communications` depende de organização
  ativa (é dado escopado por organização, como as 5 páginas de análise),
  então reaproveita o gate de organização que `(analytics)/layout.tsx` já
  implementa, em vez de duplicá-lo.
- **Segundo desvio deliberado**: `/communications` não filtra por período
  (o "Fluxo principal" da spec previa um filtro de período) — aplicar o
  período global (default "Semanal", 7 dias) esconderia a maior parte de
  um registro histórico sem nenhum sinal do porquê; julgado pior pra UX do
  que não ter o filtro. Narrativa/Tipo de registro/Tipo de comunicação
  continuam filtros reais.
- `components/intelligence-center/sidebar.tsx` ganhou o item "Comunicação"
  em `ANALYSIS_ITEMS`, apontando pra `/communications` — pedido explícito
  do usuário de nomear assim.
- `components/intelligence-center/narrative-detail-content.tsx` ganhou a
  seção "Comunicações e Decisões" logo abaixo de "Ações e decisões" —
  botão "+ Registrar" sempre visível (regra transversal #2), Narrativa
  pré-preenchida e travada no formulário. Mesmo componente
  (`NarrativeCommunicationsSection`) é usado tanto na página cheia quanto
  no modal rápido de Narrativa (`@modal/(.)narratives/[id]`), já que os
  dois renderizam `NarrativeDetailContent` — pedido explícito do usuário:
  "de dentro do modal e do detalhamento de uma narrativa, deve existir um
  botão para registrar uma comunicação".

**Verificação**: `npx tsc --noEmit` e `npm run build` passam limpos (21
rotas, incluindo as 2 novas). Revisado manualmente linha por linha antes
do primeiro deploy, mas — como sempre nas sessões sem acesso ao Supabase
Dashboard — não executado contra um banco real até o usuário rodar
`supabase db push` de verdade pelo GitHub Action.

**Bug real de produção encontrado e corrigido no deploy (2026-07-26)**:
`supabase db push` aplicou `20260726000000` com sucesso mas falhou em
`20260726010000` — `ERROR: column reference "id" is ambiguous`
(SQLSTATE 42702) na criação de `get_communication_impact`. Causa raiz:
`before_scores`/`after_scores` faziam `select w.id, gnt.*` — `gnt.*`
(saída de `get_narratives_table`) já traz sua própria coluna `id` (o id da
Narrativa, primeira coluna do retorno daquela function), então cada CTE
acabava com **duas** colunas chamadas `id` (a da comunicação/decisão e a
da Narrativa) — algo que o Postgres aceita dentro da CTE em si, mas que
vira ambíguo assim que a CTE é referenciada de fora (`bs.id`/`af.id` no
`left join` final, exatamente onde o erro apontava). Como é uma function
`language sql` (não `plpgsql`), o Postgres já valida/planeja o corpo no
próprio `CREATE FUNCTION` — o erro apareceu na hora de aplicar a migration,
não em runtime, e a migration inteira fez rollback (transação por
arquivo). `20260726000000` já estava aplicada e não precisou ser
reaplicada. Corrigido substituindo `gnt.*` por uma lista explícita das 7
colunas de fato usadas (`net_sentiment`/`sentiment_label`/
`momentum_score`/`trend_score`/`trend_label`/`risk_score`/`risk_label`) —
nunca `gnt.id`/`title`/`sov_pct`/etc., que esta function não consome mesmo.
Mesma correção nas duas CTEs (`before_scores` e `after_scores`);
`get_narrative_communication_timeline` nunca teve esse risco (já
qualificava toda coluna explicitamente, sem `select *` em lugar nenhum).
Lição geral pra qualquer function futura deste projeto que faça `left
join lateral` sobre outra function e precise só de parte do retorno dela:
sempre listar as colunas por nome, nunca `alias.*`, quando outra fonte na
mesma CTE também tiver uma coluna `id` (ou qualquer nome genérico
repetido).

### Detalhe de Narrativa — detratores/impulsionadores positivos + termos/frases mais citados (2026-07-14)

User request: "Para cada narrativa é necessário identificar Formação e
propagação — principais disseminadores. Os detratores e os impulsionadores
positivos, se houver. Além de identificar as phases/terms mais citados em
cada narrativa. Confira se na documentação está OK, se na edge functions
bw-sync está trazendo os dados corretamente e estrutura essas informações
nos detalhes da narrativa."

**Auditoria feita antes de qualquer código**: "principais disseminadores"
já existia (reusa `get_authors_ranking`/`AuthorsList`, escopado à
Narrativa via `filters.narratives`) — nenhum bug. **"Detratores"/
"impulsionadores positivos" não existiam em lugar nenhum do projeto**
(zero ocorrências em specs ou código, grep confirmado) — nenhuma
⚠️ DECISÃO PENDENTE registrada, porque o conceito nunca tinha sido
especificado, não porque foi adiado. **Termos/frases mais citados**:
`get_term_signals` já existia e já suportava escopo por Narrativa
(`filter_category_ids`), mas nunca era chamada nesta página —
`PAGE_BLOCKS.narrative_detail` nunca incluía `'term_signals'` (gap de
wiring puro, não de dado).

**bw-sync conferido, sem bug encontrado** nos dois pipelines relevantes:
`syncTopicsData()`/`syncTopAuthors()` já iteram por `categoryTargets`
(`[null, ...narrativeCategoryIds]`, `runTopicsStep`/`runTopAuthorsStep`)
— ou seja, `bw_query_topics`/`bw_query_top_authors` já são sincronizados
**por Narrativa**, não só pra Query inteira, confirmando que
`get_term_signals`/`get_authors_ranking` escopados por
`filters.narratives` recebem dado real. **Limitação real confirmada, não
um bug**: `runAuthorEnrichmentStep()` (fonte de
`AuthorRow.sentiment_positive/neutral/negative`, via
`bw_query_author_topics`) só enriquece os top 10 autores por volume da
**Query inteira** (`category_id is null`), nunca por Narrativa
especificamente — então "Detratores"/"Impulsionadores positivos" só
conseguem classificar autores que estão simultaneamente nesse top 10
global e no ranking da Narrativa aberta. Documentado explicitamente na
spec e na UI, não escondido — alinhado com o próprio pedido do usuário
("se houver").

**Implementação, 100% presentation-layer + 1 linha de wiring por Edge
Function** (nenhuma migration, nenhum SQL novo — ambos os dados já
existiam, só faltava pedir/derivar):
- `PAGE_BLOCKS.narrative_detail` ganhou `'term_signals'` (canônico +
  todas as 7 Edge Functions deployadas, Princípio técnico 5 — verificado
  que as 8 cópias ficaram idênticas nessa linha).
- Novo `components/intelligence-center/dissemination-stance-lists.tsx`
  (`DisseminationStanceLists`) — deriva Detratores/Impulsionadores
  positivos no client, **sem chamada de rede adicional**, a partir do
  mesmo bloco `authors` já buscado pra "principais disseminadores":
  filtra por `dominantSentiment()` (helper já existente em
  `author-color.ts`, mesma lógica do badge de sentimento de
  `AuthorsList`) === `'negative'`/`'positive'`, ordena por alcance, top 5
  cada. Só renderiza quando há pelo menos 1 autor no ranking da
  Narrativa (evita duplicar o `<EmptyState/>` que `AuthorsList` já mostra
  quando o ranking inteiro está vazio).
- "Termos e frases mais citados": novo `WidgetCard` em
  `narrative-detail-content.tsx` reusando `TermSignalsList` (mesma nuvem
  de palavras de "Termos emergentes" em `/themes`) sobre
  `envelope.term_signals` — mistura `words`/`phrases`/`hashtags`/etc.
  (mesma nota já registrada em `_pending.md` gap #24 pras outras páginas
  que usam este bloco, não filtra só `topic_type = 'phrases'`).
- Specs atualizadas: `narratives-exploration.md` ("Formação e
  propagação" reescrita pra descrever o `get_authors_ranking` real —
  antes citava incorretamente `bw_query_top_authors` direto — + as 2
  novas subseções; nova seção "Termos e frases mais citados"),
  `block-mapping-per-page.md` (célula `term_signals`×`narrative_detail`).

**Verificação**: `npx tsc --noEmit` e `npm run build` passam limpos (20
rotas, mesmo route table de antes — nenhuma rota nova). Sem migration
nesta sessão, então sem a limitação recorrente de "não executado contra
um banco real" que se aplica às demais entradas deste arquivo — todo o
dado usado (authors/term_signals) já vinha de functions SQL existentes e
já testadas em produção por outras páginas.

### 7 pedidos pontuais de UI/dado — Narrativas, Sentimento, Autores e Influenciadores (2026-07-25)

User request, 7 items in one message: (1) rename "Top 3 Narrativas" →
"Top 3 Narrativas por Menções"; (2) add labels to the "Sentimento por
narrativa" chart; (3) add column headers to the "Sentimento por
plataforma"/"por pauta"/"por estado" tables; (4) represent "Sentimento por
estado" as a map with labels/colors; (5) investigate why "Drivers
positivos" wasn't showing; (6) move "Perfis relevantes"/"X Themes" from
`/platforms` to a new "Autores e Influenciadores" page; (7) remove the
generic "Narrativas" table from `/platforms`.

- **(1)** `TopThreeNarrativeCards` (`overview/page.tsx`) renamed, and its
  sort criterion changed from `sov_pct` to `total_mentions` — the old
  title was ambiguous about what "top" meant; "por Menções" only makes
  sense if the actual ranking is by mention volume, not Query-relative
  SOV (a small Narrativa in a small Query could outrank a Narrativa with
  far more absolute mentions under SOV).
- **(2)** `NarrativeSentimentList` (`breakdown-panel.tsx`, "Sentimento por
  narrativa" on `/sentiment`) gained "pos X% neu Y% neg Z%" text under
  each stacked bar — same wording already used on `NarrativeCard`'s own
  sentiment bar, reused instead of inventing new copy.
- **(3)** `ScoreList` (same file — backs "Sentimento por
  plataforma"/"por pauta"/"por estado", confirmed via grep to be used
  nowhere else) rewritten from a header-less `divide-y` list into a real
  `<table>` with `<thead>` — first column label varies by breakdown type
  (`NAME_COLUMN_LABEL`: Plataforma/Pauta/Estado), plus "Participação"/
  "Sentimento" — same `font-bold text-text-primary` header convention as
  `NarrativesTable`/`XInsightsPanel` (Cross-cutting rule 7).
- **(4)** New `BrazilSentimentMap` (`components/intelligence-center/
  charts/brazil-sentiment-map.tsx`) renders below the table for
  "Sentimento por estado" (complements it, doesn't replace it — map for
  glance, table for exact numbers). State borders in `lib/geo/
  brazil-states.ts`: simplified geometry (Douglas-Peucker, epsilon 0.03°,
  small islands under 0.5% of each state's main polygon area dropped)
  derived from the public dataset `codeforgermany/click_that_hood`
  (`brazil-states.geojson`), reprojected (simple equirectangular, no
  curvature correction — acceptable for an internal dashboard widget, not
  a precision cartography tool) onto a fixed 640×640 viewBox. Each state
  fills with the same 7-band sentiment color scale already used elsewhere
  (`sentimentFillFromScore()`, new export in `score-badges.tsx`, reuses
  `SENTIMENT_META`/`sentimentBucketFromScore` — no new palette), labeled
  with its UF code over a semi-transparent backing circle (legible
  regardless of the fill color underneath) plus a native SVG `<title>`
  hover tooltip with the full name/score/participation, plus a static
  color legend below. Since the exact string Brandwatch returns for the
  `regions` chart dimension was never confirmed against a real payload
  (already flagged in `get_region_breakdown`'s own migration comment),
  `findState()` matches by full name, by UF code, then by substring as a
  last resort — anything that still doesn't match is listed by name below
  the map instead of silently dropped.
- **(5)** Real bug found in `get_term_signals` (migration
  `20260726030000`): it ordered **every** term (regardless of sentiment)
  by `trending` (growth) and cut to `limit 50` *before* the frontend's own
  positive/negative split ever ran. If the fastest-growing terms in a
  given period skewed negative/neutral (plausible in political coverage,
  where negative stories often go viral faster), the cut could leave zero
  "positive" terms in the pool — not because none existed, just because
  none were among the top 50 by growth. The classification logic itself
  (`sentiment_positive >= sentiment_neutral and >= sentiment_negative` →
  `'positive'`, symmetric with `'negative'`) was already correct — the bug
  was entirely in the pre-classification cut. Fixed: ranking now happens
  **inside** each sentiment bucket
  (`row_number() over (partition by sentiment_associated order by
  growth_pct desc)`), keeping the top 20 of each of positive/neutral/
  negative instead of one global top-50-by-trending — "Drivers positivos"
  can no longer be crowded out by faster-growing terms of a different
  sentiment in the same period.
- **(6)** New page `/authors` ("Autores e Influenciadores") — moved into
  `app/(intelligence-center)/(analytics)/authors/page.tsx` (previously a
  `ComingSoonPage` placeholder outside the `(analytics)` group, per
  `_index.md`'s original plan that the *whole* page depended on
  `entities`/Sprint 3). Reality check: only the political-spectrum
  classification depends on `entities` — the author ranking and X Themes
  widgets were already fully functional on `/platforms` using data
  synced since Sprint 1/2026-07-12/18 (`bw_query_top_authors`/
  `bw_query_top_tweeters`/`bw_query_x_insights`). New Edge Function
  `get-page-authors` (7th `get-page-*` function, first new one since
  `get-page-themes`) — copied from the canonical
  `aggregated-metrics-service.ts` + the standard handler, same Principle-5
  pattern as the other 6. `PAGE_BLOCKS.authors` (already `['authors']` in
  every copy, anticipating this page) gained `'x_insights'` — patched
  across the canonical file and all 7 Edge Functions in one pass. New spec
  `intelligence-center/authors-and-influencers.md`; `platform-analysis.md`
  keeps the "Perfis relevantes"/"X Themes" sections as historical (data
  source notes still valid, just not rendered on `/platforms` anymore).
- **(7)** The generic "Narrativas" table at the bottom of `/platforms`
  (the full, unfiltered list — never part of the original prototype,
  added as bonus content in an earlier session) removed entirely.
  Doesn't close the separate, still-open "Narrativas dominantes por
  plataforma" gap (a per-platform breakdown that never existed).
  `PAGE_BLOCKS.platforms` shrank back to `['breakdowns', 'trends',
  'narrative_text']` (dropped `'narratives'`/`'authors'`/`'x_insights'`,
  patched everywhere alongside the item-6 change) — no page on `/platforms`
  reads those blocks anymore, so keeping them would mean an unused RPC
  call on every load (same efficiency principle already applied
  elsewhere in this file).

**Verification**: `npx tsc --noEmit` and `npm run build` both pass clean.
No live Supabase access in this environment — migration `20260726030000`
and the new `get-page-authors` function reviewed manually, not run
against a real database/deployed, same recurring limitation as every
session without deploy credentials. No browser automation available —
none of the 7 changes above (renamed widget, chart labels, table headers,
the Brazil map's actual rendering/colors, the new `/authors` page) were
visually confirmed in a real browser.

## Módulo `event-radar` (Sprint 3) — 1.1-1.4/1.6 implementados, 1.5 schema pronto sem UI (2026-07-27 a 2026-08-01)

Primeiro código real do módulo `event-radar` (Sprint 3, `.dev/specs/event-radar/`
— até esta sessão, 100% `rascunho`, nenhuma tabela existia). Usuário pediu
diretamente a implementação da funcionalidade 1.1 (`detection-engine`); como
todo spec do módulo ainda estava `rascunho` e `overview.md` trava
explicitamente "Fase 2 — Implementação só começar depois que os specs da Fase
1 estiverem com status pronto", parei e perguntei antes de escrever qualquer
código (`CLAUDE.md`, regra de spec-driven development). Usuário confirmou:
prosseguir e promover a spec, e criar a migration da tabela que faltava.
Revisão do conteúdo confirmou que não havia nenhum ⚠️ DECISÃO PENDENTE real em
aberto (a última foi resolvida em 2026-07-25) — só o status formal estava
desatualizado.

- **Migration única** (`20260727000000_event_radar_detection_engine.sql`):
  `radar_staging_events` (schema exato de `data-model.md` — RLS deny-all,
  índice único parcial `WHERE closed_at IS NULL` como chave de dedup pra
  eventos "ativos") + a função `run_event_detection()` agendada via
  `pg_cron` a cada 15 minutos (mesma cadência do heartbeat de `bw-sync`,
  decisão já resolvida em `detection-engine.md` 2026-07-22) — 100%
  SQL/Postgres, sem Edge Function e sem chamada à Brandwatch, mesmo padrão
  de `refresh_narrative_metrics_hourly` (não o padrão `net.http_post` de
  `bw-sync-heartbeat`).
- **Correção de nomenclatura no próprio spec**: `data-model.md` chamava o
  tipo da coluna `severity` de "risk_level" — esse tipo não existe no
  schema. O enum reaproveitado por `narratives.risk_level` chama-se
  `severity_level` (`low`\|`medium`\|`high`\|`critical`,
  `foundation_schema.sql`) — usado na migration, e o texto do spec corrigido
  na mesma sessão.
- **Séries agregadas nunca leem `mentions`**: duas funções (`event_radar_hourly_series`/
  `event_radar_daily_series`) unem query/narrative/platform sobre
  `bw_query_metrics_hourly`/`bw_query_metrics_daily`/`narrative_metrics`
  (`source = 'bw_aggregate'`)/`bw_query_metrics_daily_by_platform` — nunca
  `SELECT`/`SUM` direto sobre `mentions`, mesma premissa já fixada
  project-wide depois do bug real de SOV (ver "Brandwatch sync model"
  acima). `net_sentiment`/`negative_share` de query/narrative são
  derivados localmente de `sentiment_positive`/`negative`/`neutral` (nunca
  lidos da coluna oficial `net_sentiment`) — mesma escolha já adotada em
  `aggregated-metrics/sql-aggregation.md` (migration `20260725060000`)
  depois de dois bugs reais de divergência entre o score oficial e o
  breakdown mostrado na mesma tela. **Gap honesto, não inventado**:
  `bw_query_metrics_daily_by_platform` não tem breakdown positivo/neutro/
  negativo (só o score composto) — escopo `platform` usa o `net_sentiment`
  oficial mesmo, e `negative_share` fica sempre `null` para esse escopo,
  o que por sua vez significa que as 2 regras de sentimento negativo
  (`negative_sentiment_increase`/`negative_sentiment_spike`) só rodam para
  `query`/`narrative`, nunca `platform`.
- **Mapeamento janela → regra é uma escolha de MVP, documentada inline na
  migration** — nenhum spec define exatamente qual das 5 janelas cada
  `event_type` usa: `3h`/`24h`/`today_vs_last_week`/`3d` cobrem
  `volume_spike`/`volume_drop` (variação percentual + volume mínimo);
  `24h` também cobre `sentiment_change`/`negative_sentiment_increase`
  (diferença absoluta); `current_hour_vs_4week_avg` cobre
  `volume_spike`/`volume_drop` (via z-score, banda ≥2 já fixada em
  `detection-engine.md`) e `negative_sentiment_spike` (z-score sobre
  `negative_share`). Thresholds (`event_radar_config()`: volume mínimo 20,
  pico/queda ±50%, delta de `net_sentiment` 20 pontos, delta de share
  negativo 15 pontos percentuais) não têm número exato em nenhum spec —
  inferência de MVP documentada num único lugar, mesmo padrão já usado em
  `get_volume_trend` (granularidade) e na regressão de Tendência.
- **Bug real evitado antes de aplicar a migration**: toda regra percentual
  originalmente dividia `(atual - anterior) * 100 / anterior` tanto no
  `SELECT` quanto, de novo, no `WHERE` (guardado só por um `AND anterior >
  0` antecedente) — o Postgres **não garante** ordem de avaliação de
  operandos de `AND`, então essa divisão podia, em tese, ser avaliada antes
  do guard e estourar divisão por zero. Extraído para
  `event_radar_delta_pct(atual, anterior)` — divisão protegida por `CASE`
  (mesmo padrão de guarda já usado por `norm_growth`,
  `aggregated-metrics/sql-aggregation.md`, onde `CASE` garante
  short-circuit de verdade) — usada em todo lugar, nunca mais uma divisão
  crua dependendo de ordem de `WHERE`.
- **Ainda não implementado neste módulo** (rascunho): `severity` (1.3 —
  `severity_score`/`severity` ficam sempre `null`), `agent-orchestrator`
  (1.4), `schema-integration` (1.5 — nunca grava em `feed_events`, que
  continua não existindo) e `volume-limits` (1.6).
  `aggregated-metrics`'s bloco `highlights` (`get_active_highlights`)
  continua vazio até 1.5 existir — sem mudança nesta sessão.

### 1.2 `deduplication-grouping` (2026-07-28)

Pedido do usuário na sessão seguinte: promover `deduplication-grouping.md`
de `rascunho` pra `pronto` e implementar. Migration
`20260728000000_event_radar_deduplication_grouping.sql`.

- **Metade do spec já estava feita desde 1.1, e isso é intencional, não
  uma sobreposição a corrigir**: os itens 2-4 do "Fluxo principal"
  (inserir se a chave de dedup não existe ativa, atualizar métricas se já
  existe) são exatamente o que `run_event_detection()` já fazia via
  `INSERT ... ON CONFLICT (...) WHERE closed_at IS NULL DO UPDATE` desde
  `20260727000000`. Esta migration não escreve uma segunda camada de dedup
  em cima disso — seria redundante e mais uma fonte de divergência.
- **A peça genuinamente nova é o item 5 (encerramento automático)**,
  implementada dentro do próprio `run_event_detection()` (`CREATE OR
  REPLACE`, não uma função/step separado) — "o indicador voltou ao normal"
  só é conhecível comparando contra a mesma varredura de regras que 1.1 já
  calcula a cada ciclo; uma função separada precisaria recalcular a mesma
  matriz de agregações só pra descobrir a mesma coisa, dobrando o custo de
  leitura sem benefício. Mecanismo: `v_cycle_start` (nova variável,
  capturada uma vez no início do ciclo) substitui todo `now()` que antes
  era usado como valor de `detected_at` em cada `INSERT`/`UPDATE` — ao
  final do ciclo, uma única instrução (`UPDATE radar_staging_events SET
  closed_at = v_cycle_start WHERE closed_at IS NULL AND detected_at <
  v_cycle_start`) fecha qualquer linha ativa que não foi tocada nesta
  varredura, ou seja, cuja regra deixou de disparar.
- **Por que isso é seguro**: `run_event_detection()` reavalia as 13
  combinações regra×janela por completo a cada ciclo (sem execução
  faseada, diferente de `bw-sync`) — "não foi tocada neste ciclo" só tem
  um significado possível: a regra parou de valer para aquele escopo. Não
  há risco de fechar por engano um evento que uma fase futura ainda
  precisaria confirmar (não existe fase parcial aqui).
- **Verificação**: as duas migrations (`20260727000000`/`20260728000000`)
  revisadas manualmente linha por linha — sem acesso a um Supabase real
  nesta sessão (mesma limitação recorrente de toda sessão sem credenciais
  de deploy), nenhuma delas foi executada contra um banco de verdade. Sem
  componente TypeScript/frontend nesta mudança (SQL puro), então `npx tsc
  --noEmit`/`npm run build` não se aplicam.

### 1.3 `severity` (2026-07-29)

Pedido do usuário na sessão seguinte: seguir com a implementação da 1.3.
Migration `20260729000000_event_radar_severity.sql` — mais um `CREATE OR
REPLACE` de `run_event_detection()` (mesma razão de 1.2: rodar como job
separado no mesmo cron de 15min não garante ordem entre os dois jobs, o
que deixaria a severidade até 15min atrasada em relação à
detecção/fechamento mais recente).

- **`severity.md` só dá os 7 pesos, nenhuma fórmula por fator** (Volume
  20%, Sentimento 20%, Velocidade 20%, Alcance/engajamento 15%, Relevância
  dos autores 10%, Risco da narrativa relacionada 10%, Persistência 5%) —
  toda fórmula abaixo é inferência de MVP, documentada por fator na
  própria migration (mesmo padrão já usado nos thresholds de 1.1 e na
  regressão de Tendência de `aggregated-metrics`):
  - **Volume/Sentimento (20%+20%)**: reaproveitam o z-score já calculado
    por `event_radar_hourly_zscore` (1.1) — `|z| * 100/3` (z=3, banda
    "relevante" já fixada em `detection-engine.md`, → 100). Fallback pra
    `platform` (sem grão horário) e pra quando não há histórico
    suficiente: variação da janela de 3 dias (`event_radar_daily_range`),
    escalada. `platform` nunca tem `negative_share` (sem breakdown
    positivo/neutro/negativo na fonte) — Sentimento fica `null` pra esse
    escopo, sem fallback possível.
  - **Velocidade (20%)**: variação percentual de volume nas últimas 3h vs.
    3h anteriores (mesma janela da regra `volume_spike`/`volume_drop` de
    "3h" em 1.1) — conceitualmente "rapidez de escalada do evento", uma
    janela bem mais curta que a regressão de 14 dias da Tendência de
    Narrativa (ver a nota já existente em `severity.md` sobre essa
    diferença, 2026-07-22). Só existe pra `query`/`narrative`.
  - **Alcance/engajamento (15%)**: percentil do dia mais recente
    disponível, relativo ao máximo entre os pares do mesmo tipo na mesma
    organização — mesmo princípio do `reach_risk`/`impact_risk` de
    `risk_score`, mas comparando contra toda a organização, não só "a
    mesma Query" (este módulo não centraliza esse agrupamento). `platform`
    usa `engagement_score` (não tem `reach_estimate` na fonte).
  - **Relevância dos autores (10%)**: % dos Top Authors (semana mais
    recente) que são `is_influential` (nativo, followers ≥100k — mesmo
    campo que `author_influence` de `risk_score`). `platform` não tem
    breakdown de autores — `null`.
  - **Risco da narrativa relacionada (10%)**: só existe pra `scope_type =
    'narrative'` — chama `get_narratives_table` filtrando por
    `p_filters->'narratives'` (mesmo shape já usado por
    `get_communication_impact`) e lê `risk_score` direto, sem recalcular
    nada. `query`/`platform` não têm "uma" narrativa relacionada (já são
    agregados de várias) — `null`.
  - **Persistência (5%)**: `now() - created_at` da própria linha (o `id`
    nunca muda entre ciclos — é sempre `UPDATE`, nunca um novo `INSERT`,
    enquanto o evento continua ativo, ver 1.2), escalada linearmente (0h
    → 0, 24h → 100, capada em 100).
- **Fator ausente = `null`, nunca inventado**: todo fator que não se
  aplica ao escopo (a maioria das combinações envolvendo `platform`)
  retorna `null` em vez de um valor fabricado — o cálculo final faz
  `coalesce(fator, 50)` (50 = neutro, mesma convenção já usada por
  `norm_growth`), então um evento de `platform` (que só tem sinal real de
  Volume/Velocidade... na verdade só Volume via fallback de 3 dias, já
  que Velocidade também precisa de grão horário) severity_score inclina
  bastante pro neutro — honesto dado o quanto menos dado existe pra esse
  escopo, não uma falha.
- **Categoria de risco reaproveita as 4 faixas exatas de `risk_score`**
  (0-33 low, 34-59 medium, 60-84 high, 85-100 critical,
  `aggregated-metrics/sql-aggregation.md`) — `severity.md` já pedia
  explicitamente "não criar uma segunda escala de risco em paralelo à já
  existente no schema".
- **Verificação**: as três migrations (`20260727000000`/`20260728000000`/
  `20260729000000`) revisadas manualmente linha por linha — sem acesso a
  um Supabase real nesta sessão (mesma limitação recorrente), nenhuma
  executada contra um banco de verdade. Sem componente TypeScript/
  frontend (SQL puro).

### 1.6 `volume-limits` (2026-07-30) — implementado antes de 1.4, não depois

Pedido do usuário: "na documentação está pedido para ir para o item 1.6
antes do 1.4 — verifique se é isso mesmo e siga, seguindo a ordem de
dependências." Verificado e confirmado: `overview.md`, "Ordem de
implementação" já dizia explicitamente que `volume-limits` (1.6) "entra
como filtro entre 1.3 e 1.4" — a numeração é só rótulo de catálogo (a
tabela de funcionalidades foi listada nessa ordem, não a ordem de
execução real), e `agent-orchestrator.md` (1.4, ainda não implementado)
já assume "dentro do cap diário" como pré-condição do próprio "Fluxo
principal". Migration `20260730000000_event_radar_volume_limits.sql` —
mais um `CREATE OR REPLACE` de `run_event_detection()` (mesma razão de
1.2/1.3: dois jobs agendados pro mesmo horário de `pg_cron` não têm ordem
garantida entre si).

- **Coluna nova, não antecipada em `data-model.md`**:
  `radar_staging_events.queued_for_agent_at` (`timestamptz`, nullable) —
  sem ela não havia como saber "quantos eventos já foram considerados hoje
  contra o cap", já que `feed_events` (onde a saída da IA seria gravada,
  por 1.5) não existe ainda, e mesmo que existisse, o corte tem que
  acontecer *antes* da chamada de IA (`volume-limits.md`: "nunca depois"),
  não dá pra inferir a partir do que já foi publicado.
- **Mecanismo**: a cada ciclo, conta (por organização) quantos eventos
  ativos já foram marcados hoje (UTC); classifica os ainda não marcados
  hoje por `severity_score` desc; marca só os primeiros N (cap - já
  marcados) com `queued_for_agent_at = v_cycle_start`. Um evento marcado
  permanece marcado mesmo que seu `severity_score` mude depois — o cap não
  "desconta" retroativamente.
- **Cap fixado em 15** — `event_radar_config()` ganhou `daily_event_cap`
  (precisou de `DROP FUNCTION` antes do `CREATE`, mesma lição já paga
  antes em `get_narratives_table` — não dá pra acrescentar coluna a uma
  function `RETURNS TABLE` via `CREATE OR REPLACE` puro). 15 é o ponto
  médio do "aproximadamente 10-20" do próprio `volume-limits.md` — mesma
  inferência de MVP já documentada pros outros thresholds em 1.1.
- **Verificação**: as quatro migrations (`20260727000000`–`20260730000000`)
  revisadas manualmente linha por linha — sem acesso a um Supabase real
  nesta sessão (mesma limitação recorrente), nenhuma executada contra um
  banco de verdade. Sem componente TypeScript/frontend (SQL puro).

### 1.4 `agent-orchestrator` (2026-07-31) — primeira chamada de IA e primeira Edge Function do módulo

Pedido do usuário: seguir com 1.4. Migration
`20260731020000_event_radar_agent_orchestrator.sql` + Edge Function
`supabase/functions/event-radar-agent-orchestrator/index.ts` — a única
etapa deste módulo que faz chamada de IA (1.1/1.2/1.3/1.6 são 100% SQL,
`run_event_detection()`) e a única que precisa de Edge Function
(agendada via `pg_cron`/`net.http_post` a cada 15min, mesmo padrão de
`bw-sync-heartbeat`).

- **Modelo: Claude Haiku 4.5** — decisão explícita do usuário, levantada
  porque o módulo já declara "cada chamada de IA tem custo" como
  princípio (`overview.md`), o que conflita com o default geral de
  assistente de sempre usar o modelo mais capaz disponível. Configurável
  via `EVENT_RADAR_AGENT_MODEL` (secret da Edge Function), sem precisar
  de nova migration/deploy de código caso o usuário queira trocar depois.
- **`feed_events` ganhou sua primeira migration nesta sessão** — a tabela
  só existia documentada em `_glossary.md`/`data-model.md` desde a "Fusão
  de módulos" (2026-07-12), nunca migrada. Criada junto com o enum
  `feed_event_type` (7 valores, já listados em `_glossary.md`) e uma
  coluna nova não antecipada em `data-model.md`:
  `radar_staging_event_id` (FK → `radar_staging_events`) — sem ela não
  havia como implementar "`closed_at` espelha
  `radar_staging_events.closed_at`" (a frase exata do próprio
  `data-model.md`), que exige saber qual linha de `feed_events` veio de
  qual linha de `radar_staging_events`. Esse espelhamento foi implementado
  dentro do próprio `run_event_detection()` (mais um `CREATE OR REPLACE`,
  no mesmo bloco de fechamento de 1.2), não numa função separada.
- **Segunda coluna nova, mesmo motivo**: `feed_events.severity_explanation`
  — o "Schema de saída" de `agent-orchestrator.md` já exigia esse campo da
  IA ("por que essa severidade, em linguagem natural") mas `data-model.md`
  nunca teve uma coluna pra guardá-lo (distinto de `description`, que
  guarda a causa provável do evento em si, não da severidade).
- **Terceira coluna nova, em `radar_staging_events`**: `agent_processed_at`
  — marca que a IA já rodou pra aquele evento, `should_publish` true ou
  false tanto faz ("única chamada de IA por evento",
  `agent-orchestrator.md`). Distinta de `queued_for_agent_at` (1.6): um
  evento pode estar na fila do cap diário sem ainda ter sido processado
  pela Edge Function.
- **Payload agregado via `event_radar_build_agent_payload()` (SQL, não
  JS)** — nunca texto bruto de mentions, só métricas já calculadas
  (as do próprio evento), top tópicos com percentuais
  (`bw_query_topics`), principais plataformas
  (`bw_query_metrics_daily_by_platform`), contagens de autores
  (`bw_query_top_authors`) — escopo `narrative`/`query` completos, escopo
  `platform` mais magro (sem breakdown de tópicos/autores por plataforma
  na fonte, mesmo gap honesto já documentado em 1.3).
- **Dedup semântico (`agent-orchestrator.md`, "Regras de negócio") — a
  única parte do módulo que genuinamente exige julgamento de IA —
  implementado como contexto no payload, não como um prompt com vários
  eventos simultâneos**: como o desenho é uma chamada por evento (não uma
  chamada por lote de eventos relacionados), o payload inclui
  `sibling_events` (outros eventos ativos agora no mesmo escopo, todos os
  3 tipos de escopo) e `recent_related_cards` (cards já publicados nas
  últimas 24h pra mesma Narrativa — só escopo `narrative`, já que
  `feed_events` não tem uma coluna de `scope_id` própria, só
  `related_narrative_id`) — o prompt instrui a IA a retornar
  `should_publish: false` quando o evento não traz nada genuinamente novo
  em relação a esse contexto. Decisão de escopo deliberada, documentada em
  `agent-orchestrator.md`, não uma simplificação silenciosa.
- **Saída forçada via `output_config.format` (JSON Schema, GA — sem beta
  header)**, não tool-use — schema não suporta `maxLength`, então os
  limites de 90/300 caracteres de `title`/`summary` (`agent-orchestrator.md`)
  são reforçados por instrução no prompt + truncamento defensivo
  (`.slice(0, 90)`/`.slice(0, 300)`) no código, nunca só confiados ao
  schema.
- **Tratamento de erro segue a tabela de "Fluxos alternativos" do spec ao
  pé da letra**: `stop_reason: "refusal"` → não marca `agent_processed_at`,
  reprocessado no próximo ciclo; resposta que não faz parse como JSON →
  mesmo tratamento ("descartar e logar erro — nunca gravar payload
  malformado"); falha ao gravar em `feed_events` depois de
  `should_publish: true` → também não marca `agent_processed_at` (aceita
  o custo de uma nova chamada de IA em troca de nunca perder um evento já
  aprovado silenciosamente).
- **Fora desta leva, deliberadamente**: "Resumo executivo" em lote (1x/dia
  — feature separada, mencionada em `agent-orchestrator.md` mas não
  descrita no próprio "Fluxo principal" desse arquivo, então tratada como
  fora de escopo) e `feed_event_feedback`/`schema-integration.md` item 2
  (retroalimentação pós-publicação do analista — precisa de UI própria,
  não pedida ainda — ver "1.5 `feed_event_feedback`" abaixo pro schema,
  adicionado numa sessão seguinte). `schema-integration.md` continua
  `rascunho` — seu item 1 (escrita em `feed_events`) já foi implementado
  como parte do próprio código de 1.4.
- **Efeito colateral real**: `aggregated-metrics`'s `get_active_highlights`
  (bloco `highlights` do envelope, `_pending.md` gap #8) já pode ser ligada
  agora — `feed_events` existe e está sendo populada pela primeira vez.
  Não implementado nesta sessão (fora do escopo pedido: só 1.4), mas
  deixou de estar bloqueada.
- **Verificação**: migration e Edge Function revisadas manualmente linha
  por linha — sem acesso a um Supabase real nem a credenciais da API da
  Anthropic nesta sessão (mesma limitação recorrente), nenhuma executada
  contra ambiente de verdade. `npm:@anthropic-ai/sdk` importado sem pin de
  versão (Deno resolve pra latest em build) — revisar se um deploy futuro
  quebrar por breaking change do SDK.

### 1.5 `feed_event_feedback` (2026-08-01) — schema pronto, sem UI

Pedido do usuário na sessão seguinte: "1.6" (já implementada — esclarecido
no chat) → escolheu seguir com `feed_event_feedback` (`schema-integration.md`
item 2) dentre as duas pendências reais restantes do módulo (a outra era
`aggregated-metrics-integration.md`, ainda intocada). Migration
`20260801000000_event_radar_feed_event_feedback.sql` — só schema/RLS,
schema exatamente como já especificado em `data-model.md`.

- **Sem Edge Function, de propósito** — diferente de praticamente toda
  outra escrita deste projeto (que passa por Edge Function mesmo em casos
  simples), `data-model.md` já especificava este INSERT como direto do
  cliente: `feedback_type` restrito por `CHECK` constraint (não enum
  Postgres — extensibilidade sem migration, mesma razão de
  `communication_types`), `user_id = auth.uid()` garantido pela policy de
  `INSERT`, isolamento de organização via subquery no FK pai
  (`feed_event_id`). Toda validação cabe em RLS/`CHECK` (Princípio técnico
  2 permite isso), então não havia necessidade real de uma função nova —
  primeira tabela do projeto com esse padrão de escrita.
- **Sem UPDATE/DELETE** — "um feedback é um registro imutável"
  (`data-model.md`), sem exceção.
- **Nenhuma UI existe pra usar isso ainda** — nem pra dar feedback, nem
  pra sequer ver um card de `feed_events` em primeiro lugar. O bloco
  `highlights` do envelope (`get_active_highlights`, `aggregated-metrics`,
  `_pending.md` gap #8) continua sem function SQL — sem ele, nenhuma
  página do frontend renderiza um card de `feed_events`, então não há
  onde pendurar um botão de "dar feedback" hoje. `schema-integration.md`
  continua `rascunho` por causa disso — schema pronto pros 2 itens do
  arquivo, UI pendente pros 2.
- **`data-model.md` passou a `implementado`** — as 3 entidades do arquivo
  (`radar_staging_events`, `feed_events`, `feed_event_feedback`) têm
  migration agora, mesmo critério já usado antes neste arquivo (status
  reflete o schema, não necessariamente toda UI/consumidor rio abaixo).
- **Verificação**: migration revisada manualmente linha por linha — sem
  acesso a um Supabase real nesta sessão (mesma limitação recorrente),
  não executada contra um banco de verdade. Sem componente TypeScript/
  frontend (SQL puro, sem Edge Function).

### `frontend-highlights-feed` (2026-08-01) — primeiro spec de frontend do módulo, só documentação

Pedido do usuário: "crie a documentação do frontend do módulo event-radar
de acordo com o que foi desenvolvido. A ideia é que o usuário tenha uma
visão rápida e fácil do que aconteceu nas últimas 72h." Sessão
puramente de Fase 1 (Especificação) — nenhum código escrito, seguindo a
própria divisão em duas fases que `overview.md` já define pro módulo.
Novo arquivo: `event-radar/frontend-highlights-feed.md` (`status:
rascunho`).

- **Não reaproveita o bloco `highlights` genérico já especificado em
  `aggregated-metrics/standard-json-envelope.md`** — aquele bloco é
  filtrado pelo período selecionado no header de cada página
  (`get_active_highlights`), o que é certo pra "highlights relevantes à
  janela que estou olhando agora" mas errado pro pedido específico desta
  sessão: "últimas 72h" tem que ser sempre as mesmas 72h corridas,
  independente de qual período o usuário tenha selecionado em qualquer
  página. Por isso o spec propõe uma fonte de dado própria
  (`get_recent_highlights`, function nova, ainda não implementada) — os
  dois blocos convivem, servindo propósitos diferentes.
- **Onde vive**: um widget novo ("Radar de Eventos", subtítulo "Últimas 72
  horas") na Visão Geral (`/overview`), no lugar hoje ocupado pelo
  `HighlightsPanel` vazio (`insights-panel.tsx`) — não uma rota nova.
  `overview.md`, "Rotas/Páginas", atualizado pra registrar isso (antes
  dizia que o módulo não expõe nenhuma UI própria).
- **Inclui eventos já fechados** (`closed_at` preenchido), ordenado por
  `created_at` desc (linha do tempo), não por `severity_score` — diferente
  do bloco `highlights` genérico, que só mostra ativos e ordena por
  severidade. Aqui o objetivo é "o que aconteceu", não "o que está
  acontecendo agora".
- **Feedback do analista** (`feed_event_feedback`, schema já implementado
  na sessão anterior) ganha finalmente um lugar de verdade pra ser usado —
  um menu "⋮" por card com as 4 opções já existentes no schema, `INSERT`
  direto do cliente (sem Edge Function, mesma decisão já tomada quando o
  schema foi criado).
- **Gap real encontrado e documentado, não bloqueante**: o tipo
  `Highlight` (`packages/shared-types/src/envelope.ts`) não tem `id` nem
  `created_at` — sem eles não dá pra vincular feedback a um card nem
  calcular "há Xh"/ordenar cronologicamente. Resolvido no próprio desenho
  do spec, não alterando o contrato do envelope existente: este widget usa
  sua própria forma de resposta (que já nasce com `id`/`created_at`), não
  o tipo `Highlight` padrão — evita o risco de alterar um contrato já
  consumido por 6 Edge Functions em produção só por causa de um widget
  novo.
- **Uma decisão de implementação deixada em aberto de propósito** (não é
  uma decisão de produto, não precisa do usuário): expor
  `get_recent_highlights` via `get-page-overview` (mais um bloco no
  envelope daquela página) ou via RPC chamada direto pelo cliente (mais
  simples, já que não depende do período/filtros do header como o resto
  do envelope) — registrado no spec pra decidir na Fase 2.
- **Fora de escopo, deliberadamente**: página dedicada de histórico
  completo/paginado, filtro por tipo/severidade dentro do widget (contra
  o próprio objetivo de "visão rápida"), notificação em tempo real.

### `feed_events.severity_score` desatualizado — bug real encontrado e corrigido antes da Fase B (2026-08-02)

Pedido do usuário: "algum ajuste para fazer na fase 2?", mostrando o
subgrafo `AGG` ("Fase B") de `fluxo-aggregated-metrics.md` — o mesmo
diagrama que trava A1 (`get_active_highlights`)/A2 (boost de
`risk_score`)/A3 (`ai-synthesis` Camada 1) até `feed_events` estar sendo
populada de verdade (o que já é o caso desde 2026-07-31). Revisão desse
diagrama antes de liberar a Fase B encontrou um bug real, não implementado
ainda nesta sessão como parte de Fase B em si.

- **O bug**: A2 lê `risk_score = greatest(risk_score calculado,
  severity_score do evento ativo)` a partir de `feed_events` — tem que ser
  um evento **publicado**, `sql-aggregation.md` já dizia isso, nunca
  `radar_staging_events` direto (que inclui `should_publish: false`). Só
  que 1.3 (`severity`) recalcula `severity_score`/`severity` em
  `radar_staging_events` a cada ciclo de 15min pra **todo** evento ativo,
  publicado ou não — e `feed_events.severity_score` só era gravado **uma
  vez**, no momento em que a Edge Function `event-radar-agent-orchestrator`
  publicava o card (1.4). Resultado: um card publicado ficava com
  severidade cada vez mais desatualizada em relação ao valor real em
  `radar_staging_events`, enquanto o evento de origem seguisse ativo —
  exatamente o mesmo problema que o espelhamento de `closed_at`
  (migration `20260731020000`) já resolvia pra "o card sumir quando o
  evento fecha", só que pra severidade em vez de status. Sem esse fix, A2
  (quando implementado) leria um número congelado, cada vez mais errado.
- **Correção**: mais um `CREATE OR REPLACE` de `run_event_detection()`
  (migration `20260802000000`, mesmo padrão já usado pra 1.2/1.3/1.6) —
  um novo bloco logo depois de 1.3 (severity), espelhando
  `severity_score`/`severity` pro `feed_events` vinculado, só quando o
  evento continua ativo (`closed_at is null`) e o valor realmente mudou
  (`is distinct from`, evita `UPDATE` desnecessário na maioria dos
  ciclos). Nenhuma mudança de schema.
- **Precisão adicionada em `sql-aggregation.md`/`fluxo-aggregated-metrics.md`**:
  A2 lê especificamente `MAX(feed_events.severity_score)` entre as linhas
  com `related_narrative_id = narrativa` e `closed_at IS NULL` — uma
  Narrativa pode ter mais de um evento ativo simultâneo (ex: um de volume
  e um de sentimento), daí o `MAX`, nunca soma. `get_active_highlights`
  (A1) também ganhou uma nota: filtrar por plataforma (quando aplicável)
  exige `JOIN radar_staging_events` via `feed_events.radar_staging_event_id`
  — `feed_events` não duplica `scope_type`/`scope_id`.
- **Achado de documentação, não de código**: o "resumo executivo em lote
  (últimas 72h)" no rodapé do diagrama de sincronismo de
  `fluxo-aggregated-metrics.md` nunca foi implementado — já estava fora de
  escopo de 1.4 (ver nota de 2026-07-31 acima), mas o diagrama ainda o
  desenhava como parte do fluxo normal, sem qualquer aviso. Marcado
  explicitamente como aspiracional, não confundir com o widget "Radar de
  Eventos" (últimas 72h) de `frontend-highlights-feed.md`, que é uma
  leitura direta de `feed_events`, não uma terceira chamada de IA em lote.
- **Fase B (A1/A2/A3) continua não implementada** — esta sessão só
  corrigiu a pré-condição que A2 precisava ter antes de poder ler dado
  confiável de `feed_events`, não implementou nenhuma das 3 etapas.
- **Verificação**: migration revisada manualmente linha por linha — sem
  acesso a um Supabase real nesta sessão (mesma limitação recorrente), não
  executada contra um banco de verdade. Sem componente TypeScript/
  frontend (SQL puro).

### Fase B implementada — A1 `get_active_highlights`, A2 boost de `risk_score`, A3 `ai-synthesis` Camada 1 (2026-08-02)

Continuação direta da sessão anterior (bug de `feed_events.severity_score`
desatualizado, acima) — usuário confirmou "Sim, vamos prosseguir com a
fase b" depois de ver a correção de pré-condição. As 3 etapas do subgrafo
`AGG` de `event-radar/fluxo-aggregated-metrics.md` foram implementadas
nesta sessão, junto com uma auditoria de coerência da documentação de
`ai-synthesis.md` pedida no meio da sessão ("verifique se a documentação
de ai-synthesis está coerente e concisa com o restante que foi
desenvolvido").

- **Auditoria de documentação, feita antes do código**: `ai-synthesis.md`
  tinha 2 problemas reais de coerência, ambos corrigidos. (1) Seu próprio
  blockquote de topo (escrito 2026-07-25) ainda dizia "Camada 1 depende de
  `event-radar` publicar 2+ highlights... gap #7 continua aberto" — frase
  que já estava desatualizada desde 2026-07-31 (quando `event-radar`
  publicou de fato), e `_pending.md` gap #7 tinha o mesmo texto obsoleto,
  divergente do gap #8 (que já tinha sido corrigido). (2) "Dependências
  técnicas" citava uma skill `humanizer-pt-br` que **nunca existiu** neste
  repositório (`.claude/skills/` só tem `brandwatch-api`/`frontend-design`/
  `spec-driven-dev`/`supabase-postgres-best-practices`/`web-app-structure`)
  — uma dependência aspiracional nunca verificada contra o diretório real.
  Ambos corrigidos na spec antes de escrever qualquer migration.
- **A1 `get_active_highlights`** (migration `20260802010000`) — leitura
  pura de `feed_events`: filtra por `organization_id`, `feed_events.created_at`
  dentro do período pedido, e por `filters.narratives` quando presente
  (único filtro de `EnvelopeFilters` de fato aplicado em todo o módulo
  `aggregated-metrics`, mesmo padrão de toda outra function). Ordena por
  `severity_score` desc, `limit 30` (o cap diário de 15 eventos/organização
  de `event-radar` 1.6 já limita o volume por dia; este limite é só
  salvaguarda pra períodos multi-dia). Deliberadamente **sem** filtro de
  `closed_at` — um evento fechado dentro do período pedido ainda é um
  insight relevante pra quem está olhando aquele período; "ativo" só
  importa pro boost de A2. `fetchHighlights` (`aggregated-metrics-service.ts`)
  parou de retornar `[]` incondicionalmente.
- **A2 boost de `risk_score`** (mesma migration) — `get_narratives_table`
  ganhou uma CTE `radar_boost` (`MAX(feed_events.severity_score)` entre
  `related_narrative_id = narrativa` e `closed_at IS NULL`, nunca soma —
  uma Narrativa pode ter mais de um evento ativo simultâneo) e o `risk_score`
  final virou `greatest(fórmula composta de sempre, coalesce(boost, 0))` —
  um evento detectado só pode **elevar** o risco mostrado, nunca derrubá-lo.
  `create or replace` foi suficiente (sem `drop function`) porque nem a
  assinatura nem a lista de colunas de saída mudaram, só o cálculo interno.
- **A3 `ai-synthesis` Camada 1** (migration `20260802020000` +
  `aggregated-metrics-service.ts`) — tabela `page_narrative_synthesis`
  criada exatamente com o schema já especificado na spec desde 2026-07-13
  (chave única `organization_id, page, period_start, period_end,
  filters_hash`), com policy de SELECT **e** INSERT/UPDATE pra
  `authenticated` escopada por organização (diferente de `feed_events`, só
  leitura — aqui é a Edge Function com o JWT do usuário que grava, nunca a
  chave secreta). `fetchNarrativeText` foi dividida em
  `fetchLayer0NarrativeText` (0/1 highlight, lógica antiga inalterada) e uma
  nova `fetchNarrativeText` externa que implementa o "Fluxo principal" da
  spec: 2+ highlights → busca a linha pela chave exata; existe → devolve
  direto, nunca chama IA de novo (os 2 gatilhos de invalidação de período
  aberto — sync concluído/"Atualizar dados" — não existem no produto ainda,
  `_pending.md` gap #21, então uma linha existente é sempre a resposta
  final por enquanto); não existe → fallback imediato é a Camada 0, e a
  composição real roda em **background** via `scheduleBackground()`, sem
  bloquear a resposta HTTP já enviada.
  - `scheduleBackground()` é um wrapper sobre `EdgeRuntime.waitUntil`
    (feature do runtime das Supabase Edge Functions) escrito **sem**
    `declare const EdgeRuntime` — acessa o global via
    `globalThis as unknown as {...}` pra não arriscar colidir com uma
    tipagem ambiente que o runtime Deno já forneça; sem esse global
    (execução local), dispara a Promise sem aguardar, best-effort.
  - Modelo: **Claude Haiku 4.5** (`claude-haiku-4-5`, secret
    `AI_SYNTHESIS_MODEL`) — mesma decisão de custo já tomada pra
    `event-radar-agent-orchestrator` (2026-07-31), reaplicada sem
    perguntar de novo ao usuário: a tarefa da Camada 1 é ainda mais barata
    ("não analisa dados, só reescreve/conecta texto que já existe"), então
    o mesmo raciocínio de custo se aplica com ainda mais razão.
  - Tom da composição: instrução direta em
    `NARRATIVE_SYNTHESIS_SYSTEM_PROMPT`, já que a skill `humanizer-pt-br`
    citada pela spec não existe (ver auditoria acima) — mesmo padrão já
    usado pelo `SYSTEM_PROMPT` de `event-radar-agent-orchestrator`.
  - `is_final` = `period_end < hoje` em `America/Sao_Paulo`, via
    `Intl.DateTimeFormat('en-CA', ...)` (formato `YYYY-MM-DD`, comparável
    como string com `period_end`).
  - **Achado real, documentado, não corrigido nesta sessão**: `page_cache`
    está desabilitado desde 2026-07-14 (`getPageEnvelopeWithCache` chama
    `assemblePageResponse` direto) — sem essa camada de-duplicando
    requisições, 2 requisições quase simultâneas pra uma chave ainda sem
    linha em `page_narrative_synthesis` podem ambas disparar a composição
    em background antes da primeira terminar (no máximo 2-3 chamadas de IA
    duplicadas nesse curto intervalo — a segunda escrita só faz `upsert`
    sobre a mesma linha, nunca duplica a linha em si). Aceito como
    trade-off de MVP dado o volume de tráfego atual; sem lock distribuído.
    Documentado em `fluxo-aggregated-metrics.md`, "Pontos de atenção no
    sincronismo".
- **Propagação (Princípio técnico 5)**: as mudanças em
  `aggregated-metrics-service.ts` (import do SDK da Anthropic,
  `fetchHighlights` real, `fetchLayer0NarrativeText`/`fetchNarrativeText`/
  `scheduleBackground`/`composeLayer1NarrativeText`/`composeAndPersistLayer1`/
  `todaySaoPaulo`/`isPeriodClosed`) foram copiadas nas 7 Edge Functions
  deployadas (`get-page-{overview,narratives,sentiment,platforms,themes,authors}`,
  `get-narrative-detail`) via um script Node de uso único (não commitado —
  ferramenta de sessão, não parte do produto), que localiza o fim do bloco
  canônico (fecho de `getPageEnvelopeWithCache`) e substitui só essa parte,
  preservando o handler HTTP específico de cada função (e, em
  `get-narrative-detail`, o `fetchNarrativeSummary` bespoke entre os dois).
  - **Bug real introduzido pela própria cópia mecânica, encontrado e
    corrigido antes de prosseguir**: o arquivo canônico só importa
    `import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'`
    (nunca chama `createClient`, já que o canônico não tem handler) — mas
    cada uma das 7 funções deployadas tinha, na prática, um import
    combinado (`import { createClient, type SupabaseClient } from ...`)
    porque o próprio handler de cada uma usa `createClient`. A cópia
    mecânica trocou esse import combinado pelo type-only do canônico em
    todas as 7, quebrando `createClient` (usado mais abaixo, no handler) —
    um `diff` linha a linha contra o canônico antes de seguir em frente
    pegou isso; corrigido restaurando o import combinado nas 7 cópias via
    `sed`. Confirmado depois: `diff` das 1170 linhas do bloco canônico
    contra `get-page-overview/index.ts` mostra **só** essa linha de import
    como diferença — o resto da propagação está byte-a-byte idêntico ao
    canônico, como deveria.
- **Verificação**: `npx tsc --noEmit` e `npm run build` passam limpos (19
  rotas — nenhuma rota nova, só lógica de backend). Contagem de parênteses/
  chaves balanceada nas 2 migrations novas e nos 7 arquivos deployados
  (mesmo proxy de verificação usado em toda sessão sem acesso a Supabase
  real). Sem ambiente Deno/Supabase real disponível nesta sessão — as 2
  migrations e a chamada real à API da Anthropic (Camada 1) não foram
  executadas contra infraestrutura de verdade, mesma limitação recorrente
  de toda sessão deste projeto sem credenciais de deploy.
- **Fechamento de documentação**: `sql-aggregation.md` (10/10 functions,
  "Risco" e a linha de `get_active_highlights` na tabela principal),
  `ai-synthesis.md` (status `implementado`, blockquote de topo reescrito,
  "Dados envolvidos"/"Dependências técnicas" atualizados),
  `fluxo-aggregated-metrics.md` (subgrafo `AGG` verde, tabela "Tabelas por
  etapa" com as 3 linhas ✅, correção do achado sobre `page_cache`
  desabilitado), `_pending.md` (gaps #7/#8 resolvidos in-place, #33
  atualizado). `_architecture.md` ainda não tocado nesta sessão — próximo
  item.

### `run_event_detection()` nunca gravava nada — statement timeout na 1.3 (severity) fazia rollback do ciclo inteiro (2026-08-03)

Incidente real de produção, reportado pelo usuário: "reveja pq a cron não
está iniciando esse processo" (`radar_staging_events` permanecia vazia),
seguido do log exato colado do Supabase:

```
ERROR:  canceling statement due to statement timeout
CONTEXT:  ... PL/pgSQL function event_radar_reach_engagement_severity(uuid,text,text) line 65 ...
          PL/pgSQL function run_event_detection() line 314 ...
```

**O `pg_cron` estava, na verdade, chamando `run_event_detection()`
corretamente a cada 15min** — o job `event_radar_detection_15min`
(`20260727000000`) nunca parou de disparar. O sintoma "a cron não inicia o
processo" era, na real, "toda invocação falha e sofre rollback total": a
função inteira é um único `language plpgsql` sem nenhum bloco `EXCEPTION`
em lugar nenhum, executada pelo `pg_cron` como uma única transação
implícita (`select run_event_detection()`) — um erro não capturado em
QUALQUER statement aborta a chamada inteira e desfaz tudo que ela já tinha
feito antes na mesma invocação, incluindo os `INSERT`s de detecção (1.1) e
o fechamento por dedup (1.2), que rodam mais cedo no corpo da função e já
tinham sido bem-sucedidos. Como a etapa que sempre falhava (1.3, severity)
roda por último, **nenhuma linha nova jamais sobrevivia** em
`radar_staging_events`, ciclo após ciclo — dava exatamente a impressão de
"a cron nunca dispara nada".

**Causa raiz da query lenta**: `event_radar_reach_engagement_severity()`
(1.3, `20260729000000`), escopo `'platform'`, calcula `v_max` via uma
subquery correlacionada — `select max(metric_date) from
bw_query_metrics_daily_by_platform pd2 where pd2.query_id = pd.query_id
and pd2.page_type = pd.page_type and pd2.category_id is null` — executada
uma vez por linha candidata. O único índice que cobre essa tabela é o
`unique (project_id, query_id, category_id_key, page_type, metric_date)`
(`20260711090000`) — lidera por `project_id`, que **não** aparece no
filtro da subquery, então o Postgres não tem como fazer um index seek por
`query_id`/`page_type` sozinho. Como `bw_query_metrics_daily_by_platform`
"acumula indefinidamente" por design (ver "Data storage is historical by
design" acima — nenhum job de retenção/poda existe), o custo dessa
subquery sem índice adequado só cresce com o tempo até estourar o
`statement_timeout`. `bw_query_metrics_daily` (escopo `'query'`) tem
exatamente o mesmo problema estrutural (`unique (project_id, query_id,
category_id, metric_date)`, também líder por `project_id`) — ainda não
visto no log deste incidente, mas mesma causa, corrigido preventivamente
junto. `narrative_metrics` (escopo `'narrative'`) nunca teve esse
problema — seu `unique (narrative_id, metric_date, period)` já lidera por
`narrative_id`, a coluna de fato usada pela subquery daquele escopo.

**Fix, migration `20260803000000`, duas partes**:
1. Dois índices parciais novos, cobrindo exatamente o padrão de filtro
   usado (e reutilizável por qualquer consumidor futuro do mesmo padrão
   "linha da Query/Plataforma inteira, dia mais recente"):
   `bw_query_metrics_daily_query_date_idx` (`query_id, metric_date desc
   where category_id is null`) e
   `bw_query_metrics_daily_by_platform_query_page_date_idx` (`query_id,
   page_type, metric_date desc where category_id is null`).
2. `run_event_detection()` — mesmo corpo de `20260802000000`, só a etapa
   1.3 (severity + seu espelhamento em `feed_events`) passou a rodar
   dentro de um bloco `begin ... exception when others then raise
   warning ...; end;` (savepoint implícito): uma falha ali (esta ou
   qualquer futura, ex: outra query lenta) não derruba mais a 1.1/1.2 já
   commitadas na mesma invocação — só pula a atualização de severidade
   deste ciclo (loga um aviso, visível em Dashboard → Database →
   Logs/pg_cron) e segue direto pra 1.6, que já tolera `severity_score`
   nulo/stale (`order by ... desc nulls last`). Mesma filosofia de
   degradação graciosa já usada em `bw-sync` (budget de chamadas, rate
   limit) — nunca perder progresso já feito por causa de uma sub-etapa
   que falhou depois.

**Verificação**: migration revisada manualmente (balanço de parênteses do
corpo SQL — fora dos comentários `--` — conferido em 0, `begin`/
`exception`/`end` contados e batendo com a estrutura esperada) — sem
acesso a um Supabase real nesta sessão (mesma limitação recorrente de toda
sessão sem credenciais de deploy), não executada contra um banco de
verdade. `git push` pra `develop` (fluxo já estabelecido) é o próximo
passo pra isso rodar de verdade e confirmar `radar_staging_events`
passando a receber linhas.

### `event-radar` 100% implementado — widget "Radar de Eventos" (frontend-highlights-feed.md) fecha o módulo (2026-08-02)

Pedido do usuário, continuação direta da sessão de Fase B: "reveja a
documentação do frontend do event-radar, se estiver coerente e conciso com
o que está desenvolvido, pode seguir com o desenvolvimento do frontend."
Revisão de `frontend-highlights-feed.md` encontrou 2 problemas reais de
coerência antes de escrever qualquer código:

- **`formatRelativeDate` não faz o que o spec alegava.** O texto descrevia
  o tempo relativo do card como "há 3h"/"há 2 dias" via
  `formatRelativeDate` (`lib/date/format.ts`) — mas essa função só tem
  granularidade de **dia** (`Hoje`/`Ontem`/`há N dias`), sem hora/minuto.
  Pra uma janela de 72h, a maioria dos eventos aconteceria "Hoje", sem
  distinção nenhuma entre um evento de 20 minutos atrás e um de 20 horas
  atrás — o oposto do "visão rápida do que aconteceu" pedido
  originalmente. Corrigido adicionando `formatRelativeTime` (nova função
  no mesmo arquivo): granularidade de minuto/hora, cai pra
  `formatRelativeDate` a partir de 24h (mesmo fallback dia-a-dia de
  sempre). A diferença entre dois instantes não depende de fuso (duração,
  não data de calendário) — só o fallback pra "Hoje"/"Ontem" precisa do
  fuso do usuário, mesma disciplina já usada por toda outra função do
  arquivo.
- **Decisão de implementação em aberto, resolvida**: o spec registrava
  como pendência "Edge Function (extensão de `get-page-overview`) vs. RPC
  direta do cliente" pra expor `get_recent_highlights`. Resolvida a favor
  de **RPC direta** (`supabase.rpc('get_recent_highlights', ...)`,
  `hooks/use-recent-highlights.ts`) — sem Edge Function nova, sem bloco no
  envelope. Justificativa do próprio spec já apontava pra isso: esta
  janela é fixa (72h), independente do período/filtros do header, então
  amarrar ao ciclo de fetch de `get-page-overview` (que refaz a chamada
  toda vez que o período muda) não faria sentido — mesmo padrão de leitura
  direta via RLS já usado por `use-narratives-list.ts`/
  `use-communication-types.ts` (módulo `communications`).

**Implementação**:
- **`get_recent_highlights(p_organization_id, p_hours default 72, p_limit
  default 10)`** (migration `20260802040000`) — leitura pura de
  `feed_events`, `security invoker` (RLS de `feed_events_select_org` segue
  valendo pro client autenticado), inclui eventos fechados de propósito
  (`closed_at` preenchido — "o que aconteceu", não "o que está ativo
  agora"). Devolve `id`/`created_at`/`closed_at`, que o tipo `Highlight` do
  envelope padrão não tem — este widget usa sua própria forma de resposta
  (`RecentHighlight`, `hooks/use-recent-highlights.ts`), nunca o tipo
  `Highlight`/bloco `highlights` genérico (decisão já registrada no spec
  desde 2026-08-01, confirmada ainda válida nesta revisão).
- **`hooks/use-recent-highlights.ts`** — mesmo padrão 3-estados
  (loading/error/loaded) + `retry` de `use-narratives-list.ts`, chamando a
  RPC direto via `createClient()` (browser client, `@supabase/ssr`).
- **`components/intelligence-center/recent-events-panel.tsx`** —
  `RecentEventsPanel` (lista de cards, cada um com ícone por `event_type`
  ↑/↓/●, `RiskBadge`, `formatRelativeTime`, `title`/`summary`/`tags`, link
  "Ver Narrativa →" via `next/link` pra `/narratives/[id]` — mesma rota que
  a intercepting route `@modal/(.)narratives/[id]` já intercepta como
  modal) + `FeedbackMenu` (menu "⋮" com as 4 opções de
  `feed_event_feedback.feedback_type`, `INSERT` direto do client, sem Edge
  Function, exatamente como `data-model.md` já especificava). ⚠️
  **Desvio deliberado do spec**: implementado **sem** o campo de
  comentário opcional (clicar numa opção já envia direto) — a coluna
  `comment` fica disponível no schema pra uma extensão futura. Também
  **sem `createPortal`** — diferente de `UserRowMenu`
  (`user-row-menu.tsx`, que precisa de portal porque vive dentro de um
  container `overflow-x-auto` que clipa um menu `absolute`), esta lista
  vertical simples não tem esse problema, então o dropdown mais simples
  se aplica.
- **`overview/page.tsx`**: `HighlightsPanel` (bloco `highlights` genérico
  por período) substituído por `RecentEventsPanel` só neste lugar —
  `HighlightsPanel` não foi removido do arquivo (`insights-panel.tsx`),
  fica disponível pra uma futura página que precise do bloco `highlights`
  por período (`/sentiment`/`/themes` já pedem esse bloco em `PAGE_BLOCKS`
  sem nenhum widget consumindo-o ainda). Comentários de
  `HighlightsPanel`/`NarrativeTextPanel` (que diziam "sempre vazio,
  event-radar/ai-synthesis não implementados") também corrigidos — ambos
  os blocos são reais desde a Fase B da sessão anterior.
- **Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf
  .next` antes, pra descartar 2 falhas transitórias de build por conflito
  de arquivo com um processo concorrente no mesmo diretório) confirmados
  limpos — 19 rotas, `/overview` cresceu de 4.85kB pra 6.18kB de First
  Load JS. Migration revisada manualmente, não executada contra um banco
  real nesta sessão (mesma limitação recorrente de toda sessão sem
  credenciais de deploy).

**Fechamento do módulo**: com a UI implementada, `schema-integration.md`
(que só faltava isso) e `frontend-highlights-feed.md` passaram a
`implementado` — as 8 funcionalidades do módulo (`data-model`/
`detection-engine`/`deduplication-grouping`/`severity`/
`agent-orchestrator`/`volume-limits`/`schema-integration`/
`aggregated-metrics-integration`/`frontend-highlights-feed`, contando
`data-model` = 9) estão todas `implementado` — `event-radar` como módulo
inteiro passa de `rascunho` pra `implementado` pela primeira vez, menos de
uma semana depois do primeiro código real (2026-07-27). Documentação
fechada em `frontend-highlights-feed.md`, `data-model.md`,
`schema-integration.md`, `overview.md`, `_architecture.md`, `_index.md`
(3 linhas stale corrigidas: a Sequência de Implantação Sprint 2 ainda
descrevia `get_active_highlights`/Camada 1 de `ai-synthesis` como
pendentes, e a tabela de módulos ainda listava `event-radar` como
`rascunho`), `_pending.md` gap #35.

**Follow-up, mesmo dia**: usuário reportou "a opção do radar no Menu
principal não está aparecendo" — a expectativa era um item de menu
próprio, não só o widget embutido em `/overview` (que era de fato tudo
que o spec original previa — "Fora de escopo: réplica do widget em outras
páginas, ou uma página dedicada"). Confirmado via `AskUserQuestion`: o
usuário queria uma opção **nova** no menu (não reaproveitar "Alertas",
que segue como `ComingSoonPage`), com sua própria rota, mostrando "o que
ocorreu nas últimas 72h, quais foram as tendências... basicamente o feed
do que foi identificado." Implementado: item "Radar de Eventos" em
`ANALYSIS_ITEMS` (`sidebar.tsx`) apontando pra nova rota `/radar`
(`app/(intelligence-center)/(analytics)/radar/page.tsx`) — reaproveita o
mesmo `RecentEventsPanel`/janela fixa de 72h já construído pro widget de
`/overview`, não uma segunda fonte de dado; os dois convivem (resumo
rápido na Visão Geral, destino dedicado no menu). `PageHeaderBar` usado
por consistência de navegação, mas seu seletor de período não afeta esta
página (janela sempre fixa). `npx tsc --noEmit`/`npm run build`
confirmados limpos (20 rotas).

### Módulo `entities` — spec completa + `data-model.md` implementado + seed real de partidos/parlamentares (2026-07-13)

Duas sessões na mesma data. **Primeira**: usuário pediu a spec do módulo de
cadastro de Entidades (CRUD, admin-only) para classificar pessoas/veículos/
partidos/instituições monitorados em múltiplos espectros e vincular esse
cadastro à visão de Autores e Influenciadores. Especificado do zero —
`entities` só existia como linha reservada em `_index.md`/`_glossary.md`
desde a criação do projeto, nunca tinha spec própria. 4 arquivos novos em
`.dev/specs/entities/` (`overview.md`, `data-model.md`,
`entity-registration.md`, `author-linking.md`), todos `status: pronto`
nesta primeira parte. Uma decisão de escopo genuinamente ambígua foi
resolvida com o usuário via pergunta direta (não assumida): o catálogo é
**global/nacional** (sem `organization_id`), mantido pelos admins da
plataforma (`is_admin`, já global desde `auth`), não um catálogo por
organização — combina com o nome "Cadastro **Nacional** de Entidades" já
reservado desde antes desta spec existir.

**Achado durante a revisão de coerência da documentação** (pedido explícito
do usuário: "revise a documentação existente"): outra sessão estava
implementando a página `/authors` ("Autores e Influenciadores") em
paralelo, exatamente enquanto esta sessão escrevia a spec de `entities` —
descoberto via `git status` mostrando arquivos modificados que não
existiam no início da sessão (`intelligence-center/authors-and-influencers.md`
era novo, `_index.md`/`_architecture.md`/`aggregated-metrics/*` já vinham
sendo editados por aquela outra sessão). A spec de `entities` foi ajustada
para reconhecer essa realidade em vez de presumir que `/authors` não
existia — `authors-and-influencers.md` já lista "classificação de espectro
político/tipo de autor (`entities`/`entity_tags`)" como gap conhecido,
exatamente o que `entities/author-linking.md` fecha. Referências cruzadas
corrigidas em `_index.md`, `_architecture.md`, `_glossary.md`,
`aggregated-metrics/overview.md`/`sql-aggregation.md`/
`standard-json-envelope.md`, `foundation/overview.md`. Bug de drift de
documentação real encontrado e corrigido de passagem: o bloco `authors` do
envelope (`standard-json-envelope.md`) não documentava dois campos que já
existem no código (`AuthorRow.sentiment_positive/neutral/negative`,
`narrative_labels`) desde sessões anteriores — nenhuma mudança de
comportamento, só a spec alcançando a implementação.

**Segunda sessão, mesma data, pedido do usuário**: "crie um seed com todos
os partidos e parlamentares complementando todas as informações que vc
conseguir na internet". Isso implicava implementar o schema de
`entities/data-model.md` primeiro (nenhuma migration criava essas tabelas
ainda) — feito em `supabase/migrations/20260731000000_entities_schema.sql`,
sem desvio do spec (`entity_type` enum + `entities`/`entity_accounts`/
`entity_tags`, reaproveitando `severity_level` já existente desde
`foundation` para `entities.influence_level`, `set_updated_at` e
`is_current_user_admin()` já existentes — nenhuma function nova).

O seed em si (`supabase/migrations/20260731010000_seed_parties_and_parliamentarians.sql`)
foi construído a partir de dado real, consultado ao vivo nesta sessão
contra as APIs de dados abertos oficiais do Congresso Nacional — nunca
"complementado" com informação inventada da memória do modelo, mesma
premissa de "nunca fabricar dado sem fonte real" já aplicada em todo o
resto do projeto (`mentions`/sampling):
- **Câmara dos Deputados**: `dadosabertos.camara.leg.br/api/v2/deputados`
  (512 deputados da legislatura atual, um único request com
  `itens=600` cobriu tudo — sem paginação necessária) e `/api/v2/partidos`
  (siglas/nomes oficiais dos partidos com representação atual).
- **Senado Federal**: `legis.senado.leg.br/dadosabertos/senador/lista/atual`
  (81 senadores em exercício, incl. `SexoParlamentar` — usado para
  "Senador"/"Senadora" no cargo).
- Consolidado num script Node local (`gen-seed.js`, scratchpad da sessão,
  não commitado) que gerou UUIDs próprios por linha (`crypto.randomUUID()`)
  e o SQL final — evita qualquer correlação frágil por nome (nomes
  duplicados existem em tese, embora nenhum tenha sido encontrado nos 512
  deputados desta consulta).
- Normalização mínima e documentada: Senado usa `PODEMOS`, Câmara usa
  `PODE` para o mesmo partido — unificado para `PODE`. Nenhuma outra sigla
  precisou de normalização (conferido programaticamente: toda sigla de
  partido de todo deputado/senador bate com a lista de partidos da
  Câmara após essa única normalização).

**Cobertura final**: 21 partidos (toda sigla com representação federal
ativa hoje, Câmara e/ou Senado) + 512 deputados + 81 senadores = 593
parlamentares, cada um com 3 `entity_tags` (`office`/`party`/`state`) —
1779 linhas de tag, todas direto do mesmo dado oficial já buscado, nenhuma
inferência local.

**Deliberadamente fora do seed** — mesmo critério acima, nunca apresentar
como fato algo sem fonte confiável/verificada:
- **`entity_accounts`** (handles de redes sociais) — não populado. Não
  existe API oficial em lote para 593 handles de Twitter/Instagram/etc., e
  um handle errado quebraria silenciosamente o vínculo com
  `bw_query_top_authors` (`author-linking.md`) sem nenhum erro visível —
  risco pior que simplesmente deixar em branco para cadastro manual
  (`/admin/entities`, quando implementada) ou uma futura rotina de
  enriquecimento.
- **`influence_level`** — já documentado desde a spec original como campo
  manual/subjetivo do admin; um seed automatizado não deveria opinar por
  ele.
- **`political_spectrum`/`ideology`** (`entity_tags`) — classificação
  real, mas contestável e sem uma fonte única/oficial que resolva a
  ambiguidade para os 21 partidos com o rigor que este projeto exige de
  qualquer dado apresentado como fato (mesmo padrão já aplicado a
  `authors[].risk_level`, `_pending.md` gap #11 — não inventar uma fórmula/
  classificação sem uma fonte que a sustente). Fica para classificação
  manual pelo admin via `/admin/entities`.
- **Partidos registrados no TSE sem parlamentar federal eleito hoje** (ex:
  PCO, PSTU, PCB, UP, PMB, PRTB) — as duas fontes oficiais usadas cobrem só
  representação federal atual; adicionar os demais é um `INSERT` direto
  quando/se algum cliente precisar deles.

**Verificação**: as duas migrations foram revisadas manualmente (contagem
de linhas por bloco batendo com o esperado — 21/593/1779 —, ausência de
vírgula solta antes de `on conflict`, encoding UTF-8 dos nomes acentuados
conferido em amostras como "Célia Xakriabá"/"Átila Lins") mas **não
executadas contra um banco real** nesta sessão — sem credenciais/deploy
neste ambiente, mesma limitação recorrente de toda sessão sem acesso ao
Supabase Dashboard já registrada em várias entradas deste arquivo. `git
push` para `develop` (fluxo já estabelecido do projeto) é o próximo passo
para essas duas migrations realmente rodarem. `entity-registration.md`
(CRUD pela UI) e `author-linking.md` (o `LEFT JOIN` que liga uma Entity a
um autor do ranking) continuam só especificados — o catálogo já existe e
já está populado no schema, mas hoje só é editável via SQL direto, não
pela UI do produto.

**Follow-up, mesmo dia**: usuário perguntou "consegue identificar as
plataformas e os perfis dos parlamentares? Se sim, crie um seed para
entities account." Resposta real, verificada ao vivo, não assumida: **sim
para os 512 Deputados Federais, não para os 81 Senadores** —
`dadosabertos.camara.leg.br/api/v2/deputados/{id}` (endpoint de
**detalhe**, diferente do endpoint de listagem já usado no seed anterior)
expõe um campo `redeSocial` preenchido voluntariamente por cada gabinete;
já `legis.senado.leg.br/dadosabertos/senador/{id}` foi conferido campo a
campo nesta sessão e genuinamente não tem nenhum equivalente. Nova
migration `supabase/migrations/20260731030000_seed_deputy_social_accounts.sql`:
512/512 deputados consultados com sucesso (0 falhas), 325 com ao menos 1
conta declarada, 989 URLs brutas → **976 linhas de `entity_accounts`**
depois de descartar 13 URLs comprovadamente malformadas na própria fonte
(ex: `twitter.com/https:` — um link colado dentro de outro pelo próprio
gabinete; `facebook.com/share`/`facebook.com/profile.php` sem parâmetro
`id` — sem handle real recuperável, omitidas em vez de gravadas erradas).
Parser (script local, não commitado) normaliza plataforma pelo domínio da
URL e resolve 3 formatos legados que apareceram de fato nos dados reais:
`youtube.com/user/NOME` (YouTube antigo), `facebook.com/pages/NOME/ID`
(Facebook Páginas antigo, usa o slug legível, não o ID numérico), e
`twitter.com/#!/NOME` (Twitter hash-bang antigo, handle no fragmento da
URL, não no path). Dedupe por `(platform, lower(username))` dentro do
próprio seed (0 colisões reais encontradas) mais `on conflict (platform,
username) do nothing` no banco (mesma constraint `entity_accounts_unique_handle`
já definida no schema) para idempotência entre execuções. `entity_id` de
cada linha reaproveita exatamente os mesmos UUIDs já gravados pela
migration anterior — extraídos de volta do próprio arquivo SQL já
commitado (parse por nome do deputado), não regerados, para garantir que
cada conta aponta pra Entity certa. Ver `entities/data-model.md` para o
detalhe completo.

**Follow-up, mesmo dia**: pedido do usuário: "Em entities renomeie o campo
descrição para cargo, inclua um novo campo chamado partido, crie um campo
chamado ideologia (popule com direita, esquerda, centro, centro direita,
centro esquerda) e reorganize os dados nessas novas colunas." Migration
`supabase/migrations/20260731050000_entities_cargo_partido_ideologia.sql`:

- `alter table entities rename column description to cargo` — dado
  preservado, coluna não recriada.
- 2 colunas novas: `partido text`, `ideologia text` (+ índices).
- **Reorganização, não nova busca**: todo o dado já estava semeado pelas 2
  migrations anteriores. `cargo`/`partido` dos 593 parlamentares migrados
  de `entity_tags` (`office`/`party`, criados pelo seed original) para as
  colunas novas via `UPDATE ... FROM entity_tags`; as 2 linhas de
  `entity_tags` correspondentes foram **removidas** depois (dado vive só
  num lugar, não duplicado — `state` continua em `entity_tags`, fora do
  pedido). Os 21 partidos tiveram `cargo` zerado (a coluna guardava o nome
  completo do partido antes da renomeação — ex: "Movimento Democrático
  Brasileiro" — sem sentido numa coluna chamada "cargo").
- **`ideologia`**: diferente de `cargo`/`partido`/`estado` (direto da
  Câmara/Senado), esta é a primeira coluna do módulo sem fonte oficial em
  lote — decisão consciente de reverter a cautela da sessão anterior
  ("`political_spectrum`... classificação contestável — não apresentada
  como fato sem fonte verificada"), porque agora é um pedido explícito e
  direto do usuário, não mais uma inferência própria. Os 21 partidos foram
  classificados por caracterização amplamente citada na ciência política/
  imprensa brasileira (linha editorial, composição de blocos parlamentares,
  posicionamento em pautas econômicas/de costumes — não uma fonte única
  verificável como as migrations anteriores), documentado explicitamente
  como classificação de melhor esforço/revisável no comentário da migration
  e em `data-model.md`, não apresentado como dado oficial. Os 593
  parlamentares **herdam a ideologia do próprio partido** (`UPDATE ...`
  casando `entities.partido` com o `name` da linha `type = 'party'`
  correspondente) — não é uma avaliação individual por parlamentar.
- Verificação extra desta migration (além do padrão de sempre — sem vírgula
  solta, etc.): confirmado **programaticamente** (script Node, não só por
  leitura) que as 21 siglas usadas na classificação de ideologia batem
  exatamente, caractere a caractere incl. acentos (`MISSÃO`/`UNIÃO`), com
  as 21 siglas já gravadas pelo seed anterior — 0 divergências.
- Specs atualizadas em conjunto: `entities/data-model.md` (tabela de
  campos, vocabulário de `entity_tags` sem `party`/`office`/
  `political_spectrum`), `entities/entity-registration.md` (formulário
  ganha Cargo/Partido/Ideologia em "Dados básicos", saem de "Classificação"),
  `entities/author-linking.md` (`AuthorRow` ganha `entity_cargo`/
  `entity_partido`/`entity_ideologia` como campos fixos, não mais só
  genéricos via `entity_tags`), `entities/overview.md`, `_glossary.md`,
  `_index.md`, `_architecture.md`. Não executada contra um banco real
  (mesma limitação recorrente).

### Seed de institutos de pesquisa eleitoral e veículos de imprensa (2026-07-14)

Pedido do usuário, mesmo módulo `entities`: "crie um seed para entities
com informações de entidades de pesquisas eleitorais, mídia, imprensa e
veículos de comunicação que emitem notícias e que podemos de alguma forma
vincular com os dados que vem da brandwatch." Migration
`supabase/migrations/20260807010000_seed_polling_institutes_and_media_outlets.sql`.

- **Fonte usada**: diferente do seed de partidos/parlamentares (API oficial
  do Congresso), não existe uma API aberta equivalente para institutos de
  pesquisa/veículos de imprensa — a fonte real usada nesta sessão foi a
  API pública do **Wikidata** (`wbsearchentities` + `Special:EntityData`),
  consultada ao vivo, lendo as propriedades P856 (site oficial), P2002
  (usuário do Twitter/X) e P2003 (usuário do Instagram) — mesma disciplina
  de "nunca fabricar dado sem fonte real" já aplicada em todo o resto do
  projeto. Nenhum handle foi completado de memória.
- **Cobertura**: 12 institutos de pesquisa eleitoral (`type = 'company'` —
  são empresas privadas, não "instituição" no sentido cívico do enum:
  Datafolha, Ipec, Quaest, AtlasIntel, Paraná Pesquisas, FSB Pesquisa, Real
  Time Big Data, Ipespe, Modal Pesquisas, PoderData, Instituto Ideia, MDA
  Pesquisa) + 30 veículos de imprensa/mídia (`type = 'media_outlet'`:
  G1, O Globo, GloboNews, Folha de S.Paulo, UOL, Estadão, Terra, R7, SBT,
  Band, CNN Brasil, Veja, IstoÉ, CartaCapital, Poder360, Metrópoles,
  Congresso em Foco, Brasil 247, Gazeta do Povo, Jovem Pan, Agência
  Brasil, Correio Braziliense, O Antagonista, Exame, InfoMoney, Valor
  Econômico, BBC News Brasil, Nexo Jornal, Agência Pública, The Intercept
  Brasil) = 42 Entities, 51 `entity_accounts` (28 dos 30 veículos têm ao
  menos 1 conta confirmada; só 2 dos 12 institutos — ver limitação
  abaixo), 118 `entity_tags`.
- **2 dimensões novas de `entity_tags`** (mesmo princípio já fixado em
  `data-model.md` — uma nova dimensão é só um `INSERT`, nunca uma
  migration de schema): `segment` ("Pesquisa Eleitoral" para os
  institutos; para os veículos, o tipo de mídia — Portal de Notícias/
  Jornal Impresso/Revista/TV Aberta/TV a Cabo/Rádio/Agência de Notícias/
  Jornalismo Investigativo, lido da própria descrição do item no
  Wikidata) e `website` (URL oficial confirmada — **puramente
  informativo**, não usado no vínculo com autores: `author-linking.md`
  já define que o `JOIN` com `bw_query_top_authors`/`mentions` é sempre
  por `username` de handle, nunca por domínio, então gravar o site como
  `entity_accounts.platform = 'website'` não teria nenhum efeito real e
  sugeriria um vínculo que não existe — por isso ficou em `entity_tags`,
  não em `entity_accounts`). `power_branch` (já existente) recebeu
  `Setor Privado` para os institutos e `Mídia` para os veículos.
- **Limitação real, documentada na própria migration**: 10 dos 12
  institutos de pesquisa (todos exceto AtlasIntel e, parcialmente, Ipec)
  não têm `entity_accounts` — o Wikidata genuinamente não tem item
  verificável com essas propriedades para eles (várias tentativas de
  busca com termos alternativos ao longo da sessão, mesma cautela já
  usada para os Senadores no seed anterior, que também ficaram sem
  contas por falta de fonte em lote). **`Ipec` é um caso à parte**: o
  item mais próximo do Wikidata (Q21206655) está na verdade sobre o
  "IBOPE" histórico (sitelinks enwiki/ptwiki = "IBOPE", "Ipec" só como
  alias) e seu site apontava para a Kantar IBOPE Media — uma empresa
  distinta da Ipec (Inteligência em Pesquisa e Consultoria) desde a
  cisão de 2020 — por isso a Entity "Ipec" foi criada, mas
  deliberadamente **sem** `website`/`entity_accounts`, para não atribuir
  o site/conta de uma empresa a outra por engano. `ideologia` (espectro
  político) não foi populada para nenhum veículo de imprensa — não foi
  pedido nesta sessão, e é uma classificação bem mais contestável para um
  veículo de imprensa do que para um partido político (que já tinha esse
  pedido explícito, ver `20260731050000`) — fica para o admin classificar
  manualmente se/quando desejado.
- **Verificação**: contagem de linhas (42 entities/51 entity_accounts/118
  entity_tags) conferida programaticamente (script Node), ausência de
  UUID/handle/tag duplicados dentro do próprio arquivo, ausência de
  colisão de `(platform, username)` contra o seed de deputados já
  existente (`20260731030000`) — tudo confirmado via script, não só por
  leitura visual. **Não executada contra um banco real** nesta sessão —
  sem credenciais/deploy neste ambiente, mesma limitação recorrente de
  toda sessão sem acesso ao Supabase Dashboard já registrada em várias
  entradas deste arquivo. `git push` para `develop` é o próximo passo.

### `/narratives` retornando vazio — `page_cache` desabilitado, depois causa raiz real encontrada e corrigida (2026-07-14)

User report: `get-page-narratives` devolvendo `narratives: []` para uma
organização com Narrativas-folha ativas. Diagnóstico por leitura de código
+ queries SQL fornecidas pelo usuário descartou duas causas óbvias: (1) o
`scope` da function (`bw_categories.status = 'active'`, `parent_id is not
null`) tem várias Narrativas ativas pra essa organização; (2) essas
Narrativas têm linhas reais em `narrative_metrics` (`period = 'daily'`)
dentro da janela de 7 dias pedida — o que deveria produzir linhas via
`get_narratives_table('leaves')`. Também descartado: a Edge Function
`get-page-narratives` deployada é idêntica ao arquivo canônico
(`supabase/functions-shared-source/aggregated-metrics-service.ts`), sem
divergência de deploy.

Usuário pediu para desabilitar `page_cache` (gap #21, implementado
2026-07-25, TTL 5min por `(organization_id, page, period, filters)`) e
retomar essa funcionalidade depois, em vez de continuar investigando se
era a causa. `getPageEnvelopeWithCache()` — na service layer canônica e
nas 7 Edge Functions `get-page-{overview,narratives,sentiment,platforms,
themes,authors}`/`get-narrative-detail` (Princípio técnico 5, cada cópia
editada manualmente) — agora só chama `assemblePageResponse()` direto,
sem ler/gravar `page_cache`. Tabela/migration/RLS (`20260725040000`)
ficam intactas, só não usadas; reativar é restaurar o corpo original da
function (ver histórico do git). `npx tsc --noEmit` confirma que isso não
afeta o lado Next.js (arquivos `supabase/functions*` são excluídos do
`tsconfig.json` de propósito).

**Desabilitar o cache não resolveu** — usuário confirmou que continuava
vazio, o que descartou `page_cache` como causa de vez e apontou de volta
pro código das 3 Edge Functions pedidas para reexame:
`get-page-overview`, `get-page-narratives`, `get-narrative-detail`.

**Causa raiz real, encontrada nesta revisão**: `get_narratives_table`
existia como **dois overloads conflitantes** no banco, mesma classe de
bug já documentada neste arquivo ("Narrative card redesign...",
2026-07-21) para esta mesma function. Sequência exata: `20260726010000`
(módulo `communications`) adicionou `p_reference_at timestamptz default
now()` (6 → 7 parâmetros) e corretamente fez `drop function if exists
get_narratives_table(uuid, date, date, jsonb, uuid, text)` antes de
recriar com 7 parâmetros. Minutos depois, na mesma sessão,
`20260726020000` (o fix de sentimento "proportion only") fez só `create
or replace function get_narratives_table(...)` com **6** parâmetros — sem
`drop function` antes. Como a assinatura de 6 parâmetros tinha acabado de
ser dropada, esse `create or replace` não substituiu nada: **criou** um
novo overload de 6 parâmetros, coexistindo com o de 7. Os dois ficaram
divergentes: o de 7 parâmetros nunca ganhou `category_label` (regressão —
foi escrito a partir de uma cópia da function anterior a
`20260725050000`) nem o fix de sentimento "proportion only".

`get-page-overview`/`get-page-narratives`/`get-narrative-detail` chamam
`get_narratives_table` via `supabase.rpc(...)` (PostgREST) com exatamente
6 argumentos nomeados, nunca `p_reference_at` — com dois overloads do
mesmo nome no catálogo, PostgREST fica sujeito a falhar ao escolher um
único candidato (`PGRST203`, "could not choose the best candidate
function") em vez de simplesmente preferir o de menos parâmetros default
como o Postgres faria numa chamada SQL pura. Esse erro nunca chegava
visível ao usuário: `fetchNarratives`/`fetchNarrativeSummary`
(`aggregated-metrics-service.ts` + as 7 cópias inline nas Edge Functions)
capturam qualquer exceção da RPC e devolvem `[]`/`null` silenciosamente —
exatamente o sintoma reportado. Isso também explica por que as queries
SQL diretas do usuário sempre mostraram dado real (SQL direto não passa
pelo PostgREST, então nunca hits essa ambiguidade) e por que desabilitar
`page_cache` não mudou nada (nunca foi a causa).

`get_communication_impact` (também em `20260726010000`) chama
`get_narratives_table` com argumentos nomeados incluindo `p_reference_at
=>` explicitamente — resolve sem ambiguidade contra o overload de 7
parâmetros mesmo com os dois coexistindo, o que explica por que o módulo
`communications` nunca apresentou o mesmo sintoma.

**Fix** (migration `20260731040000`): dropa os dois overloads antigos
(`drop function` pras assinaturas de 6 e de 7 parâmetros) e recria UM
ÚNICO `get_narratives_table`, 7 parâmetros, reunindo as duas metades que
tinham divergido — `category_label`/sentimento "proportion only" (de
`20260726020000`) + `p_reference_at` ancorando a janela de 14 dias da
Tendência (de `20260726010000`, `trend_series` agora usa
`(p_reference_at::date)` em vez de `current_date`). Diff isolado
confirmado contra `20260726020000`: só a assinatura (parâmetro extra) e
`trend_series` mudam, todo o resto (scope/momentum/risco/tags) é
idêntico. `get_communication_impact`/`get_narrative_communication_timeline`
não precisaram de nenhuma mudança — funções `language sql` não fixam o OID
do que chamam por nome no momento da criação, resolvem a cada invocação
contra o overload que existir no catálogo naquele momento.

`page_cache` continua desabilitado (ver acima) — não era a causa, mas
também não havia motivo pra reativar só por isso; fica como estava,
retomada é decisão separada do usuário. `npx tsc --noEmit` confirma que a
migration não afeta o lado Next.js (SQL puro). **Migration não executada
contra um banco real nesta sessão** — sem credenciais/deploy neste
ambiente, mesma limitação recorrente de toda sessão sem acesso ao
Supabase Dashboard; `git push` para `develop` (fluxo já estabelecido) é o
próximo passo para isso rodar de verdade e confirmar `/narratives`
voltando a popular. Ver `_pending.md`, gap #34, pro registro completo.

### Sentimento por narrativa ignorava o balde Neutro predominante (2026-07-14)

Follow-up na mesma sessão, depois do fix acima: usuário reportou, com
screenshot, que os cards "Direita"/"Esquerda" e a tabela "Todas as
Narrativas" mostravam "Negativo -20"/"Negativo -29", contradizendo a
própria barra pos/neu/neg do mesmo card — Direita tinha `neu 44.2%` (maior
que `pos 22.3%` e `neg 33.5%`), Esquerda tinha `neu 47.7%` (maior que `pos
18.5%` e `neg 33.8%`). Confirmado matematicamente: `net_sentiment` era
`(positivo - negativo) / (positivo + negativo) * 100` — Direita:
`(22.3-33.5)/(22.3+33.5)*100 = -20.07`, Esquerda:
`(18.5-33.8)/(18.5+33.8)*100 = -29.25` — bate exatamente com os números
mostrados. A fórmula estava funcionando exatamente como projetada, só que
nunca considerava se Neutro era o balde predominante antes de calcular o
skew só entre positivo/negativo (as duas minorias, no caso). Diferente
dos 2 bugs de sentimento já corrigidos em 2026-07-25 (janela de tempo
divergente, depois duas fontes divergentes) — este é um terceiro
problema, novo: a fórmula certa aplicada ao par errado de categorias.

Fixed na migration `20260802030000` (originalmente escrita/numerada como
`20260731050000` — renomeada depois que um `supabase db push` real expôs
uma colisão de timestamp com outro arquivo de migration não relacionado,
`20260731050000_entities_cargo_partido_ideologia.sql`, escrito em paralelo
por outro trabalho no módulo `entities`; ver "Colisão de timestamp entre
migrations..." logo abaixo) — mesma assinatura de `20260731040000`, só
`sentiment_final`/`sentiment_labeled` mudam:
`sentiment_label` agora checa primeiro se Neutro é o balde predominante
(`>=` positivo E `>=` negativo, com alguma menção neutra de verdade) — se
for, o rótulo é sempre `'neutral'` e o `net_sentiment` reportado é `0`
(pra não ficar "Neutro -20" contraditório na UI). Só quando Neutro não é
predominante o skew positivo/negativo volta a decidir o rótulo, nas
mesmas 7 faixas de sempre. `risk_inputs.sentiment_risk` herda a correção
automaticamente (lê `sl.net_sentiment`) — uma Narrativa dominada por
cobertura neutra agora produz `sentiment_risk = 50` (neutro) em vez de
inflar o risco por causa de uma pequena minoria desbalanceada. Verificado
por diff isolado contra `20260731040000`: só as duas CTEs de sentimento
mudam, todo o resto (scope/momentum/tendência/risco/tags) é idêntico.
`npx tsc --noEmit` limpo (SQL puro). **Não executado contra um banco
real** — mesma limitação recorrente de toda sessão sem credenciais de
deploy; `git push` pra `develop` é o próximo passo.

### Redesenho de "Autores e Influenciadores" com vínculo real a `entities` (2026-08-01)

Pedido do usuário, 2 turnos na mesma sessão: (1) "revise a página e o
backend de autores e influenciadores e sugira novas visualizações
integrando com a tabela entities... totalmente interativa... partido,
ideologia, menções, sentimentos"; (2) depois de um protótipo interativo
aprovado ("protótipo aprovadíssimo"): "pode escrever a spec e iniciar o
desenvolvimento".

**Revisão (turno 1)** — auditoria de código (não de spec) encontrou que o
vínculo com `entities` descrito em `entities/author-linking.md` desde
2026-07-13 **nunca tinha sido implementado**: `get_authors_ranking`
sempre devolvia `entity_id`/`risk_level` como `null` hardcoded, sem
nenhum `LEFT JOIN` real; `AuthorsList` não tinha nenhum código referente a
`entities`. Achado também que a lista completa de autores/`p_period_start`/
`p_period_end` nunca eram usados pela function (documentado como
limitação estrutural, não bug — `bw_query_top_authors`/`bw_query_top_tweeters`
não guardam histórico por período, só o snapshot mais recente). Protótipo
HTML interativo (Artifact, dados ilustrativos) construído seguindo o skill
`dataviz` do workspace, para o usuário avaliar o desenho antes de
implementar de verdade.

**Implementação (turno 2)**:
- **Specs atualizadas primeiro**: `entities/author-linking.md` (SQL exata
  do `LEFT JOIN`, contra a definição real da function, não uma suposição)
  e `intelligence-center/authors-and-influencers.md` (nova seção
  "Redesenho interativo" — toda a UI nova documentada campo a campo antes
  de escrever código), `aggregated-metrics/standard-json-envelope.md`
  (`AuthorRow` formalizado), `_design-tokens.md`/`tailwind.config.ts`
  (paleta nova "Ideologia" — 5 faixas esquerda→direita, violeta↔teal
  deliberadamente distinto de vermelho/verde de sentimento e laranja/
  vermelho de risco, pra não sugerir "esquerda é ruim"/confundir as 3
  escalas quando aparecem juntas).
- **Migration `supabase/migrations/20260801010000_authors_entity_enrichment.sql`**
  — `drop function`/`create or replace function get_authors_ranking`
  (mesma assinatura de entrada) ganhando `entity_match`/`entity_tags_agg`
  (CTEs novas, `LEFT JOIN` só depois do `grouped` já existente, nenhum
  cálculo de ranking mudou) e a coluna `mentions` (`g.volume`, já
  calculada só pra `order by`, nunca devolvida). Vínculo por
  `lower(trim(entity_accounts.username)) = lower(trim(author))`,
  desempatado por `created_at` quando o mesmo handle existe em 2
  `entity_accounts` diferentes (mesma limitação já aceita de "JOIN só por
  username, não platform").
- **`AuthorRow` ganhou 7 campos** (`mentions`, `entity_type`,
  `entity_cargo`, `entity_partido`, `entity_ideologia`,
  `entity_influence_level`, `entity_tags`) — `packages/shared-types/src/envelope.ts`
  + a mesma mudança replicada manualmente (Princípio técnico 5, sem
  ferramenta de propagação automática) nas **7** Edge Functions
  `get-page-{overview,narratives,sentiment,platforms,themes,authors}`/
  `get-narrative-detail` (a lista cresceu de 6 pra 7 desde que
  `get-page-authors` foi criada em 2026-07-25 — a nota antiga de
  `author-linking.md` ainda dizia "6", corrigida nesta sessão).
- **Frontend**: `authors-list.tsx` evoluiu de lista estática cortada em 15
  linhas pra tabela ordenável/paginada (`Pagination`/`DEFAULT_PAGE_SIZE`)
  com colunas Partido/Ideologia/Menções — continua sendo a mesma
  componente reusada em `/themes` e no detalhe de Narrativa (prop
  `onSelectAuthor` é opcional, as 2 páginas mais simples não precisam
  passar). Novo helper `author-color.ts` (sem JSX) centraliza
  `dominantSentiment`/cor por ideologia (token fixo)/partido (hash
  determinístico, mesmo mecanismo já usado por `trend-line-chart.tsx` pra
  grupos sem paleta conhecida) — reusado por 6 componentes, evita 6
  implementações divergentes da mesma regra de cor. 5 componentes novos em
  `components/intelligence-center/`: `charts/author-scatter-chart.tsx`
  (dispersão Alcance×Sentimento, SVG à mão com `viewBox` acompanhando a
  largura real via `ResizeObserver` — mesmo padrão de
  `trend-line-chart.tsx`, evita o bug de 2026-07-19 de rótulo escalando
  com a largura do card), `author-ideology-breakdown.tsx` (menções por
  ideologia + sentimento médio por ideologia, ordem sempre fixa
  esquerda→direita), `author-party-breakdown.tsx` (top 8 partidos por
  alcance, ordem por valor), `author-detail-panel.tsx` (slide-over lateral,
  não modal central), `author-filters-toolbar.tsx` ("Colorir por" +
  busca/partido/sentimento/só-vinculados + chips de ideologia). `/authors`
  (`app/(intelligence-center)/(analytics)/authors/page.tsx`) reescrita
  pra orquestrar tudo — toda a interatividade é `useState`/`useMemo` local
  sobre `envelope.authors` já carregado, **nenhuma chamada de rede nova**
  por filtro/ordenação/clique (mesmo princípio de `dominantSentiment()`
  já existente, agora formalizado como regra da spec).
- **Não implementado nesta sessão**: o botão "+ Cadastrar Entidade" no
  painel de detalhe aparece (só pra admin, `useUserProfile().isAdmin`) mas
  ainda não abre um formulário de verdade — depende de
  `entity-registration.md` (CRUD do módulo `entities`, ainda `pronto`, não
  implementado) existir primeiro.
- **Verificação**: `npx tsc --noEmit` limpo; `npm run build` limpo (19
  rotas, só 2 warnings pré-existentes e não relacionados sobre `<img>` em
  `sidebar.tsx`/`layout.tsx`) — um warning novo de `react-hooks/exhaustive-deps`
  em `authors/page.tsx` (`allAuthors` recriado a cada render) foi
  encontrado e corrigido (`useMemo` próprio) antes de finalizar. **Não
  executado contra um banco real** — sem credenciais/deploy neste
  ambiente, mesma limitação recorrente de toda sessão sem acesso ao
  Supabase Dashboard já registrada em várias entradas deste arquivo.

### X Themes — links clicáveis (2026-08-02)

Pedido do usuário: "tudo que for possível colocar link clicável em X
Themes (Hashtags, Posters, Stories, Emojis) coloque. Exemplo: hashtags,
perfis, url de posts, stories, etc." `components/intelligence-center/
x-insights-panel.tsx` ganhou `insightHref(type, name)` — sem dado novo,
`XInsightItem.name` já é literalmente "a hashtag, emoji, URL ou @handle
citado" (`foundation/data-model.md`, `bw_query_x_insights`), só faltava
construir o link a partir disso: **Top Hashtags** → busca por hashtag no
X (`x.com/hashtag/<tag>`, prefixo `#` removido se vier no dado); **Most
Mentioned X Posters** → perfil do autor (`x.com/<handle>`, prefixo `@`
removido); **Top Stories** (`insight_type = 'url'`) → `name` já é a URL
completa, linka direto (só valida `/^https?:\/\//` antes, pra nunca
produzir um `href` quebrado a partir de um dado inesperado). **Top Emojis
fica deliberadamente sem link** — um emoji sozinho não é um recurso
navegável, diferente dos outros 3 tipos (sempre têm uma URL real por
trás). Todos abrem em nova aba. Spec atualizada em
`intelligence-center/authors-and-influencers.md`. `npx tsc --noEmit`
limpo.

### Colisão de timestamp entre migrations escritas em paralelo — `20260731050000` renomeada (2026-08-02)

Real incident, found while debugging why the `concurrency`/self-healing
fix to `deploy.yaml` (see above) kept failing identically on every retry
instead of resolving: `supabase migration repair --status applied
20260731050000` reported success every single time, yet the very next
`supabase db push` still listed `20260731050000_narrative_sentiment_
neutral_plurality.sql` as pending and failed on the exact same
`duplicate key ... schema_migrations_pkey` error — 5 times in a row,
looping without ever converging. That ruled out the concurrency-race
theory this fix was built for (a real race would resolve after one
repair): `supabase/migrations/` had **two different files sharing the
same version prefix**, `20260731050000` — this session's
`narrative_sentiment_neutral_plurality.sql` and an unrelated
`entities_cargo_partido_ideologia.sql` written independently by other
parallel work on the `entities` module in this same repo (this project
has had multiple sessions/agents committing to it concurrently, per
several `supabase/functions*`/spec files showing up modified by "the
user or a linter" throughout recent sessions in this file). Whichever of
the two reached the remote database first claimed that version number in
`supabase_migrations.schema_migrations` (`version` is the primary key) —
`migration repair` just re-confirms whichever row is already sitting on
that version, it can't make room for a *second*, differently-named
migration under the same version number. That's why every retry looped
identically instead of ever succeeding: the file being pushed
(`narrative_sentiment_neutral_plurality.sql`) was never the one recorded
under that version, so `db push` kept trying to insert it and kept
colliding with the other migration's row.

**Fix**: renamed the file to a free version number,
`20260802030000_narrative_sentiment_neutral_plurality.sql` (`git mv`,
preserves history) — same content, only the timestamp changed, since a
brand-new, never-before-used version number can't collide with anything.
Updated its own internal self-reference comments and the `comment on
function` string, plus every doc citing the old version
(`_pending.md` gap #35, `sql-aggregation.md`'s "Correção #3", the
paragraph just above this one) to point at `20260802030000` instead.
`20260731050000_entities_cargo_partido_ideologia.sql` (the other,
unrelated file occupying that same original number) was left completely
untouched — not this session's migration, not this session's to rename.

**✅ Recommendation added to prevent recurrence** — see `.dev/specs/
_index.md`, Principle 7 ("Migration hygiene"), new bullet: **always check
`ls supabase/migrations/ | sort | tail` (or `git status`/`git pull`
right before writing a new migration) for the exact timestamp about to be
used, and never assume a timestamp is free just because it looks like
"now."** In a repo where more than one session/agent may be adding
migrations around the same time, two independently-chosen timestamps can
legitimately collide (both picked "the current date + 000000" without
seeing each other's uncommitted or just-committed work) — this is not
hypothetical, it happened for real this session. When in doubt, pick a
timestamp clearly past the latest one currently on disk, and always
double check with a fresh `ls`/`git pull` immediately before naming the
file, not from memory of what was there earlier in the session.

### X Themes — auditoria de bw-sync + correção de bug real + frescor visível na UI (2026-08-03)

User request: "reveja se os dados dessas tabelas [X Themes: Hashtags,
Posters, Stories, Emojis] estão sendo corretamente atualizadas pelo
bw-sync, pois os dados de uma publicação não está batendo com os dados
vindos na integração."

**Auditoria completa, sem divergência de mapeamento encontrada**:
`syncXInsights`/`isXInsightsStale`/`runXInsightsStep` (`bw-sync/index.ts`)
reconferidos linha a linha contra
`developers.brandwatch.com/docs/twitter-insights` ao vivo nesta sessão —
os 4 endpoints (`data/hashtags`/`data/emoticons`/`data/urls`/
`data/mentionedauthors`), o parâmetro `category` (filtro documentado,
mesmo padrão já usado por outras chamadas neste projeto) e o mapeamento de
campo (`volume`/`tweets`/`retweets`/`impressions`/`reachEstimate`/
`sentiment`) batem exatamente com o que já estava implementado — nenhuma
divergência nova em relação à confirmação já feita em 2026-07-18. Upsert
key (`project_id, query_id, category_id_key, insight_type, name,
metric_week`) e dedupe (`dedupeByKey`) também corretos.

**Um bug real encontrado e corrigido** (migration `20260803010000`):
`get_x_insights`'s CTE `latest` escolhia "qual é a semana mais recente"
agrupando só por `insight_type`, ignorando `category_id` — se
`filter_category_ids` alguma vez resolver mais de uma Category
simultaneamente (não acontece hoje pela UI atual, que nunca envia mais de
uma Narrativa em `filters.narratives`, mas a function precisa estar
correta independente disso), qualquer Category cujo sync mais recente
caiu num dia diferente do "mais recente" combinado entre todas ficava
silenciosamente excluída do resultado — o `join ... on l.w = s.metric_week`
nunca casava as linhas dela. Corrigido: `latest` agora agrupa por
`(insight_type, category_id)`, cada Category compara só contra o próprio
snapshot mais recente.

**Causa mais provável do relato do usuário, no entanto: ausência de
indicação de frescor na UI, não um bug de dado.** `isXInsightsStale`
sempre limitou X Insights a re-sincronizar a cada 7 dias por par (project,
query, category) — mas nenhuma tela jamais mostrava desde quando aquele
snapshot valia, então um número visto ao vivo na Brandwatch podia
legitimamente divergir de um valor sincronizado até 7 dias atrás sem que
isso fosse um bug de verdade. Fechado com um novo campo `synced_at
timestamptz` no retorno de `get_x_insights` (nunca `null` — toda linha
vem de uma sincronização real), propagado por Princípio 5 através de
`packages/shared-types/src/envelope.ts` (`XInsightItem.synced_at`), da
cópia canônica (`supabase/functions-shared-source/aggregated-metrics-service.ts`)
e das 7 Edge Functions deployadas (`get-page-{overview,narratives,
sentiment,platforms,themes,authors}`, `get-narrative-detail`) — todas
mantidas manualmente em sincronia, mesma disciplina já usada por toda
adição de campo anterior neste módulo. `XInsightsPanel`
(`components/intelligence-center/x-insights-panel.tsx`) agora mostra
"Atualizado hoje"/"Atualizado ontem"/"Atualizado há N dias" por seção
(Hashtags/Posters/Stories/Emojis), reaproveitando `formatRelativeDate`
(`lib/date/format.ts`) e o `timezone` do usuário (`useUserProfile()`, já
buscado pela página `/authors` — só precisou ser repassado como prop).
Corrigido de passagem: um comentário desatualizado em todas as 8 cópias
de `XInsightItem` ainda dizia "só na página `platforms`" — o bloco mudou
de página em 2026-07-25 e o comentário nunca foi atualizado; agora diz
`authors` em todas.

**Ponto adicional documentado, não um bug**: "Top Stories"
(`insight_type = 'url'`) é um agregado por URL — soma o volume de **todos
os posts que compartilham aquela URL**, não as métricas nativas de uma
publicação específica isolada (`data/urls`, "Top Shared URLs" na doc da
Brandwatch, ver `foundation/data-model.md`). Se o usuário estava
comparando o número de uma Story com as métricas de um único post do X, a
divergência é esperada por definição, não um defeito — registrado em
`sql-aggregation.md` para o caso de o relato persistir e alguém precisar
descartar essa explicação primeiro.

**Limitação recorrente, mesma de toda sessão anterior sem acesso a
produção**: sem credenciais Brandwatch/Supabase reais neste ambiente, não
foi possível reproduzir o exemplo específico do usuário ("os dados de uma
publicação não está batendo") ponto a ponto — o fix acima cobre as duas
causas plausíveis e verificáveis por inspeção de código (bug de
agrupamento + staleness silenciosa); se a divergência persistir depois
deste deploy, o próximo passo é pedir ao usuário o hashtag/story/exemplo
concreto comparado, para diagnosticar contra o dado real em vez de
inspeção estática.

**Verificação**: `npx tsc --noEmit` e `npm run build` — ver resultado
abaixo desta entrada, rodados ao final da sessão. Migration
`20260803010000` revisada manualmente, não executada contra um banco
real — mesma limitação recorrente de toda sessão sem credenciais de
deploy neste ambiente.

## Módulo `finops` — painel de custo de IA (2026-08-05)

Módulo novo, spec'd e implementado na mesma sessão. Pedido do usuário, na
sequência direta de uma investigação de custo do `event-radar` (o usuário
tinha acabado de configurar `ANTHROPIC_API_KEY` e pedido uma estimativa
manual de custo baseada em pricing público do Claude Haiku 4.5): "faça uma
página e disponibilize no menu de administração com a estimativa de custo
tendo em vista o consumo atual... deve ser atualizada diariamente com o
consumo e com a previsão de gasto... permita tb cadastrar custos extras
que podem ser pontuais ou mensais ou anuais." Migration
`20260805000000_finops_schema.sql`, 4 Edge Functions novas, página
`/admin/finops`. Ver `.dev/specs/finops/` (`overview.md`/`data-model.md`)
para o spec completo.

- **De estimativa pra medição real**: a resposta anterior desta mesma
  conversa (a estimativa de custo do `event-radar`) tinha sido só
  aritmética manual em cima de faixas de tokens chutadas — o pedido desta
  sessão é o oposto, um painel que reflete o **uso real**, então a
  primeira decisão foi instrumentar os dois únicos pontos do produto que
  chamam Claude pra gravar `response.usage.input_tokens`/`output_tokens`
  (dado que a própria API da Anthropic já retorna, nunca estimado) numa
  tabela nova, `ai_usage_log`: `event-radar-agent-orchestrator/index.ts`
  (event-radar 1.4) e `composeLayer1NarrativeText` em
  `aggregated-metrics-service.ts` (Camada 1 de `ai-synthesis`). Custo em
  USD calculado no momento da gravação (`AI_MODEL_PRICING`, hoje só
  `claude-haiku-4-5` — $1/$5 por MTok, confirmado via a skill `claude-api`
  nesta mesma conversa) — preserva o custo histórico correto mesmo que o
  preço de um modelo mude no futuro, sem precisar de uma tabela de preços
  versionada.
- **`recordAiUsage()` duplicada nos dois pontos de chamada** (Princípio
  técnico 5 — Edge Functions autossuficientes) e propagada nas 7 cópias
  deployadas de `aggregated-metrics-service.ts`
  (`get-page-{overview,narratives,sentiment,platforms,themes,authors}`,
  `get-narrative-detail`) via um script Node de uso único (não commitado,
  mesma técnica já usada na sessão da Fase B, 2026-08-02) — verificado com
  `diff` que as 7 cópias receberam exatamente a mesma mudança, sem
  divergência mecânica. `composeLayer1NarrativeText` precisou de 3
  parâmetros novos (`supabase`, `ctx`, `page`) que não tinha antes, só pra
  poder gravar o uso — `composeAndPersistLayer1` (o único chamador) já
  tinha os três em escopo, então o call site também mudou. A gravação
  acontece **logo após receber a resposta da Anthropic**, antes de
  qualquer verificação de `stop_reason`/parse/persistência subsequente —
  o uso já foi cobrado naquele ponto, independente do que acontece depois
  (refusal, erro de parse, falha ao gravar o resultado final). Uma falha
  ao gravar em `ai_usage_log` em si só loga o erro e nunca derruba o
  fluxo principal (observabilidade não deve quebrar o que está
  observando).
- **Escopo deliberado: plataforma inteira, não por organização** — mesmo
  modelo de `/admin/users` (`is_admin`, sem seletor de organização), não o
  modelo das 5 páginas de análise (organização ativa + período do
  header). O custo de IA é cobrado numa única conta da Anthropic pela
  plataforma inteira, então não fazia sentido pedir pro admin escolher
  "qual organização" pra ver esse gasto.
- **Decisão deliberada: sem tabela de resumo diário materializada + cron
  novo**, diferente do padrão já usado no projeto pra grão diário
  (`bw_query_metrics_daily`/`narrative_metrics`, que existe pra evitar
  reconsultar a API do Brandwatch, sujeita a rate limit). Nenhuma dessas
  razões se aplica aqui — `ai_usage_log` é local, permanente (sem job de
  retenção/poda, mesma filosofia de sempre) e o volume esperado é
  minúsculo (poucas dezenas de chamadas de IA por dia, no teto — o cap
  diário de 15/organização do event-radar 1.6 já limita isso). Uma
  consulta live agrupada por dia sobre `ai_usage_log`, dentro de
  `get_finops_overview()`, é trivial em performance e sempre exata — "
  atualizada diariamente" (pedido do usuário) é satisfeito por
  construção, já que a página lê direto do log gravado em tempo real,
  nunca de um snapshot que poderia atrasar até o próximo job noturno.
- **`get_finops_overview(p_trend_days integer default 30)` retorna
  `jsonb`** — mesmo padrão de `get_dissemination_graph`
  (aggregated-metrics/sql-aggregation.md), a forma mais simples de um
  único RPC devolver blocos heterogêneos (hoje/mês corrente/projeção/
  tendência diária/custos extras) numa chamada só. Fórmula de projeção
  (inferência de MVP, sem nenhum spec prévio definindo isso — mesmo
  padrão já usado em `event_radar_config()`/`get_volume_trend`,
  documentada num único lugar pra ser recalibrada com dado real):
  `avg_daily_ai_cost_usd = gasto_do_mês / dias_decorridos`,
  `projected_ai_cost_usd = avg_daily × dias_no_mês`, mais os custos extras
  ativos no mês (mensal cheio, anual/12, pontual se a data cai no mês
  corrente). `daily_trend` preenche os 30 dias via `generate_series` +
  `coalesce(..., 0)` — nunca um "buraco" silencioso num dia sem uso de IA.
- **`manual_costs`** — custos extras cadastrados manualmente
  (descrição/valor USD/recorrência pontual-mensal-anual/data efetiva/data
  de término opcional). `recurrence` é enum (`finops_cost_recurrence`),
  não uma tabela de referência tipo `communication_types` — são 3 valores
  estruturais, sem pedido do usuário de que isso cresça (diferente de
  tipos de comunicação, onde o usuário pediu explicitamente uma tabela
  editável). CRUD via 3 Edge Functions dedicadas
  (`create`/`update`/`delete-finops-manual-cost`), cada uma validando no
  handler (Princípio técnico 2) e checando `is_admin` — mesmo padrão de
  auth dos `admin-*` (Bearer token → `supabaseAdmin.auth.getUser(token)` →
  checar `user_profiles.is_admin`), não o padrão de `get-page-*` (chave
  publicável + JWT encaminhado), já que este é um recurso admin-only da
  plataforma.
- **RLS deny-all** em `ai_usage_log`/`manual_costs` — mesmo padrão de
  `bw_sync_lock`/`sync_cursors`/`sync_log` (nem `authenticated` nem `anon`
  tocam essas tabelas direto; só `service_role`, via as Edge Functions,
  bypassa).
- **Frontend**: `/admin/finops` (mesmo gate `is_admin` de `/admin/users`,
  server component com `redirect('/overview')` pra não-admin) — 4 KPIs
  (gasto hoje, gasto no mês, custos extras no mês, projeção total do
  mês), gráfico de tendência diária reaproveitando `TrendLineChart`
  (construindo um objeto `Trend` compatível a partir de `daily_trend` —
  nenhum componente de chart novo precisou ser escrito), tabela de uso
  por origem no mês, e a lista de custos extras com CRUD completo
  (criar/editar/excluir, `ConfirmDialog` na exclusão, `Toast` em toda
  ação, mesmo padrão de `users-admin-view.tsx`). Item de menu "FinOps" em
  CONFIGURAÇÕES, ao lado de "Administração", mesmo gate `isAdmin`.
- **Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf
  .next` antes) confirmados limpos — 21 rotas, `/admin/finops` nova.
  Migration `20260805000000` revisada manualmente, não executada contra
  um banco real nesta sessão (mesma limitação recorrente de toda sessão
  sem credenciais de deploy) — o próximo `git push` pra `develop` é o que
  de fato cria as tabelas/function e passa a acumular `ai_usage_log` de
  verdade; até lá, `/admin/finops` mostra zeros (sem uso de IA registrado
  ainda), não um erro.

### "Mudança de sentimento" — widget morto na página `/sentiment` religado ao `narrative_text` já existente (2026-08-03)

User report, colando 2 mensagens exatas vistas na UI: "Ainda sem resumo
executivo gerado para esta Narrativa." (detalhe de Narrativa — pipeline
separado, `narrative-summary-composer`/`narratives.description`, já
resolvido em outra sessão concorrente neste mesmo repositório, ver
`_pending.md`) e "Análise textual de mudança de sentimento ainda não
implementada — depende de síntese narrativa (ai-synthesis, ver
_pending.md)." (`/sentiment`). Pedido: "Verifique o que está pendente em
ai-synthesis e implemente."

Revisão de `ai-synthesis.md` (a mesma revisão de coerência da sessão
anterior, 2026-08-03) já tinha confirmado Camadas 0/1 implementadas desde
2026-08-02, com apenas 2 gaps reais e deliberadamente deferidos
(gatilhos de invalidação de período aberto — `_pending.md` #21; Camada 2,
opt-in por página). Nenhum dos dois é o que o usuário está vendo — a
segunda mensagem colada é um `EmptyState` **hardcoded no frontend**
(`app/(intelligence-center)/(analytics)/sentiment/page.tsx`), escrito
2026-07-13 durante o import do protótipo, numa época em que `ai-synthesis`
genuinamente não tinha nenhuma camada pronta. Ficou obsoleto desde
2026-08-02 e ninguém tinha voltado nesta página específica pra trocar o
texto fixo pelo dado real — `narrative_text` já é computado pro envelope
de `/sentiment` (uma das 3 páginas que hoje alcançam a Camada 1 de
verdade: `highlights` **e** `narrative_text` juntos em `PAGE_BLOCKS`,
`get-page-sentiment` já deployada) e já **estava sendo renderizado** nesta
mesma página — só no widget genérico "Insights" no fim da página
(`NarrativeTextPanel` + `HighlightsPanel`), nunca no widget "Mudança de
sentimento" ao lado de "Distribuição geral" (posição do protótipo
original), que continuava com o `EmptyState` morto.

Fix, sem nenhuma mudança de backend — só o frontend deixou de esconder um
dado que já existia: `NarrativeTextPanel` movido (não duplicado) pro
widget "Mudança de sentimento"; o widget "Insights" no fim da página
passou a mostrar só `HighlightsPanel` — mesmo padrão de dedup já
estabelecido em `/overview` ("O que os gráficos mostram?", ver a entrada
"Second round of `/overview` UI polish" mais acima neste arquivo).
`intelligence-center/sentiment-analysis.md` atualizada com o achado.

**Não implementado nesta sessão, fora do escopo do que foi pedido/visto na
UI**: `narrative_detail` (`/narratives/[id]`) também computa
`narrative_text` (sempre via Camada 0, já que essa página não tem bloco
`highlights` em `PAGE_BLOCKS` — nunca alcança Camada 1) mas
`narrative-detail-content.tsx` nunca lê `envelope.narrative_text` em lugar
nenhum — diferente do caso de `/sentiment`, aqui não existe nem um
`EmptyState` visível (o dado é só silenciosamente descartado, não haveria
mensagem pro usuário reportar). Registrado como achado, não corrigido
agora — não foi o que o usuário reportou ver.

**Verificação**: `npx tsc --noEmit` limpo. Sem mudança de SQL/Edge
Function nesta sessão.

### Mapeamento tópico↔Narrativa por polaridade + Drivers de sentimento em todas as páginas (2026-07-14)

User request, 2 partes na mesma mensagem: (1) "Na integração com a
brandwatch temos os topics vinculados com as narrativas. Esses tópicos
precisam aparecer no envelope das narrativas para que a IA consiga
utilizar em sua análise... No caso das narrativas é importantíssimo esse
mapeamento dos tópicos com a narrativa para melhorar o entendimento da IA
e do usuário final"; (2) "em todas as páginas é importante existir os
principais tópicos positivos e negativos."

**Auditoria antes do código** confirmou que os dois pedidos apontavam
para gaps reais, distintos: `get_narratives_table.tags` já mapeava
tópico→Narrativa desde `20260721010000`, mas sem nenhuma polaridade — não
dava pra responder "quais termos especificamente puxam o sentimento desta
Narrativa" a partir da tabela/card. `get_term_signals` já resolve
sentimento por termo (classificação por maioria, corrigida em
`20260726030000`), mas só escopado a 1 Narrativa por vez
(`filters.narratives`) — inviável para preencher N linhas simultâneas da
tabela de Narrativas sem N chamadas. E `PAGE_BLOCKS` só incluía
`term_signals` em `sentiment`/`themes`/`narrative_detail` — `overview`,
`narratives` e `platforms` não tinham o bloco de forma alguma, confirmando
o segundo pedido como um gap real de wiring, não uma percepção errada do
usuário.

**Migration `20260805010000`** — `get_narratives_table` ganhou (`drop
function` necessário, mesma regra de sempre para aumento de colunas de
saída) `positive_topics`/`negative_topics` (`text[]`, até 5 itens cada):
mesmo universo de `tags` (`bw_query_topics`, `topic_type in ('hashtags',
'phrases', 'words')`, semana mais recente sincronizada), classificados
pela **mesma regra de maioria já usada por `get_term_signals`**
(`sentiment_positive`/`neutral`/`negative`, o balde com mais menções
vence) — só aplicada por Narrativa (`category_id`) em vez de por filtro
arbitrário, ranqueados por `volume` (mesmo critério de `tags`, não
`trending` — aqui o objetivo é "quais termos mais citados puxam esse
sentimento", não "quais estão crescendo mais rápido"). Sempre array,
nunca `null`; `{}` quando não há termo com sentimento predominante nesse
lado no período sincronizado.

`narrative_summary_build_payload` (o job `narrative-summary-composer` que
escreve `narratives.description`) ganhou os 2 campos no mesmo objeto
`scores` que já lia de `get_narratives_table` (`create or replace`, mesma
assinatura/retorno `jsonb`, sem `drop function`) — a IA que escreve o
resumo executivo de cada Narrativa agora vê explicitamente quais termos
puxam o sentimento pra cada lado, não só a lista neutra de `tags`. Como
`positive_topics`/`negative_topics` também fazem parte do bloco
`narratives` do envelope padrão, chegam automaticamente ao payload da IA
de síntese geral (`toAiPayload`/Camada 1 de `ai-synthesis.md`) em toda
página cujo `PAGE_BLOCKS` inclua `'narratives'` — satisfaz "para que a IA
consiga utilizar em sua análise" sem nenhuma chamada adicional.

**Propagação (Princípio técnico 5)**: `NarrativeRow`
(`packages/shared-types/src/envelope.ts`), a cópia canônica
(`supabase/functions-shared-source/aggregated-metrics-service.ts` —
`NarrativeRow` **e** `NarrativeTableRow`, as duas interfaces do lado Deno
que espelham o mesmo shape) e as 7 Edge Functions deployadas
(`get-page-{overview,narratives,sentiment,platforms,themes,authors}`,
`get-narrative-detail`) ganharam os 2 campos — propagação mecânica via
script Node de uso único (substituição por igualdade de string exata,
contando ocorrências pra garantir 1 match por arquivo antes de aplicar),
mesma técnica já usada na sessão da Fase B (2026-08-02). Confirmado por
`diff` contra o canônico depois: só as diferenças já conhecidas/esperadas
(comentário do cabeçalho, linha de import, um comentário citando o nome
da página) sobraram, nada da propagação divergiu.

**`PAGE_BLOCKS`** ganhou `'term_signals'` em `overview`/`narratives`/
`platforms` (mesma propagação) — `themes`/`narrative_detail` já tinham o
bloco (só para a nuvem de palavras `TermSignalsList`, sem separação de
polaridade). Novo par de widgets "Principais tópicos positivos"/
"Principais tópicos negativos" (`overview`, `narratives`, `platforms`) e
"Tópicos positivos/negativos por pauta"/"da narrativa" (`themes`,
`narrative_detail`) — todos reusando `PositiveDriversList`/
`NegativeDriversList` (`components/intelligence-center/term-signals-list.tsx`,
já existentes desde `/sentiment`, 2026-07-17) sem nenhuma mudança nesses
componentes. `NarrativeCard` (`components/intelligence-center/narrative-card.tsx`)
ganhou 2 linhas de chips coloridos (verde/vermelho, até 3 termos por
lado) acima da linha neutra de `tags` já existente, usando
`positive_topics`/`negative_topics` — mapeamento tópico↔Narrativa visível
diretamente no card, sem abrir o detalhe.

**Especificações atualizadas**: `aggregated-metrics/sql-aggregation.md`
(nova seção "Mapeamento tópico↔Narrativa por polaridade"),
`standard-json-envelope.md` (`narratives`/`term_signals`),
`block-mapping-per-page.md` (linha `term_signals` da tabela + nota de
topo), `intelligence-center/narratives-exploration.md` (card + detalhe),
`executive-overview.md`, `platform-analysis.md`, `electoral-themes.md`,
`sentiment-analysis.md` (nota de que o widget deixou de ser exclusivo
desta página).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, nenhuma rota nova (só widgets
adicionais em páginas já existentes). Migration `20260805010000` revisada
manualmente, não executada contra um banco real nesta sessão (mesma
limitação recorrente de toda sessão sem credenciais de deploy neste
ambiente) — `git push` para `develop` (fluxo já estabelecido) é o próximo
passo para isso rodar de verdade.

### `/overview` — Top N configurável, tópicos unificados num único frame, Radar de Eventos com resumo executivo (2026-07-14)

User request, 5 itens na mesma mensagem, só frontend + documentação (sem
mudança de backend/envelope): (1) retirar a tabela "Narrativas" de
`/overview` e subir "Top 3 Narrativas por Menções" pro lugar dela; (2)
permitir escolher Top 3/5/10; (3) botão de acesso a todas as Narrativas
nesse mesmo widget; (4) "Principais tópicos positivos"/"negativos" no
mesmo frame, só variando a cor (vermelho/verde/neutro); (5) "Radar de
Eventos" ganha 2 visualizações alternáveis — lista (como já era) e resumo
executivo.

- **Item 1**: a tabela "Narrativas" (`NarrativesTable` + `ScoreLegend`,
  10 primeiras linhas) foi removida de `/overview` — a lista completa
  continua em `/narratives` (agora com um link explícito, ver item 3). O
  widget de Top N passou a ocupar exatamente essa posição, entre "O que
  os gráficos mostram?" e "Principais tópicos".
- **Item 2**: `overview/page.tsx` ganhou `useState<3|5|10>` (`topCount`,
  default 3) e um segmented control no cabeçalho do próprio widget
  (`WidgetCard`'s novo prop `headerAction`, ver abaixo) — mesmo estilo
  visual do toggle de período do header global (`bg-accent-blue
  text-white` no ativo). `TopThreeNarrativeCards` virou `TopNarrativeCards`
  (recebe `count`), grid ganhou um passo `sm:grid-cols-2` (antes só
  `md:grid-cols-3`, fixo em 3 itens) pra acomodar 5/10 itens sem forçar
  tudo numa única linha ou coluna.
- **Item 3**: link "Ver todas as Narrativas →" (`next/link` pra
  `/narratives`) ao lado do seletor de Top N, no mesmo `headerAction`.
- **Item 4**: `WidgetCard` (`components/intelligence-center/widget-card.tsx`)
  ganhou um prop opcional `headerAction?: React.ReactNode` (renderizado ao
  lado do título, `flex justify-between`) — usado tanto pelo seletor de
  Top N quanto, futuramente, por qualquer outro widget que precise de um
  controle no cabeçalho; nenhum dos ~40 usos existentes de `WidgetCard`
  precisou mudar (prop opcional).
- **Item 5**: `PositiveDriversList`/`NegativeDriversList`
  (`term-signals-list.tsx`) — 2 componentes/`WidgetCard`s separados desde
  2026-07-17 — foram substituídos por um único `TopicSentimentList`, que
  mistura positivo/neutro/negativo na mesma lista de pills, cada um só
  com a cor correspondente (`bg-sentiment-positive-bg`/`-neutral-bg`/
  `-negative-bg`, tokens já existentes em `tailwind.config.ts`, nenhuma
  cor nova). O bucket `neutral` — antes descartado ("termos neutros não
  aparecem em nenhuma das duas") — passou a ser exibido (até 4 itens,
  contra 8 de cada lado positivo/negativo) já que o próprio pedido do
  usuário cita "vermelho, verde **ou neutro**" como as 3 cores esperadas.
  Aplicado nos 6 lugares que usavam o par antigo (mesmo padrão de
  componente compartilhado já estabelecido pra esse par desde
  2026-07-14/25): `overview`, `narratives`, `sentiment` ("Drivers de
  sentimento"), `platforms`, `themes` ("Tópicos positivos e negativos por
  pauta") e `narrative-detail-content.tsx` ("Tópicos positivos e
  negativos da narrativa") — cada página tinha 2 `WidgetCard`s lado a
  lado, agora é 1 só. `DriverChip`/`DRIVER_COLOR` (helpers antigos)
  removidos junto — sem mais nenhum consumidor.
- **Item 5 (Radar de Eventos)**: o toggle "Lista"/"Resumo executivo" foi
  implementado dentro do próprio `RecentEventsPanel`
  (`components/intelligence-center/recent-events-panel.tsx`), não em cada
  página que o renderiza — o componente já é compartilhado entre
  `/overview` (widget) e `/radar` (página dedicada, 2026-08-02), então um
  único ponto de mudança cobre as duas. "Resumo executivo"
  (`RecentEventsExecutiveSummary`) é inteiramente derivado dos mesmos
  `highlights` já buscados por `useRecentHighlights` (nenhuma chamada de
  rede nova) — contagem por severidade (crítico/alto/médio/baixo),
  contagem por `event_type` (rótulos em `EVENT_TYPE_LABEL`, incl.
  `momentum_spike`, adicionado em 2026-08-07 e antes ausente de
  `EVENT_ICON`/labels deste arquivo) e os 5 eventos de maior
  `severity_score` com título/explicação/tempo relativo — nenhum cálculo
  de score novo (Princípio técnico 2), só agrupamento pra exibição, igual
  ao já aceito em `dominantSentiment()` (`author-color.ts`).

**Especificações atualizadas**: `intelligence-center/executive-overview.md`,
`sentiment-analysis.md`, `platform-analysis.md`, `electoral-themes.md`,
`narratives-exploration.md` (menções ao par "Principais tópicos
positivos"/"negativos" e à tabela de Narrativas em `/overview`),
`event-radar/frontend-highlights-feed.md` (widget "Radar de Eventos"
ganha as 2 visualizações).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, mesma contagem de antes (só mudança de
conteúdo dentro de páginas já existentes, nenhuma rota nova/removida).
Sem mudança de backend/migration nesta sessão — item puramente
frontend, então não se aplica a limitação recorrente de "não executado
contra um banco real". Sem automação de browser disponível neste
ambiente — o layout do seletor de Top N, o frame único de tópicos e o
toggle do Radar de Eventos não foram confirmados visualmente num
navegador real, mesma limitação já registrada em toda sessão anterior de
`intelligence-center` neste arquivo.

### FinOps não mostrava consumo de IA — terceira função de IA nunca foi instrumentada (2026-07-14)

User report: "FinOps não está mostrando o cálculo do consumo de IA até o
momento." Confirmado ao vivo contra o projeto Supabase real
(`NEXT_PUBLIC_SUPABASE_URL` de `.env.local`) que `get_finops_overview` já
está deployada e responde — a função em si não é o problema, e a migration
do módulo (`20260805000000`) já rodou.

**Causa raiz real**: quando o módulo `finops` foi construído, a sessão
instrumentou "os dois únicos pontos do produto que chamam Claude" —
`event-radar-agent-orchestrator` e `composeLayer1NarrativeText`
(`aggregated-metrics-service.ts`, Camada 1 de `ai-synthesis`) — mas essa
premissa já estava desatualizada: `narrative-summary-composer` (ver
"`narratives.description` finally gets a producer", 2026-07-14 — a mesma
data de hoje) já existia havia semanas de sessão e já chama
`anthropic.messages.create()` de verdade, a cada 30 minutos via
`pg_cron`, para gerar o resumo executivo de cada Narrativa `due`. Nunca foi
revisitada quando `finops` foi criado, então seu custo real nunca era
gravado em `ai_usage_log`. Pior: das três funções que chamam Claude, esta é
a **única sem gate condicional de dado** —
`event-radar-agent-orchestrator` só roda quando há eventos reais
enfileirados (`radar_staging_events.queued_for_agent_at`), e a Camada 1 de
`ai-synthesis` só roda com 2+ highlights — enquanto `narrative-summary-composer`
roda incondicionalmente a cada ciclo processando toda Narrativa "due". Ou
seja, esta era plausivelmente a maior (ou única) fonte real de gasto de IA
em produção, e ficava inteiramente invisível ao painel.

**Fix**: migration `20260805020000` (alarga o `check` de
`ai_usage_log.source` pra incluir `'narrative_summary_composer'`) +
`recordAiUsage()`/`AI_MODEL_PRICING`/`computeAiCostUsd` duplicados dentro
de `narrative-summary-composer/index.ts` (Princípio técnico 5 — mesma
cópia idêntica das outras duas, chamada logo após receber a resposta da
Anthropic, antes de checar `stop_reason`/parse — uso já foi cobrado ali
independente do que acontece depois). `FinopsUsageSource`/
`FINOPS_SOURCE_LABELS` (`app/(intelligence-center)/admin/finops/types.ts`)
ganharam a terceira fonte ("Resumo executivo de Narrativa (IA)") — nenhuma
mudança em `get_finops_overview` (já agrupa por `source` genericamente, o
valor novo aparece automaticamente em "Uso de IA por origem").

**Verificação**: `npx tsc --noEmit` passa limpo. Migration revisada
manualmente, não executada contra o banco real nesta sessão — mesma
limitação recorrente de toda sessão sem credenciais de deploy; `git push`
pra `develop` é o próximo passo para o campo `source` novo ser aceito de
verdade (até lá, um `insert` desta function falharia no `check` antigo).

### Amostragem de mentions via Brandwatch — research + `sample_mentions` no resumo executivo + skill `humanizer-pt-br` nos 3 pontos de IA do produto (2026-08-06)

Duas partes na mesma sessão. **Research (sem código)**: usuário perguntou
se é possível capturar uma amostra de mentions por Narrativa via endpoints
da Brandwatch, pra apoiar análise por IA, e qual o limite. Confirmado via
`references/mentions.md`/`references/filters.md` da skill `brandwatch-api`
(já cacheados no projeto, sem precisar de acesso à internet): `/data/mentions`
(e `/data/mentions/fulltext`) aceitam `category=<id>` como filtro — já usado
em produção neste projeto por `enrichFullTextForNarrativeDay()`
(`bw-sync/index.ts`, fase `full_text_enrichment`). Limites: paginação
clássica (`page`/`pageSize`) só alcança até 10.000 mentions no total
(teto documentado pela própria Brandwatch, não de rate limit); paginação
por cursor (`nextCursor`) não tem teto documentado, só o limite real de
30 chamadas/10min por Client; `/data/mentions/count` dá a contagem exata
numa chamada só, sem paginar. Ponto prático que reduziu o custo do pedido
seguinte a zero: como `mentions` já é sincronizada localmente com
`category_ids`, uma amostra por Narrativa (usando `snippet`, sempre
presente) já era obtível sem nenhuma chamada nova à Brandwatch.

**Implementação, pedido do usuário no turno seguinte**: "incluir algumas
mentions da narrativa na IA para que ela inclua no resumo executivo das
narrativas uma explicação do que é a narrativa e o que está acontecendo
na narrativa" + "humanizar" as respostas de IA do produto, objetivas,
claras, eficientes, "para não termos textos extremamente longos", usando
a skill `humanizer-pt-br`
(`npx skills add https://github.com/mackswendhell/humanizer-pt-br --skill
humanizer-pt-br`, instalada nesta sessão via essa exata invocação —
`.agents/skills/humanizer-pt-br/SKILL.md`, symlinkada pro Claude Code).
Perguntado ao usuário (`AskUserQuestion`) se a humanização deveria valer
só pro resumo executivo de Narrativa ou nos 3 pontos onde a IA gera texto
lido pelo usuário — escolhida a segunda opção.

- **`sample_mentions` — reverte, só pro `narrative-summary-composer`, a
  decisão original "nunca texto bruto de mentions"** (migration
  `20260806000000`, `narrative_summary_build_payload`). Fonte:
  `narrative_matched_mentions()` (`foundation/narratives.md` — única
  definição de "mentions desta Narrativa" no projeto, reusada, não
  reimplementada), mesma janela de 30 dias já usada por `scores` no mesmo
  payload; texto = `coalesce(full_text, snippet)` truncado a 400
  caracteres (`snippet` sempre existe; `full_text` só quando já
  enriquecido por `full_text_enrichment` — nenhuma chamada nova à
  Brandwatch, 100% dado já sincronizado); até 8 mentions, ranqueadas por
  `reach_estimate` (mesmo critério de `enrichFullTextForNarrativeDay`).
  **Não é uma reversão da premissa "nunca agregar/somar sobre mentions
  amostradas pra representar um total"** (fixada 2026-07-11) — usar um
  punhado de mentions reais como contexto qualitativo pra um redator
  entender do que uma Narrativa trata é categoria de uso diferente de
  calcular uma estatística sobre elas; o `SYSTEM_PROMPT` do composer
  proíbe explicitamente usar `sample_mentions` pra afirmar proporções/
  percentuais — pra números, só os campos de `scores`.
- **Skill `humanizer-pt-br` aplicada nos 3 pontos** — `narrative-summary-composer/index.ts`,
  `event-radar-agent-orchestrator/index.ts` e a Camada 1 de `ai-synthesis.md`
  (`NARRATIVE_SYNTHESIS_SYSTEM_PROMPT`, `aggregated-metrics-service.ts`,
  propagada nas 7 Edge Functions deployadas — Princípio técnico 5, script
  Node de uso único, `diff` confirmou as 7 cópias idênticas ao canônico
  neste trecho). A skill em si é um guia interativo de edição (recebe um
  texto pronto e reescreve, com checklist/pontuação de qualidade) — não é
  um trecho de prompt colável direto na API da Anthropic, então seus
  padrões concretos (frases diretas sem "gancho" dramático, sem
  vocabulário de IA — "além disso"/"desempenha papel fundamental"/"reflete
  uma tendência mais ampla" —, sem atribuição vaga a "especialistas", sem
  conclusão genérica/otimista, sem gerúndio final de falsa profundidade,
  sem regra dos 3 forçada) foram destilados numa instrução de tom
  compacta, duplicada nos 3 `SYSTEM_PROMPT`s manualmente (mesma disciplina
  já usada por `recordAiUsage`/`AI_MODEL_PRICING`, também triplicados por
  Princípio técnico 5). Corrige uma nota stale de `ai-synthesis.md`
  (2026-08-02), que confirmava a ausência dessa skill no repositório na
  época — estava certa então, e ficou desatualizada só depois que o
  usuário pediu a instalação real nesta sessão.
- **Limites de caracteres não mudaram** (500/300/90, já curtos desde que
  cada função foi criada) — o pedido de "não textos extremamente longos"
  é sobre estilo (padding/vocabulário de IA), não sobre um teto numérico
  que já existia.

**Verificação**: `npx tsc --noEmit` e `npm run build` — ver resultado ao
final desta sessão. Migration `20260806000000` revisada manualmente, não
executada contra um banco real nesta sessão — mesma limitação recorrente
de toda sessão sem credenciais de deploy neste ambiente; sem acesso à API
da Anthropic nesta sessão, o prompt humanizado e o `sample_mentions` novo
não foram testados contra uma chamada real — revisar via logs
`[narrative-summary-composer]`/`[event-radar-agent-orchestrator]`/
`[aggregated-metrics] composeLayer1NarrativeText` depois do próximo
deploy pra confirmar que o tom de fato mudou na prática, não só na
instrução.

### `daily_metrics` nunca completava a fase — corte silencioso de 1000 linhas do PostgREST na checagem de frescor (2026-08-06)

User report, com log real colado do Supabase: `bw-sync` retornando
`{"ok":true,"skipped":true,"reason":"brandwatch_rate_limit_near_ceiling","lastRateLimitUsed":27}`
em invocações alternadas, e nas invocações que de fato rodavam, a fase
`daily_metrics` reprocessava **exatamente as mesmas 8 categoryIds** a
cada heartbeat de 15min (32827164/32844977/32844976/32752127/32752126/
32827165/32827163/32752234), sempre terminando em `invocation:step_done
{"stayOnStep":true,"nextStep":"daily_metrics","cycleComplete":false}` —
nunca avançando pra `hourly_metrics`/`topics`/`top_authors`/`platform_by_narrative`/
`x_insights`/`top_sites`/`demographics`/`sov`/`full_text_enrichment`. Daí
o sintoma relatado: "os dados não estão sendo atualizados completamente".

**Causa raiz**: `fetchDailySentimentFreshness()` (bw-sync/index.ts,
throttle de burst da 2026-07-22 — `MAX_SENTIMENT_TARGETS_PER_INVOCATION =
8`/`DAILY_SENTIMENT_FRESH_WINDOW_MS = 25min`) decidia quais Narrativas
pular (já sincronizadas há menos de 25min) com um `select category_id,
synced_at from bw_query_metrics_daily where ... category_id in (...)`
**sem `order()` nem `limit()`**, computando o `MAX(synced_at)` por
categoria no lado do client (TypeScript). `bw_query_metrics_daily`
acumula histórico indefinidamente por design (ver "Data storage is
historical by design" acima) — ~196 dias por categoria desde
`BRANDWATCH_MENTIONS_START_DATE` — e `supabase/config.toml` já fixa
`max_rows = 1000` (o limite padrão do PostgREST). Esta organização tem
mais de 8 Narrativas ativas para a Query; 8+ categorias × ~196 linhas
cada ultrapassa 1000 linhas facilmente, e **sem `ORDER BY` o Postgres não
garante qual subconjunto de linhas sobrevive ao corte de `max_rows`** —
para as categorias cujas linhas mais recentes ficavam fora das primeiras
1000 devolvidas, o `MAX(synced_at)` calculado no client saía incompleto
ou ausente, fazendo essas categorias parecerem **sempre** "não
sincronizadas recentemente", mesmo tendo acabado de ser processadas.
Como o loop de `runDailyMetricsStep()` itera `narrativeCategoryIds` em
ordem fixa e capa em 8 chamadas reais por invocação, as mesmas primeiras
8 categorias "vítimas" do corte eram reprocessadas para sempre — nenhuma
categoria além da 8ª nunca chegava a ser sequer tentada, e a fase nunca
liberava `stayOnStep`. Efeito colateral: cada invocação gastava 9
chamadas reais à Brandwatch (8 categorias + query inteira) só repetindo
trabalho já feito, empurrando `lastRateLimitUsed` perto do teto (27/30) e
acionando o gate proativo de 2026-07-21 na invocação seguinte — as duas
falhas (fase presa + rate limit) eram o mesmo bug, não dois problemas
separados.

**Fix** (migration `20260806010000`): a query bruta (sujeita ao corte
`max_rows`) foi substituída por uma function `language sql` nova,
`bw_query_metrics_daily_category_freshness(p_project_id, p_query_id,
p_category_ids)` — `GROUP BY category_id` executado no próprio Postgres
devolve no máximo `len(category_ids)` linhas, nunca mais que isso,
imune ao `max_rows` independentemente de quanto histórico a tabela
acumule (a mesma classe de garantia que uma agregação SQL sempre dá sobre
uma seleção bruta paginada). `fetchDailySentimentFreshness()` agora chama
essa function via `.rpc(...)` em vez de `.from(...).select(...)`.
Acrescentado também um índice de suporte,
`bw_query_metrics_daily_project_query_category_synced_idx (project_id,
query_id, category_id, synced_at desc)` — prevenção, não reação: a mesma
classe de "tabela grande sem índice cuja coluna líder sirva o filtro
real" já causou um `statement timeout` real em `event-radar` (ver
"`run_event_detection()` nunca gravava nada", 2026-08-03), e sem esse
índice o `GROUP BY` novo ficaria lento (não haveria erro, só voltaria a
degradar como esta mesma classe de tabela já degradou antes).

**Nenhuma outra checagem de frescor no arquivo tem o mesmo risco** —
auditado explicitamente: `isGrainStale()`/`isQueryGroupSovStale()`/
`isTopicsStale()`/`isTopAuthorsStale()`/`isXInsightsStale()` sempre usam
`.order("synced_at", desc).limit(1)` escopadas a **uma** categoria por
chamada (nunca um `IN (...)` multi-categoria sem `ORDER BY`/`LIMIT`) —
`fetchDailySentimentFreshness()` era a única função fazendo um `select`
multi-linha sem paginação/ordenação explícita neste arquivo.

**Verificação**: `npx tsc --noEmit` e `npm run build` passam limpos (21
rotas — mudança é Deno-only, fora do escopo do `tsconfig.json` do
Next.js, então o build não valida a sintaxe Deno diretamente; revisado
manualmente linha por linha). Migration `20260806010000` revisada
manualmente (parênteses/marcadores `$$` balanceados), não executada
contra um banco real nesta sessão — mesma limitação recorrente de toda
sessão sem credenciais de deploy neste ambiente. `git push` para
`develop` é o próximo passo para isso rodar de verdade — o sinal de que
funcionou é `sync_cursors.next_step` deixando de ficar preso em
`"daily_metrics"` entre heartbeats sucessivos, e as fases seguintes
(`hourly_metrics`/`topics`/`top_authors`/etc.) voltando a aparecer nos
logs `[bw-sync] invocation:step_start`.

**Follow-up, mesmo dia**: usuário rodou o pipeline manualmente depois do
fix acima, colou um novo log confirmando que o ciclo agora completa de
verdade — `daily_metrics` já tinha passado, e o log mostra
`top_authors`→`top_tweeters`→`author_enrichment`→`top_sites`→
`top_shared_sites`→`demographics`→`full_text_enrichment`→`sov`→
`invocation:step_done {"cycleComplete":true}`, seguido de
`invocation:no_pair_due` na heartbeat seguinte (o par ficou "não devido"
por `BW_SYNC_INTERVAL_HOURS`, exatamente o comportamento esperado de um
ciclo que fechou) — ou seja, o fix anterior funcionou, o pipeline agora
sai de `daily_metrics` e completa o ciclo inteiro. Mesmo assim, o
usuário reportou "a integração rodou ok, mas os dados não foram
refletidos no painel".

**Segunda causa raiz, independente da primeira**: `get_narratives_table`
(o que abastece a tabela de Narrativas, os cards com SOV/sentimento/
momentum/tendência/risco, "Top 3 Narrativas" — a maior parte do conteúdo
visível do painel) lê de `narrative_metrics`, **não** direto de
`bw_query_metrics_daily`. `narrative_metrics` só é populada por
`refresh_narrative_metrics()`, que roda num `pg_cron` **próprio e
totalmente desacoplado** do de bw-sync:
`cron.schedule('refresh_narrative_metrics_hourly', '0 * * * *', ...)`
(migration `20260710030000`) — topo de cada hora, UTC, sem nenhuma
relação com quando `bw-sync` de fato termina um ciclo. `get_metrics_cards`
(os KPIs de topo) é diferente — lê `bw_query_metrics_daily` diretamente,
então esses já refletiam o dado novo na hora; só a parte do painel que
depende de `narrative_metrics` ficava presa ao valor da última execução
do cron horário. Rodando manualmente às 14:34 UTC (log timestamp
convertido), o último `refresh_narrative_metrics_hourly` tinha rodado às
14:00 — o próximo só às 15:00 — até 26 minutos de defasagem entre "a
integração rodou" e "o painel principal reflete isso", exatamente o
sintoma relatado. Isso nunca aparecia em uso normal (heartbeat de 15min
+ `BW_SYNC_INTERVAL_HOURS=3h` default) porque o atraso de até 59min do
cron horário sempre ficava escondido dentro da janela de 3h entre ciclos
— só fica visível quando alguém roda manualmente e confere o painel
logo em seguida, exatamente o que o usuário fez.

**Fix** (sem migration — só `bw-sync/index.ts`): `refreshNarrativeMetricsForToday()`,
nova function que chama `refresh_narrative_metrics()` via `.rpc(...)`
para uma janela estreita (hoje + ontem, cobre virada de fuso sem
reprocessar os ~210 dias que o cron horário já cobre) — chamada logo
depois que a fase `daily_metrics` escreve dado de verdade
(`result.didWork`, no dispatcher de `runSyncInvocation`). Sem custo de
rate limit (a function não chama a Brandwatch, só agrega dado já
sincronizado — mesma justificativa já usada pro agendamento horário
existente) e sem conflito com `refresh_narrative_metrics_hourly` (mesma
function, `upsert` idempotente por `(narrative_id, metric_date, period)`
— os dois convivem, o cron horário continua como rede de segurança pra
qualquer pair/dia que essa chamada reativa não cubra). Uma falha nessa
chamada é logada (`refreshNarrativeMetricsForToday:error`) e nunca
derruba a invocação — `bw_query_metrics_daily` já está correto nesse
ponto (o que importa pra integridade do dado); o painel só volta a
ficar sujeito ao atraso do cron horário nesse caso específico, que já
era o comportamento antes deste fix.

**Verificação**: `npx tsc --noEmit` e `npm run build` passam limpos (21
rotas, mudança Deno-only). Sem migration nesta parte — `refresh_narrative_metrics`
já existe e já é chamável via RPC (nenhum `revoke`/`grant` restringindo
seu acesso em nenhuma migration). Não testado contra um Supabase real
nesta sessão — mesma limitação recorrente de toda sessão sem
credenciais de deploy; o sinal de que funcionou é o painel refletir uma
sincronização manual em segundos, não em até 59min, e o log
`[bw-sync] refreshNarrativeMetricsForToday:done` aparecendo logo após
`invocation:step_done {"step":"daily_metrics"}` nos logs de produção.

### Dispatcher de fases parava na primeira com trabalho real — "furo" de sincronismo entre SOV/volumetria/etc. corrigido (2026-08-06)

Usuário: "A cada 15 min está executando pela cron, porém a execução está
em apenas 1 step e os demais steps só são atualizados quando há
intervenção manual. Onde está o furo... é importante rodar todo o ciclo
no mesmo momento (ou mto próximos), pois entre uma execução e outra pode
ocorrer discrepância entre os dados. Exemplo: o SOV foi buscado em um
momento e a volumetria de menções em outra." Diagnóstico confirmado lendo
`runSyncInvocation()`: o dispatcher de fases (`sync_cursors.next_step`,
"Execução em fases", 2026-07-11) parava a invocação inteira assim que a
**primeira** fase fazia trabalho real (`result.didWork === true`) —
comportamento original, pensado como rede de segurança de CPU. Como
`daily_metrics` (3ª de 16 fases) quase sempre tem trabalho pendente a
cada heartbeat de 15min, o cron parava ali quase toda vez —
`hourly_metrics`/`weekly_monthly`/`topics`/`platform_by_narrative`/
`x_insights`/`top_authors`/`top_tweeters`/`author_enrichment`/
`top_sites`/`top_shared_sites`/`demographics`/`full_text_enrichment`/
`sov` só avançavam quando alguém clicava "Invoke" manualmente várias
vezes seguidas no Dashboard (cada clique comprime em minutos o que o cron
levaria horas pra alcançar) — exatamente o sintoma relatado, e a causa
direta do "SOV vs. volumetria desencontrados": cada tipo de métrica podia
ter sido sincronizado num ciclo de cron inteiramente diferente do outro.

**Corrigido em `bw-sync/index.ts`, sem migration**: o dispatcher agora
encadeia quantas fases o orçamento permitir dentro da MESMA invocação,
mesmo as que fizeram trabalho real. Só para (`stopReason`, novo, logado
em todo `invocation:step_done`) quando: `cycle_complete` (as 16 fases
fecharam); `stay_on_step` (o burst de sentimento de `daily_metrics`
continua espalhado entre heartbeats de propósito — existe especificamente
pra não estourar o teto de 30 chamadas/10min da Brandwatch dentro de uma
invocação só, não é "atropelado" por este loop); `call_budget_exhausted`
(`hasBrandwatchCallBudget()`, já compartilhado por toda fase
"stale-gated"); ou `time_budget_exhausted` (novo
`INVOCATION_TIME_BUDGET_MS = 45_000`, checado só ENTRE fases — nunca
interrompe uma fase no meio, cada fase mantém seus próprios orçamentos
internos, ex: `MENTIONS_LOOP_BUDGET_MS = 20_000` pra mentions). Cada fase
"stale-gated" continua avançando no máximo 1 `categoryTarget` por
passagem (trade-off inalterado, "Execução em fases") — o que muda é que o
dispatcher agora visita TODAS as fases dentro do orçamento por invocação,
não só a primeira que tinha trabalho, então o ciclo inteiro tende a
fechar dentro da mesma invocação (ou poucas, em sequência próxima) sempre
que o orçamento permitir. Novo campo `stepsRun` no log final
`[bw-sync] invocation:done` (e na resposta JSON) — confirma, invocação a
invocação, quantas fases foram de fato encadeadas (`1` era o máximo
possível sempre que havia trabalho real, antes desta correção).

**Efeito colateral esperado, positivo**: como o ciclo completo volta a
fechar perto da cadência pretendida (`BW_SYNC_INTERVAL_HOURS`, 3h
padrão) em vez de se estender por muito mais tempo, a fase `mentions`
(histórico bruto, ver "Mentions polling walks history forward" acima)
volta a ser visitada com a frequência originalmente pretendida — o que
deve, por tabela, acelerar o preenchimento de
`sync_cursors.backfill_completed_at` pra quem tiver esse campo
permanentemente `null` (mesmo dia, ver logo abaixo).

⚠️ Não elimina o "Trade-off aceito" de "Execução em fases" (várias
Narrativas na mesma fase "stale-gated" ainda cobrem 1
`categoryTarget`/invocação, então popular todas pode levar vários ciclos)
— só elimina o desencontro **entre tipos de métrica diferentes** dentro
do mesmo ciclo, que era o problema relatado.

**Verificação**: balanço de parênteses/chaves conferido no arquivo
alterado (mesmo proxy de verificação usado em toda sessão sem acesso a
Supabase/Brandwatch real). Sem ambiente real disponível nesta sessão — o
sinal de que funcionou é `stepsRun > 1` aparecendo nos logs
`[bw-sync] invocation:done` em produção, e o desencontro de dados
relatado parando de se repetir.

**`sync_cursors.backfill_completed_at` permanentemente `null` — mesmo
dia, pergunta separada do usuário**: esclarecido que **não** deveria ser
preenchido quando um ciclo (16 fases) se encerra — são sinais
propositalmente independentes desde `20260710020000`
(`resolveMentionsSinceAdded()`/`runMentionsStep()`): `backfill_completed_at`
só liga (uma vez, permanentemente) quando o walk ascendente de `mentions`
(desde `BRANDWATCH_MENTIONS_START_DATE`) retorna uma página com **menos**
de `MENTIONS_PAGE_SIZE` (1000) resultados — "não sobrou mais histórico
antes de agora". Um ciclo inteiro pode fechar (`last_synced_at` avança)
várias vezes com o backfill de mentions ainda em andamento — não é bug,
é o desenho. Causa mais provável de estar `null` há muito tempo: a mesma
raiz do furo de sincronismo acima — `mentions` só busca até 10.000
registros (10 páginas) por vez em que é sua vez, e só recebia sua vez
uma vez por ciclo inteiro, que estava levando bem mais que 3h pra fechar.
Nenhuma mudança de código pra este campo — o comportamento já está
correto; o sinal a acompanhar é `pagesFetched`/`reachedNow` em
`[bw-sync] invocation:mentions_synced` depois do próximo deploy, pra
confirmar que o backlog está de fato avançando (se `reachedNow` nunca
vier `true` mesmo depois de vários ciclos pós-fix, o próximo passo é
medir o volume real do backlog contra `BRANDWATCH_MENTIONS_START_DATE`,
não assumir mais bug de código sem esse dado).

### `event-radar` nunca considerava Momentum na detecção — regra `momentum_spike` adicionada (2026-08-07)

User report: "No cálculo realizado pelo RADAR para criar os eventos não
me parece que está sendo considerado o momentum... existem algumas
narrativas que tem o momento explosivo e que não gerou nenhum evento no
radar." Pergunta em duas partes, ambas verificadas por leitura de código
antes de qualquer mudança.

**Esclarecimento de nomenclatura** (segunda parte da pergunta —
"substituímos velocidade por momentum, verifique se isso está correto"):
não foi isso que aconteceu. Em 2026-07-22 (`20260722010000`) "Velocidade"
(score de Narrativa, snapshot 3h-vs-3h) foi substituída por "Tendência"
(`trend_score`, regressão de 14 dias) — Momentum nunca foi tocado por essa
troca, sempre existiu como um quarto score separado, e o próprio pedido do
usuário na época foi explícito: "os indicadores se mantém como risk_score
e momentum". O usuário estava confundindo duas trocas distintas.

**Gap real, confirmado** (primeira parte): `run_event_detection()` (1.1,
`detection-engine.md`) sempre leu só volume bruto e sentimento
(`bw_query_metrics_hourly`/`daily`/`narrative_metrics`) — nunca
`momentum_score` (`aggregated-metrics/sql-aggregation.md`, índice composto
de crescimento volume/engajamento/autores/alcance). A etapa 1.3
(`severity.md`) só toca Momentum indiretamente (fator "Risco da narrativa
relacionada", 10% do peso, via `risk_score` — que já embute Momentum a
25%) e só depois que um evento **já existe**, detectado por outra regra.
Uma Narrativa com Momentum "Explosivo" (≥80) sem pico de volume bruto
correspondente (crescimento puxado por engajamento/autores/alcance, ou
com volume abaixo do `min_volume`/`spike_pct` da 1.1) nunca gerava evento
algum — exatamente o sintoma relatado. Isso não era um bug silencioso: era
uma decisão deliberada, tomada e documentada em `_pending.md` gap #32
(2026-07-24, mesma sessão que fechou "narrativas emergentes" fora do
escopo do módulo): "o indicador `momentum_score` já representa esse sinal
bem o suficiente, sem precisar de uma regra de detecção própria em
event-radar." A tabela/cards de Narrativas e o Radar de Eventos são
alimentados por caminhos inteiramente diferentes (`get_narratives_table`
lê `momentum_score` sob demanda a cada carregamento de página; o Radar só
mostra o que `run_event_detection()` grava em `radar_staging_events`/
`feed_events`) — "representar bem o sinal" numa tela nunca implicou
"gerar evento" na outra, e ninguém tinha percebido essa lacuna até agora.

Usuário confirmou via `AskUserQuestion`: reverter a decisão do gap #32,
adicionando uma regra de detecção dedicada (não só reforçar o peso de
Momentum na severidade — opção descartada).

**Fix** (migration `20260807000000_event_radar_momentum_detection.sql`,
`CREATE OR REPLACE` de `run_event_detection()`/`event_radar_config()`):
- Novo `event_type = 'momentum_spike'`, só `scope_type = 'narrative'`
  (Momentum como score de produto só existe pra Narrativa — não há
  "Momentum de Query"/"de plataforma" em nenhum lugar do produto).
  Reaproveita a janela `3d` já existente no CHECK constraint (não uma
  janela nova) e a própria fórmula/pesos de Momentum já em produção (0.40
  volume + 0.25 engajamento + 0.20 autores + 0.15 alcance, via
  `norm_growth` — a mesma função já usada por `get_narratives_table` desde
  `20260714000000`, chamada aqui sem redefinição) — nunca uma segunda
  fórmula divergente, só aplicada a uma janela fixa de 3 dias em vez do
  período selecionado na UI (este motor periódico não tem esse conceito).
  Threshold reaproveita a própria faixa "Explosivo" (≥80) já definida em
  `sql-aggregation.md`, via novo `event_radar_config().momentum_spike_threshold`
  — precisou de `drop function` (adicionar coluna a `RETURNS TABLE`, mesma
  regra de sempre).
- **Guarda anti-falso-positivo, não presente na fórmula original**: no
  `momentum` CTE de `get_narratives_table`, um `left join period_agg`
  sobre `latest_day` já garante implicitamente que só Narrativas com dado
  no período aparecem. `event_radar_narrative_momentum()` (nova function)
  não tem esse gate implícito — toda Narrativa ativa da organização é
  avaliada — então sem uma guarda explícita,
  `norm_growth(null, valor_real)` (dado do período atual ainda não
  sincronizado, período anterior com atividade real) resolveria pra 100
  (LEAST/GREATEST do Postgres ignoram `NULL` em vez de propagar) — um
  "crescimento explosivo" inteiramente artefato de atraso de sync, não
  growth real. Adicionado `where vol_current is not null` — exige que
  pelo menos a coluna mais confiável (`total_mentions`, sempre populada
  primeiro e incondicionalmente por `daily_metrics`, ver "bw-sync rate
  limit" acima) tenha dado no período atual antes de considerar a
  Narrativa candidata. Os outros 3 fatores (engajamento/autores/alcance)
  ainda podem sofrer o mesmo artefato individualmente sem travar a
  Narrativa inteira — mesmo risco latente já existente hoje na fórmula de
  produção, não introduzido por esta migration, só documentado em vez de
  silenciado (comentário no topo do arquivo da migration).
- **Downstream**: `event-radar-agent-orchestrator/index.ts`'s
  `feedEventType()` mapeava qualquer `event_type` que não começasse com
  `"volume_"` para `"sentiment_changed"` — `momentum_spike` cairia nessa
  categoria por padrão, semanticamente errado (não é sobre sentimento).
  Corrigido para mapear `momentum_spike` para `"threshold_triggered"`
  (mesma categoria de `volume_spike`/`volume_drop` — um indicador
  numérico cruzando um limiar configurado). `SYSTEM_PROMPT` também
  ganhou uma menção a "momentum explosivo" na frase que descreve que
  tipos de evento agregado a IA recebe — antes só citava "picos/quedas de
  volume, mudanças de sentimento".
- Severidade (1.3) **não mudou** — os 7 pesos continuam idênticos pra todo
  evento, independente do `event_type` que o gerou; o fator "Risco da
  narrativa relacionada" continua sendo o único ponto onde Momentum
  influencia severidade, indiretamente, via `risk_score`. Só a 1.1
  (detecção) ganhou o sinal novo, escopo desta sessão.

**Verificação**: migration revisada manualmente (parênteses/`$$`
balanceados, mesmo corpo de `20260803000000` só com o bloco novo
inserido). Sem acesso a um Supabase real nesta sessão — mesma limitação
recorrente de toda sessão sem credenciais de deploy; `git push` para
`develop` é o próximo passo, e o sinal a acompanhar é uma linha
`event_type = 'momentum_spike'` aparecendo em `radar_staging_events` na
próxima execução do `pg_cron` (a cada 15min) pra qualquer Narrativa cujo
`momentum_score` já leia "Explosivo" na tela de Narrativas.

### `compose-narrative-synthesis` 503 em produção — mesmo bug de import da Fase B, num 8º arquivo que ficou fora daquela propagação (2026-08-07)

User report, com o erro exato do console/logs do Supabase: clicar em
"Analisar período com IA" (período personalizado, `NarrativeTextPanel`,
`ai-synthesis.md`) devolvia `503`, e o log da Edge Function mostrava
`ReferenceError: createClient is not defined at Object.handler
(.../compose-narrative-synthesis/index.ts:1018:22)`.

**Causa raiz — exatamente o mesmo bug já documentado na sessão da Fase B
(2026-08-02, ver "Fase B implementada" acima)**: o arquivo canônico
(`supabase/functions-shared-source/aggregated-metrics-service.ts`) só
precisa de `import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'`
(nunca chama `createClient` — não tem handler), mas todo arquivo
**deployado** que copia esse conteúdo precisa do import combinado
(`import { createClient, type SupabaseClient } from ...`), já que o
próprio handler HTTP de cada função chama `createClient(...)` pra
construir o client com o JWT do usuário. A sessão da Fase B corrigiu
exatamente esse mesmo bug, mas só nas "7 Edge Functions deployadas" que
ela mesma enumerou (`get-page-{overview,narratives,sentiment,platforms,
themes,authors}`, `get-narrative-detail`) — `compose-narrative-synthesis`
é um **8º arquivo** que também copia o mesmo bloco canônico (criado na
sessão "`narrative_text` ganha um botão manual...", mesmo dia que
implementou a Camada 1 de `ai-synthesis.md`) e não constava naquela lista,
então ficou com o import type-only quebrado em produção desde então —
não pego antes porque nenhuma sessão sem credenciais de deploy consegue
testar uma chamada HTTP real a uma Edge Function, e o botão "Analisar
período com IA" só é clicado manualmente pelo usuário (não faz parte de
nenhum carregamento de página automático).

**Fix**: uma linha, `supabase/functions/compose-narrative-synthesis/index.ts`
— mesmo import combinado das outras 7. Auditado o restante do diretório
`supabase/functions/` pra confirmar que não sobrou nenhum outro arquivo
com o mesmo padrão quebrado: todo arquivo que chama `createClient(...)`
(28 no total) agora também o importa — `compose-narrative-synthesis` era
o único caso solto.

**Verificação**: `npx tsc --noEmit` limpo (mudança é Deno-only, fora do
escopo do `tsconfig.json` do Next.js — não valida a sintaxe diretamente,
só confirma que nada no lado Next.js quebrou). Sem ambiente Deno/Supabase
real nesta sessão — `git push` para `develop` é o próximo passo; o sinal
de que funcionou é o botão "Analisar período com IA" voltando a responder
200 em vez de 503, sem `ReferenceError: createClient is not defined` nos
logs.

### Cards do Radar de Eventos com Momentum alto não ficavam vermelhos — fator "Velocidade" da severidade desconectado do sinal real (2026-08-08)

User report, com screenshot de um card real do Radar de Eventos: badge
"Alto 78" (laranja, não vermelho), título "Explosão de menções sobre
Interferência do Judiciário", texto "registrou crescimento de mais de
1.000% em volume de menções nos últimos 3 dias", tags incluindo
`momentum_crescente`. Pedido: "reveja a cor dos cards do radar... tenho
um event é critico momentum alto e não ficou vermelho. Documento e
implemente."

**Investigação — não era bug de mapeamento cor↔label no frontend**:
`RiskBadge`/`SEVERITY_BORDER` (`score-badges.tsx`/`recent-events-panel.tsx`)
só leem `severity`/`severity_score` já gravados em `feed_events` — "Alto"
(60-84) renderiza laranja e só "Crítico" (≥85) renderiza vermelho, por
desenho, sem divergência entre o rótulo mostrado e a cor aplicada. A causa
real estava em **como `severity_score` é calculado** pra um evento
`momentum_spike` (a regra adicionada no dia anterior, ver "`event-radar`
nunca considerava Momentum..." acima): o fator "Velocidade" (20% do peso,
`event_radar_velocity_severity()`) sempre recalculava uma janela **fixa de
3h-vs-3h** — totalmente desconectada da janela "3d"/do sinal que
`momentum_spike` de fato detecta (que já tem seu próprio score 0-100,
`momentum_score`, gravado em `radar_staging_events.metric_value` no
momento da detecção). Se o crescimento explosivo já tinha acontecido mais
cedo dentro da janela de 3 dias e o volume já estabilizou num platô alto
nas últimas 3h, a comparação 3h-vs-3h pode ler perto de zero de variação —
o fator "Velocidade" despenca pra perto de **0** (não neutro/50 — o
cálculo roda de verdade, só que sobre um sinal sem relação nenhuma com "o
evento é sobre Momentum"), justamente no fator de 20% de peso que deveria
refletir a força do sinal do evento. Reconstituindo com números plausíveis
do card do usuário (volume=100 capado pelo `least`, sentimento~50,
velocidade~0 nesse cenário de platô, alcance~50-70, autores~30, risco da
narrativa relacionada~60, persistência~0 — evento com "27 min" de vida): a
soma ponderada fecha bem perto de 78, exatamente o valor reportado —
consistente com o diagnóstico.

**Fix** (migration
`20260808000000_event_radar_severity_velocity_momentum_alignment.sql`):
`event_radar_velocity_severity()` ganhou 2 parâmetros novos
(`p_event_type`, `p_metric_value`, precisou de `drop function` — mudança
de aridade) — quando o evento é `momentum_spike`, o fator "Velocidade"
passa a ser o próprio `momentum_score` já calculado na detecção
(`metric_value`, já 0-100, mesma escala do fator — só clampado
defensivamente com `least(100, greatest(0, ...))`), em vez de recalcular
um 3h-vs-3h sem relação com o que gerou o evento. Para todo outro
`event_type` (`volume_spike`/`volume_drop`/`sentiment_change`/etc.), o
comportamento é idêntico ao de antes — nenhuma mudança de severidade fora
de `momentum_spike`. Efeito esperado no exemplo do usuário: 0.20 *
(velocidade 0 → `momentum_score`, tipicamente ≥80 já que é o próprio
limiar de disparo da regra) adiciona ~16 pontos ao score ponderado — o
suficiente pra cruzar 85 (Crítico) num caso como o relatado, sem tocar em
nenhum outro peso/fórmula da severidade. `severity.md` atualizado — a nota
de 2026-08-07 dizia (incorretamente, corrigido no dia seguinte) que a
regra `momentum_spike` "não muda a fórmula de severidade".

**Também corrigido, mesmo pedido**: `EVENT_ICON`
(`recent-events-panel.tsx`) não tinha entrada pra `momentum_spike` (caía
no fallback genérico "•") — ganhou "⚡", distinto do "↑" de
`volume_spike`.

**Verificação**: migration revisada manualmente (só 1 função com mudança
de aridade + `run_event_detection()` idêntico a `20260807000000` exceto
pela chamada atualizada). `npx tsc --noEmit` limpo (mudança de frontend é
só `EVENT_ICON`, sem impacto de tipos). Sem acesso a um Supabase real
nesta sessão — mesma limitação recorrente de toda sessão sem credenciais
de deploy; `git push` para `develop` é o próximo passo, e o sinal a
acompanhar é um evento `momentum_spike` cujo `severity` sobe de `high`
pra `critical` no próximo ciclo do `pg_cron` (15min) sem que
`momentum_score`/`metric_value` tenham mudado — confirma que o fator
"Velocidade" está lendo o valor certo.

### `/narratives` — coluna Ação removida, painel lateral ao selecionar, tabela dinâmica, toggle tabela/cards (2026-07-14)

User request, 5 itens na mesma mensagem, só frontend + documentação (sem
mudança de backend/envelope):

1. **Coluna "Ação" removida** de `NarrativesTable`
   (`components/intelligence-center/narratives-table.tsx`) — pedido do
   usuário: "não está sendo usual, pois ao clicar no nome abre o modal e
   na linha destaca o card." A coluna "Narrativa" já contém o `Link` que
   abre `/narratives/[id]` (modal, via a intercepting route existente) —
   a coluna "Ação" era um segundo caminho pra exatamente a mesma
   navegação. Tabela shared component (também usada por `/themes`) caiu
   de 7 pra 6 colunas em ambos os lugares; `min-w-[760px]` do wrapper
   `overflow-x-auto` ajustado pra `min-w-[680px]`.
2. **Painel de resumo passou de "abaixo da tabela" pra "ao lado dela"**
   (`app/(intelligence-center)/(analytics)/narratives/page.tsx`) — pedido
   do usuário: "reduza essa tabela a esquerda e mostre ao lado direito da
   tabela o card... de forma que o resumo executivo possa ser lido
   completamente." O bloco que envolve a `WidgetCard` da tabela virou um
   `grid` que só ganha uma segunda coluna (`lg:grid-cols-
   [minmax(0,1fr)_400px]`) quando há uma linha selecionada — a tabela
   ocupa a coluna elástica (encolhe, rola horizontalmente por dentro se
   precisar, mesmo `overflow-x-auto` de sempre) e o mesmo `NarrativeCard`
   de sempre ocupa uma coluna fixa de 400px à direita, larga o bastante
   pra não cortar o resumo executivo. Sem seleção, o grid volta a 1
   coluna (tabela cheia), comportamento idêntico ao de antes.
3. **Desseleção**: `onRowClick` agora alterna — clicar de novo na mesma
   linha já selecionada chama `setSelectedId(null)` em vez de
   reselecionar a mesma linha à toa. Um botão "✕ Fechar" (texto simples,
   sem ícone novo) acima do `NarrativeCard`, ao lado do rótulo "Narrativa
   selecionada", oferece a mesma ação de forma explícita — cobre tanto
   quem descobre por tentativa (clicar de novo na linha) quanto quem
   procura um controle óbvio de fechar.
4. **Tabela dinâmica**: `NarrativesTable` ganhou um prop opcional
   `groupByCategory?: boolean` (default `false`, então `/themes` — que
   não passa esse prop — está inalterada). Quando `true`, agrupa
   `sortedRows` por `category_label` (mesmo campo/lógica de
   `NarrativeCategoryLanes`, 2026-07-25 — a Category-pai da Subcategory,
   sempre presente) em vez de uma lista plana — cada grupo vira uma linha
   de cabeçalho (`colSpan` de todas as colunas, negrito, contagem +
   ▲/▼) seguida das linhas normais daquele grupo, com o mesmo estado de
   expandir/recolher por categoria já usado pelas raias de cards
   (`Set<string>` de categorias recolhidas, local ao componente). Ordem
   dentro de cada grupo preserva a ordenação por coluna ativa (ou o
   default do backend) — só a soma dos grupos é reorganizada, não o
   critério de ordenação em si. Toggle "Subcategorias"/"Categoria e
   subcategoria" no `headerAction` do `WidgetCard` da tabela (mesmo prop
   adicionado à `WidgetCard` na sessão anterior).
5. **Toggle "Tabela e cards"/"Só tabela"/"Só cards"** no topo da página —
   `displayMode` (`useState`), controla `showTable`/`showCardsGrid`.
   `selected` é calculado como `showTable ? rows.find(...) : null` —
   nunca fica "preso" numa seleção invisível quando o usuário troca pra
   "Só cards" (não há tabela pra ter gerado essa seleção nesse modo, então
   ela é sempre ignorada ali, mesmo que um `selectedId` tenha sobrado de
   uma troca de modo anterior). A grade de cards por categoria
   (`NarrativeCategoryLanes`) só aparece quando `showCardsGrid && !selected`
   — em "Só tabela" nunca aparece (por isso o pedido do usuário marcou o
   item 2 como "primordial" nesse modo: o painel lateral é o único jeito
   de ler o resumo sem a grade); em "Só cards" aparece sempre, já que
   `selected` é sempre `null` nesse modo.

**Especificações atualizadas**: `intelligence-center/narratives-exploration.md`
(novo blockquote de topo + "Fluxo principal" itens 2-4 + nova seção de
toggles em "Interface (UI)"), `executive-overview.md` ("7 colunas" →
"6 colunas", já que a tabela é o mesmo componente compartilhado).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, mesma contagem de antes (mudança só de
conteúdo em `/narratives`, nenhuma rota nova/removida). Sem mudança de
backend/migration nesta sessão. Sem automação de browser disponível neste
ambiente — o layout lado a lado, os 3 toggles e o agrupamento por
categoria na tabela não foram confirmados visualmente num navegador real,
mesma limitação já registrada em toda sessão anterior de
`intelligence-center` neste arquivo.

### Autores e Influenciadores redesenhada em 2 guias + Top Sites (gap real fechado) + NarrativesTable (default SOV, oculta zerados) (2026-08-08)

User request, 3 partes na mesma sessão: (1) "Precisamos ajustar a página
Autores e Influenciadores com dois objetivos distintos: 1) Visualizar os
autores genericamente: detratores, impulsionadores, alcance, engajamento,
envolvimento em narrativas, etc. Top Autores, Top Sites, Top Stories. 2)
Visualização por entidade como já existe, incluindo não só partido, mas
imprensa, e outras organizações que pode existir na tabela entities.
Portanto, divida essa página em duas guias... Redesenhe de forma
eficiente, objetiva e clara"; (2) mid-turn: "ordenação defaulta da tabela
de narrativas deve ser por sov"; (3) mid-turn: "o que estiver zerado em
sov pode ser ocultado da tabela... No mensal aparece uma narrativa, mas
quando mudo para o diário tem menos narrativas... algumas zeradas pq não
foram citadas no dia."

**Auditoria antes do código** confirmou um gap real, não só de UI:
`bw_query_top_sites` ("Top Sites", `data/volume/topsites/queries` —
domínios de onde as menções se originam, distinto de `bw_query_top_shared_sites`
= "Top Shared Sites") já era sincronizada por `bw-sync` desde
2026-07-11 (`runTopSitesStep`/`isTopSitesStale`, mesmo throttle semanal de
`x_insights`), mas nunca teve nenhuma function SQL/bloco de envelope
lendo essa tabela — 100% sincronizada, 100% inacessível ao frontend até
agora, mesma classe de achado de "X Themes — auditoria de bw-sync" (ver
acima). "Top Autores" e "Top Stories" já existiam (ranking/`AuthorsList`
e `x_insights.insight_type='url'`, respectivamente) — só "Top Sites" era
um gap de verdade.

**Backend, migration `20260808010000`**: `get_top_sites(p_organization_id,
p_period_start, p_period_end, p_filters)` — mesmo padrão exato de
`get_x_insights` (`filter_category_ids`/`cat_ids` cross join, nunca `= any((select
...))`; "latest" agrupado por `category_id`, não um `max(metric_week)`
global — nasce já correto, evitando o bug que `get_x_insights` teve que
corrigir em 2026-08-03), top 15 por `volume`. Novo `TopSiteItem`
(`domain`/`volume`/`reach_estimate`/`monthly_visitors`/`sentiment_positive/
neutral/negative`/`synced_at`) + `top_sites` no `PageEnvelope` +
`PAGE_BLOCKS.authors` ganhando `'top_sites'` — propagado em
`packages/shared-types/src/envelope.ts`, no arquivo canônico
(`supabase/functions-shared-source/aggregated-metrics-service.ts`) e nas
7 Edge Functions `get-page-*`/`get-narrative-detail` (Princípio técnico
5), verificado por diff byte-a-byte de cada bloco novo contra o canônico
depois da propagação (script Node de uso único, mesma técnica já usada em
sessões anteriores). **Achado de passagem, corrigido no mesmo lote**: o
arquivo canônico tinha `XInsightItem` **sem** o campo `synced_at` na
própria interface (só aparecia no shape de leitura interno e no `.map()`
de `fetchXInsights`) — as 7 Edge Functions já deployadas já tinham o campo
certo desde 2026-08-03 (confirmado via grep antes de mexer), então isso
nunca foi um bug em produção, só uma divergência silenciosa no arquivo
"fonte da verdade" que o `tsc` do Next.js nunca pega (`supabase/functions*`
fica fora do `tsconfig.json` de propósito). Corrigido no canônico; as 7
cópias deployadas não precisaram de nenhuma mudança nesse campo.

**Frontend — 2 guias, mesmo `envelope.authors`/`envelope.top_sites` já
carregado, nenhuma chamada de rede por troca de guia ou filtro**:
- **"Visão Geral"**: toolbar simplificada (`AuthorGeneralFiltersToolbar`
  — só Buscar + Sentimento, sem Partido/Ideologia/Tipo, que são assunto
  da outra guia), 4 KPIs (Autores/Menções/**Alcance total** — novo, a
  versão antiga não somava alcance/Sentimento médio), novo
  `AuthorDetractorsBoosters` (`author-detractors-boosters.tsx` — 2
  mini-listas lado a lado, até 6 cada, por `dominantSentiment()` +
  alcance desc), dispersão com `colorBy` fixo em "sentimento", novo
  `AuthorNarrativeInvolvement` (`author-narrative-involvement.tsx` —
  barras de quantos autores **distintos** citam cada Narrativa/pauta via
  `narrative_labels`, clique filtra), `AuthorsList` com a nova
  `variant="general"` (sem colunas Partido/Ideologia), e uma seção
  "Conteúdo em destaque" reunindo o novo `TopSitesPanel`
  (`top-sites-panel.tsx` — tabela única com mini-barra de sentimento) e o
  `XInsightsPanel` já existente (Hashtags/Posters/Stories/Emojis).
- **"Por Entidade"**: toolbar (`AuthorEntityFiltersToolbar`) ganha
  "Colorir por: Tipo" (novo `ColorByMode = "entity_type"`) e chips de
  **Tipo de Entidade** (novo `author-entity-type-breakdown.tsx` +
  `ENTITY_TYPE_ORDER`/`ENTITY_TYPE_LABEL`/`ENTITY_TYPE_HEX` em
  `author-color.ts` — Pessoa/Partido/Veículo de Imprensa/Instituição/
  Empresa/Movimento/Outro, os 7 valores reais do enum `entity_type`) —
  **esta é a peça que responde diretamente ao pedido "não só partido, mas
  imprensa, e outras organizações"**, lendo `AuthorRow.entity_type`
  (já enriquecido desde `author-linking.md`, 2026-08-01, mas nunca usado
  em nenhuma visualização até agora). Filtra a lista inteira a
  `entity_id != null` antes de qualquer outro filtro (autor sem Entity
  não tem tipo/partido/ideologia a mostrar). `AuthorsList` ganha
  `variant="entity"` (coluna Tipo + Partido/Ideologia) e, no nome do
  autor, passa a mostrar `entitySegment()` (novo helper — lê
  `entity_tags.tag_type='segment'`, já buscado desde 2026-08-01 mas nunca
  renderizado) quando não há `entity_cargo` — ex: um veículo de imprensa
  mostra "Portal de Notícias" em vez de ficar em branco.
- **`AuthorsList` ganhou a prop `variant: "full" | "general" | "entity"`**
  (default `"full"`) — `/themes` e o detalhe de Narrativa (os outros 2
  consumidores deste componente) continuam recebendo `"full"` sem
  nenhuma mudança de comportamento, nenhum dos dois pediu a redesign
  desta sessão.
- `AuthorFiltersState` reorganizado: perdeu `onlyLinked` (agora implícito
  por guia — "Visão Geral" nunca filtra por Entity, "Por Entidade" sempre
  filtra), ganhou `narrativeLabel` (só "Visão Geral") e `entityTypes`
  (só "Por Entidade").

**Fix separado, mesma sessão, `NarrativesTable`** (2 pedidos mid-turn):
(1) ordenação default trocada de "nenhuma" (ordem crua do backend,
`risk_score desc`) para `sov_pct desc`; (2) linhas com `sov_pct` nulo ou
`0` agora são **ocultadas** inteiramente (`visibleRows`, filtrado antes de
ordenar/agrupar/renderizar) — antes apareciam com a célula mostrando "—",
o que confundia ao trocar de um período longo (mês, onde a Narrativa tem
SOV real) para um período curto (dia, sem nenhuma menção naquele dia
específico). Mesmo tratamento de "0 é ausência de dado, não um valor
real" já usado em `ScoreList` (`charts/breakdown-panel.tsx`,
2026-07-12). Afeta todo consumidor deste componente compartilhado
(Visão Geral, Narrativas, Pautas Eleitorais) de uma vez, sem duplicar a
regra em cada página.

**Verificação**: `npx tsc --noEmit` limpo (achou e corrigiu de passagem um
erro real em `toAiPayload()`, `packages/shared-types/src/envelope.ts` —
faltava `top_sites` no objeto retornado, `Omit<PageEnvelope, ...>` exige
todo campo não omitido). `npm run build` limpo (21 rotas, mesma contagem
de antes — nenhuma rota nova/removida), só os 2 warnings pré-existentes
de `<img>` (`sidebar.tsx`/`layout.tsx`, não relacionados). Migration
`20260808010000` revisada manualmente, não executada contra um banco real
nesta sessão — mesma limitação recorrente de toda sessão sem credenciais
de deploy neste ambiente. Sem automação de browser disponível — a troca
de guias, os novos widgets (Detratores/Impulsionadores, Envolvimento em
narrativas, Por tipo de Entidade, Top Sites) e o comportamento de ocultar
linhas zeradas em `NarrativesTable` não foram confirmados visualmente num
navegador real.

### Radar de Eventos: KPIs em uma linha única + cards sem menção ocultados em `/narratives` (2026-08-08)

User request, 2 itens na mesma mensagem, ambos frontend-only:

1. **`RecentEventsExecutiveSummary`** (`components/intelligence-center/
   recent-events-panel.tsx`) — as 5 estatísticas do "Resumo executivo"
   (Total de eventos, Críticos, Altos, Médios, Baixos) usavam
   `grid-cols-2 sm:grid-cols-4`, deixando o 5º item ("Baixos") quebrar pra
   uma segunda linha mesmo em telas largas (screenshot do usuário
   confirmou o problema). Trocado para `grid-cols-5` incondicional — as 5
   caixas sempre numa única linha, independente do tamanho da tela;
   `SummaryStat`'s padding reduzido (`p-2 sm:p-3`, era `p-3` fixo) pra
   caber melhor em 5 colunas em telas estreitas.
2. **`NarrativeCategoryLanes`** (`components/intelligence-center/
   narrative-category-lanes.tsx`, visualização por cards de `/narratives`)
   ganhou o mesmo filtro que `NarrativesTable` já aplicava (adicionado
   pela sessão concorrente que terminou pouco antes desta: "Linhas com
   SOV zerado/nulo são ocultadas" — uma Narrativa sem nenhuma menção no
   período selecionado não tem SOV nenhum a mostrar) — `hasMentions()`
   (`row.sov_pct !== null && row.sov_pct !== 0`) filtra antes de agrupar
   por categoria, então a contagem no cabeçalho de cada raia já reflete
   só as Narrativas visíveis. Como a página só verificava `rows.length >
   0` (existem Narrativas cadastradas, não que alguma tenha menção no
   período), `NarrativeCategoryLanes` ganhou seu próprio `<EmptyState />`
   pro caso de o filtro remover tudo (comum ao trocar pra período
   "Diário") — antes renderizaria uma grade vazia sem explicação.

**Especificações atualizadas**: `event-radar/frontend-highlights-feed.md`
("Resumo executivo" — 5 estatísticas em uma linha, não mais "4
estatísticas... Médios+Baixos", que já estava desalinhado do código antes
desta sessão), `intelligence-center/narratives-exploration.md` (nova nota
sobre o filtro de menção + `EmptyState` na visualização por cards).

**Verificação**: `npx tsc --noEmit` limpo. Sem mudança de backend/
migration — os dois itens são puramente CSS/filtro client-side sobre dado
já buscado. Sem automação de browser disponível neste ambiente — o layout
de 5 colunas numa linha e o `EmptyState` novo não foram confirmados
visualmente num navegador real, mesma limitação já registrada em toda
sessão anterior de `intelligence-center` neste arquivo.

### X Themes nunca atualizava — gate de "volume de X" comparava contra um valor nunca confirmado (2026-08-08)

User report: "a atualização de todos os valores de X Themes (Hashtags,
Posters, Stories, Emojis) está completamente desatualizado, por mais que
execute o bw_sync ele não atualiza esses dados no frontend. Veja se o
problema está no frontend ou no sincronismo dos dados."

**Frontend descartado por primeiro**, com evidência concreta, não só
suposição: `usePageEnvelope` refaz a chamada a cada mudança de
organização/período/`attempt` (sem nenhum cache client-side); `page_cache`
(Edge Function) está **desabilitado** desde 2026-07-14 —
`getPageEnvelopeWithCache` só chama `assemblePageResponse` direto, sem ler
nem gravar a tabela; e `get_x_insights` (SQL) já teve seu bug real de
agrupamento (`latest` por `insight_type` sozinho, ignorando `category_id`)
corrigido em 2026-08-03. Nada nessas 3 camadas explicava "desatualizado
mesmo depois de rodar o sync".

**Causa raiz real, no lado do sincronismo**: `queryHasTwitterVolume()`
(`bw-sync/index.ts`) — a "salvaguarda de orçamento" que barra as 4
chamadas de X Insights (Hashtags/Emojis/Stories/Posters) quando a Query
"não tem presença relevante em X", checando
`bw_query_metrics_daily_by_platform.page_type = 'twitter'` (comparação
exata, case-sensitive) — sempre exigiu esse valor literal como
pré-requisito rígido antes de sequer TENTAR qualquer chamada. Só que
`page_type` vem de `series.id` da dimensão de chart `pageTypes`
(`syncPlatformMetrics`/`syncPlatformMultiAggregate`), e o comentário
*original* dessa função, desde que foi escrita, já admitia: "não peguei um
payload de exemplo específico desta combinação... ainda é inferido pelo
padrão geral" — ou seja, o valor exato que a Brandwatch devolve pra
X/Twitter nessa dimensão especificamente **nunca foi confirmado contra um
payload real** neste projeto. Se o valor real vier com outra caixa
(`'Twitter'`/`'X'`) ou já tiver sido renomeado internamente pra `'x'`
(rebranding real da plataforma), esse gate reprova silenciosamente **pra
sempre** — sem erro, sem log de aviso visível, só `no_twitter_volume` — e
nenhuma reexecução manual de bw-sync jamais destrava isso, porque o
problema não é frescor/staleness, é o gate nunca deixar a fase `x_insights`
sequer chegar a chamar a Brandwatch. Isso bate exatamente com o relato:
"por mais que execute" não ajuda quando a fase nunca tenta de verdade.

**Fix**: `queryHasTwitterVolume()` agora aceita `twitter`/`x`
case-insensitive (`.or("page_type.ilike.twitter,page_type.ilike.x")`) —
mesma dualidade já aceita em `get_authors_ranking` (`use_tweeters`,
migration `20260801010000`) pro filtro de plataforma vindo do frontend,
então não é uma convenção nova, só estendida pra este gate que ainda não
a usava. Ainda uma inferência, não uma confirmação definitiva — por isso
também foi adicionado um log de diagnóstico
(`queryHasTwitterVolume:no_match`, só no caminho de falha, sem custo de
chamada extra à Brandwatch) que lista os `page_type` reais encontrados
pro par — se o valor real for uma terceira variação ainda não coberta,
aparece direto no log de produção, sem precisar de acesso ao banco pra
descobrir. Mesma função é usada por dois consumidores
(`runXInsightsStep`/`runDemographicsStep`) — os dois se beneficiam do
mesmo fix.

**Verificação**: mudança isolada em `bw-sync/index.ts` (sem migration,
sem mudança de frontend/envelope — o problema nunca chegava a esse
ponto). Sem ambiente Deno/Supabase real disponível nesta sessão — não
executado contra produção, mesma limitação recorrente de toda sessão sem
credenciais de deploy. `git push` para `develop` é o próximo passo; o
sinal de que funcionou é `[bw-sync] syncXInsights:done` aparecendo nos
logs pra este par pela primeira vez em muito tempo, e X Themes voltando a
mostrar dado recente no frontend. Se `queryHasTwitterVolume:no_match`
ainda aparecer nos logs depois do deploy, o `distinctPageTypes` logado
ali é o próximo passo — usar esse valor real pra corrigir o gate de vez.

### Pautas Eleitorais: SOV ordenado, reorganização de layout, e um bug real de escopo em "Insights" (2026-08-09)

User request, 4 itens na mesma mensagem:

1. **"Share of Voice e sentimento por pauta" ordenado decrescente** —
   `PautaCardGrid` (`components/intelligence-center/pauta-cards.tsx`)
   ganhou `.sort((a, b) => b.pct - a.pct)` antes de renderizar (a function
   SQL `get_theme_breakdown` não tem `order by` explícito — ordenação só de
   apresentação, Princípio técnico 2, mesmo padrão já usado por
   `NarrativesTable`).
2-3. **Layout da metade inferior de `/themes` reorganizado** — pedido do
   usuário: diminuir "Termos emergentes" e colocar "Tópicos positivos e
   negativos por pauta" logo abaixo dele; mover "Comparação entre
   períodos" pra cima de "Termos emergentes"; resultado: 3 frames do lado
   direito, tabela + "Autores e comunidades por pauta" do lado esquerdo.
   `app/(intelligence-center)/(analytics)/themes/page.tsx` reestruturado:
   um `grid grid-cols-1 lg:grid-cols-3` — esquerda (`lg:col-span-2`):
   "Narrativas" (tabela interativa) + "Autores e comunidades por pauta"
   empilhados; direita: "Comparação entre períodos" → "Termos emergentes"
   (agora dentro de `<div className="max-h-48 overflow-y-auto">`, frame
   visivelmente menor com scroll interno) → "Tópicos positivos e negativos
   por pauta". "Estrutura das pautas"/"Share of Voice e sentimento por
   pauta"/"SOV por pauta ao longo do tempo" (topo) e "Insights" (rodapé)
   ficam fora dessa grade, inalterados.
4. **Bug real de escopo encontrado e corrigido** — pedido do usuário:
   "Insights dessa página deve focar apenas no conteúdo de Pautas
   Eleitorais, reveja o envelope dessa página para saber se a IA está
   tratando corretamente." Investigação confirmou que não era só uma
   percepção: `get_active_highlights`/`get_volume_delta` (Camada 1/Camada
   0 de `ai-synthesis.md`) só sabem escopar por `filters.narratives` — uma
   lista explícita de IDs de Narrativa, sem noção nenhuma de "página" ou
   "categoria". `effectiveFilters(ctx)` só popula `filters.narratives`
   quando `ctx.narrativeId` está setado, e isso só acontece em
   `get-narrative-detail` — `/themes` nunca passava por esse caminho.
   Resultado real, confirmado lendo o código: "Insights" em `/themes`
   sempre leu `highlights`/`narrative_text` da **organização inteira**,
   exatamente igual a qualquer outra página — nunca restrito às Pautas,
   apesar do nome/propósito específico da página.
   **Fix** (`supabase/functions-shared-source/aggregated-metrics-service.ts`,
   `assemblePageResponse`): quando `page === 'themes'`, busca as
   Narrativas-Pauta primeiro — a mesma `get_narratives_table(p_scope=
   'pautas')` que já alimenta o bloco `narratives` desta página,
   reaproveitada via `narrativesPromise` (nunca uma segunda chamada) — e
   usa os IDs resultantes pra popular `filters.narratives` num
   `highlightsContext` só usado por `fetchHighlights`/`fetchNarrativeText`
   nesta página. É o único `await` do arquivo fora do `Promise.all`
   principal — inevitável (o filtro de highlights depende do resultado de
   `narratives`), mas só serializa pra `themes`; toda outra página
   continua 100% paralela, comportamento idêntico a antes. Limitação
   aceita, documentada inline: se a organização não tiver nenhuma
   Subcategory sob "Pautas" configurada, `filters.narratives` fica vazio e
   o comportamento cai de volta pro escopo antigo (organização inteira) —
   `get_active_highlights`/`get_volume_delta` tratam array vazio e "filtro
   ausente" de forma idêntica (`nullif(array_agg(...), '{}')` sempre vira
   `NULL` sobre zero linhas), então não há como distinguir "escopo vazio de
   propósito" de "sem filtro" nessas duas functions sem uma mudança de SQL
   — não fiz essa mudança, já que é o mesmo caso degenerado que `/themes`
   já sinaliza em todo outro widget ("Nenhuma subcategoria da categoria
   'Pautas' configurada").
   **Propagação (Princípio técnico 5)**: o mesmo bloco (`assemblePageResponse`)
   foi copiado, byte-a-byte idêntico ao canônico, nas 7 Edge Functions
   deployadas (`get-page-{overview,narratives,sentiment,platforms,themes,
   authors}`, `get-narrative-detail`) via um script Node de uso único (não
   commitado) — confirmado por `diff` isolado do bloco `assemblePageResponse`
   contra o canônico em cada uma das 7, sem divergência.

**Especificações atualizadas**: `intelligence-center/electoral-themes.md`
(novo blockquote de topo + notas em "Interface (UI)"/"Dados envolvidos"),
`aggregated-metrics/ai-synthesis.md` (novo blockquote sobre o bug),
`aggregated-metrics/sql-aggregation.md` (nota na linha de
`get_active_highlights`), `aggregated-metrics/service-layer-aggregation.md`
("Fluxo principal" item 3 — exceção de serialização pra `themes`).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, mesma contagem de antes. Sem migration
nesta sessão — mudança 100% TypeScript (service layer + frontend). Sem
acesso a um Supabase/Anthropic real neste ambiente — o comportamento
corrigido (highlights/narrative_text realmente restritos a Pautas) não foi
confirmado contra dado de produção; o sinal a acompanhar depois do deploy
é o widget "Insights" de `/themes` deixar de citar eventos claramente
alheios a Pautas Eleitorais (ex: um pico de menções de um candidato/
narrativa fora da categoria "Pautas"). Sem automação de browser disponível
— o novo layout de 2 colunas e o frame reduzido de "Termos emergentes"
não foram confirmados visualmente num navegador real, mesma limitação já
registrada em toda sessão anterior de `intelligence-center` neste arquivo.

### SOV não mudava ao trocar de período — snapshot de um único dia, não agregado (2026-08-08)

User report: "SOV precisa mudar de acordo com o período que o usuário
selecionou. Por exemplo, estou no mensal e mudo para diário, a proporção
de SOV precisa mudar, não faz sentido se manter a mesma. Verifique e
corrija doc e implementação."

**Causa raiz confirmada por leitura direta de `get_narratives_table`**
(última versão antes desta sessão, `20260805010000`): `sov_pct`/
`total_mentions` vinham de `latest_day` — um `distinct on (narrative_id)
order by metric_date desc` sobre `public.narratives_overview`, que usava
`p_period_start`/`p_period_end` só pra filtrar QUAIS dias são elegíveis,
nunca pra somar sobre eles; o `distinct on` descarta todos os dias menos
o mais recente dentro da janela e devolve o `sov_percent` **daquele único
dia**. Como todo preset de período no header (Diário/Semanal/Mensal)
termina em "hoje" (`header-context.tsx`), "o dia mais recente dentro da
janela" é sempre o mesmo dia nos 3 modos — daí o SOV nunca mudar ao
trocar de período, exatamente o sintoma relatado. Não é uma regressão do
bug de escopo já corrigido em 2026-07-11 (`20260711080000` — denominador
por `organization_id` em vez de `query_id`, esse sim já corrigido e
correto) — é uma granularidade diferente, sempre presente desde que essa
função existe: SOV nunca foi agregado pelo período pedido, só amostrado
num único dia dentro dele. `.dev/specs/aggregated-metrics/sql-aggregation.md`
descrevia isso como projeto original ("dado bruto por dia", contrastado
com os 3 scores "período-dependentes" calculados dentro da function) — a
própria spec documentava o bug como se fosse a decisão correta.

**Fix** (migration `20260808030000`, sem `drop function` — mesma
assinatura de `20260805010000`, só o cálculo interno de 2 colunas muda):
`sov_pct`/`total_mentions` passam a vir de `period_agg.vol_current` (soma
de `total_mentions` da Narrativa sobre `p_period_start..p_period_end` —
essa soma já existia há tempos dentro de `period_agg`, usada só por
Momentum, nunca por SOV) dividido por um novo `query_period_totals` (mesmo
agregado, por `query_id`, sobre **todas** as Narrativas daquela Query —
mesma definição de denominador que `public.narratives_overview.sov_percent`
já usa por dia, só que somada ao longo do período em vez de lida de um
único dia). `total_mentions` também precisou virar `period_agg.vol_current`
junto — se só `sov_pct` mudasse, a mesma linha mostraria um SOV
período-agregado ao lado de um "total de menções" ainda snapshot de um
dia só, quebrando a consistência aritmética entre as duas colunas na
mesma tela. `latest_day`/`public.narratives_overview` continuam sendo
lidas (só pra resolver `title`/`query_id`/existência da linha, âncora do
`join scope`) — só deixaram de ser a fonte de `sov_pct`/`total_mentions`
em si. Nenhum outro score (Momentum/Tendência/Sentimento/Risco) foi
tocado.

**Efeito colateral esperado, correto**: combinado com o fix de
`NarrativesTable` do mesmo dia (linhas com `sov_pct` zerado/nulo agora
ocultadas, ver seção "Autores e Influenciadores redesenhada em 2 guias..."
acima) — agora que SOV genuinamente muda por período, trocar pra um
período curto (Diário) vai legitimamente esconder mais Narrativas sem
menção naquele dia específico, o que é o comportamento correto, não um
bug novo.

**Documentação**: `sql-aggregation.md` (linha da tabela de functions,
`get_narratives_table` — nota dedicada explicando o antes/depois).

**Verificação**: sem componente TypeScript/frontend nesta mudança (SQL
puro, mesma assinatura de entrada/saída — nenhuma Edge Function/tipo
precisou mudar). Migration revisada manualmente (diff isolado contra
`20260805010000` conferido — só `period_agg` ganhando `max(query_id)`, a
CTE nova `query_period_totals`, e as 2 colunas do select final trocando
de fonte, todo o resto byte-a-byte idêntico) — **não executada contra um
banco real** nesta sessão, mesma limitação recorrente de toda sessão sem
credenciais de deploy neste ambiente. `git push` para `develop` é o
próximo passo; o sinal de que funcionou é o SOV de uma mesma Narrativa
mostrando valores diferentes ao alternar Diário/Semanal/Mensal no header.

### "Quem move a conversa" — plataforma/papel na conversa/seguidores no widget de disseminadores (2026-08-08)

User request, com um mockup próprio de referência: "no detalhamento da
narrativa precisamos da seguinte informação, quem está movimentando essa
narrativa. Engajamento, reposts, comentários etc. Coloque essa
visualização em Formação e propagação — principais disseminadores."

**Auditoria antes do código**: "Formação e propagação — principais
disseminadores" (`narrative-detail-content.tsx`) já reusa
`get_authors_ranking`/`AuthorsList` (variante `full`: Autor/Partido/
Ideologia/Menções/Alcance/Engaj./Sentimento — ver entrada "Detalhe de
Narrativa — detratores/impulsionadores..." acima). O mockup do usuário
pede um recorte de colunas diferente e mais focado (Autor/Plataforma/
Papel na conversa/Seguidores/Publicações/Engajamento) — 2 campos reais
faltavam por trás (`followers`/plataforma), 1 era presentation-layer puro
("Papel na conversa").

- **`followers`** — `bw_query_top_authors`/`top_tweeters.followers` (de
  `twitterFollowers`, único campo de seguidores confirmado no envelope do
  endpoint Top Authors, já sincronizado desde `20260710050000`) nunca
  tinha sido exposto por `get_authors_ranking`. Migration
  `20260808020000`: `max(r.followers)` no `group by` de `grouped` — `max`,
  não `sum`, porque é um atributo de perfil estático (não deveria dobrar
  quando o mesmo autor casa com mais de uma Narrativa no escopo, diferente
  de alcance/engajamento/menções, que já somam por design e já têm esse
  trade-off documentado).
- **Plataforma** — nenhuma coluna de plataforma existia nesta function,
  apesar de `platform_stats` (jsonb bruto por autor, mesmo endpoint) já
  ser sincronizado desde a criação da tabela. Nova function auxiliar
  `bw_top_author_platform_tags(platform_stats jsonb) returns text[]`: só
  reporta uma plataforma quando há uma chave real daquele vocabulário
  (mesmo já usado em `mentions.engagement`: `twitterFollowers`/
  `twitterTweets`/`twitterRetweets`, `instagramFollowerCount`/
  `instagramLikeCount`/`instagramCommentCount`, `facebookLikes/Comments/
  Shares`, `tiktokLikes/Comments/Shares`, `linkedinLikes/Comments/Shares/
  Impressions`, `blueskyFollowers/Likes/Replies/Reposts`) presente no
  jsonb já sincronizado — nunca inferida/fabricada. Agregada por autor via
  `platforms_flat`/`platforms_agg` (unnest + `array_agg(distinct ...)`,
  já que um autor pode casar com mais de uma Category no escopo pedido).
  ⚠️ **Limitação real, documentada em vez de escondida**: só `twitter*` é
  confirmado contra a documentação da Brandwatch para este endpoint
  especificamente (ver `foundation/data-model.md`) — as demais plataformas
  só aparecem se o payload real trouxer essas chaves, o que não está
  garantido pela doc; um autor genuinamente ativo fora do X/Twitter pode
  ficar com `platforms: []` ("—" na UI) em vez de mostrar a rede certa.
  Preferível a inventar uma plataforma sem sinal real (mesma premissa
  project-wide de nunca fabricar dado que a Brandwatch não confirma).
- **"Papel na conversa"** — 100% presentation-layer, nenhum dado novo de
  backend (`authorRole()`, `components/intelligence-center/author-color.ts`):
  quando o autor tem uma Entity vinculada de tipo `media_outlet`/
  `institution`/`party` (já existente desde `entities/author-linking.md`,
  2026-08-01), o papel é "Imprensa"/"Institucional"/"Partidário" — mais
  informativo que sentimento pra esses casos (um veículo de imprensa não é
  "crítico" ou "apoiador", é imprensa). Sem esse vínculo (a maioria dos
  autores — pessoas físicas), cai pro sentimento dominante já calculado
  (`dominantSentiment()`, mesma fonte que já alimenta Detratores/
  Impulsionadores logo abaixo no mesmo widget): "Crítico"/"Apoiador"/
  "Neutro". `—` (nunca inventado) quando não há Entity institucional
  **nem** dado de sentimento suficiente — mesma limitação de cobertura já
  documentada pra Detratores/Impulsionadores (`sentiment_positive/neutral/
  negative` só populado pros top 10 autores por volume da Query inteira).
- **`AuthorsList` ganhou uma 4ª variante, `variant="disseminators"`**
  (`components/intelligence-center/authors-list.tsx`) — Autor/Plataforma/
  Papel na conversa/Seguidores/Publicações/Engajamento, ordenação padrão
  por Seguidores (não Alcance, que esta variante não exibe). "Publicações"/
  "Engajamento" reusam `mentions`/`engagement` (mesmos campos já
  existentes, só relabeled). Refatorado o corpo da tabela pra gate por
  variante em cada célula (`variant === "disseminators"` liga Plataforma/
  Papel/Seguidores e desliga Partido/Ideologia/Alcance/Sentimento) — as
  outras 3 variantes (`full`/`general`/`entity`, usadas por Pautas
  Eleitorais e as 2 guias de `/authors`) continuam com exatamente o mesmo
  comportamento de antes. Só `narrative-detail-content.tsx` passa a usar
  `variant="disseminators"` na seção "Formação e propagação — principais
  disseminadores" — `DisseminationStanceLists` (Detratores/Impulsionadores)
  continua logo abaixo, inalterada.
- Propagação (Princípio técnico 5): `AuthorRow`
  (`packages/shared-types/src/envelope.ts`), a cópia canônica
  (`supabase/functions-shared-source/aggregated-metrics-service.ts` —
  `AuthorRow`, `AuthorRankingRow`, `fetchAuthors`) e as **8** cópias
  inline nas Edge Functions que usam `AuthorRow` (`get-page-{overview,
  narratives,sentiment,platforms,themes,authors}`, `get-narrative-detail`,
  `compose-narrative-synthesis` — este último não estava na lista de "7"
  documentada em `entities/author-linking.md` até agora, corrigido pra 8
  na mesma revisão) ganharam `followers`/`platforms` via um script Node de
  uso único, mesma técnica já usada em sessões anteriores — 3 âncoras
  exatas substituídas nos 8 arquivos, contagem de ocorrências (1 por
  arquivo) conferida antes de aplicar.

**Documentação**: `intelligence-center/narratives-exploration.md`
("Formação e propagação", novo bloco ✅), `aggregated-metrics/
sql-aggregation.md` e `standard-json-envelope.md` (campos novos do bloco
`authors`), `foundation/data-model.md` (`bw_query_top_authors.followers`/
`platform_stats`, novo consumidor).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, mesma contagem de antes (nenhuma rota
nova/removida, só um widget numa página já existente). Migration
`20260808020000` revisada manualmente, não executada contra um banco real
nesta sessão — mesma limitação recorrente de toda sessão sem credenciais
de deploy neste ambiente. `git push` para `develop` é o próximo passo; o
sinal de que funcionou é a coluna "Plataforma" mostrando "X / Twitter"
pra autores com esse sinal sincronizado, e "Seguidores" deixando de
mostrar "—" pra qualquer autor cujo `followers` já esteja sincronizado.

### `daily_metrics` ainda preso em `stayOnStep` depois do fix de 2026-08-06 — segunda causa raiz real: starvation por ordem fixa de iteração (2026-08-09)

User report, colando o log exato: `invocation:step_done
{"step":"daily_metrics","didWork":true,"stayOnStep":true,"nextStep":"daily_metrics","cycleComplete":false,"stopReason":"stay_on_step"}`
— o mesmo sintoma já corrigido em 2026-08-06 (ver acima), mas persistindo
mesmo depois daquele deploy. Investigação confirmou que o fix de
2026-08-06 estava correto e continua em vigor (a RPC
`bw_query_metrics_daily_category_freshness` já elimina o corte de
`max_rows` do PostgREST) — só que ele resolveu uma causa e deixou uma
segunda, distinta, intocada.

**Causa raiz nova**: o loop de sentimento por Narrativa em
`runDailyMetricsStep()` iterava `narrativeCategoryIds` na ORDEM FIXA
devolvida por `fetchNarrativeCategoryIds()` (sem `ORDER BY`, mas estável
na prática entre invocações — a mesma tabela, sem escrita concorrente
relevante) e só pulava (via `continue`) categorias já "fresh" dentro de
`DAILY_SENTIMENT_FRESH_WINDOW_MS = 25min`. Com
`MAX_SENTIMENT_TARGETS_PER_INVOCATION = 8` e heartbeat de 15min, dar 1
volta completa em N categorias leva `ceil(N/8) × 15min`. Pra N > 16
(≈ 2 × 8), essa volta completa passa a levar mais de 25min — ou seja, as
primeiras ~16 categorias da lista voltam a ficar "stale" antes de o loop,
em ORDEM FIXA, sequer alcançar as categorias além do índice 16. Resultado:
toda invocação reprocessava perpetuamente as mesmas ~16 primeiras
categorias (sempre "as mais atrasadas de novo", porque ficaram esperando
sua vez), e qualquer categoria além disso nunca era sequer tentada —
`allNarrativeSentimentDone` nunca virava `true`, e a fase nunca liberava
`stayOnStep`. É a mesma classe de bug já documentada em 2026-08-06 (uma
fila que nunca dá cobertura completa), só que a causa aqui não é
truncamento de dado — é a interação entre "ordem fixa de iteração" +
"janela de frescor menor que o tempo real de 1 volta completa" pra
organizações com Narrativas suficientes (confirmado matematicamente:
capacidade sustentável era ~16 categorias "em voo" simultaneamente, dado
25min de janela ÷ 15min de heartbeat ≈ 1.67 batches simultâneos × 8/batch).

**Fix** (`supabase/functions/bw-sync/index.ts`, sem migration):
1. `fetchDailySentimentFreshness()` passou a devolver `Map<categoryId,
   ageMs>` (idade em ms, `Infinity` pra quem nunca sincronizou) em vez de
   um `Set` booleano de "fresh" — o chamador precisa da idade real pra
   ordenar, não só um sim/não.
2. O loop deixou de iterar em ordem fixa pulando "fresh": agora filtra as
   categorias DEVIDAS (idade ≥ janela) e ordena da mais atrasada pra menos
   atrasada antes de aplicar o cap de 8 — mesmo princípio já usado pelo
   "round-robin pair picker" de `sync_cursors` (ordenado por
   `last_synced_at` mais antigo primeiro, `CLAUDE.md`, "Scheduled cadence")
   aplicado aqui dentro de uma única fase. Isso garante progresso
   monotônico: uma categoria só pode ficar "esperando" até se tornar a
   mais atrasada de todas, nunca presa atrás de outras pra sempre,
   independente de quantas Narrativas a organização tenha.
3. `DAILY_SENTIMENT_FRESH_WINDOW_MS` (constante fixa de 25min, a única
   janela "stale-gated" deste arquivo que não seguia o padrão já
   estabelecido) foi removida em favor de `getSyncStalenessWindowMs()` —
   a mesma janela derivada de `BW_SYNC_INTERVAL_HOURS` (3h padrão) já
   usada por toda outra fase "stale-gated" do arquivo (`x_insights`/
   `top_sites`/`weekly_monthly`/`topics`/`top_authors`/etc., ver "Every
   'stale-gated' phase's staleness window unified under
   BW_SYNC_INTERVAL_HOURS" acima). Além de eliminar uma segunda constante
   divergente, isso multiplica a capacidade sustentável de ~16 pra até
   ~96 categorias (3h/15min × 8) no default — configurável pelo mesmo
   secret já existente, sem precisar de deploy novo pra recalibrar.

**Verificação**: `npx tsc --noEmit` limpo (mudança é Deno-only, fora do
`tsconfig.json` do Next.js — não valida a sintaxe diretamente, revisado
manualmente linha por linha). Sem ambiente Deno/Supabase real disponível
nesta sessão — não executado contra produção, mesma limitação recorrente
de toda sessão sem credenciais de deploy. `git push` para `develop` é o
próximo passo; o sinal de que funcionou é `stopReason` deixando de ser
`"stay_on_step"` em toda invocação sucessiva — para uma organização com
N Narrativas, o esperado agora é ver `dueCategoryIds` (implícito no
número de `syncSentimentMetrics` chamadas por invocação, visível nos logs
de `[bw-sync]`) cobrindo categorias diferentes a cada heartbeat até o
ciclo fechar (`cycleComplete: true`), em vez das mesmas ~8-16 category
IDs se repetindo indefinidamente.

### "SOV por pauta ao longo do tempo" vazio no modo "Diário" — `get_theme_sov_trend` ganha grão `hour` (2026-08-09)

User report (screenshot, mesma sessão do reorg de `/themes` acima): o
gráfico "SOV por pauta ao longo do tempo" aparecia praticamente vazio (só
eixos, sem linhas) quando o período selecionado é "Diário". Mesmo bug já
corrigido em `get_volume_trend` (2026-07-19, "Volume/sentiment trend
chart — hourly grain..." acima): a regra de grão automático (≤31d → day,
32-186d → week, >186d → month) nunca teve um caso pra "exatamente 1 dia" —
caía no grão `day`, devolvendo **1 único ponto** por Pauta (o dia inteiro
somado), o que uma linha de SVG não desenha como linha nenhuma. A
diferença é que `get_theme_sov_trend` só existe desde 2026-07-25 (gap
#10) — já nasceu sem o grão `hour`, e seu próprio comentário original
dizia (incorretamente, como este relato confirma) que "nenhuma das duas
páginas [platforms/themes] usa o modo Diário horário do jeito que Visão
Geral/Sentimento usam".

**Fix** (migration `20260809000000`, `create or replace` — `bucket_date`
já era `text` desde sempre nesta function, então não precisou de `drop
function`): novo grão `hour`, ativo quando o período pedido é exatamente
1 dia, fonte `bw_query_metrics_hourly` (mesma tabela que `get_volume_trend`
já usa — janela móvel de 30 dias, já tem `category_id` nullable).
Numerador (menções da Pauta por hora) = linhas com `category_id` = o
`bw_category_id` da Pauta; denominador (menções da Query inteira por
hora) = linhas com `category_id is null`; `bucket_date` no grão `hour` é
um ISO 8601 UTC completo (`to_char(metric_hour at time zone 'utc',
'YYYY-MM-DD"T"HH24:MI:SS"Z"')`), mesmo formato que `get_volume_trend` já
produz. **Nenhuma mudança de frontend** — `TrendLineChart` já distingue
hora/dia genericamente pelo comprimento/formato da string `bucket_date`
(`isHourlyPoint()`), sem nenhuma lógica específica de qual function
gerou o dado; funciona automaticamente pra `series_by_group` (uma linha
por Pauta) do mesmo jeito que já funcionava pra série única.

**Verificação**: `npx tsc --noEmit` limpo (mudança 100% SQL, sem impacto
de tipos). Migration revisada manualmente, não executada contra um banco
real nesta sessão — mesma limitação recorrente de toda sessão sem
credenciais de deploy; `git push` para `develop` é o próximo passo, e o
sinal a acompanhar é o gráfico "SOV por pauta ao longo do tempo" mostrar
uma série real (múltiplos pontos por hora) quando "Diário" está
selecionado, em vez de aparecer vazio.

### `page_narrative_synthesis` nunca atualizava num período aberto — recomposição a cada 3h (2026-07-14)

User report: "na funcionalidade ai-synthesis.md os resumos não estão
atualizando até o momento. a atualização das `page_narrative_synthesis`,
vamos definir atualização a cada 3h." Confirmado por leitura de código,
não só pelo relato: desde que a Camada 1 foi implementada (2026-08-02, ver
"Fase B implementada" acima), `fetchNarrativeText()` sempre devolvia uma
linha já existente em `page_narrative_synthesis` **como está, pra
sempre** — sem nenhum gatilho de recomposição, mesmo num período ainda
aberto ("Semanal"/"Mensal" em andamento, `is_final = false`). Isso já
estava documentado como limitação conhecida (não um bug) desde que a
Camada 1 foi implementada — os 2 gatilhos "empurrados" que a spec
original previa (sync da Brandwatch concluir um ciclo, ou um botão
"Atualizar dados" no header) nunca existiram no produto — mas na prática
significava que o resumo executivo de qualquer período aberto ficava
congelado no texto da primeira composição, por mais que os highlights
subjacentes mudassem depois. Em vez de esperar por esses 2 gatilhos, o
usuário pediu um caminho mais simples: um intervalo fixo.

**Fix** (`aggregated-metrics-service.ts`, sem migration —
`page_narrative_synthesis.generated_at` já existia desde a criação da
tabela, só não era lido por `fetchNarrativeText()` até agora): nova
constante `AI_SYNTHESIS_REFRESH_HOURS` (configurável via secret, default
`3` — mesmo padrão de `BW_SYNC_INTERVAL_HOURS`) + `isNarrativeTextStale(generatedAt)`.
`fetchNarrativeText()` agora seleciona `generated_at` junto com
`narrative_text`/`is_final` e, ao encontrar uma linha existente, continua
devolvendo o texto já gravado **nesta mesma resposta** (nunca bloqueia a
página esperando uma nova composição) — mas também dispara uma
recomposição em background (`scheduleBackground`, mesmo mecanismo
fire-and-forget já usado pro caso "linha não existe") sempre que **todas**
as condições valem: período ainda aberto (`is_final = false` — período
fechado continua permanente, nunca recomposto, por definição), período
não é `custom` (mesmo gate de sempre desde 2026-07-14 mais cedo nesta
mesma data — um período personalizado nunca dispara IA sozinho, só pelo
botão "Analisar com IA"), e `generated_at` já tem 3h ou mais. Puxado no
próximo carregamento de página que encontrar a linha vencida — nunca um
cron dedicado, já que `page_narrative_synthesis` só é gravada quando
alguém de fato abre a página.

Propagado (Princípio técnico 5) na cópia canônica
(`supabase/functions-shared-source/aggregated-metrics-service.ts`) e nas
**8** Edge Functions deployadas que a replicam
(`get-page-{overview,narratives,sentiment,platforms,themes,authors}`,
`get-narrative-detail`, `compose-narrative-synthesis`) via um script Node
de uso único (substituição por igualdade de string exata, contando
ocorrências pra garantir 1 match por arquivo antes de aplicar — mesma
técnica já usada em sessões anteriores deste arquivo), confirmado
aplicado nos 8 arquivos sem falha.

**Especificações atualizadas**: `aggregated-metrics/ai-synthesis.md` (novo
blockquote de topo + "Camada 1"/"Fluxo principal"/"Fluxos alternativos e
erros"/"Regras de negócio" reescritos pra descrever o comportamento real,
substituindo a descrição antiga de "nunca regenera, aspiracional"),
`_pending.md` (nova nota "✅ Resolvida" logo após o gap #21 original —
esclarecendo que só a instância deste gap em `ai-synthesis.md` foi
fechada; a instância em `page_cache`, TTL de resposta HTTP, mecanismo
independente e hoje desabilitado, continua aberta, já que não fazia parte
deste pedido).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, mesma contagem de antes (mudança é
Edge-Function-only, sem impacto no lado Next.js). Sem ambiente
Deno/Supabase real disponível nesta sessão — não testado contra uma
chamada real à Anthropic nem contra produção, mesma limitação recorrente
de toda sessão sem credenciais de deploy neste ambiente; `git push` para
`develop` é o próximo passo, e o sinal a acompanhar é uma linha de período
aberto em `page_narrative_synthesis` ganhando um novo `generated_at` (via
log `[aggregated-metrics] composeAndPersistLayer1`) depois de 3h da
composição anterior, na próxima vez que a página correspondente for
carregada.

**Follow-up, mesmo dia** — usuário testou manualmente (baixando
`AI_SYNTHESIS_REFRESH_HOURS` pra forçar staleness) e reportou "mesmo
alterando a secret nada está sendo atualizado", e perguntou onde checar o
log. Achado real ao revisar: **não existia nenhum log de sucesso** nesta
rotina — `composeAndPersistLayer1`/`fetchNarrativeText` só logavam erro
(`console.error`), nunca confirmavam via `console.log` que o gate passou
ou que a recomposição terminou. Sem isso, "rodou e funcionou" e "nunca
chegou a ser disparado" eram indistinguíveis nos logs — exatamente o que
impedia o usuário de diagnosticar o próprio teste. Adicionados 3 pontos de
log (`aggregated-metrics-service.ts` + as 8 cópias deployadas, mesmo
script de propagação verificado por contagem de ocorrências):
`fetchNarrativeText:stale_refresh_scheduled` (confirma que o gate de 3h
passou e a recomposição foi agendada), `fetchNarrativeText:initial_compose_scheduled`
(mesmo sinal pro caso "linha não existe ainda", que também nunca tinha
log de disparo), e `composeAndPersistLayer1:success` (confirma que a
composição terminou e a linha foi gravada). Combinados com os logs de erro
já existentes (`composeLayer1NarrativeText: ANTHROPIC_API_KEY não
configurada`, `composeLayer1NarrativeText failed`,
`composeAndPersistLayer1 upsert failed`, `fetchNarrativeText (Camada 1)
failed`), agora dá pra ler a trilha completa em Dashboard → Edge Functions
→ Logs (função `get-page-<página>` correspondente, filtrar por
`[aggregated-metrics]`): se `stale_refresh_scheduled`/
`initial_compose_scheduled` nunca aparece, o gate não passou (verificar
`is_final`/`period.mode`/quantidade de highlights — Camada 1 só é
alcançável com 2+, ver "Camada 1" em `ai-synthesis.md`); se aparece mas
`composeAndPersistLayer1:success` não vem em seguida, o erro
correspondente (`ANTHROPIC_API_KEY`/`composeLayer1NarrativeText
failed`/`upsert failed`) explica a causa. `npx tsc --noEmit` limpo.

### Resumo executivo passa a acompanhar o radar + janela reduzida pra 1h (2026-07-14)

User request, mesmo dia/mesma sessão do fix do refresh de 3h acima: "esse
resumo executivo precisa acompanhar o radar, se aparecer algo novo no
radar, refaz o resumo executivo. Além disso, atualiza automaticamente de
hora em hora" — esclarecido com um exemplo concreto: "gerou-se um novo
evento no radar, mas o resumo executivo do radar e as narrativas acabam
ficando desatualizadas."

**Duas mudanças em `fetchNarrativeText()`** (`aggregated-metrics-service.ts`):

1. **`AI_SYNTHESIS_REFRESH_HOURS` default 3h → 1h** — mesma constante do
   fix anterior, só o valor padrão muda. ⚠️ Se o secret já foi setado
   explicitamente em produção (`supabase secrets set
   AI_SYNTHESIS_REFRESH_HOURS=3`, ao testar a mudança anterior), esse
   valor **não** é sobrescrito pelo novo default — é preciso `supabase
   secrets set AI_SYNTHESIS_REFRESH_HOURS=1` (ou remover o secret pra
   herdar o novo default do código).
2. **Gatilho por evento novo, independente da janela de tempo** — nova
   `highlightsNewerThan(highlights, generatedAt)`: se qualquer highlight
   do array já buscado nesta mesma requisição (`fetchHighlights`, sem
   chamada de rede extra) tem `created_at` mais recente que
   `page_narrative_synthesis.generated_at`, conta como "algo novo
   apareceu no radar desde a última composição" e dispara recomposição em
   background mesmo que a janela de 1h ainda não tenha vencido. Precisou
   de um dado que a function SQL não expunha: `get_active_highlights`
   ganhou `created_at` (migration `20260809040000`, `feed_events.created_at`
   — já existia na tabela desde sempre, nunca exposto por esta function;
   `drop function` necessário, mesma regra de sempre pra adicionar coluna
   de saída a uma `RETURNS TABLE`). `Highlight` ganhou `created_at:
   string` — em **dois** lugares (Princípio técnico 5, são tipos
   independentes): `packages/shared-types/src/envelope.ts` (lado Next.js)
   e a interface `Highlight` inline dentro de
   `aggregated-metrics-service.ts` (lado Deno, self-sufficient — achado
   real ao implementar: a primeira rodada de edição só tocou o tipo do
   pacote npm, e o `tsc` do Next.js não acusa nada de errado porque os
   arquivos `supabase/functions*` ficam fora do `tsconfig.json` — só uma
   segunda checagem manual encontrou a interface duplicada faltando o
   campo). `fetchHighlights`/`ActiveHighlightRow` também precisaram
   passar o campo adiante.

Os dois gatilhos (tempo OU evento novo) continuam sob o mesmo gate de
sempre: só disparam quando `is_final = false` (período aberto) e o
período não é `custom` (nunca dispara IA sozinho pra um intervalo
personalizado, só pelo botão "Analisar com IA"). Propagado (Princípio
técnico 5) na cópia canônica e nas 8 Edge Functions deployadas
(`get-page-{overview,narratives,sentiment,platforms,themes,authors}`,
`get-narrative-detail`, `compose-narrative-synthesis`) via o mesmo padrão
de script Node verificado por contagem de ocorrências das sessões
anteriores.

**Sobre "e as narrativas" do exemplo do usuário**: o resumo executivo
**por Narrativa** (`narratives.description`, produzido por
`narrative-summary-composer`, ver "`narratives.description` finally gets
a producer" acima) é um mecanismo **diferente** deste — e já reage a
`feed_events` novos desde que foi criado: `narrative_summary_due_ids()`
já marca uma Narrativa como "devida" quando "surgiu um `feed_events` novo
pra ela desde o último resumo" (uma de 4 condições, avaliada a cada 30min
via `pg_cron`). Não alterado nesta sessão — explicado ao usuário na
resposta em vez de presumido corrigido; se ainda parecer desatualizado na
prática depois do deploy, é um sintoma a investigar separadamente (cron
não rodando, batch de 5/invocação insuficiente pro volume), não a mesma
causa fechada aqui.

**Especificações atualizadas**: `aggregated-metrics/ai-synthesis.md` (novo
blockquote de topo + "Camada 1"/"Fluxo principal"/"Fluxos alternativos e
erros"/"Regras de negócio" revisados pra descrever os 2 gatilhos, não só
o de tempo), `aggregated-metrics/standard-json-envelope.md` (bloco
`highlights` ganha `created_at` na lista de campos),
`aggregated-metrics/sql-aggregation.md` (linha de `get_active_highlights`
na tabela principal), `_pending.md` (follow-up na mesma nota "✅
Resolvida" da sessão anterior).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, mesma contagem de antes. Sem ambiente
Deno/Supabase real disponível nesta sessão — migration `20260809040000`
revisada manualmente, não executada contra um banco real, mesma
limitação recorrente de toda sessão sem credenciais de deploy neste
ambiente; `git push` para `develop` é o próximo passo, e o sinal a
acompanhar é o log `fetchNarrativeText:stale_refresh_scheduled` trazendo
`"reason":"new_highlight"` (em vez de só `"time_window"`) na próxima vez
que um evento novo do radar aparecer antes de 1h se passar desde a última
composição.

### SOV da tabela/gráfico de Pautas estava calculado contra a Query inteira, não só Pautas — segundo bug real na mesma sessão (2026-08-09)

User follow-up, mesma sessão do fix de "Insights" acima, com screenshot:
"tudo dessa página deve ser somente em cima da categoria Pautas. SOV do
gráfico e da tabela de narrativas está incorreto. os valores utilizados
em Share of Voice e sentimento por pauta estão corretos considerando
apenas as subcategorias de Pautas."

**Achado, confirmado lendo as 3 functions lado a lado** (não uma
suposição): `get_theme_breakdown` (widget "Share of Voice e sentimento
por pauta", confirmado correto pelo usuário) divide as menções de cada
Pauta pela soma de menções de **todas as Pautas** (`grand_total`, migration
`20260721030000`, já existia assim desde aquela correção de escopo) —
nunca pelo total da Query inteira. `get_narratives_table` (tabela
"Narrativas" desta página, `p_scope='pautas'`) e `get_theme_sov_trend`
(gráfico "SOV por pauta ao longo do tempo") faziam diferente: as duas
dividiam pelo total da **Query inteira** — `query_period_totals` (soma de
`total_mentions` de TODAS as Narrativas do `query_id`, sem filtro de
escopo, migration `20260808030000`) e `bw_query_metrics_daily`/
`bw_query_metrics_hourly` com `category_id is null` (adicionada no dia
anterior, migration `20260809000000`), respectivamente. Como Pautas é
normalmente um subconjunto pequeno do que a Query inteira rastreia
(a organização tem outras Narrativas fora de "Pautas" — crise,
monitoramento geral, etc.), dividir por esse total bem maior produzia
SOVs artificialmente minúsculos: o screenshot do usuário mostrava
1.2%/0.9%/0.1%/0.1% pras 4 pautas com atividade, quando o valor correto
(mesma base de `get_theme_breakdown`) é bem maior — não um bug de
arredondamento, um bug de escopo de denominador.

**Fix** (migration `20260809010000`, `create or replace` nas duas
functions — nenhuma mudou assinatura/colunas de saída, sem `drop
function`):
- `get_theme_sov_trend`: removidas as CTEs `query_hourly`/`query_daily`
  (que buscavam o total da Query inteira em `bw_query_metrics_hourly`/
  `bw_query_metrics_daily`) — o denominador agora é calculado a partir
  dos próprios dados de Pauta já buscados (`bucket_totals`, `sum(pauta_mentions)
  group by bucket_date`), sem precisar mais tocar nenhuma tabela de "Query
  inteira". Simplifica a function (menos CTEs, menos joins) e corrige o
  bug ao mesmo tempo.
- `get_narratives_table`: novo `pautas_period_total` (soma de
  `total_mentions` de todas as Subcategories ativas de "Pautas", org-wide
  — não por `query_id`, mesma base de `get_theme_breakdown`), usado no
  lugar de `query_period_totals` **só quando `p_scope = 'pautas'`** — toda
  outra página (`overview`/`narratives`/`sentiment`, que não passam
  `p_scope='pautas'`) mantém o denominador "Query inteira" de sempre, sem
  nenhuma mudança de comportamento. `case when p_scope = 'pautas' then
  (select total from pautas_period_total) else qpt.query_total_current
  end` — só essa linha do `sov_pct` mudou; confirmado por `diff` isolado
  contra a versão deployada (`20260808030000`) que nenhuma outra linha da
  function diverge.

**Migrations anteriores já estavam deployadas** (`git rev-list
--left-right --count origin/develop...HEAD` = `0 0` no momento desta
sessão) — por isso este fix é uma migration **nova**
(`20260809010000`), não uma edição de `20260809000000`/`20260808030000`
— editar um arquivo de migration já aplicado no banco real não faz o
Postgres reexecutá-lo (o "de-para" fica registrado por versão/nome do
arquivo em `supabase_migrations.schema_migrations`), então a correção
tinha que ser um novo arquivo mesmo sendo, na prática, a continuação
imediata do trabalho do dia anterior.

**Especificações atualizadas**: `intelligence-center/electoral-themes.md`
(novo blockquote de topo + reescrita da seção "SOV por pauta" em
"Interface (UI)", que descrevia o próprio bug como se fosse o
comportamento correto), `aggregated-metrics/sql-aggregation.md` (notas
em `get_theme_sov_trend`/`get_narratives_table`).

**Verificação**: `npx tsc --noEmit` limpo (mudança 100% SQL). Migration
revisada manualmente — `diff` isolado de `get_narratives_table` contra a
versão deployada confirma que só a CTE nova + a linha de `sov_pct`
divergem, resto byte-idêntico; balanço de parênteses conferido
separando linhas de comentário puro (`grep -v '^\s*--'`) do corpo SQL
real, que fecha em 238/238. Não executada contra um banco real nesta
sessão — mesma limitação recorrente de toda sessão sem credenciais de
deploy; `git push` para `develop` é o próximo passo, e o sinal a
acompanhar é o SOV de cada Pauta (tabela e gráfico) bater com os
percentuais já mostrados em "Share of Voice e sentimento por pauta" pro
mesmo período.

### Dot de Pauta recolorido + "Diário" de "SOV por pauta" ainda vazio — causa raiz real era em `bw-sync`, não no SQL (2026-08-09)

User follow-up, mesma sessão dos 2 fixes de SOV/Insights de Pautas acima,
2 itens:

1. **Dot recolorido pra bater com a linha do gráfico** — pedido do
   usuário: "pinte a bolinha que existe ao lado das pautas com a cor do
   gráfico de linhas para facilitar a leitura." `colorForGroup()` (a
   function que já colore cada série de `TrendLineChart` por hash
   determinístico do nome do grupo) foi extraída de
   `components/intelligence-center/charts/trend-line-chart.tsx` pra
   `lib/chart-colors.ts` — sem essa extração, `pauta-cards.tsx` não tinha
   como chamar a mesma lógica sem duplicá-la (os dois arquivos vivem em
   pastas irmãs dentro de `intelligence-center/`, sem um lugar comum óbvio
   pra esse utilitário até agora). `PautaCardGrid`'s dot
   (`components/intelligence-center/pauta-cards.tsx`) trocou de
   `NetSentimentDot` (cor por sentimento) pra
   `colorForGroup(item.label)` — mesmo `item.label`/título de Pauta que
   `get_theme_sov_trend` usa como `series_by_group.group`, então a cor do
   dot sempre bate com a cor da linha correspondente no gráfico logo
   abaixo. Trade-off aceito, pedido explícito: o card deixa de mostrar
   sentimento visualmente (só a tabela "Narrativas" e o widget "Sentimento
   por pauta" continuam mostrando).
2. **"SOV por pauta ao longo do tempo" continuava vazio no modo "Diário"**
   mesmo depois dos 2 fixes anteriores (grão `hour` + denominador
   escopado a Pautas). Investigação encontrou a causa raiz de verdade, na
   **captura de dado**, não no SQL: das 3 chamadas fixas de
   `runHourlyMetricsStep` (`bw-sync/index.ts`), só
   `syncHourlySentimentMetrics` grava `total_mentions` em
   `bw_query_metrics_hourly` — e sempre com `category_id: null`
   (hardcoded, linha só da Query inteira). `syncHourlyNetSentiment
   ("categories", ...)` grava uma linha **por Narrativa** (incluindo cada
   Pauta), mas só escreve `net_sentiment` — nunca `total_mentions`, que
   fica preso no default da coluna (`not null default 0`, migration
   `20260713040000`) pra sempre, pra **qualquer** Narrativa. Ou seja:
   desde que essa tabela existe, **nenhuma linha com `category_id`
   preenchido jamais teve `total_mentions` real** — `get_theme_sov_trend`'s
   `pauta_hourly` (que faz `join bw_query_metrics_hourly h on h.category_id
   = p.bw_category_id`) sempre casava com linhas cujo `total_mentions` é
   0, produzindo uma série sempre vazia/zerada no modo "Diário". O SQL da
   sessão anterior estava certo — o dado que ele lê nunca existiu. Mesmo
   gap afetaria `get_volume_trend`'s grão `hour` sempre que
   `filters.narratives` estiver ativo (ex: `/narratives/[id]` no modo
   "Diário"), não só Pautas — por isso o fix é genérico (todo
   `categoryTarget`), não uma gambiarra só pra `themes`.
   **Fix** (`bw-sync/index.ts` + migration `20260809020000`):
   `syncHourlySentimentMetrics` ganhou um parâmetro `categoryId` opcional
   (mesmo padrão de `syncSentimentMetrics`, já usado pelos grãos dia/
   semana/mês desde sempre — `category=<id>` como filtro genérico já
   confirmado válido, `available-filters.md`) — quando presente, filtra a
   chamada por `category=<id>` e grava a linha com esse `category_id` de
   verdade. `runHourlyMetricsStep` ganhou um loop throttled sobre
   `categoryTargets` (todas as Narrativas, não só Pautas) — mesmo padrão
   de round-robin por staleness já usado em `daily_metrics` (2026-08-09,
   ver entrada acima): `fetchHourlyVolumeFreshness()` (nova, chama a RPC
   `bw_query_metrics_hourly_category_freshness`, migration `20260809020000`
   — agregação no Postgres, nunca uma select bruta sem `ORDER
   BY`/`LIMIT`, mesma classe de bug já corrigida em 2026-08-06 pra
   `bw_query_metrics_daily`), capado em `MAX_HOURLY_VOLUME_TARGETS_PER_INVOCATION
   = 8`, `stayOnStep: true` se sobrar trabalho (não estoura o teto de 30
   chamadas/10min da Brandwatch numa organização com muitas Narrativas).
   As 3 chamadas fixas originais continuam sem guarda de orçamento (mesmo
   comportamento de sempre — "sempre roda, sem throttle"); só o novo loop
   por Narrativa é gated.

**Especificações atualizadas**: `foundation/data-model.md`
(`bw_query_metrics_hourly`, novo blockquote sobre o bug de captura),
`foundation/sync-brandwatch.md` (linha `hourly_metrics` da tabela de
passos), `intelligence-center/electoral-themes.md` (nota corrigindo a
causa raiz do gráfico vazio + nota do dot recolorido).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, mesma contagem de antes (mudança
puramente de estilo/dado, nenhuma rota nova). Balanço de parênteses do
arquivo `bw-sync/index.ts` conferido antes/depois da mudança (mesma
profundidade final em ambas as versões — `+1`, já presente antes desta
sessão, artefato de comentário em prosa, não um erro de sintaxe
introduzido agora). Migration `20260809020000` revisada manualmente, não
executada contra um banco real nesta sessão — mesma limitação recorrente
de toda sessão sem credenciais de deploy; `git push` para `develop` é o
próximo passo, e o sinal a acompanhar é `bw_query_metrics_hourly` ganhando
linhas com `category_id` preenchido e `total_mentions > 0` nos logs
`[bw-sync] syncHourlySentimentMetrics:done`, seguido do gráfico "SOV por
pauta ao longo do tempo" mostrando uma série real no modo "Diário".

### Sentimento de autor em Pautas, colunas de `AuthorsList`, e mensagem morta em "Por Entidade" (2026-08-09)

User request, 4 itens na mesma mensagem, ainda em Pautas Eleitorais/
Autores e Influenciadores:

1. **"Na tabela [Autores e comunidades por pauta] só aparece sentimento
   para um author, pq não aparece para os demais?"** — bug real. Sentimento
   por autor (`AuthorRow.sentiment_positive/neutral/negative`) só existe
   pra quem já foi enriquecido via `bw_query_author_topics`
   (`get_authors_ranking`'s `author_sentiment`), e o único pool de
   candidatos a enriquecer sempre foi "top 10 autores por volume da QUERY
   INTEIRA" (`bw-sync`'s `runAuthorEnrichmentStep`, `bw_query_top_authors`
   com `category_id is null`) — nunca escopado por Narrativa/Pauta. Como
   Pautas é um subconjunto pequeno do que a Query inteira rastreia (mesma
   observação já confirmada pelo bug de SOV corrigido nesta mesma sessão,
   ver acima), o pool global e "autores ativos em Pautas" são
   majoritariamente disjuntos — só quem cai nos dois por coincidência
   mostrava sentimento na tabela de Pautas. **Fix**: novo pool de
   candidatos via `bw_pautas_top_author_candidates` (migration
   `20260809030000` — top 10 autores por volume somado entre todas as
   Subcategories ativas de "Pautas"), processado em
   `runAuthorEnrichmentStep` só depois que o pool global já estiver
   totalmente enriquecido na semana (prioridade preservada, sem mudança
   de comportamento pra quem não usa Pautas). Só chama `syncAuthorTopics`
   pra este pool, não `syncAuthorImpressions` — `impressions` é gravado
   numa linha `category_id is null` de `bw_query_top_authors`, que um
   autor só ativo em Pautas pode não ter; `bw_query_author_topics` (o que
   `get_authors_ranking` de fato lê pra sentimento) não depende disso.
   `runAuthorEnrichmentStep` ganhou um parâmetro `organizationId` (já
   disponível no escopo do dispatcher, só precisou ser repassado).
2-3. **Colunas de "Autores e comunidades por pauta"**: pedido do usuário
   ("substitua a coluna Partido por tipo de entidade... Retire da tabela o
   campo ideologia"). `AuthorsList`'s variant `full`
   (`components/intelligence-center/authors-list.tsx`) — confirmado como
   único consumidor real desta variante (`/themes`, sem `variant` explícito
   no call site = default `"full"`; detalhe de Narrativa usa
   `"disseminators"`, não `"full"` — um comentário antigo do arquivo dizia o
   contrário, corrigido de passagem) — trocou de Autor/Partido/Ideologia/
   Menções/Alcance/Engaj./Sentimento pra Autor/Tipo/Menções/Alcance/Engaj./
   Sentimento. "Tipo" (`entity_type`) reusa a mesma célula/render já usada
   pela variant `entity` (`—` sem vínculo de Entity, nunca inventado); a
   cor do avatar circular também passou a usar `entity_type` em vez de
   `ideologia` pra esta variant (evita colorir por uma dimensão que a
   tabela não mostra mais). Único consumidor afetado — `general`/`entity`/
   `disseminators` (usados por `/authors` e pelo detalhe de Narrativa)
   ficam inalterados.
4. **"Autores Por Entities a página está vazia sem gráficos"** — investigado
   sem acesso a dado real de produção. O estado vazio (guia "Por Entidade"
   de `/authors`, quando `linkedAuthors.length === 0`) já é o comportamento
   correto por design quando nenhum autor do escopo bate com uma conta já
   semeada no Cadastro Nacional de Entidades — mas a mensagem em si tinha
   um **link morto real**: instruía o usuário a cadastrar em
   `/admin/entities`, uma rota que **não existe**
   (`entity-registration.md` — CRUD do módulo `entities` — está com
   `status: pronto`, nunca implementada; confirmado que
   `app/(intelligence-center)/admin/` só tem `users`/`finops`). Mensagem
   reescrita pra explicar honestamente que o vínculo é automático por
   handle contra o que já foi semeado (deputados/senadores/partidos/
   imprensa/institutos de pesquisa), sem prometer uma tela que ainda não
   existe. Perguntado ao usuário via `AskUserQuestion` se deveria
   implementar `/admin/entities` agora (resolveria a causa raiz de "sem
   dado pra mostrar" pra quem quiser cadastrar contas fora do seed) —
   resposta: não nesta sessão, só a correção da mensagem.

**Especificações atualizadas**: `foundation/sync-brandwatch.md` (linha
`author_enrichment`), `aggregated-metrics/sql-aggregation.md`
(`get_authors_ranking`), `intelligence-center/electoral-themes.md` (nova
seção sobre o fix de sentimento + colunas), `intelligence-center/authors-and-influencers.md`
(mensagem de estado vazio corrigida + variantes de `AuthorsList`
atualizadas, incluindo a correção do comentário desatualizado sobre quem
usa `full`).

**Verificação**: `npx tsc --noEmit` limpo. Migration `20260809030000`
revisada manualmente (balanço de parênteses do arquivo `bw-sync/index.ts`
conferido antes/depois — mesma profundidade final de antes desta sessão,
artefato de comentário em prosa, não um erro de sintaxe introduzido
agora), não executada contra um banco real nesta sessão — mesma limitação
recorrente de toda sessão sem credenciais de deploy; `git push` para
`develop` é o próximo passo, e o sinal a acompanhar é mais de 1 autor
mostrando sentimento na tabela "Autores e comunidades por pauta" depois de
`runAuthorEnrichmentStep` rodar algumas vezes (throttle de 1 autor por
invocação, mesmo padrão de sempre).

### ai-synthesis Camada 2 — 3 seções reais + resumo executivo em `/narratives` + admin force-refresh (2026-07-14)

User request, 5 itens numa mensagem só + um pedido geral de fechamento:
(1) Overview's "O que os gráficos mostram?" considerar diário/semanal/
mensal + "mostrar mais"/"mostrar menos"; (2) `/narratives` — "atualizar o
resumo executivo de todas as narrativas" + "inclua um resumo executivo da
página"; (3) `/platforms` — "Conteúdos de destaque" gerado pela synthesis,
movido pro início da página; (4) `/themes` — "Comparação entre períodos"
gerado pela synthesis, movido pro início da página; (5) `/authors` —
"Conteúdo em destaque (Top Sites, X Themes)" ganha "uma visão geral
sucinta sobre os autores e influenciadores"; todos os 5 com "mostrar
mais"/"mostrar menos" quando o texto transborda o frame; e, geral: "permita
que eu consiga executar a atualização do resumo executivo, pode ser via
cron ou por algo disponível na sessão do administrador."

**Achado antes de qualquer código**: item 1 (diário/semanal/mensal) já
funcionava por construção desde 2026-07-14 mais cedo (a chave de
`page_narrative_synthesis` já inclui `period_start`/`period_end`, cada
modo do header produz um par distinto) — nada a corrigir aí além do
"mostrar mais"/"mostrar menos". Os itens 3/4/5 pediam 3 textos novos que
não existiam em nenhuma página — "Conteúdos de destaque" e "Comparação
entre períodos" eram `EmptyState` desde que suas páginas existem (gaps
documentados, sem fonte de dado — nunca houve `feed_events`/mentions
individuais por trás), e "Autores e Influenciadores" nunca teve nenhum
texto de síntese. Nenhum dos 3 tem equivalente no radar (`event-radar`) —
exatamente o caso que `ai-synthesis.md` já reserva pra "Camada 2", nunca
implementada até agora (0 usos reais).

**Generalização de schema** (migration `20260809050000`) —
`page_narrative_synthesis` ganhou `section text not null default 'main'`,
chave única virou `(organization_id, page, section, period_start,
period_end, filters_hash)`. `'main'` é o `narrative_text` genérico de
sempre (Camada 0/1); os 3 textos novos usam seções próprias
(`'featured_content'`, `'period_comparison'`, `'overview'`). Todo o código
que já lia/escrevia essa tabela (`fetchNarrativeText`/
`composeAndPersistLayer1`/`composeNarrativeSynthesisOnDemand`) passou a
filtrar/gravar `section = 'main'` **explicitamente** — sem isso, um
`.maybeSingle()` encontraria 2+ linhas assim que a primeira seção nova
existisse pra essa mesma `(page, period, filters_hash)`, quebrando o fluxo
existente silenciosamente até o primeiro erro em produção.

**Mecanismo genérico** (`fetchSectionText`/`composeAndPersistSection`/
`composeSectionText`, `aggregated-metrics-service.ts`) — mesma
tabela/persistência/janela de frescor (`AI_SYNTHESIS_REFRESH_HOURS`) da
Camada 1, só sem o gatilho de "evento novo do radar" (essas seções não
dependem de `highlights`) e com `layer: 'layer_2'`. Cada seção: system
prompt próprio, função de payload (só dado já agregado **já buscado por
essa mesma requisição** — nunca uma chamada extra, exceto a exceção abaixo)
e fallback determinístico próprio (nunca tela vazia sem explicação):
- **`platforms:featured_content`** — payload = breakdown de plataforma
  (top 5) + `term_signals` (top 8), ambos já buscados por `/platforms`.
- **`themes:period_comparison`** — payload = `get_theme_breakdown` (já
  usado por "Share of Voice e sentimento por pauta") chamado uma **2ª
  vez**, pro período imediatamente anterior de mesma duração
  (`previousPeriodRange()` — aritmética de data pura em JS, sem chamada à
  Brandwatch). Único dos 3 com uma chamada extra (RPC Postgres, barata).
- **`authors:overview`** — payload = top 5 autores por alcance + top 5
  sites + top 5 hashtags, todos já buscados por `/authors`.

Wiring em `assemblePageResponse`: 3 branches `if (page === '...')` depois
do cálculo de `narrativeText`, cada uma só roda na sua própria página,
resultado anexado a `ui_meta` (`featured_content_text`/
`period_comparison_text`/`authors_overview_text` — nunca vai pra IA,
mesma regra de sempre pra `ui_meta`).

**Frontend**: novo `components/ui/expandable-text.tsx` (`ExpandableText`)
— mede `scrollHeight > clientHeight` do parágrafo clampado
(`-webkit-line-clamp`, 4 linhas) pra só mostrar "Mostrar mais" quando o
texto de fato transborda (o pedido do usuário dizia "menor que cabe no
frame", tratado como imprecisão — o único comportamento que faz sentido é
o oposto: toggle quando **maior**/transborda). Usado por
`NarrativeTextPanel` (seção `'main'`) e pelos 3 widgets novos.
`/narratives` ganhou "Resumo executivo da página" (mesmo mecanismo de
sempre — `PAGE_BLOCKS.narratives` ganhou `'highlights'`/`'narrative_text'`,
únicas ausentes até agora entre as 5 páginas de análise). `/platforms`'s
"Conteúdos de destaque" e `/themes`'s "Comparação entre períodos" foram
movidos pro início de suas páginas, pedido explícito do usuário.

**Admin force-refresh** — 2 mecanismos, cada um resolvendo uma metade
diferente do pedido:
1. `NarrativeTextPanel`'s botão (antes só em período `custom`) agora
   também aparece pra `is_admin` em qualquer período — reaproveita a Edge
   Function já existente (`compose-narrative-synthesis`, síncrona), só
   muda a visibilidade no frontend. Cobre a seção `'main'` de qualquer
   página.
2. Nova Edge Function admin-only **`admin-refresh-narrative-summaries`**
   — força `narratives.description` (resumo **por Narrativa**, produtor
   `narrative-summary-composer`, ver `foundation/narratives.md`) a ser
   regerado agora pra toda Narrativa ativa de uma organização.
   `narrative_summary_due_ids()` ganhou `p_organization_id`/`p_force`
   (migration `20260809060000`, `drop function` — muda de 1 pra 3
   parâmetros) — com `p_force = true`, ignora as 4 condições de staleness
   de sempre. Botão "Atualizar resumos executivos das Narrativas" em
   `/narratives`, admin-only, até `MAX_BATCH_SIZE = 50` por clique.
   **Deliberadamente não exposto via `narrative-summary-composer` em si**
   (só o `pg_cron` chama, `verify_jwt = false`, sem CORS/auth) — aceitar
   um `organization_id` arbitrário ali sem autenticação seria um vetor de
   "gaste dinheiro de IA da vítima" pra qualquer um que soubesse a URL.

**Propagação (Princípio técnico 5)**: todas as mudanças de
`aggregated-metrics-service.ts` foram propagadas pras 8 Edge Functions
deployadas via uma técnica diferente das sessões anteriores (mais segura
pra um diff deste tamanho): em vez de N substituições de string pequenas,
um script Node localiza o marcador estável de fim do corpo compartilhado
(`getPageEnvelopeWithCache`, sempre a última function do arquivo canônico)
em cada arquivo deployado e substitui **tudo antes dele** pelo prefixo
canônico inteiro, preservando só o que vem depois (o handler HTTP
específico de cada função, e `fetchNarrativeSummary` no caso de
`get-narrative-detail`). Confirmado por diff byte-a-byte que os 8 prefixos
ficaram idênticos ao canônico. **Efeito colateral positivo, achado durante
a verificação**: isso corrigiu de graça um drift real e pré-existente,
não introduzido por esta sessão — `compose-narrative-synthesis` estava
faltando o bloco inteiro de `top_sites` (`TopSiteItem`/`fetchTopSites`/
`PAGE_BLOCKS.authors` com `'top_sites'`) desde a sessão de 2026-08-08 que
adicionou esse recurso, porque aquela propagação só cobriu "as 7 Edge
Functions deployadas" sem incluir `compose-narrative-synthesis` na lista
— mesma classe de erro já documentada em "`compose-narrative-synthesis`
503 em produção" (2026-08-07). Nunca quebrou nada em produção (essa
function não usa `top_sites`), mas violava a garantia de "cópia inteira
byte-a-byte" que Princípio técnico 5 pressupõe — agora corrigido.

**Especificações atualizadas**: `aggregated-metrics/ai-synthesis.md` (novo
blockquote de topo detalhando os 3 payloads + admin force-refresh + seção
"Camada 2" do corpo marcada como implementada + tabela de schema com
`section`), `standard-json-envelope.md` (3 chaves novas de `ui_meta`),
`intelligence-center/platform-analysis.md`/`electoral-themes.md`/
`authors-and-influencers.md`/`narratives-exploration.md` (nota por
página).

**Verificação**: `npx tsc --noEmit` e `npm run build` (com `rm -rf .next`
antes) passam limpos — 21 rotas, mesma contagem de antes. Balanço de
parênteses/chaves conferido nos 8 arquivos deployados + na nova Edge
Function `admin-refresh-narrative-summaries` (mesmo proxy de verificação
de toda sessão sem acesso a Deno/Supabase real). Sem ambiente real
disponível nesta sessão — as 2 migrations novas (`20260809050000`/
`20260809060000`) revisadas manualmente, não executadas contra um banco
real, mesma limitação recorrente; `git push` para `develop` é o próximo
passo. Sinais a acompanhar em produção: os 3 novos widgets mostram
"Preparando..."/uma mensagem de ausência de dado no primeiro carregamento
de cada `(organização, período)` e o texto real na carga seguinte (mesmo
padrão fire-and-forget de sempre); e o botão "Atualizar resumos
executivos das Narrativas" respondendo com uma contagem real de
`processed`/`updated`.

### Heartbeat de `bw-sync` apertado de 15min pra 1min (2026-08-09)

User request, direto após uma análise de log real (ver a conversa desta
mesma sessão, sem entrada própria neste arquivo por ter sido diagnóstico
puramente conversacional): rodar o pipeline inteiro uma vez estava
levando ~5,5-7h reais (medido via logs de produção), bem acima do piso
teórico de ~2,5-3h calculado a partir do custo de chamadas por fase.
Causa raiz do desvio, confirmada no log: não era falta de orçamento — era
**espera ociosa**. Com o heartbeat fixo em 15min (`*/15 * * * *`,
migration `20260711020000`), quando a janela de 10min da Brandwatch
libera orçamento no minuto 3 de um ciclo, o sistema só percebe isso no
próximo múltiplo de 15 — no log real, `topics` esgotou o orçamento
(`rateLimitUsed: 27`) e o próximo trabalho de verdade só aconteceu ~17
minutos depois, a maior parte disso sendo `invocation:
rate_limit_near_ceiling_skip` puro, sem nenhuma chamada à Brandwatch.

Cogitado e descartado: construir um "agente"/orquestrador dedicado — o
que ele faria (checar continuamente se sobrou orçamento e disparar a
próxima chamada assim que possível) é exatamente o que o dispatcher/
`bw_sync_lock`/`hasBrandwatchCallBudget()` já fazem hoje; o problema era
puramente a frequência de checagem, não falta de inteligência de
orquestração. Fix, migration `20260809070000` (`select cron.alter_job(
(select jobid from cron.job where jobname = 'bw-sync-heartbeat'),
schedule => '* * * * *')`) — reagenda o job já existente pra 1min em vez
de recriá-lo, primeiro uso de `cron.alter_job` neste projeto (os
comentários da migration original de 2026-07-11 já antecipavam esse
mecanismo exato para uma futura mudança de cadência). Justificativa de
custo: uma invocação ociosa (`no_pair_due`/`rate_limit_near_ceiling_skip`)
já é barata hoje — confirmado nos próprios logs, ~24-46ms de boot + 1-2
leituras no Postgres, sem tocar a Brandwatch — então rodar 15x mais vezes
não pesa em custo real, só reduz a folga entre "orçamento liberou" e "o
sistema percebeu".

**Não muda, deliberadamente**: `BW_SYNC_INTERVAL_HOURS` (controla quando
um PAR fica "devido" pra um ciclo novo) e `getSyncStalenessWindowMs()`
(janela de frescor por fase, mesmo secret) — ambos continuam sendo o
parâmetro de negócio, configurável via secret sem migration, exatamente a
distinção já registrada desde a migration original do heartbeat
(2026-07-11: "cadência fixa — decisão de infraestrutura, não é o
parâmetro de negócio que o usuário pediu para ser configurável"). Esta
migration só aperta a cadência de *checagem*, nunca a de "quando um ciclo
novo é considerado devido". Também não muda o teto real de 30 chamadas/
10min da Brandwatch — o piso teórico de ~2,5-3h continua sendo o piso,
esta mudança só elimina o desperdício de espera ociosa em torno dele, sem
prometer ultrapassá-lo.

**Verificação**: migration revisada manualmente (sintaxe padrão de
`cron.alter_job`, mesmo padrão já usado por `cron.schedule` nas migrations
que já agendam jobs neste projeto) — sem acesso a um Supabase real nesta
sessão, não executada contra um banco de verdade, mesma limitação
recorrente de toda sessão sem credenciais de deploy. Sem componente
TypeScript/Edge Function nesta mudança (SQL puro, só reagenda um job
`pg_cron` já existente). `git push` para `develop` é o próximo passo; o
sinal de que funcionou é `cron.job` mostrando `schedule = '* * * * *'`
pra `bw-sync-heartbeat` (`select schedule from cron.job where jobname =
'bw-sync-heartbeat'`) e o intervalo real entre `invocation:start`
consecutivos nos logs caindo de ~15min pra ~1min, com o tempo até o
próximo trabalho real depois de um `rate_limit_near_ceiling_skip` caindo
de dezenas de minutos pra poucos minutos.

### `[get-page-*] unhandled error ReferenceError: createClient is not defined` em produção — a técnica de propagação "wholesale prefix replace" reintroduziu o próprio bug que ela deveria evitar (2026-07-14)

Incidente real, reportado pelo usuário direto do log de produção: todas as
8 Edge Functions que copiam `aggregated-metrics-service.ts` (`get-page-{overview,
narratives,sentiment,platforms,themes,authors}`, `get-narrative-detail`,
`compose-narrative-synthesis`) começaram a devolver `503`/`unhandled
error` com `ReferenceError: createClient is not defined`, todas na mesma
linha do próprio handler (`const supabase = createClient(...)`).

**Causa raiz**: a sessão anterior (mesmo dia, "ai-synthesis Camada 2")
introduziu uma técnica de propagação nova, deliberadamente escolhida por
ser "mais segura" que a de sessões anteriores pra uma mudança grande — em
vez de N substituições de string pequenas (risco de erro por arquivo), um
script localizava o fim do corpo compartilhado (`getPageEnvelopeWithCache`,
sempre a última function do arquivo canônico) em cada arquivo deployado e
substituía **tudo antes dele** pelo prefixo canônico inteiro. Isso incluía,
sem que a sessão percebesse, a **primeira linha de import** do arquivo:
`import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'` —
correta no arquivo canônico (que não tem handler, nunca chama
`createClient`), mas cada um dos 8 arquivos deployados tem, no fim das
contas, um import **combinado**
(`import { createClient, type SupabaseClient } from ...`), porque o
próprio handler HTTP de cada um chama `createClient(...)` pra montar o
client com o JWT do usuário. A substituição "prefixo inteiro" trocou esse
import combinado pelo type-only do canônico nos 8 arquivos de uma vez —
exatamente a mesma classe de bug já documentada duas vezes antes neste
arquivo ("Fase B implementada", 2026-08-02, e "`compose-narrative-synthesis`
503 em produção", 2026-08-07), só que desta vez a própria técnica
"melhorada" (pensada pra evitar erros de propagação) foi o que a
reintroduziu, de uma vez em todos os 8 arquivos ao mesmo tempo — pior que
as duas vezes anteriores, que cada uma afetou só 1 arquivo.

Verificado por `diff`/`grep` antes de aplicar o fix: os outros arquivos
`(` `{` continuavam balanceados (a substituição de string em si era
sintaticamente válida) — o erro só aparece em runtime, no primeiro request
que tenta montar o client Supabase, exatamente o tipo de bug que só um
teste real contra produção pega, não `tsc --noEmit` (Deno não é
type-checado pelo `tsconfig.json` do Next.js) nem uma checagem de balanço
de parênteses.

**Fix**: substituição de string única, aplicada aos 8 arquivos (script Node
verificado por contagem de ocorrências) — restaura o import combinado
`import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'`
nos 8, sem tocar no canônico (que continua correto como type-only).
Confirmado por uma varredura em **todo** `supabase/functions/` (não só os
8) por qualquer outro arquivo que chame `createClient(...)` mas ainda
tenha o import type-only — nenhum encontrado, os 8 eram os únicos afetados.

**Lição pra qualquer propagação futura em bloco (wholesale prefix/suffix
replace) neste arquivo**: a linha de import do topo do arquivo canônico
**nunca** deve fazer parte do prefixo copiado cegamente pros arquivos
deployados — ela é uma das poucas linhas que é *deliberadamente diferente*
entre o canônico (sem handler, só tipos) e cada cópia deployada (com
handler, precisa do valor `createClient` de verdade). Uma propagação em
bloco futura deve excluir explicitamente a(s) linha(s) de `import` do
range substituído, ou verificar depois — via `grep` em todo
`supabase/functions/`, como feito aqui — que nenhum arquivo com
`createClient(` ficou com um import só-de-tipo.

**Verificação**: `npx tsc --noEmit` limpo (mudança é Deno-only, fora do
`tsconfig.json` do Next.js). Balanço de parênteses/chaves conferido nos 8
arquivos. Sem ambiente Deno/Supabase real nesta sessão — não testado
contra produção, mesma limitação recorrente de toda sessão sem
credenciais de deploy; `git push` para `develop` é o próximo passo, e o
sinal de que funcionou é o `ReferenceError: createClient is not defined`
parar de aparecer nos logs de qualquer uma das 8 funções.

## Directory structure

```
app/(intelligence-center)/    Every authenticated page (overview, narratives,
                               sentiment, platforms, themes, admin/{users,finops},
                               perfil) — shares one shell (Sidebar/header/footer),
                               see layout.tsx; nested (analytics)/ route group adds
                               the org-required gate for the 5 analytics pages
                               plus communications/ (Sprint 2.1 — also org-scoped).
                               admin/finops (module `finops`, platform-wide, not
                               org-scoped) sits alongside admin/users, same
                               is_admin gate
app/{login,forgot-password,reset-password}/   Public auth pages, outside the shell
components/intelligence-center/   Shared UI for the 5 analytics pages (table,
                               badges, charts, widget states) — see CLAUDE.md,
                               "edge-functions-per-page.md + the 5
                               intelligence-center pages"
components/communications/    Shared UI for the `communications` module (Sprint
                               2.1) — form modal, narrative combobox, table,
                               impact timeline — see CLAUDE.md, "Módulo
                               communications (Sprint 2.1)"
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
