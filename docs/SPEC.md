# Verocity v2 — Build Specification (Starting Draft)

> Status: **starting spec for review.** Decisions marked **LOCKED** were confirmed;
> items under *Open questions* still need a call.

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
  notes, owner_user_id → profiles.id`.
- **`plans`** — `owner_user_id, name, start_date, end_date, source_markdown,
  parsed jsonb, is_active`. (Multi-week structured program.)
- **`workout_logs`** — `owner_user_id, plan_id, log_date, day_key, week_number,
  status (planned|in_progress|paused|done|cancelled), started_at, ended_at,
  total_seconds, notes, activity_type, tags[], data jsonb`. Realtime enabled.
- **`movement_subs`** — substitution memory: `(owner, plan, day_key, original,
  replacement, count, last_used_at, dismissed_at)` with the `bump_movement_sub`
  RPC. Drives Logger's "you usually swap X→Y" suggestion.
- **`recommendations`** — coach output (status, drift_score, confidence, tldr,
  action, body_md, disposition fields, snooze fields…). **Kept in schema but
  unused until the AI phase.**
- **`invites`** *(new)* — invite codes for signup gating: `code_hash, used_by,
  used_at, expires_at`.
- **`shares`** *(new)* — read-only share tokens: `id, token_hash, owner_user_id,
  scope (profile|plan|log), resource_id (nullable), label, created_at, expires_at,
  revoked boolean`. Backs §7B share links and plan adoption.

### JSONB documents (unchanged contract)
- `plans.parsed` → `ParsedPlan` (title, dates, blocks, weeklyTemplate, days[] with
  exercises[] and per-week planned-set strings).
- `workout_logs.data` → `LogDocument` (sections → groups → items → sets; each set
  has `planned`, `actual {weight,reps,rpe,distance,time,completed,prefilled}`,
  `notations[]`; plus optional `session.vibe {sleep,energy,soreness}`).

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

From the original app. v2 must reach parity on these before enhancing.

### Pages
- **Home** — dashboard: 30-day plan-progress timeline, day rail + day-preview,
  active-day card with "Start workout", recent sessions list (with set-shape
  strips + durations), inline stats (session count, total time, top e1RMs),
  quick actions, recommendations badge.
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
  movement family, top-movement e1RM sparklines (with family roll-up).
- **Library** — browse/search/filter movements (shared + custom), edit own
  (rest, primary metric, delete), create custom.
- **Recommendations** — coach cards: open/snoozed/recent-decisions, drift/confidence
  bars, detail dialog with disposition (acted/modified/skipped/snooze), fit slider,
  linked session, outcome note. *(AI phase.)*

### Cross-cutting
- Activity tagging + per-tag colors; movement families roll-up; notation glossary
  ((p),(t),+5%,/side,→); e1RM (Brzycki); week-from-date derivation; prefill from
  last performance; realtime log sync; mobile-PWA touch model (long-press, scrub,
  haptics, 44px targets, 16px inputs).

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

> Open Q: keep the existing identity (recommended) vs. a fresh visual language.

---

## 12. AI Features (deferred — future design)

Not in the first build. When we get there:
- **parse-plan** → Supabase Edge Function (Deno), swapping the old Lovable AI
  gateway for the **Anthropic/Claude API** (or pluggable provider). Tool-calling to
  emit a structured `ParsedPlan`. Strict local parser remains the first attempt;
  AI is the fallback.
- **Recommendations "coach"** → likely a **Railway** scheduled service (drift
  detection over logs → writes `recommendations` via service-role). Long-running /
  cron makes Railway a better home than an edge function.

---

## 13. Phased Roadmap (multi-phase)

- **Phase 0 — Foundations.** New repo, Astro + TS + Tailwind + shadcn-equivalent,
  design tokens ported, Supabase project, schema + RLS + auth, invite gating,
  `.claude/` + `CLAUDE.md`, CI, deploy pipeline (Vercel + Supabase).
- **Phase 1 — Read paths + showcase.** Profiles, Home, Calendar, Stats, Library
  (read), Plan view, session detail. Build the **view-only showcase** here (it's
  read-only, so it validates the data + RLS + visuals early).
- **Phase 2 — Logger (core write path).** Full logging engine, autosave, timers,
  pickers, grouping, substitutions, custom workouts. Port `logBuilder`,
  `lastPerformance`, `weekPicker`, `useTimer`, `useLongPress`, `useVoiceInput`.
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


- **CLAUDE.md** — follows the agreed template: a **Routing** table → project
  **Hard rules** (RLS is the boundary, private-by-default, never expose the
  service-role key, keep Vercel light, islands-not-SPA, preserve JSONB contracts,
  design-tokens-only, invite-gated, AI deferred) → four numbered working principles
  (Think Before Coding · Simplicity First · Surgical Changes · Goal-Driven
  Execution).
- **`.claude/`** — project agents/commands (e.g. a "port a page" workflow), shared
  settings, allowed-tools.

---

## 15. Open Questions / Decisions Needed

**Resolved:** view-only = both public showcase + per-profile share
links · reads = private by default · signup = invite codes · visuals = keep &
elevate current identity · **repo = `shourjoguha/verocity-Multi`** · **CLAUDE.md =
modeled on the routing / hard-rules / numbered-principles template**.

**Still open:**
1. **Showcase rendering:** static + client-fetch (zero Vercel compute, no SEO) vs.
   edge SSR for the public showcase (SEO/social previews, some edge invocations)?
2. **Plan adoption:** share-link-only, or also a `is_public` plan flag for a small
   adoption marketplace?
3. **PWA/offline:** how important is offline logging? (Affects island/state design.)
4. **Units:** kg-only (as today) or kg/lb toggle?
5. **Auth method:** magic-link, email+password, or both for the per-profile login?

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
