# Session Handover — Verocity v2

Fresh session? Read this first, then `CLAUDE.md`, `docs/SPEC.md`, `docs/ROADMAP.md`.

## Status: the app is built, live-backed, and merged to `main`

PR #3 merged the **full application** to `main`. The backend is live on Supabase and
the original v1 data is imported. **The next job is the Vercel deploy** (below) — the
user is installing the **Vercel MCP** so you can do it directly.

## YOUR NEXT TASK — deploy to Vercel + custom domain

Use the **Vercel MCP** (the user is installing it; look for `mcp__*vercel*` tools via
ToolSearch). Goal: deploy `main` and serve it at **`lift.shourjoguha.com`**.

1. Create/import a Vercel project from `shourjoguha/verocity-Multi`; Production Branch
   = `main`. Framework: **Astro** (static output). Build: `npm run build`. Output dir:
   `dist`. (No adapter — it builds to static; Vercel just serves `dist/`.)
2. Set env vars (Production + Preview). Public-safe — RLS is the security boundary:
   ```
   PUBLIC_SUPABASE_URL        = https://zwuaieavvmjacqtbzowm.supabase.co
   PUBLIC_SUPABASE_ANON_KEY   = sb_publishable_8BKfMv2rb4T52RRnzmzMyQ_Wi8-qjhp
   PUBLIC_SHOWCASE_PROFILE_ID = 8a8078c4-2aa8-4136-9e0d-5c2620b4614c
   ```
3. Deploy; confirm the build is green and `/` (landing), `/login`, `/showcase`
   (imported data, read-only) render on the `*.vercel.app` URL.
4. Add domain **`lift.shourjoguha.com`**: create a **CNAME** record `lift` →
   `cname.vercel-dns.com` at the `shourjoguha.com` DNS host (if on Cloudflare, set it
   to "DNS only"/grey-cloud so Vercel can verify). Vercel auto-issues HTTPS once DNS
   resolves.
   - Routing note: `/` is the marketing landing; `/showcase` is the public portfolio.
     If the user wants the domain to open directly on the showcase, redirect
     `/`→`/showcase` (small change in `src/pages/index.astro`).

## Already done

- **Code:** full Astro 6 + React 19 island app on `main`. Green: `npm run build`
  (15 static pages), `npm run check` (0 errors), `npm test` (56 passing). Tailwind via
  PostCSS (`postcss.config.mjs`, not the Vite plugin). `@/*` → `src/*`.
- **Backend (Supabase `zwuaieavvmjacqtbzowm`):** migrations `0001`–`0005` applied
  (`0005` = explicit shared-library write-lock). Edge functions `signup` + `share-read`
  deployed (`share-read` is public — `verify_jwt` off — and validates the token itself).
- **Data:** the v1 Lovable dump (different JSONB shape) was transformed into the v2
  `ParsedPlan` / `LogDocument` contracts and imported under a real auth account —
  82 movements (77 shared + 5 custom), 1 active plan ("16-Week Program"), 20 logs
  (302 sets). The showcase profile flag is set.
  - **Account:** email `guha.shourjo@gmail.com`, profile id
    `8a8078c4-2aa8-4136-9e0d-5c2620b4614c` ("Shourjo"). The temporary login password
    was shared with the user in chat (kept out of git on purpose) — reset after first
    login.

## Supabase MCP

`mcp__*` tools (`execute_sql`, `apply_migration`, `list_migrations`, `get_advisors`,
`deploy_edge_function`…), `project_id` = `zwuaieavvmjacqtbzowm`. New schema changes go
in a new `00NN_*.sql` via `apply_migration` (migrations are NOT idempotent). Run
`get_advisors` after any DDL.

> Pre-existing advisors (not blockers): `invites` has RLS enabled with no policies
> (intentional — service-role only); `public.rls_auto_enable()` SECURITY DEFINER is
> callable by anon/authenticated (added out-of-band, not in our migrations — review
> before relying on it); Auth leaked-password protection is off (optional toggle).

## Local `.env` (gitignored — recreate on a fresh clone)

```
PUBLIC_SUPABASE_URL=https://zwuaieavvmjacqtbzowm.supabase.co
PUBLIC_SUPABASE_ANON_KEY=sb_publishable_8BKfMv2rb4T52RRnzmzMyQ_Wi8-qjhp
PUBLIC_SHOWCASE_PROFILE_ID=8a8078c4-2aa8-4136-9e0d-5c2620b4614c
```

(DB password and service-role key are not in the repo; the service-role key is
auto-injected into edge functions.)

## Still open (optional)

- **Apply migration `0008_sessions.sql`:** the Sessions library (saved workout
  templates) needs this migration applied to the live DB — it adds the
  `sessions` table (+ owner/anon-showcase RLS) and `workout_logs.session_id`.
  Additive and non-destructive. Apply via `apply_migration`, then run
  `get_advisors`. Until applied, `/app/sessions` and the "Saved sessions" group
  read an empty list and saving fails.
- **Browser click-through:** the interactive flows (Logger, plan editor, export, share
  links) are typecheck/test/build-verified only — exercise them once on the live URL.
- **Invites:** insert sha-256 `code_hash` rows into `invites` if other people should be
  able to sign up (the owner already has an account).
- **AI (Phase 5):** DEFERRED — do not build without an explicit go-ahead (CLAUDE.md).

## Environment note

This cloud session's network policy blocks direct egress (Supabase REST/functions and
the general internet return "Host not in allowlist"); the **only** path to Supabase is
the MCP, and the Vercel MCP will be the path for deploy. Browser-based UI testing is
not possible from inside this environment.

## Commands

`npm run dev` · `npm run build` · `npm run check` (astro check) · `npm test` (vitest).
