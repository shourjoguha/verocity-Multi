# Verocity v2 — Build Specification

> Status: **built and shipped.** This is the design record, not a plan. Where it
> describes intent and the code disagrees, the code wins — check
> `docs/LESSONS.md` before assuming a section here is current.
> Hard rules live in `CLAUDE.md` and are not restated here.

---

## 1. Vision

Rebuild Verocity — a strength/training logger — as a faster, better-looking,
multi-profile app with a public **view-only showcase**. Keep the distinctive
Swiss-minimalist identity but elevate the visuals and motion, run nearly all
compute off Vercel (to preserve free-tier headroom for other apps), and put real
per-profile auth in front of the data so the read-only guarantee is enforced by
the database, not the UI.

"Modeled after the original" = **feature parity baseline, then enhance.** The
original's full feature inventory is captured in §9; v2 enhancements in §10.

---

## 2. Constraints (non-negotiable)

- **Vercel free tier must stay light.** Vercel should mostly serve static assets.
  Push DB, auth, realtime, and any server compute to Supabase / Railway so we can
  keep adding apps to the same Vercel account without exhausting function
  invocations or bandwidth.
- **View-only profile must be truly read-only** — no path to write the DB, served
  fast at/near the edge.
- **Scale target: < 100 profiles.** Small, known user set. This permits an
  invite-gated signup without heavy multi-tenant machinery.
- **No vendor lock-in we can't escape.** Supabase is plain Postgres underneath;
  data is portable.

---

## 3. Decisions (LOCKED)

| Area | Decision |
|---|---|
| Frontend | **Astro + React islands.** Static-first HTML; React islands only for interactive screens (Logger, Stats, pickers). |
| Data/Auth/Realtime | **Supabase** (Postgres + Auth + RLS + Realtime + Edge Functions). |
| Heavy jobs | **Railway**, only where Supabase Edge Functions fall short (e.g. future scheduled "coach" engine). Not needed for the core app. |
| Auth | **Real per-profile auth** (Supabase Auth) + a **public read-only role** for the showcase profile. RLS enforces read-only server-side. |
| Visibility | **Private by default** — each profile reads only its own data. Cross-user access is explicit, via **share links** (read-only tokens). |
| View-only | **Both**: one always-on **public showcase** profile *and* **per-profile share links** for any profile/plan/log. |
| Signup | **Invite codes** — new profiles require a valid code (caps at <100). |
| Visual | **Keep & elevate** the Swiss-minimalist identity (no fresh redesign). |
| AI | **Deferred to later phases.** Build the core logging app first; plan-parsing and the recommendations "coach" come later (see §12). |
| Hosting | Astro static/edge output on **Vercel**; Supabase managed; Railway optional. |

---

## 4. Target Architecture


```
                         ┌─────────────────────────────┐
   Browser (PWA)         │  Vercel (static + edge)     │
   ───────────────       │  Astro build output         │
   Astro pages    ◄──────┤  - static HTML/CSS/JS        │
   + React islands       │  - tiny edge SSR (optional)  │
        │                └─────────────────────────────┘
        │  supabase-js (authed user key  OR  anon read-only key)
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Supabase                                                  │
   │  - Postgres (RLS-enforced)                                 │
   │  - Auth (email magic-link / password)                      │
   │  - Realtime (workout_logs)                                 │
   │  - Edge Functions (Deno) — future: parse-plan, coach hooks │
   └──────────────────────────────────────────────────────────┘
        ▲ (future, only if needed)
        │  scheduled / long-running jobs
   ┌──────────────┐
   │  Railway     │  future: recommendations engine, cron
   └──────────────┘
```



**Key principle:** the browser talks **directly to Supabase**. Vercel does no
per-request DB work for the authenticated app, so authenticated usage costs
Vercel ~nothing beyond static hosting.

---

## 5. Resource Budget — keeping Vercel light

- **Authenticated app:** pure static Astro shell + client islands → Supabase.
  **Zero Vercel functions** on the hot path.
