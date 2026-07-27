---
name: db-change
description: Owns every backend change in Verocity — Postgres schema and migrations, RLS policies, Supabase edge functions, auth and signup gating, share tokens, and the data-access layer (queries.ts, supabase.ts, DB row types). Use when adding or altering a table, column, index, policy or function, when changing what a role can read or write, or when deploying/editing an edge function. Do NOT use for components, CSS, tokens or layout — that is the ui-change skill.
---

# Database and backend changes

**RLS is the security boundary.** The anon key is public and ships in the
client bundle by design; the UI enforces nothing. Every rule below follows from
that.

## Read first

- `docs/SPEC.md` §6 (auth & access) and §8 (data model, JSONB documents, RLS).
- `docs/HANDOVER.md` § Supabase — project ref, env vars, known advisors.
- `supabase/migrations/0002_rls.sql` and `0004_rls_initplan_perf.sql` are the
  canonical policy references. Copy their shape.

## What you own

| | |
|---|---|
| Schema | `supabase/migrations/**` |
| Edge functions | `supabase/functions/**` |
| Data access | `src/lib/queries.ts`, `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/share.ts` |
| Row types | the DB-row half of `src/lib/types.ts` |

**You never touch** components, `src/styles/global.css`, design tokens or
layout. If the task needs a UI change, stop and hand off.

## Migration discipline

- One new file per change: `NNNN_snake_case_description.sql`, 4-digit
  sequential (not timestamps). Current head is
  `supabase/migrations/0016_library_subroutines.sql`.
- **Migrations are NOT idempotent. Never edit one that has been applied.**
  A correction is a new migration.
- Apply through the Supabase MCP `apply_migration` tool, then **run the
  advisors check** (`get_advisors`) — it is the standing check for this
  surface, the way the audits are for the UI.
- **A migration file that was never applied is not a schema change**, and a
  schema change applied without a migration file means a fresh clone cannot
  rebuild the database. Both halves, every time.

> The MCP server may be unauthorized in a given session. If it is, you can
> author the migration file but you **cannot** apply it — say exactly that
> rather than reporting the schema changed. Authorization happens in an
> interactive session or the claude.ai connector settings.

## RLS patterns

Every new table gets `enable row level security` plus explicit per-role
policies. There is no default-allow.

- **Naming:** `<table_abbrev>_<verb>_<audience>` — `logs_select_auth`,
  `logs_insert_own`, `plans_select_anon`, `sessions_delete_own`, `recs_*`,
  `fa_*` (fitness_assessments).
- **Always name the role**: `to authenticated` / `to anon`.
- **Owner predicate:** `owner_user_id = (select auth.uid())` — on `using` for
  reads/updates/deletes, on `with check` for inserts and updates.
  **The `(select ...)` wrapper is mandatory.** It forces an InitPlan so the
  check evaluates once per query instead of once per row; `0004` retrofitted it
  across every policy and every migration since preserves it. `profiles` uses
  `id = (select auth.uid())` because the PK is the user id.
- **Anon is SELECT-only**, and only through the stable SQL function
  `public.showcase_profile_id()`:
  `owner_user_id = (select public.showcase_profile_id())`. The shared movement
  library (`owner_user_id is null`) is the single ambient cross-user read that
  exists.
- **Deny-all = RLS on with zero policies** (`invites`,
  `garmin_connections`). Service-role only. If a subset must be readable,
  expose it through a non-`security_invoker` view with an explicit
  `grant select ... to authenticated`, as `garmin_connection_status` does.
- **Cross-user reads are explicit**, via read-only share tokens resolved by the
  `share-read` edge function with the service-role key. Never grant an ambient
  cross-profile read.
- Pin `search_path = ''` on any new SQL function (see `0003`).

## Types are hand-maintained

There is **no generated types file** and no `Database` generic —
`src/lib/types.ts` is a manual mirror, and says so:
`// ---- DB row types (mirror supabase/migrations) ----`. Query results are
hand-cast. Any DDL that adds or changes a column updates that file **in the
same change**, or the mirror silently lies.

## Data-access conventions

`src/lib/queries.ts` is the single DAL. Match it:

- Reads take `client: SupabaseClient = supabase` as the **last** argument, so
  showcase paths can pass `supabasePublic` (a session-less client that always
  resolves to the `anon` role, even for a signed-in viewer).
- Writes resolve the owner via `supabase.auth.getUser()` and inject
  `owner_user_id` themselves. Never trust a caller-supplied owner.
- Reads that islands consume go through `src/lib/useAuthedQuery.ts`; the
  module-level cache in `src/lib/queryCache.ts` is cleared on sign-out.

## Edge functions

Current roster: `signup`, `share-read` (public, `verify_jwt` off, validates its
own token), `coach`, `garmin-connect`, `garmin-ingest`.

- Deploy via the MCP `deploy_edge_function` tool.
- **Never ship the service-role key to the client.** It lives only in edge
  function env, auto-injected by Supabase.
- Prefer the caller's own JWT with the anon key when the function only needs
  the caller's data — `coach` does this deliberately, so RLS still applies.
  Reach for service-role only when crossing users (`share-read`) or writing
  deny-all tables (`garmin-ingest`).
- `coach` must keep degrading to `{ok:false,error:'no_key'}` at HTTP 200 when
  `ANTHROPIC_API_KEY` is unset, so the client falls back to `src/lib/coach.ts`.
  Governors in `src/lib/deepGovernors.ts` are enforced in the UI regardless of
  what the model returns — never trust the model's output shape.
- If the roster changes, update the list in `docs/HANDOVER.md`.

## The boundary

Four files are shared with the UI owner. You lead on all four; the UI adapts.

| File | Rule for you |
|---|---|
| `src/lib/types.ts` | Yours for DB rows. `ParsedPlan` and `LogDocument` are frozen JSONB contracts (`plans.parsed`, `workout_logs.data`) — changing either is a two-owner change. |
| `src/lib/queries.ts` | You own the signatures. Changing one means auditing its call sites. |
| `src/app.config.ts` | Domain truth read by both sides. |
| `src/lib/planTemplate.ts` | **Hard handoff.** Any change to plan structure, blocks, sections, metrics or units must move the CSV/TSV wireframe, the AI authoring prompt, the compatibility checker in `PlanUpload.tsx` and the tests together. `validateParsedPlan` is the gate before save and is never bypassed. |

A change touching a boundary file is not done until `npm test` **and** the
relevant UI audit have both run.

## Verify

```
npm run check
npm test
```

Then, through the MCP: `list_migrations` and `list_tables` to confirm the
migration actually landed, an `execute_sql` spot check that the `anon` role
sees only what it should, and `get_advisors` after any DDL.

**Say what you did not check.** Nothing on this list can see a UI regression —
if your change touched a query signature or a shared type, the UI audits are
the check that observes that symptom, and they are not run here.

Then run the `docs-upkeep` skill if this cost you more than twenty minutes or
you were wrong before you were right.
