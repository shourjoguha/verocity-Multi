# Operations — Verocity v2

Environment, backend and deploy facts. **Start at `CLAUDE.md`**, not here — this
document used to open with "Fresh session? Read this first" and a task list that
was two months stale, which meant a fresh agent's first instruction was to
redo a deploy that had already happened.

Nothing in this file describes *current work*. Sequence and status live in
`docs/ROADMAP.md`; traps live in `docs/LESSONS.md`.

## Commands

| | |
|---|---|
| `npm run dev` | Astro dev server |
| `npm run build` | static build to `dist` |
| `npm run check` | `astro check` (types) |
| `npm test` | vitest |
| `npm run audit:mobile` | overflow + tap targets, every `/app` route |
| `npm run audit:flicker` | sheet open/close behaviour |
| `npm run audit:shell` | the app shell: document must not scroll, bottom bar not viewport-anchored |
| `npm run audit:docs` | code identifiers in the docs still resolve |

The three audits need a build and a running preview:
`npm run build && npm run preview &`. **Restart preview after every rebuild** —
`astro preview` serves a startup snapshot (see `docs/LESSONS.md` § Testing).

## Deploy

Vercel, production branch `main`, framework Astro, static output to `dist`, no
adapter. Served at `lift.shourjoguha.com`. Pushing to `main` deploys; every PR
gets a preview URL.

**Test an installed-PWA bug on the preview URL, not the installed app.** A fresh
origin has no service worker, so it cannot serve you a stale build — which is
otherwise a real way to conclude a fix failed when it simply never shipped
(`docs/LESSONS.md` § Caching).

## Supabase

Project `zwuaieavvmjacqtbzowm`. Public-safe env vars — RLS is the security
boundary, so these are meant to be in the client bundle:

```
PUBLIC_SUPABASE_URL=https://zwuaieavvmjacqtbzowm.supabase.co
PUBLIC_SUPABASE_ANON_KEY=sb_publishable_8BKfMv2rb4T52RRnzmzMyQ_Wi8-qjhp
PUBLIC_SHOWCASE_PROFILE_ID=8a8078c4-2aa8-4136-9e0d-5c2620b4614c
```

Recreate these in a local `.env` on a fresh clone (gitignored). The DB password
and service-role key are not in the repo; the service-role key is auto-injected
into edge functions.

**Schema changes:** a new numbered file in `supabase/migrations/`, applied via
the Supabase MCP's migration tool. **Migrations are NOT idempotent** — never
edit one that has been applied. Run the advisors check after any DDL.

Edge functions: `signup`, `share-read` (public, `verify_jwt` off, validates its
own token), `coach`, `garmin-connect`, `garmin-ingest`.

Known advisors, none blocking: `invites` has RLS on with no policies
(intentional — service-role only); `public.rls_auto_enable()` is SECURITY
DEFINER and callable by anon/authenticated (added out-of-band, review before
relying on it); auth leaked-password protection is off.

## Account

Owner profile `8a8078c4-2aa8-4136-9e0d-5c2620b4614c` ("Shourjo"), email
`guha.shourjo@gmail.com`, flagged as the showcase profile. Signup is
invite-gated: insert sha-256 `code_hash` rows into `invites` to let anyone else
register.