- **View-only showcase:** default to **static shell + client-side read-only
  Supabase fetch** (zero Vercel compute). Upgrade *specific* pages to Vercel Edge
  SSR only if SEO/social-preview of showcase data becomes a goal (see Open Q).
- **Images/assets:** ship optimized at build (Astro asset pipeline), avoid
  Vercel Image Optimization (it bills against the free tier).
- **AI / heavy work:** Supabase Edge Functions or Railway — never Vercel.

---

## 6. Auth & Access Model

This is the biggest upgrade over the original (which had *no* real auth — a single
shared key plus a name picker, with fully-open RLS).

### Roles
1. **Authenticated profile** — a real Supabase Auth user. One `auth.users` row ↔
   one `profiles` row. Owns their plans/logs/movements.
2. **Anonymous / public (view-only)** — uses the Supabase **anon** key. RLS grants
   it `SELECT` **only** on the designated showcase profile's rows, and **no**
   insert/update/delete anywhere.
3. **Share-link holder** — anyone presenting a valid, non-expired read-only token
   (see §7). Gets read-only access to exactly the shared resource.

### Signup gating (caps at < 100) — LOCKED: invite codes
- Signup requires a valid **invite code** (an `invites` row; repurposes the old
  `app_settings` global-key idea). Without a valid code, no profile is created.
  Code redemption happens in a signup Edge Function (service-role), not the client.

### Visibility policy — LOCKED: private by default
- **Reads (authenticated):** **own rows only** (`owner_user_id = auth.uid()`).
  No implicit cross-user visibility.
- **Writes (authenticated):** own rows only. → Real per-profile protection.
- **Cross-user access is explicit**, granted through **share links** (§7), never
  ambient. This replaces the original's communal model.
- **Shared movement library** (`movements` with `owner_user_id IS NULL`) remains
  readable by all authenticated users — it's curated reference data, not personal.
- **Anonymous:** `SELECT` restricted to `owner_user_id = <SHOWCASE_PROFILE_ID>`;
  everything else denied.

> Consequence: the original's "adopt another user's plan" feature now flows through
> an explicit share (or an opt-in `is_public` plan), not ambient browsing — see §10.

---

## 7. View-Only / Edge Strategy  (LOCKED: both)

Two read-only surfaces:

### A. Public showcase (always-on, one designated profile)
A new visitor can browse **everything** on the showcase profile (plan, calendar,
stats, session detail) but cannot edit or write.
- **Enforcement:** anon Supabase key + SELECT-only RLS scoped to
  `owner_user_id = <SHOWCASE_PROFILE_ID>`. The DB refuses any write.
- **Routing:** dedicated public routes, e.g. `/showcase/*` (or a subdomain), that
  never mount edit affordances and use the anon client.
- **Rendering (default):** static Astro shell + client-side read-only fetch → zero
  Vercel compute, fast, cacheable. Optional Vercel Edge SSR per route if SEO /
  social previews matter (open Q §15).
- **Live**, reading current DB via the read-only key (safe to expose; RLS is the
  boundary).

### B. Per-profile share links (any profile, opt-in)
Any authenticated profile can mint a **read-only share token** for their whole
profile, a single plan, or a single log.
- **Model:** a `shares` row holds `token_hash`, `owner_user_id`, `scope`
  (`profile|plan|log`), `resource_id`, `expires_at`, `revoked`.
- **Read path:** `/share/:token` → a Supabase **Edge Function** (`share-read`)
  validates the token (hash + not expired/revoked) and returns the scoped data via
  **read-only SELECTs** (service-role, but the function only ever reads). Keeps
  Vercel uninvolved; share traffic is low so Supabase function cost is negligible.
  - *Alternative considered:* RLS using a request-header GUC + `SECURITY DEFINER`
    check. More moving parts; the edge function is simpler and equally safe.
- **Read-only guarantee:** holders never receive a writable key; the function
  exposes no mutations. Revocation = flip `revoked` / set `expires_at`.
- **This token also powers "adopt a plan"** (§10): adoption = open a shared plan,
  then copy it into your own account.

---

## 8. Data Model

Port the original schema, plus auth-backed ownership. Postgres on Supabase.

