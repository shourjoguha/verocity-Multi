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

## External blockers

**None.** All cleared: Supabase provisioned and migrated, v1 data imported, the
showcase profile flagged, and Vercel deploying `main` to `lift.shourjoguha.com`.
Operational detail lives in `docs/HANDOVER.md`.


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
- [x] Plan edit mode (`/app/plan/edit`): inline-edit title/labels/movements/sections + per-week cells, drag handles + up/down reorder for days & exercises, add/delete, "+ Week", debounced autosave. Pure helpers in `lib/planEdits.ts` (unit-tested); `dayKey` stays stable across renames. Block-phase editing (add/remove/type/week-range) now exposed in the editor (unit-tested).
- verify: ✓ parser + planEdits unit-tested; check/build clean. updatePlan save path
  verified against the live DB.

### Phase 4 — Polish  `[done]`
- [x] Astro View Transitions (ClientRouter)
- [x] PWA install shell (manifest, SVG icons, network-first app-shell service worker) + a11y/perf pass (skip link, `<main>`, nav `aria-current`, focus-visible, `prefers-reduced-motion`, font preconnects)
- [x] Enhancements from SPEC §10: custom-movement CRUD in Library (shared library read-only), data export (JSON full backup + flattened CSV), share-link UI (`/app/shares` mint/revoke + public read-only `/share?token=`)
- [x] Client realtime subscription on `workout_logs` (Home re-fetches on change)
- [ ] Self-host fonts — still outstanding, needs licensed font files
- verify: ✓ check/build clean; deployed and in daily use on a phone.

### Phase 5 — AI  `[partly done]`
- [x] **Coach** — on-demand Supabase Edge Function (`supabase/functions/coach`),
  not the scheduled Railway service originally planned. Drift signals from the
  caller's own logs → Claude → `recommendations`. UI at `/app/coach`; claim
  bounds in `lib/deepGovernors.ts`. See SPEC §12.
- [ ] parse-plan Edge Function — not built. `lib/planTemplate.ts` gives the user
  a copyable authoring prompt instead, and the strict local parser stays the
  only ingest path.

### Phase 6 — Beyond the original  `[shipped, unplanned]`
Built after the roadmap above was written, so it has no phase entry of its own:
Garmin integration (`garmin-connect` / `garmin-ingest`, `GarminPanel`), heart
rate and fitness assessments, library subroutines, PR detection, the three-way
theme toggle, `/app/settings`, and the mobile UX pass (bottom tab bar, set-entry
sheet, 44px targets) with its two standing audits.

### Phase 7 — Guidance upkeep  `[ongoing]`
`npm run audit:docs` fails if the docs name code that no longer exists. It was
added after a five-PR bug hunt that these documents actively misdirected; see
`docs/LESSONS.md` § Superseded for the full account.
