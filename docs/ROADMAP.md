# Verocity v2 — Build Roadmap (living tracker)

Companion to `docs/SPEC.md`. Tracks phase status and records decisions made
while building. Update as work lands.

## Decisions locked while building (resolving SPEC §15 open questions)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Showcase rendering | Static shell + client-side read-only fetch | Zero Vercel compute (SPEC §5 default). SSR can be added per-route later if SEO matters. |
| 2 | Plan adoption | Share-link path now; `is_public` column in schema | Build the explicit-share flow; marketplace is a later flip of one flag. |
| 3 | PWA / offline | Installable PWA shell, no offline-first sync in v1 | Offline log sync is a large state-design cost; defer to Phase 4+. |
| 4 | Units | kg-only, config-driven | Matches original; `app.config.ts` holds the unit so a toggle is additive. |
| 5 | Auth method | Email + password, invite-gated | Deterministic to build/test; magic-link is an additive Supabase option. |

> Note: no original codebase is present in this repo. Everything is built from
> `docs/SPEC.md` descriptions, not ported from source.

## External blockers (need the user)

- [x] Supabase project provisioned (`zwuaieavvmjacqtbzowm`); `PUBLIC_*` keys supplied. Service-role key is auto-injected into Edge Functions.
- [x] Migrations applied to the Supabase project — `0001`–`0004` applied via MCP; RLS boundary verified; edge functions deployed; shared library seeded; authed data paths verified with a (since-deleted) test user.
- [ ] `SHOWCASE_PROFILE_ID` chosen and set once a showcase profile exists.
- [ ] Invite code(s) inserted (sha-256 `code_hash`) so signup is usable.
- [ ] Original Lovable data imported (waiting on a dump from the source DB; egress to it is blocked from the build sandbox).
- [ ] Vercel project linked for deploy (`PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` as build env).


## Phases

### Phase 0 — Foundations  `[done]`
- [x] Astro 6 + React 19 islands + TS strict scaffold
- [x] Tailwind v4 (PostCSS pipeline) + design tokens (HSL) per SPEC §11
- [x] `app.config.ts` (blocks, sections, metrics, RPE, timers, tags+colors, families, touch tunables, units)
- [x] `src/lib/types.ts` (domain types, `ParsedPlan`, `LogDocument`)
- [x] Supabase client (`src/lib/supabase.ts`), `.env.example`
- [x] `supabase/migrations` — schema (0001) + RLS (0002) (SPEC §8)
- [x] Edge functions: `signup` (invite redeem), `share-read`
- [x] `astro check` + `astro build` green (0 errors)
- verify: ✓ build + check pass. NOTE: SQL migrations are written but not yet
  applied/verified against a live Postgres (no DB available in this env).

### Phase 1 — Read paths + showcase  `[done]`
- [x] Base + App layouts, design-system primitives, nav, landing
- [x] Data-access layer (`src/lib/queries.ts`) relying on RLS scoping
- [x] Domain utils: e1RM (Brzycki), week-from-date, formatters, stats, tags
- [x] Auth: login page + session handling; client-side `/app` guard (`useAuthedQuery`)
- [x] Home dashboard (read): inline stats, active plan, recent sessions + set-shape strips
- [x] Public showcase route (`/showcase`) via session-less anon client
- [x] Calendar (month grid + per-session bars, click → session detail)
- [x] Stats (summary, consistency heatmap, weekly table, RPE-by-family, top movements e1RM)
- [x] Library (browse/search/filter movements)
- [x] Plan view (week-by-week progression table with block markers)
- [x] Session detail page (`/app/session?id=`)
- verify: ✓ build (9 pages) + check clean (0/0/0); all routes serve SSR'd shells
  (curl 200). NOTE: e1RM sparkline trend deferred to polish; live data needs
  Supabase env.

### Phase 2 — Logger (core write path)  `[done]`
- [x] Logger island: sections/items/sets, completion, autosave (15s)
- [x] WeightWheel (drag-scrub), RepsStepper, inline RPE, rest countdown, session stopwatch
- [x] Build from plan day (`logBuilder`) + last-performance prefill; custom (blank) session
- [x] Create/resume/finish/cancel session; write mutations (`createLog`/`updateLog`)
- [x] Entry points: dashboard "Start workout" + per-day "Start" in Plan view
- [x] Voice input (Web Speech, feature-detected; parser unit-tested), grouping (superset/circuit merge/ungroup + kind toggle), metric swap
- [x] Movement swap/add/remove via library picker, substitution suggestions (`bump_movement_sub` RPC + getMovementSubs)
- [x] VibeCheck on start, ActivityLogger (`/app/activity`, lightweight non-strength)
- verify: ✓ check/build clean; pure edit logic in `lib/logEdits.ts`. Authed write
  path (create/update log, RPC) verified against the live DB via role simulation.

### Phase 3 — Plan authoring  `[done]`
- [x] Strict markdown plan parser (`planParser.ts`) → ParsedPlan
- [x] **Unit tests for the parser (6 passing — vitest)** ← genuinely verified
- [x] PlanUpload: paste markdown → Parse → preview → Save & activate
- [x] Adopt a shared/public plan (`adoptPlan` + `?adopt=<id>`) and `createPlan`
- [x] Plan edit mode (`/app/plan/edit`): inline-edit title/labels/movements/sections + per-week cells, drag handles + up/down reorder for days & exercises, add/delete, "+ Week", debounced autosave. Pure helpers in `lib/planEdits.ts` (unit-tested); `dayKey` stays stable across renames. (Block-phase editing not yet exposed.)
- verify: ✓ parser + planEdits unit-tested; check/build clean. updatePlan save path
  verified against the live DB.

### Phase 4 — Polish  `[in progress]`
- [x] Astro View Transitions (ClientRouter)
- [x] PWA install shell (manifest, SVG icons, network-first app-shell service worker) + a11y/perf pass (skip link, `<main>`, nav `aria-current`, focus-visible, `prefers-reduced-motion`, font preconnects)
- [ ] Enhancements from SPEC §10 (export, etc. as scoped); self-host fonts; client realtime subscription on `workout_logs` (DB is realtime-enabled, client not yet subscribing)
- verify: ✓ check/build clean; dev server serves all routes 200. Lighthouse/a11y +
  install + offline shell need a real browser/deploy to confirm.

### Phase 5 — AI  `[DEFERRED — do not build without explicit go-ahead]`
- parse-plan Edge Function; recommendations coach (Railway). See SPEC §12.