### Tables
- **`profiles`** — 1:1 with `auth.users`. `id (uuid, = auth.uid())`,
  `display_name`, `created_at`, optional `is_showcase boolean`. Replaces the
  original `app_users`.
- **`movements`** — shared (null owner) + per-profile custom. Same shape as today:
  `name, category, tags[], default_metrics[], primary_metric, default_rest_seconds,
  notes, owner_user_id → profiles.id`, plus `kind`/`url` for library subroutines
  and `taxonomy jsonb` (nullable) — a per-user muscle-region/modality/plane
  override, matched to logged movements by **normalised name** because logs
  carry no FK here. See §8.1.
- **`plans`** — `owner_user_id, name, start_date, end_date, source_markdown,
  parsed jsonb, is_active`. (Multi-week structured program.)
- **`workout_logs`** — `owner_user_id, plan_id, log_date, day_key, week_number,
  status (planned|in_progress|paused|done|cancelled), started_at, ended_at,
  total_seconds, notes, activity_type, tags[], data jsonb`. Realtime enabled.
  `in_progress` means **live right now**, not merely "the Logger is open": the
  Logger's Home button leaves the row in that state so you can browse the app
  mid-workout, and Home's primary CTA turns into "Resume …" while one exists
  (`src/lib/activeSession.ts`). A row is only offered for resume inside
  `TIMERS.maxWorkoutSeconds` of `started_at`, so a session left behind by a
  closed tab ages out rather than shimmering forever. `paused` is unused.
- **`movement_subs`** — substitution memory: `(owner, plan, day_key, original,
  replacement, count, last_used_at, dismissed_at)` with the `bump_movement_sub`
  RPC. Drives Logger's "you usually swap X→Y" suggestion.
- **`sessions`** *(new)* — saved workout templates ("Sessions" library):
  `owner_user_id, name, tags[] (activity tags), frame jsonb, source_plan_id,
  source_day_key, created_at`. A standalone, named, tagged workout — a plan day
  without the per-week dimension. Created from scratch, from any plan day
  (active or historic), or from a finished workout. `workout_logs.session_id`
  links a logged workout back to the template it was launched from.
- **`recommendations`** — coach output (status, drift_score, confidence, tldr,
  action, body_md, disposition fields, snooze fields…). **Kept in schema but
  unused until the AI phase.**
- **`fitness_assessments`** — dated 1–10 self-ratings backing the Stats radar:
  `owner_user_id, taken_at, scores jsonb (keyed by AspectKey), created_at`. A
  rating overrides the derived score for the axes it names, and only for
  `ASPECT_OVERRIDE_DAYS` — past that the derivation takes back over rather than
  letting a months-old check-in read as current.
- **`aspect_snapshots`** — derived radar history: `owner_user_id, period_end,
  window_days, metrics_version, metrics jsonb, scores jsonb, computed_at,
  created_at`, unique on `(owner_user_id, period_end, window_days)`. One row per
  **completed week** per measurement window. `metrics_version` records which
  definition of `computeAspectMetrics` produced the row; reads filter on
  `ASPECT_METRICS_VERSION` so a stale definition can never enter a baseline, and
  redefining a metric means bumping it plus a migration in the shape of `0019`. `metrics` is the load-bearing column — raw, unit-ful
  measurements — because the radar scores each axis **relative to the owner's own
  past values** for that metric, so the middle of the scale means "typical for
  you" and nothing else. `scores` is a presentation of `metrics` against that
  baseline, stored only so a past reading can be shown as drawn.
  `window_days` keeps the selectable windows (`ASPECT_WINDOWS`) as separate
  series: a 28-day reading is only ever scored against 28-day samples.
  Below `ASPECT_MIN_BASELINE` samples an axis is **unscored** — there is no
  absolute fallback, and the chart shows the raw measurement instead. Written by
  the browser on demand (owner-scoped, RLS is the boundary); there is no
  scheduler in this project.
