# Session Handover — Verocity v2

Read this first if you're a fresh session, then `CLAUDE.md`, `docs/SPEC.md`,
and `docs/ROADMAP.md`. Changes are committed on a working branch and opened as a
PR (this environment provisions a per-task branch).

## Current state (the important part)

The backend is **live**. The previous "couldn't reach Supabase" blocker is gone:
a Supabase MCP is loaded and the schema, RLS, and edge functions are deployed
against project `zwuaieavvmjacqtbzowm`.

- **Migrations 0001–0005 applied** (`list_migrations` to confirm):
  - `0001_init` schema · `0002_rls` policies · `0003_harden_function_search_path`
  - `0004_rls_initplan_perf` — wraps `auth.uid()` in `(select auth.uid())`
  - `0005_lock_shared_library` — makes the shared-library write-lock explicit
    (`owner_user_id IS NOT NULL AND owner_user_id = (select auth.uid())`)
- **Edge functions deployed:** `signup` (invite redeem) and `share-read`
  (`verify_jwt = false` — it's public and validates the share token itself).
- Migrations are **not idempotent** (`create table` without `if not exists`), so
  never re-apply 0001/0002 on a populated DB. New changes go in a new
  `00NN_*.sql` file applied via `apply_migration`.

## Supabase MCP

Look for `mcp__*` tools (`execute_sql`, `apply_migration`, `list_tables`,
`get_advisors`, `list_migrations`, `deploy_edge_function`). Use ToolSearch
(`+supabase` or `select:...`) to load their schemas. `project_id` is
`zwuaieavvmjacqtbzowm`. Run `get_advisors` after any DDL.

> Known pre-existing advisors (not from recent work): `invites` has RLS enabled
> with no policies (intentional — service-role only); a `public.rls_auto_enable()`
> SECURITY DEFINER function is executable by anon/authenticated (added
> out-of-band; not in our migrations — review before relying on it).

## Local `.env` (gitignored — recreate on a fresh clone)

Values are public-safe (publishable key; RLS is the boundary):

```
PUBLIC_SUPABASE_URL=https://zwuaieavvmjacqtbzowm.supabase.co
PUBLIC_SUPABASE_ANON_KEY=sb_publishable_8BKfMv2rb4T52RRnzmzMyQ_Wi8-qjhp
PUBLIC_SHOWCASE_PROFILE_ID=
```

(DB password and service-role key are NOT in the repo by design; the service-role
key is auto-injected into edge functions.)

## What's built

- **Phases 0–3 complete; Phase 4 in progress.** Read paths + showcase, the
  Logger write path, plan authoring (parser + edit mode), View Transitions, PWA
  shell. See `docs/ROADMAP.md` for the per-phase checklist.
- **Recently added (this branch):** custom-movement CRUD in the Library (shared
  library stays read-only), plan **phase-band editing** in the plan editor,
  **data export** (JSON full backup + flattened CSV), and the **share-link UI**
  (`/app/shares` to mint/revoke; public read-only `/share?token=…`). Dead
  `logBuilder.addMovement` removed.
- Stack: Astro 6 + React 19 islands, Tailwind 4 via **PostCSS** (`postcss.config.mjs`,
  not `@tailwindcss/vite` — rolldown incompat). `@/*` → `src/*`. Static output.

## Remaining work / blockers (need the user)

- [ ] **Original Lovable data import** — IN PROGRESS. User supplied a public-schema
      data dump + table schema (CSV). Still need the **v2 auth user id** to remap
      `owner_user_id` onto before inserting. Verify JSONB shapes match the
      `ParsedPlan` / `LogDocument` contracts (SPEC §8) before loading.
- [ ] `PUBLIC_SHOWCASE_PROFILE_ID` chosen + set (local `.env` + Vercel) once a
      showcase profile exists.
- [ ] Invite code(s) inserted (sha-256 `code_hash`) so signup is usable.
- [ ] Vercel project linked (`PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY`).
- [ ] Phase 4 leftovers: self-host fonts (needs licensed Clash Display + Satoshi
      files), client realtime subscription on `workout_logs`.
- Phase 5 AI: **DEFERRED** — do not build without explicit go-ahead (CLAUDE.md).

## Commands

`npm run dev` · `npm run build` · `npm run check` (astro check) · `npm test`
(vitest). All currently green (56 tests).
