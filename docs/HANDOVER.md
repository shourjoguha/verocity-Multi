# Session Handover — Verocity v2

Read this first if you're a fresh session. Then read `CLAUDE.md`,
`docs/SPEC.md`, and `docs/ROADMAP.md`. Work happens directly on `main`
(commit + push to `main`).

## Why this doc exists

The previous session built Phases 0–3 (core) but **could not reach Supabase**
from the sandbox (egress allowlist blocks the project host; the direct DB host
is IPv6-only and doesn't resolve here). So nothing is verified against a live
database except the plan parser (vitest). A Supabase MCP was configured
(`.mcp.json`) to bring the backend up from a session where it's loaded.

## First actions in the new session

1. **Confirm the Supabase MCP loaded.** Look for `mcp__*` tools like
   `execute_sql`, `apply_migration`, `list_tables` (use ToolSearch:
   `+supabase` or `execute_sql apply_migration list_tables`). The server is in
   `.mcp.json` → `mcp.supabase.com`, `project_ref=zwuaieavvmjacqtbzowm`,
   features `docs,database,debugging,functions,storage`. Approve it if prompted.
   - If the MCP is NOT present, the fallback is: user applies SQL in the
     Supabase SQL Editor and verifies via a Vercel deploy.
2. **Recreate the local `.env`** (it's gitignored, so a fresh clone won't have
   it). Values are public-safe (anon/publishable key; RLS is the boundary):
   ```
   PUBLIC_SUPABASE_URL=https://zwuaieavvmjacqtbzowm.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=sb_publishable_8BKfMv2rb4T52RRnzmzMyQ_Wi8-qjhp
   PUBLIC_SHOWCASE_PROFILE_ID=
   ```
   (DB password and service-role key are NOT in the repo by design. The user is
   rotating the DB password; ask for the current one only if a tool needs it.)

## Backend bring-up checklist (via MCP)

1. **Check whether the schema already exists** (`list_tables`, or
   `execute_sql`: `select table_name from information_schema.tables where
   table_schema='public'`). The migrations are NOT idempotent (`create table`
   without `if not exists`), so only apply if the tables are absent — the user
   may have already run them in the SQL Editor.
2. **If absent, apply migrations in order:** `supabase/migrations/0001_init.sql`
   then `supabase/migrations/0002_rls.sql` (read the files, apply via
   `apply_migration`/`execute_sql`).
3. **Seed a showcase + data to verify:**
   - Create an auth user (Supabase dashboard or `signup` edge fn), insert its
     `profiles` row, set `is_showcase = true` on one profile.
   - Put that profile's id in `PUBLIC_SHOWCASE_PROFILE_ID` (local `.env` + Vercel).
   - Optionally seed a few shared movements (`owner_user_id IS NULL`) for Library.
4. **Verify the boundary (SPEC §6, Risks §16):** confirm anon can read ONLY the
   showcase profile's rows + shared library; confirm a non-owner can't read/write
   another user's rows; confirm authed user can CRUD only their own rows.
5. **Deploy edge functions** (`supabase/functions/signup`, `share-read`). They
   need `SUPABASE_SERVICE_ROLE_KEY` as a function secret. `signup` redeems an
   `invites` row (insert invite codes as sha-256 `code_hash`).

## Vercel

Set env vars **`PUBLIC_SUPABASE_URL`** and **`PUBLIC_SUPABASE_ANON_KEY`**
(Astro needs the `PUBLIC_` prefix — `NEXT_PUBLIC_*` won't be read). Build is
static (`astro build` → `dist/`).

## What's built (see ROADMAP for detail)

- **Phase 0** foundations · **Phase 1** all read paths + showcase · **Phase 2
  core** Logger · **Phase 3 core** plan parser (tested) + PlanUpload + adopt.
- Stack: Astro 6 + React 19 islands, Tailwind 4 (PostCSS), `@supabase/supabase-js`.
  Tailwind uses PostCSS (`postcss.config.mjs`), NOT `@tailwindcss/vite` (rolldown
  incompat). `@/*` → `src/*`.

## Remaining work

- Phase 2 extras: voice input, supersets/circuits grouping, metric swap, movement
  swap/add/remove via library, substitution suggestions (`bump_movement_sub`),
  VibeCheck on start, ActivityLogger.
- Phase 3: Plan edit mode (drag-reorder, inline edit, add/delete, autosave).
- Phase 4: Astro View Transitions, PWA install shell, perf, a11y.
- Phase 5 AI: DEFERRED — do not build without explicit go-ahead (CLAUDE.md).
- Suggested: add unit tests for `e1rm`, `week`, `logBuilder.parsePlanned`, `stats`.

## Commands

`npm run dev` · `npm run build` · `npm run check` (astro check) · `npm test`
(vitest). All currently green.