- **`user_stats`** *(new)* — owner anthropometrics, 1:1 with `profiles` on the
  PK: `body_weight_kg, height_cm, birth_year, gender, body_type, injuries jsonb`.
  Edited from the **You** group on `/app/settings` (`UserStatsPanel.tsx`).
  **A separate table, not columns on `profiles`, for one reason:**
  `profiles_select_showcase` grants `anon` a **whole-row** read of the showcase
  profile and `getCurrentProfile` is `select('*')`, so a column added to
  `profiles` is published the moment it exists. `user_stats` has **no anon
  policy at all** — never add one.
  Only two fields reach a metric: `body_weight_kg` prices unweighted work
  (`VOLUME.bodyweightFraction`, replacing a flat 40kg that was identical for a
  55kg and a 110kg lifter) and `birth_year` gives `220−age` as the HR ceiling —
  ranked **below** an observed `hr_max`, never above it. Height, gender, body
  type and injuries are stored and read by nothing; `Injury.region` is a
  `RegionKey` so `/app/body` can use it later without a data migration.
  One current row, **not a time series** — a six-month-old log is priced with
  today's bodyweight, and a bodyweight history is the known next step.
  Derivations are single-sourced in `src/lib/userStats.ts` and all accept `null`.
- **`invites`** *(new)* — invite codes for signup gating: `code_hash, used_by,
  used_at, expires_at`.
- **`shares`** *(new)* — read-only share tokens: `id, token_hash, owner_user_id,
  scope (profile|plan|log), resource_id (nullable), label, created_at, expires_at,
  revoked boolean`. Backs §7B share links and plan adoption.

### 8.1 Movement taxonomy (region · modality · plane)

Classifies a logged movement for the body map at `/app/body`. **Additive** — it
sits alongside `MOVEMENT_FAMILIES`/`familyOf`, which keep their existing (and
in three cases wrong) answers so Stats output for existing logs is unchanged.

- **Vocabulary** in `src/app.config.ts`: eight coarse `MUSCLE_REGIONS`
  (chest, back, shoulders, arms, core, posteriorChain, quads, calves) with a
  separate `systemic` flag; five `MOVEMENT_MODALITIES`; three
  `MOVEMENT_PLANES`; and `ROTARY_ROLES` (rotational / anti-rotational) modelled
  **orthogonally** to plane, since both are transverse-plane.
- **Matching** in `src/lib/movementTaxonomy.ts`: normalise → exact table →
  rules (longest matched fragment wins) → `unknown`. Never falls back to a
  bucket; unresolvable names surface in the UI's unmapped list.
- **Aggregation** in `src/lib/bodyLoad.ts`, in **two currencies** the region
  list toggles between. **Working minutes** is the default and the only unit
  that survives for unloaded mobility work. **Volume** (`regionVolume`) is
  `setVolume` distributed across the same `profile.regions` weights — load ×
  rep-equivalents, with unloaded reps priced against the owner's bodyweight.
  Raw **tonnage** (`weight × reps`) still cannot be a currency: it is zero for
  erg intervals, jumps and planks, which is what `setVolume` exists to fix.
  Tonnage and hard sets remain resistance-only secondary readouts.
  `regionIntensities(summary, currency)` normalises per currency, so the heat
  map cannot contradict the list beside it.
- **Geometry** in `src/lib/bodyRegions.ts`, renderer-agnostic path data.
- **Overrides** on `movements.taxonomy`, matched by normalised name.

Owned by the `movement-taxonomy` skill; `npm test` is the only check that can
see a regression, and it cannot see whether a mapping is anatomically correct.

### JSONB documents (unchanged contract)
- `plans.parsed` → `ParsedPlan` (title, dates, blocks, weeklyTemplate, days[] with
  exercises[] and per-week planned-set strings).
- `workout_logs.data` → `LogDocument` (sections → groups → items → sets; each set
  has `planned`, `actual {weight,reps,rpe,distance,time,completed,prefilled}`,
  `notations[]`; plus optional `session.vibe {sleep,energy,soreness}`).
