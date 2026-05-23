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

- [ ] Supabase project provisioned; `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` supplied.
- [ ] Migrations applied to the Supabase project (`supabase db push` or SQL editor).
- [ ] `SHOWCASE_PROFILE_ID` chosen and set once a showcase profile exists.
- [ ] Vercel project linked for deploy.

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

### Phase 1 — Read paths + showcase  `[ ]`
- [ ] Base layout, design-system primitives, nav
- [ ] Home dashboard (read), Calendar, Stats, Library (read), Plan view, session detail
- [ ] Data-access layer (typed Supabase queries) + graceful empty states
- [ ] Public showcase routes (`/showcase/*`) using anon client
- verify: pages render with empty/seed data; showcase is read-only

### Phase 2 — Logger (core write path)  `[ ]`
- [ ] Logger island: sections/groups/sets, completion, autosave (15s)
- [ ] WeightWheel, RepsStepper, voice input, rest timers, stopwatch
- [ ] Grouping, metric swap, movement swap/add/remove, substitution memory
- [ ] VibeCheck, custom (plan-less) workouts, ActivityLogger
- verify: full session can be created/edited/finished against DB

### Phase 3 — Plan authoring  `[ ]`
- [ ] PlanUpload strict markdown parser + preview + save/activate
- [ ] Plan edit mode (reorder, inline edit, add via library, delete, autosave)
- [ ] Adopt a shared/public plan (copy into own account)
- verify: paste markdown → parsed plan → saved → visible in Plan view

### Phase 4 — Polish  `[ ]`
- [ ] Astro View Transitions, micro-interactions
- [ ] PWA install shell, perf pass, accessibility
- [ ] Enhancements from SPEC §10 (export, etc. as scoped)
- verify: lighthouse/a11y pass; transitions smooth

### Phase 5 — AI  `[DEFERRED — do not build without explicit go-ahead]`
- parse-plan Edge Function; recommendations coach (Railway). See SPEC §12.