- `sessions.frame` → `SessionFrame` (`{ exercises: SessionExercise[] }`, a flat
  ordered list of `{movement, section, primaryMetric, planned, notes?}` — a plan
  day's exercises collapsed to a single `planned` string each). The Logger
  reconstructs grouping, exactly as it does for plan days.

Keeping these JSONB contracts means the parsing/logging logic ports with minimal
change.

#### Plan authoring surface (AI-friendly)

Beyond the original markdown format, users can also author plans via a tabular
wireframe so an external AI can produce a plug-and-play plan:

- **CSV/TSV template** — a rectangular file with the fixed header
  `kind,id,label,section,metric,week,planned,notes` and four row kinds
  (`META`, `BLOCK`, `DAY`, `EX`). Built by `buildPlanCsvTemplate` /
  `buildPlanTsvTemplate` in `src/lib/planTemplate.ts`.
- **AI prompt** — generated by `buildPlanAiPrompt`. It enumerates the canonical
  sections, metrics, units, and block keys read live from `app.config.ts` so the
  prompt updates whenever the domain config does.
- **Upload + validation** — `parsePlanTabular` produces a `ParsedPlan` and a
  list of compatibility issues; `validateParsedPlan` is the final gate before
  save (also used for markdown uploads). The UI in `PlanUpload` blocks save
  while issues remain so a malformed plan cannot break silently.
- **Workbook uploads** — `.xlsx` files are read by `parsePlanWorkbook` (dynamic
  import of `exceljs` so the cost is only paid when a user actually uploads a
  workbook). The reader locates the canonical header row anywhere in the first
  sheet and feeds the data through `parsePlanTabular` — so validation and the
  domain vocabulary remain single-sourced. XLSB (binary Excel) is not supported
  in v1; export to XLSX or CSV.

When the plan structure, sections, metrics, units, or block vocabulary change,
update `planTemplate.ts` (sample rows + prompt) and its tests in the same
change. This is a hard rule in `CLAUDE.md`.

### RLS sketch (private-by-default)

```sql
-- profiles
select: authenticated → id = auth.uid()      -- own only
        anon          → id = :SHOWCASE_ID
insert/update: id = auth.uid()

-- plans / workout_logs / movement_subs / recommendations
select: authenticated → owner_user_id = auth.uid()         -- own only
        anon          → owner_user_id = :SHOWCASE_ID
        (plans may also expose owner_user_id-agnostic rows where is_public = true)
insert/update/delete: owner_user_id = auth.uid()           -- anon: none

-- movements
select: authenticated → owner_user_id = auth.uid() OR owner_user_id IS NULL  -- own + shared library
        anon          → owner_user_id = :SHOWCASE_ID OR owner_user_id IS NULL
insert/update/delete: owner_user_id = auth.uid()

-- invites, shares
select/update: service-role only (signup + share-read edge functions)
-- shares: owners may INSERT/UPDATE(revoke) their own rows from the client
shares insert/update: owner_user_id = auth.uid()
```


Share-link reads (§7B) bypass ambient RLS by going through the `share-read` Edge
Function, which validates the token and performs scoped read-only queries.

> Note: the original migrations included a `claude_ro` DB role granted write
> access and an external process writing `recommendations` directly. v2 should
> **not** carry that over — the coach, when built, writes via a Supabase Edge
> Function or Railway service using the service-role key, not a shared DB login.

---

## 9. Feature Inventory (parity baseline)

> **Historical.** This is the parity target taken from the original app, kept as
> the record of what v2 set out to match. **It is not a list of what ships** —
> roughly a third of the current app was built after it and never added here.
> For what exists now, read the source: `src/pages/` for routes,
> `src/components/` for surfaces. Shipped since and absent below: the AI coach
> (`/app/coach`, `supabase/functions/coach`), Garmin integration
> (`garmin-connect` / `garmin-ingest` + `GarminPanel`), heart-rate and fitness
> assessments, library subroutines, PR detection, the three-way theme toggle,
> and `/app/settings`.

### Pages
- **Home** — dashboard, ordered so the next workout leads: header meta (date ·
  program week · streak) over the name; one plan unit fusing the active plan,
  a fit-width day accordion (active day expanded, the rest collapsed to letters)
  and the primary "Start &lt;day&gt;" action with a chooser for everything else;
  inline stats (session count, total time, top e1RM); a scrollable activity strip
  spanning the whole logged history, opening on today (bar height = session
  duration, rest days a hairline, heights re-normalised to the visible window
  once scrolling settles); recent sessions list
  (with set-shape strips + durations); recommendations badge.
- **Plan** — week-by-week (W1–W16) progression table per day; edit mode
  (drag-reorder days, inline-edit movements/cells, add via library, delete,
  autosave); block-type color markers; shows actual best-set from last log.
- **PlanUpload** — paste/upload markdown → strict local parse, AI fallback later;
  preview; save (activates, deactivates prior); **adopt** another user's plan.
- **Logger (core)** — sectioned, grouped (single/superset/circuit) movement
  logging; per-set weight/reps|time|distance/RPE/notes; completion checks;
  **WeightWheel** drum picker, **RepsStepper**, voice input; per-set + per-movement
  rest timers; clone-forward on long-press; multi-select grouping; metric swapping;
  movement swap/add/remove via library; substitution suggestions; VibeCheck on
  start; session stopwatch with pause/resume/finish/cancel; autosave (15s);
  light-day "why" prompt; custom (plan-less) workouts.
- **ActivityLogger** — lightweight non-strength log (title, tags, date, duration,
  notes) → minimal `workout_logs` row.
- **Calendar** — month grid with per-session colored bars (by tag) + set-shape
  strips; click bar → log; click empty → AddSessionMenu; month list.
- **Stats** — summary cards (sessions, time, adherence), weekly table
  (count/time/volume), consistency heatmap (7×8 weekday×week), RPE fingerprint by
  movement family, top-movement e1RM sparklines (with family roll-up), and the
  **fitness profile radar** — six axes, all derived from logged data and each
  scored against the owner's own stored history. **Strength** and **power** are
  scaled training volume (`setVolume`: load × rep-equivalents, adjusted for
  `/side`, `(p)` paused reps and RPE), strength weighted by load relative to each
  movement's own best e1RM and power biased toward low-rep sets.
  **Endurance** blends HR-weighted aerobic minutes, dense strength work (short
  rests read as conditioning) and the `hr_max − hr_avg` spread scaled by session
  length, boosted when a conditioning block was logged. Two toggles: measurement window
  (`ASPECT_WINDOWS`, the responsiveness control) and what the dashed comparison
  series is (previous block, or the oldest week held). Axes on a thin baseline
  render hollow; axes with no baseline show their raw measurement and no polygon
  is drawn. An always-available explainer (`AspectExplainer`) states what the
  scale means, since "typical for you" is a claim that needs its source shown.
- **Library** — browse/search/filter movements (shared + custom), edit own
  (rest, primary metric, delete), create custom.
- **Sessions** — saved workout templates: browse/search/filter by activity tag,
  create from scratch (name, tags, movement frame editor), edit, delete; a
  "From your plans" browser to start or save any plan day (active or historic)
  as a session. Surfaced in the log-a-workout flow (AddSessionMenu) and via
  `/app/log?session=` / `?plan=&day=`.
- **Recommendations** — coach cards: open/snoozed/recent-decisions, drift/confidence
  bars, detail dialog with disposition (acted/modified/skipped/snooze), fit slider,
  linked session, outcome note. *(AI phase.)*

### Cross-cutting
- Activity tagging + per-tag colors; movement families roll-up; notation glossary
  ((p),(t),+5%,/side,→); e1RM (Brzycki); week-from-date derivation; prefill from
  last performance; realtime log sync; mobile-PWA touch model (haptics, 44px
  targets, 16px inputs — long-press and scrub were dropped in the mobile pass in
  favour of tap-to-open sheets).

### Domain config (port `app.config.ts`)
Single source of truth for blocks/sections, metrics, RPE, timers, activity tags
& colors, section aliases, movement families, touch tunables.

---

## 10. Enhancements ("new and enhanced")

1. **Real auth & per-profile data protection** (§6) — fixes the original's open-write model.
2. **Private-by-default + explicit sharing** (§6) — your data is yours; sharing is a deliberate act.
3. **Public showcase + per-profile share links** (§7) — net-new.
4. **Plan adoption via sharing** — open a shared/public plan, copy it into your
   account (replaces the original's ambient "browse everyone's plans"). Optional
   `is_public` plan flag enables a lightweight adoption marketplace.
5. **Better visuals** (§11) — elevated motion, depth, data-viz polish, Astro View Transitions.
6. **Performance** — static-first delivery, smaller JS (islands only), faster cold loads than the Vite SPA.
7. **Invite-gated signup** — caps profiles, removes the shared-password friction.
8. *(Candidates for discussion)* multi-unit (lb/kg), export (CSV/JSON), richer
   plan templates, PR celebrations, deeper Stats.

---

## 11. Visual / Design Direction

Keep the **Swiss-minimalist typographic identity** (it's distinctive and ages
well): Clash Display + Satoshi, monochrome HSL tokens, hairline borders, sharp
corners, tabular numbers, uppercase tracking, the typographic **Echo Stack**, and
bold CSS-first motion. **Light** editorial palette (`#f2f2f2` bg / `#111111` fg);
the provided design spec + reference screenshots take precedence on aesthetics.

Elevate via:
- **Astro View Transitions** for cheap, native page-to-page motion.
- Refined micro-interactions on the data-viz (set-shape strips, heatmaps, e1RM
  sparklines) — the original's best visual assets, made crisper.
- A polished, gallery-grade **showcase** presentation (the view-only profile is a
  portfolio piece).
- Considered, sparing use of activity-tag color as accent against the neutral base.

### Depth & backdrop

A `BackgroundLayer` Astro component sits behind every page at `z-index: -10`
and swaps presets via the `html[data-bg]` attribute. CSS presets (`grain`,
`hairlines`, `topography`) paint with token-derived SVG/gradient fills; the
`aurora` preset (labelled "Depth" in the UI) mounts `BackgroundScene3DCanvas`
— a `@react-three/fiber` scene composed of an ink-grey monolith, a mid-grey
plinth, a hairline wire frame, and a static paper veil, anchored by a real
cast shadow on a ground plane. Pointer parallax on the scene root group
(≈3.4°/2°, critically-damped 400ms settle) gives it life. The scene is
**lazy-loaded** via `client:idle` + dynamic import, so the three.js cost is
only paid when a user is actually on that preset.

The preference is stored in `localStorage` and applied pre-paint by an inline
script in `Base.astro` (no FOUC) that picks a **device-aware default** when
no explicit preference is stored: `aurora` on `(min-width: 768px) and
(pointer: fine)` without `prefers-reduced-motion`; otherwise `topography`.
This keeps WebGL off mobile / touch / reduced-motion devices while still
giving every user a depth cue out of the box.

**The `.lift` / `.hill-btn` / `EchoText` depth rules are stated once, in
`CLAUDE.md`.** They used to be duplicated here in full; the two copies drifted
(the flat-button size threshold said `h-5 / h-6` here and `h-5 to h-8` there,
with nothing saying which won) and the copy here went on recommending `.lift`
for modal panels long after `docs/LESSONS.md` recorded that it fights an
animated transform. One owner, one place to change.

> Open Q: keep the existing identity (recommended) vs. a fresh visual language.

---

## 12. AI Features (shipped — Coach)

**What shipped**, and it is not what this section originally predicted:
- **The coach is a Supabase Edge Function, not Railway.** On-demand rather than
  scheduled: `supabase/functions/coach/index.ts` computes training-drift signals
  from the caller's own logs, asks Claude for recommendations, and writes them
  back to `recommendations` (see `supabase/migrations/0007_recs_owner_writes.sql`).
  It returns `{ok:false,error:'no_key'}` when `ANTHROPIC_API_KEY` is unset, so the
  UI degrades instead of erroring.
- **The UI** is `CoachView.tsx` at `/app/coach`, with `lib/coach.ts` and
  `DeepEnrichment.tsx`. Claims the model may make are bounded deterministically
  in `lib/deepGovernors.ts` — enforce those in the UI rather than trusting the
  model's output.
- **parse-plan is still not built.** `lib/planTemplate.ts` gives the user a
  copyable authoring prompt instead, so the strict local parser in `PlanUpload`
  stays the only ingest path. That trade has held well; revisit only with a
  reason.

---

## 13. Phased Roadmap (multi-phase)

- **Phase 0 — Foundations.** New repo, Astro + TS + Tailwind + shadcn-equivalent,
  design tokens ported, Supabase project, schema + RLS + auth, invite gating,
  `.claude/` + `CLAUDE.md`, CI, deploy pipeline (Vercel + Supabase).
- **Phase 1 — Read paths + showcase.** Profiles, Home, Calendar, Stats, Library
  (read), Plan view, session detail. Build the **view-only showcase** here (it's
  read-only, so it validates the data + RLS + visuals early).
- **Phase 2 — Logger (core write path).** Full logging engine, autosave, timers,
  pickers, grouping, substitutions, custom workouts. Shipped as `logBuilder.ts`,
  `lastPerformance.ts`, `week.ts`, `useTimer.ts`, `voice.ts` — long-press was
  dropped in the mobile pass (rows became tap-to-open sheets instead).
- **Phase 3 — Plan authoring.** PlanUpload (strict parser), Plan edit mode, adopt.
- **Phase 4 — Polish.** View Transitions, PWA/offline, perf pass, accessibility,
  enhancements from §10.
- **Phase 5 — AI.** parse-plan (Edge Fn), then the coach (Railway).

Each phase is independently shippable; the showcase is usable after Phase 1.

---

## 14. Repo Structure & Tooling (new repo)


```
/ (new repo)
├─ .claude/                 # agents, commands, settings for this project
├─ CLAUDE.md                # routing + hard rules + numbered principles
├─ docs/
│  ├─ SPEC.md               # this document
│  └─ ROADMAP.md            # living phase tracker
├─ src/                     # Astro pages + React islands + lib
├─ supabase/                # migrations, RLS, (future) edge functions
└─ ...
```


- **CLAUDE.md** — the entry point: a **Routing** table → project **Hard rules**
  → four numbered working principles. It is the single owner of those rules;
  this document deliberately does not restate them, because the copy that used
  to live here drifted from the original and nothing caught it.

---

## 15. Open Questions / Decisions Needed

**Resolved:** view-only = both public showcase + per-profile share
links · reads = private by default · signup = invite codes · visuals = keep &
elevate current identity · **repo = `shourjoguha/verocity-Multi`** · **CLAUDE.md =
modeled on the routing / hard-rules / numbered-principles template**.

**All five originally-open questions are settled** — the decisions table in
`docs/ROADMAP.md` is the canonical record. In short: showcase is static +
client-fetch; plan adoption is share-link-only; the PWA ships with a
stale-while-revalidate shell (see the Caching entry in `docs/LESSONS.md`);
units are kg-only; auth is email + password.

---

## 16. Risks & Notes

- **Astro + a heavy interactive Logger.** The Logger is essentially a stateful SPA;
  as a single large island it's fine, but we must keep its state self-contained and
  avoid sprinkling many tiny islands (hydration cost). Mitigation: one Logger
  island, `client:load`, with internal routing/state.
- **Private-by-default migration of "adopt plan."** The original let users browse
  everyone's plans; v2 routes this through explicit shares / `is_public`. Make sure
  the adoption UX stays easy despite the privacy default.
- **Read-only key & share tokens.** The anon key is public by design; safety rests
  entirely on RLS, and share tokens on the `share-read` function. Both need a
  **denied-write / denied-cross-read test suite**.
- **Realtime cost.** Supabase realtime on `workout_logs` is fine at <100 profiles.
- **Original artifacts to drop:** the `claude_ro` write-granted DB role and the
  external direct-DB recommendation writer — replace with service-role edge/Railway.
- **Secrets.** Service-role key never ships to the client; only the anon key and
  authed-session keys reach the browser.
