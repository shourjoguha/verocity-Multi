# Meal logging — handover & implementation plan

**Status:** planned, nothing built. No code, migration or doc has been written yet.
**Repo:** `shourjoguha/verocity-Multi` · **Branch:** `claude/meal-logging-feature-wgf10s`
**Base commit at planning time:** `927e5bb` (merge of #134)
**Supabase project:** `Verocity-Multi-Project`, ref `zwuaieavvmjacqtbzowm`
**Visual source of truth:** <https://www.magicpatterns.com/c/6mmqhpuqguskcfrr1jpfrp>

## How to use this document

This is the complete specification. Every migration, type, query helper and component is
specified with the reasoning behind it, and the live database state is **verified**, not
assumed (§3.3).

1. **Open the Magic Patterns design first** (§1.1). It is the visual source of truth and
   this document defers to it wherever the two disagree on appearance.
2. **Read `CLAUDE.md`.** Its hard rules govern this change and several have non-obvious
   teeth. **§0 lists four places where the design spec and those rules genuinely
   conflict** — read that before writing a line.
3. **Work through §2 in order.** Each step verifies independently.
4. **Invoke the repo's own skills**: `db-change` for §4–§8, `ui-change` for §9–§11,
   `docs-upkeep` for §14.
5. **§15 is the only blocked part** — applying migrations needs a session that can
   approve MCP writes, and four Storage policies must be created by hand.

**First action:** commit this file to the branch as `docs/MEAL_LOGGING.md`.

### State of play

| | |
|---|---|
| Explored | Routes, nav, UI primitives, modal/form patterns, migrations, RLS conventions, `queries.ts`, `types.ts`, `app.config.ts`, test setup |
| Verified live | Migration head, table list, storage buckets, role privileges (§3.3) |
| Specified by the user | Full visual + interaction spec (§1), Magic Patterns design |
| Built | **Nothing** |

---

## 0. Four conflicts to resolve before you build

These are places where the design spec and `CLAUDE.md`'s hard rules disagree. Each has a
resolution; none should be resolved silently.

### 0.1 Control height: 32–36px vs. the 44px floor

The spec asks for core control rows "at least 32–36px high". `TOUCH.minTargetPx` is 44,
`npm run audit:mobile` enforces it, and **it is green at 24/24 for the first time in the
project's history**.

This exact tension has already been litigated once. `CLAUDE.md` on `SegmentedTabs`: *"It
stays `min-h-11` at both sizes — `size="sm"` buys compactness with type and padding only,
because the reference design's ~30px in-card height is below `TOUCH.minTargetPx`."* A
previous design pass asked for the same thing and was refused.

**Resolution — the one `CLAUDE.md` itself prescribes:** *"The fix for a small target is a
bigger hit box, not a bigger glyph — wrap it in a `min-h-11` / `h-11 w-11` box and pull
the extra back with a negative margin so nothing moves on screen."*

So: the control **looks** 36px tall and **hits** 44px. Visual box is 36px; the button's
padding extends to 44px with `-my-1` pulling the layout back. Verify with
`npm run audit:mobile` — this is precisely the symptom it observes. Do not ship a genuine
36px target.

### 0.2 Raw hex vs. design tokens

The spec lists hexes: `#050505`, `#0e0e0e`, `#171717`, `#49F2E1`, `rgba(255,255,255,.14)`.
These are Verocity's **dark theme values**. `CLAUDE.md`: *"Design tokens only (HSL); no raw
colors in components — this one MUST hold… A hardcoded hex breaks dark mode silently."*
The app ships a three-way light/dark/system toggle.

**Resolution — use the tokens, which already resolve to exactly these values in dark:**

| Spec value | Token | Tailwind |
|---|---|---|
| `#050505` background | `--color-bg` | `bg-bg` |
| `#0e0e0e` surface | `--color-surface` | `bg-surface` |
| `#171717` elevated | `--color-elevated` | `bg-elevated` |
| white / `#f4f4f4` text | `--color-fg` | `text-fg` |
| `rgba(255,255,255,.48–.62)` | `--color-muted` / `--color-subtle` | `text-muted` / `text-subtle` |
| `#49F2E1` accent | `--color-teal` (`hsl(174 87% 62%)`) | `text-teal` / `bg-teal` |
| `rgba(255,255,255,.14)` outer | `--color-border` | `border-border` |
| `rgba(255,255,255,.07)` inner | `--color-border-soft` | `border-border-soft` |
| selected: white bg / near-black text | `--color-accent` / `--color-accent-fg` | `bg-accent text-accent-fg` |

Every hex in the spec has an exact token. **Write zero raw colours.** Light mode then
works for free; hardcoding would break it silently and no audit here can see that.

Radii (3px chip / 4px control / 6px card) and the fonts already match the repo's
`--radius-*` tokens and Archivo Black + Space Grotesk exactly — no change needed.

### 0.3 A form in a drawer, with a software keyboard

The spec requires a bottom drawer containing text inputs, and *"Drawer remains usable with
the software keyboard open."*

`ui/Modal.tsx` has **no `visualViewport` handling**. The only component in the repo that
solves this is `logger/SetEntrySheet.tsx`, which hand-rolls its own overlay — and
`docs/LESSONS.md` records that the keyboard inset must be applied as **padding on the
scrim, never as margin on the panel**. `Modal` also deliberately skips autofocus on touch
so the keyboard does not rise mid-animation.

**Resolution:** extend `Modal` with an **opt-in** prop rather than forking it or changing
it for everyone — the spec says *"Do not fork existing components when they can be
extended cleanly."*

```tsx
export function Modal({ open, onClose, title, keyboardInset = false, children }: …)
```

`keyboardInset` defaults to `false`, so all five existing sheets are byte-identical in
behaviour. Only the meal drawer passes `true`. Port the `visualViewport` listener from
`SetEntrySheet.tsx` and apply it as scrim padding.

`npm run audit:flicker` is **8/8 with zero skips** and exercises sheets — it is the check
that can observe a regression here. Run it before and after.

### 0.4 Photo persistence

The spec says *"Keep the image local to the draft/mock persistence layer unless the repo
already has an upload service. Do not invent a backend or external image URL."*

The repo has no upload service, but it does have Supabase — the project's own backend, not
an invented one. A photo held only in a draft is lost on reload, which makes the feature
pointless.

**Resolution:** use Supabase Storage, private bucket, signed URLs (§5, §8). This honours
the guardrail's intent — no external host, no invented backend. `MealDraft.photoUrl` stays
in the draft as a local `blob:` preview; it maps to `photo_path` on save.

**Caveat:** the four `storage.objects` policies cannot be created from a migration on this
project (§4.2, verified). Until they are created by hand, **every upload and signed URL is
denied**. Build everything else first; the photo row is the last thing to test.

---

## 1. Context

Verocity logs training. It has no way to record when you ate, how big it was, and what
kind of meal it was. This adds that, with the lowest possible friction.

**Out of scope, absolutely:** calorie targets, macros, meal scores, nutritional judgment,
AI recommendations, or any derived nutrition data. Capture and retrieval only.

### 1.1 Read the Magic Patterns design first

<https://www.magicpatterns.com/c/6mmqhpuqguskcfrr1jpfrp>

Read it via the Magic Patterns MCP: `get_editor_id_from_url` → `get_artifact` →
`read_artifact_files`. **This required an interactive approval that the planning session
could not give**, so the design has *not* been read into this document — every visual
detail below comes from the written spec. **Where the two disagree, the Magic Patterns
file wins.** Its code is a starting point, not production code: adapt it to this repo's
conventions rather than pasting it.

### 1.2 Home page order

Required order on `/app`:

1. Date / week / streak + athlete name
2. Active plan  ← stays visually dominant, unchanged
3. Activity chart
4. **Today's meals**
5. Remaining existing home content

**Today's meals sits below the activity chart.** In `ProfileView.tsx` that is after the
`ActivityStrip` `<Item>` (closes ~line 725) and before the `StatStrip` `<Item>` (~line 731).

---

## 2. Build order

| # | Step | Verify |
|---|---|---|
| 1 | Commit this doc as `docs/MEAL_LOGGING.md` | file on branch |
| 2 | Read the Magic Patterns design (§1.1) | — |
| 3 | §6 `app.config.ts` vocabulary + guards | `npm run check` |
| 4 | §7 `types.ts` row + input types | `npm run check` |
| 5 | §4 both migration files | SQL written; applying needs §15 |
| 6 | §8 `queries.ts` helpers | §13 `mealLogs.test.ts` |
| 7 | §5 `mealPhoto.ts` | §13 `mealPhoto.test.ts` |
| 8 | §9 `mealDraft.ts` — draft model, defaults, mapping, shortcut derivation | §13 `mealDraft.test.ts` |
| 9 | §0.3 `Modal` `keyboardInset` prop | `audit:flicker` 8/8, zero skips |
| 10 | §0.1 `SegmentedTabs` compact + radiogroup variants | `audit:mobile` green |
| 11 | §10.1 shared field components | `check` |
| 12 | §10.2 `MealDrawer` | `audit:mobile`, `audit:flicker` |
| 13 | §10.3 `MealChipRail` + §11.1 mount in plan card | `audit:mobile` |
| 14 | §10.4 `TodaysMeals` + §11.2 mount below Activity | `audit:mobile` |
| 15 | §10.5 full logger route + §10.6 history route | `audit:shell`, `audit:mobile` |
| 16 | §14 docs | `audit:docs` |
| 17 | §16 end-to-end | manual, needs §15 |

---

## 3. Verified live database state

Read-only checks run against the project during planning.

| Question | Answer |
|---|---|
| Project | `Verocity-Multi-Project`, ref `zwuaieavvmjacqtbzowm`, eu-central-1, PG 17.6, `ACTIVE_HEALTHY` |
| Applied migration head | `0031_onboarding` — **matches the repo**, so `0032` is genuinely next |
| `meal_logs` exists? | No. 18 public tables, none of them this |
| Storage buckets | **None at all** |
| Policies on `storage.objects` | **Zero** |
| Migration role | `postgres` — `rolsuper=false`, `rolbypassrls=true` |
| `storage.objects` owner | `supabase_storage_admin` |
| `postgres` member of it? | **No**, no admin option → cannot `create policy` there |
| `postgres` insert on `storage.buckets`? | **Yes** → the bucket insert will succeed |

One oddity, noted and **not** to be acted on: `0016_library_subroutines` carries a
timestamp later than `0030`, so it was applied out of order at some point. Leave it.

---

## 4. Migrations

### 4.1 `supabase/migrations/0032_meal_logs.sql`

```sql
-- Meal logging: when you ate, how big it was, what kind of meal, optional
-- photo, tags, hunger before/after and a note. Capture only — nothing in this
-- app derives anything from these rows, and that is deliberate. No calories,
-- no macros, no score.
--
-- WHY WALL CLOCK AND NOT A TIMESTAMPTZ. `log_date` + `eaten_time` store the
-- local clock reading, not an absolute instant. You ate at 10:30 wherever you
-- were; a timestamptz redisplays that as 05:00 after a flight, and every
-- question this data will eventually be asked ("do I eat late?", "how long
-- between meals?") is a wall-clock question. The real instant the row was
-- written is still on `created_at`. The two columns also map 1:1 onto the two
-- native inputs the form uses, so there is no timezone conversion in the
-- client at all.
--
-- WHY NO ANON POLICY. `profiles_select_showcase` (0002_rls.sql) grants `anon` a
-- whole-row read of the showcase profile, and /showcase renders through the
-- session-less client. What someone eats must never travel that way. This
-- follows `user_stats` (0020): owner-only, all four verbs, no `_select_anon`
-- policy at all. Do not add one.
create table public.meal_logs (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.profiles (id) on delete cascade,
  log_date       date not null,
  eaten_time     time not null,
  -- Vocabularies live in src/app.config.ts (MEAL_SIZES / MEAL_KINDS /
  -- MEAL_SOURCES), NOT in check constraints — the same call `gender`,
  -- `body_type`, `experience`, `equipment` and `disciplines` made. Adding
  -- "brunch" must be a config edit, not a migration. The cost is that a stored
  -- value is not guaranteed to be a known key, so getMealLogs applies a type
  -- guard at the read boundary.
  --
  -- NOT NULL with defaults, unlike most optional columns in this schema: the
  -- product spec prefills size/kind/source on every draft (medium/meal/home),
  -- so a row without them cannot be produced by the UI.
  size           text not null default 'medium',  -- light | medium | heavy
  kind           text not null default 'meal',    -- snack | meal
  source         text not null default 'home',    -- home  | out  | takeaway
  -- ONE column for both suggested and user-created tags. The draft model
  -- carries `tags` and `customTags` separately because the UI groups them, but
  -- persisting two arrays would let them disagree. Custom-ness is derived on
  -- read by set difference against MEAL_TAGS — see splitTags() in mealDraft.ts.
  -- This is also what makes repeat-meal shortcuts free: they are the distinct
  -- custom tags of recent meals, newest first. No second table.
  tags           text[] not null default '{}',
  note           text,
  -- 1-5 sliders. These DO get check constraints, unlike the vocabularies above:
  -- a fixed range is not a list that grows. MEAL_SCALE in app.config.ts must
  -- stay in step with these bounds. Defaults match the spec's draft defaults.
  hunger_before  int not null default 4 check (hunger_before between 1 and 5),
  hunger_after   int not null default 1 check (hunger_after  between 1 and 5),
  -- Object path in the private `meal-photos` bucket, '<owner uuid>/<uuid>.jpg'.
  -- The FIRST folder segment is the owner id, because that is what the storage
  -- policy in 0033 keys on. Never write a path that does not start with it.
  photo_path     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index meal_logs_owner_idx
  on public.meal_logs (owner_user_id, log_date desc, eaten_time desc);

alter table public.meal_logs enable row level security;

-- Owner-only, all four verbs. The `(select auth.uid())` wrapper is mandatory —
-- it is the InitPlan hoist that 0004_rls_initplan_perf.sql retrofitted
-- everywhere. There is deliberately NO ml_select_anon; see the header.
create policy ml_select_own on public.meal_logs
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy ml_insert_own on public.meal_logs
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy ml_update_own on public.meal_logs
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy ml_delete_own on public.meal_logs
  for delete to authenticated using (owner_user_id = (select auth.uid()));

comment on table public.meal_logs is
  'Meal capture: local date + clock time, size/kind/source, tags, note, 1-5 hunger before/after, optional photo in the private meal-photos bucket. Owner-only by design — never add an anon policy, the showcase reads through the anon role.';
```

**No trigger for `updated_at`.** This repo has no triggers anywhere. Set it client-side in
`updateMealLog`, exactly as `upsertUserStats` does.

### 4.2 `supabase/migrations/0033_meal_photos_bucket.sql`

> Split in two, and the split is **verified against the live database** (§3), not a
> precaution. The bucket goes in the migration; the four policies cannot.

```sql
-- First use of Supabase Storage in this project. Private bucket: there is no
-- public URL for a meal photo, ever. Reads go through a short-lived signed URL
-- minted by the owner's own session, which the select policy allows.
--
-- Path convention is '<owner uuid>/<uuid>.jpg' and it is load-bearing: every
-- policy keys on the first folder segment. src/lib/mealPhoto.ts is the only
-- place that builds a path.
--
-- `on conflict do nothing` is an exception to this project's "migrations are
-- not idempotent" rule, and a deliberate one: this bucket may have been created
-- by hand in the dashboard first, and failing the whole migration for that
-- would be worse than a no-op.
insert into storage.buckets (id, name, public)
values ('meal-photos', 'meal-photos', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- THE FOUR OBJECT POLICIES ARE NOT IN THIS MIGRATION, AND CANNOT BE.
--
-- storage.objects is owned by `supabase_storage_admin`. Migrations here run as
-- `postgres`, which on this project is NOT a superuser, NOT a member of that
-- role, and holds no admin option on it (all three verified against the live
-- DB). `create policy ... on storage.objects` as `postgres` therefore fails
-- with "must be owner of table objects" and would abort this migration.
--
-- Create them once from Dashboard -> Storage -> Policies. Recorded verbatim
-- here so the schema is not undocumented; this block is a comment, not dead
-- SQL to uncomment.
--
--   create policy meal_photos_select_own on storage.objects
--     for select to authenticated
--     using (
--       bucket_id = 'meal-photos'
--       and (storage.foldername(name))[1] = (select auth.uid())::text
--     );
--
--   ... insert (with check), update (using + with check), delete (using),
--       all four with the identical predicate.
-- ---------------------------------------------------------------------------
```

**Until those four policies exist the photo row is inert** — `storage.objects` has RLS on
with zero policies today, so every upload and every signed URL is denied. Everything else
works without them.

---

## 5. `src/lib/mealPhoto.ts` (new)

Storage lives here, not in `queries.ts`, which is PostgREST row CRUD. No new dependency —
canvas does the resize.

```ts
/**
 * Longest-edge fit. Pure and exported so it can be unit-tested — the only part
 * of this module that runs outside a browser. Never upscales.
 */
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number }

/**
 * Downscale to a JPEG blob. Returns null if the browser cannot decode the file
 * — the realistic HEIC-from-the-iOS-library case — and the caller falls back to
 * uploading the original.
 *
 * `imageOrientation: 'from-image'` on createImageBitmap is LOAD-BEARING.
 * Without it every photo taken in portrait comes back rotated, because the
 * pixels are landscape and the rotation lives only in the EXIF the canvas
 * throws away.
 */
export async function downscale(file: File): Promise<Blob | null>

/**
 * Upload, return the object path or null. Path is '<owner uuid>/<uuid>.jpg' and
 * the leading segment is not cosmetic: every policy keys on
 * (storage.foldername(name))[1]. This is the only function that builds a path.
 */
export async function uploadMealPhoto(file: File): Promise<string | null>

/** Short-lived signed URL (3600s). The bucket is private; no public URL exists. */
export async function mealPhotoUrl(path: string): Promise<string | null>

export async function deleteMealPhoto(path: string): Promise<boolean>
```

Implementation notes: `createImageBitmap(file, { imageOrientation: 'from-image' })` →
canvas at `fitWithin(w, h, MEAL_PHOTO.maxEdgePx)` → `toBlob('image/jpeg', 0.75)`. On
decode failure, upload the original if `file.size <= MEAL_PHOTO.maxBytes`, else return
null. Upload with `{ contentType: 'image/jpeg', upsert: false }`.

Also, kept pure and tested:

```ts
/** 'HH:MM' for now, rounded to the nearest MEAL_TIME_ROUND_MINUTES. */
export function nowRounded(d = new Date()): string
/** 'YYYY-MM-DD' for the LOCAL day — not toISOString(), which is UTC. */
export function todayLocal(d = new Date()): string
```

> `new Date().toISOString().slice(0,10)` is used elsewhere in this repo and is **wrong
> after 18:30 in IST** — it returns tomorrow. Meals are logged in the evening constantly,
> so use local components here. **Do not "fix" the existing callsites** — real bug, out of
> scope; mention it, leave it.

---

## 6. `src/app.config.ts`

New block after `ACTIVITY_TYPES` (~line 233), following the existing banner style.

```ts
// ----------------------------------------------------------------
// Meals
// ----------------------------------------------------------------
// Three INDEPENDENT axes, deliberately not one list. "Takeaway" is a source,
// not a kind — a takeaway can also be a snack — and collapsing them would make
// "how often do I eat out?" unanswerable without also answering "how often do I
// snack?".
//
// No check constraints back these (see 0032_meal_logs.sql). Adding an option is
// a config edit; the read boundary in getMealLogs guards the column.

export const MEAL_SIZES = {
  light: { label: 'Light' },
  medium: { label: 'Medium' },
  heavy: { label: 'Heavy' },
} as const;

export const MEAL_KINDS = {
  snack: { label: 'Snack' },
  meal: { label: 'Meal' },
} as const;

export const MEAL_SOURCES = {
  home: { label: 'Home' },
  out: { label: 'Out' },
  takeaway: { label: 'Takeaway' },
} as const;

// Suggested tags. Ordered because the chip row's reading order is the point.
// Carries NO colour, unlike ACTIVITY_TAGS: activity tone is charted so its
// hexes carry information. Selected tags use the teal accent per the spec,
// which is a token (--color-teal), not a per-tag hue.
export const MEAL_TAGS = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'veg', label: 'Veg' },
  { key: 'sweet', label: 'Sweet' },
  { key: 'coffee', label: 'Coffee' },
] as const;

// Repeat-meal shortcuts are DERIVED from the distinct custom tags of recent
// meals (newest first) — no second table. This seed is what a brand-new user
// sees before they have saved anything, and it disappears from the front of the
// rail naturally once real custom tags exist. Union, not replacement: if the
// user has also used 'post-workout', it appears once.
export const MEAL_REPEAT_SEED = ['post-workout'] as const;

// How many repeat shortcuts the chip rail shows before it stops. The rail
// scrolls, so this is about signal, not width.
export const MEAL_REPEAT_LIMIT = 6;

// Hunger before / after. Must stay in step with the check constraints in
// 0032_meal_logs.sql — widening this without a migration writes rejected rows.
export const MEAL_SCALE = { min: 1, max: 5 } as const;

// Draft defaults, per the product spec. Unlike most of this app, a meal draft
// arrives PREFILLED: the whole point is that a common meal is one tap plus
// Save.
export const MEAL_DEFAULTS = {
  size: 'medium',
  kind: 'meal',
  source: 'home',
  hungerBefore: 4,
  hungerAfter: 1,
} as const;

// Photo handling. maxEdgePx/quality put a 4000px phone photo at roughly 150KB.
// maxBytes is the ceiling for the fallback path where the browser cannot decode
// the file (HEIC from the iOS library) and the original is uploaded as-is.
export const MEAL_PHOTO = {
  bucket: 'meal-photos',
  maxEdgePx: 1280,
  quality: 0.75,
  maxBytes: 5_000_000,
} as const;

// Default time is now, rounded — nobody ate at exactly 10:37.
export const MEAL_TIME_ROUND_MINUTES = 5;
```

Add every one to the aggregate `config` object at the bottom (`mealSizes`, `mealKinds`,
`mealSources`, `mealTags`, `mealRepeatSeed`, `mealScale`, `mealDefaults`, `mealPhoto`).

Derived types and guards, alongside the existing ones (~line 614+):

```ts
export type MealSizeKey = keyof typeof MEAL_SIZES;
export type MealKindKey = keyof typeof MEAL_KINDS;
export type MealSourceKey = keyof typeof MEAL_SOURCES;
export type MealTagKey = (typeof MEAL_TAGS)[number]['key'];

export const MEAL_SIZE_KEYS   = Object.keys(MEAL_SIZES)   as MealSizeKey[];
export const MEAL_KIND_KEYS   = Object.keys(MEAL_KINDS)   as MealKindKey[];
export const MEAL_SOURCE_KEYS = Object.keys(MEAL_SOURCES) as MealSourceKey[];
export const MEAL_TAG_KEYS    = MEAL_TAGS.map((t) => t.key) as MealTagKey[];

/**
 * `meal_logs.size` / `.kind` / `.source` are unconstrained `text`, so a stored
 * value is NOT guaranteed to be one of these keys however the TypeScript says
 * otherwise. Applied at the boundary in getMealLogs, exactly as isExperienceKey
 * is applied in getUserStats.
 *
 * hasOwnProperty, not `in`: `in` walks the prototype chain, so 'toString' and
 * 'constructor' would pass and hand callers a Function to read `.label` off.
 */
export function isMealSizeKey(v: unknown): v is MealSizeKey { … }
export function isMealKindKey(v: unknown): v is MealKindKey { … }
export function isMealSourceKey(v: unknown): v is MealSourceKey { … }
```

---

## 7. `src/lib/types.ts`

Under the `// ---- DB row types (mirror supabase/migrations) ----` banner. Add the four
meal key types to the existing type-only import from `@/app.config`.

```ts
/**
 * meal_logs (0032). Capture only — nothing derives anything from these rows.
 *
 * `eaten_time` is 'HH:MM' and NOT the raw Postgres value. Postgres `time`
 * serialises as 'HH:MM:SS'; <input type="time"> only accepts 'HH:MM' and
 * silently renders BLANK for anything longer. getMealLogs trims it at the read
 * boundary so no component has to know that.
 *
 * `tags` holds suggested and custom tags together; splitTags() in
 * lib/mealDraft.ts separates them for display.
 */
export interface MealLog {
  id: string;
  owner_user_id: string;
  log_date: string;   // 'YYYY-MM-DD'
  eaten_time: string; // 'HH:MM'
  size: MealSizeKey;
  kind: MealKindKey;
  source: MealSourceKey;
  tags: string[];
  note: string | null;
  hunger_before: number;
  hunger_after: number;
  photo_path: string | null;
  created_at: string;
  updated_at: string;
}

/** What the form writes. The owner comes from the session, never the caller. */
export type MealLogInput = Partial<
  Omit<MealLog, 'id' | 'owner_user_id' | 'created_at' | 'updated_at'>
> & { log_date: string; eaten_time: string };
```

---

## 8. `src/lib/queries.ts`

New section at the end. Conventions that must hold: reads take
`client: SupabaseClient = supabase` **last**; writes never take a client and resolve the
owner from `supabase.auth.getUser()`; nothing throws — reads return `[]`/`null`, writes
return `boolean`; writes call `clearQueryCache()`.

```ts
// ---- meal_logs (owner-only by RLS; deliberately no anon read) ----

/**
 * The one door meal rows come through, so normalisation lives here rather than
 * at each callsite — the argument getUserStats makes. Two things are fixed here
 * and nowhere else:
 *
 *   1. Postgres `time` arrives as 'HH:MM:SS'. <input type="time"> requires
 *      'HH:MM' and renders BLANK for anything else, silently.
 *   2. size/kind/source are unconstrained text, so a value written by an older
 *      build may not be a key we know. Unknown falls back to the MEAL_DEFAULTS
 *      value rather than null — the columns are NOT NULL and the UI always has
 *      a selection.
 */
function normalizeMealLog(row: MealLog): MealLog

export async function getMealLogs(limit = 100, client: SupabaseClient = supabase): Promise<MealLog[]>
export async function getMealLogsInRange(from: string, to: string, client: SupabaseClient = supabase): Promise<MealLog[]>
export async function createMealLog(input: MealLogInput): Promise<MealLog | null>
export async function updateMealLog(id: string, patch: Partial<MealLogInput>): Promise<boolean>
export async function deleteMealLog(id: string): Promise<boolean>
```

Ordering on every read: `.order('log_date', {ascending:false}).order('eaten_time',
{ascending:false})`. `updateMealLog` sets `updated_at: new Date().toISOString()` in the
patch — no triggers exist.

---

## 9. `src/lib/mealDraft.ts` (new) — the product model

Pure, no React, no Supabase. Everything here is unit-tested (§13).

```ts
import type { MealSizeKey, MealKindKey, MealSourceKey } from '@/app.config';

/**
 * The UI-side draft, as specified by the product brief. Deliberately camelCase
 * and deliberately NOT the DB row: `tags` and `customTags` are separate here
 * because the tag section groups them visually, but they persist to ONE
 * `tags` column (see toInput). Keeping two columns would let them disagree.
 *
 * `photoUrl` is a local blob: URL for preview only. It never reaches the
 * database — `toInput` drops it, and the caller supplies the uploaded
 * `photo_path` separately.
 */
export interface MealDraft {
  time: string;        // 'HH:MM'
  size: MealSizeKey;
  kind: MealKindKey;
  source: MealSourceKey;
  date: string;        // 'YYYY-MM-DD'
  tags: string[];       // selected suggested tags
  customTags: string[]; // user-created tags, selected
  hungerBefore: number; // 1-5
  hungerAfter: number;  // 1-5
  notes: string;
  photoUrl: string | null;
}

/** Which preset chip opened the drawer. */
export type MealPreset =
  | { kind: 'custom' }
  | { kind: 'meal' }
  | { kind: 'snack' }
  | { kind: 'repeat'; tag: string };

/**
 * A fresh draft for a preset. Per the spec:
 *   custom  -> blank draft (all defaults)
 *   meal    -> kind = 'meal'
 *   snack   -> kind = 'snack', size = 'light'
 *   repeat  -> meal draft with that custom tag preselected
 * Time and date are always "now", local.
 */
export function draftFor(preset: MealPreset, now = new Date()): MealDraft

/** Draft -> DB input. Merges tags + customTags, trims the note to null if empty. */
export function toInput(draft: MealDraft, photoPath: string | null): MealLogInput

/** DB row -> draft, for editing an existing meal. */
export function toDraft(row: MealLog): MealDraft

/** Splits a persisted tag array into [suggested, custom] by set difference. */
export function splitTags(tags: string[]): { suggested: string[]; custom: string[] }

/**
 * Normalise a typed custom tag: trim, collapse inner whitespace, lowercase.
 * Returns null if empty after trimming. Lowercasing is what makes "Post Workout"
 * and "post workout" the same shortcut rather than two.
 */
export function normalizeTag(raw: string): string | null

/**
 * Repeat-meal shortcuts for the chip rail: the distinct custom tags of recent
 * meals, newest meal first, unioned with MEAL_REPEAT_SEED, capped at
 * MEAL_REPEAT_LIMIT. Newest first is the spec's "newly created shortcuts should
 * be placed before older shortcuts" — and it falls out of the query order for
 * free, since getMealLogs already returns newest first.
 */
export function repeatShortcuts(meals: MealLog[]): string[]
```

---

## 10. Components

All under `src/components/meals/` unless noted.

### 10.1 Shared field components — `MealFields.tsx`

Used **identically** by the drawer and the full logger. This is what makes the two
surfaces one implementation.

**`<FieldRow label>`** — the condensed core row. **No labels above controls.**
- Fixed label column `w-14` (56px), `t-label` uppercase, `text-muted`, vertically centred.
- Control fills remaining width. Row is `flex items-center gap-3`.
- Visual height ~36px; **hit box 44px** per §0.1.

**`<SegmentedChoice>`** — size / kind / source. Extend `ui/SegmentedTabs.tsx` (§0.1) with:
- `as?: 'tabs' | 'radiogroup'` — default `'tabs'` keeps all five existing callers
  byte-identical. Meals pass `'radiogroup'`, rendering `role="radiogroup"` with
  `role="radio" aria-checked`. **This is the correct semantic for picking a value**;
  `role="tablist"` (the current behaviour) means "switches views" and `CLAUDE.md`
  restricts it to that.
- `size?: 'sm' | 'md' | 'compact'` — `compact` = 36px visual, 44px hit box.
- Selected: `bg-accent text-accent-fg`. Unselected: transparent, `border-border`,
  `text-muted`. Keep `aria-pressed`/`aria-checked` — it is an accessibility contract here
  and the flat pressed state keys off it.
- **Selected state must not rely on colour alone** — the fill/weight change carries it.

**`<TimeRow>`** — native `<input type="time">`, `aria-label="Time eaten"`, `tabular-nums`.
On iOS Safari this *is* the scrollable hour/minute/AM-PM wheel, drawn by the OS. Do not
build a wheel.

**`<PhotoRow>`** — "Add picture".
- Hidden `<input type="file" accept="image/*">` behind a button, the `PlanUpload.tsx:362`
  / `GarminPanel.tsx:181` pattern. **No `capture` attribute** — it would force the camera
  and remove "Photo Library" from the iOS sheet.
- After selection: compact thumbnail + "Photo added" + a remove button with
  `aria-label="Remove photo"`.
- Preview via `URL.createObjectURL`. **Revoke it on unmount and on replace** or every pick
  leaks.

**`<HungerSection>`** — nested collapsible, its own `<Disclosure>` *inside* More details.
- Collapsed summary: `Hunger — Before 4 · After 1`.
- Expanded: two `<input type="range" min=1 max=5 step=1>`, five visible marks via
  `<datalist>`, current integer right-aligned in `tabular-nums`.
- Each needs an explicit `aria-label` ("Hunger before eating", "Hunger after eating").
  Range inputs are keyboard-accessible natively — do not intercept arrows.
- Defaults 4 / 1.

**`<TagsSection>`**
- Label `Tags · optional`.
- Suggested chips from `MEAL_TAGS` + the user's custom tags. Selected → teal accent
  (`border-teal text-teal`), unselected → quiet outline. Toggle on tap.
- Compact text input, `aria-label="Add a custom tag"`, plus an **Add button**.
  **Enter also adds** — handle `onKeyDown` for `Enter` **and** `preventDefault()`, or a
  form wrapper will submit the drawer.
- `normalizeTag` trims/collapses/lowercases; duplicates are a no-op; a new custom tag is
  **selected immediately**.

**`<NotesRow>`** — compact `<textarea rows={2}>`, placeholder
`Anything worth remembering?`, never required.

**`<MoreDetails>`** — full-width quiet utility row, `ui/Disclosure` (native `<details>`).
Contains, in order: Date → Hunger → Tags → Notes. **Collapsed on every open** (§10.2).

### 10.2 `MealDrawer.tsx`

Uses `ui/Modal` with `keyboardInset` (§0.3) — bottom sheet on mobile, the app's centred
card on desktop. Modal already gives scrim-click, Escape, focus trap, focus return, scroll
lock on the correct root, `pb-safe`, and `max-h-[85dvh]`.

- Header: teal eyebrow `Quick capture`, title `Log a meal`, close icon button with
  `aria-label`. Modal's `title` prop renders one line only, so render this header **inside
  the children** and leave `title` unset — pass `aria-label="Log a meal"` for the dialog.
- Body scrolls: `<div className="min-h-0 flex-1 overflow-y-auto p-4">`.
- Footer pinned: `<div className="flex shrink-0 gap-2 border-t border-border p-4">` —
  secondary icon button (`aria-label="Open the full logger"`) → `/app/meals/log`, then
  primary `Save meal`.
- **"More details" resets to collapsed on every open.** `Modal` unmounts its children on
  close, so a `<Disclosure>` without `defaultOpen` already resets — but verify it, because
  a `key` or a hoisted state would break it. This is acceptance criterion 8.
- Save → `uploadMealPhoto` (if a photo) → `createMealLog(toInput(draft, path))` → prepend
  to Today's meals → close → `toast('Meal saved')`. If the upload fails, **still save the
  row** and toast that the photo did not upload. Losing the log because a photo failed is
  worse than losing the photo.
- `track('meal_logged', { size, kind, source, has_photo, tag_count })`, mirroring
  `ActivityLogger`'s `track('activity_logged', …)`.

### 10.3 `MealChipRail.tsx`

Lives **inside the active-plan card**, directly beneath the Start workout row.

- ~48px high, `border-t border-border-soft` above it.
- **Fixed left**: meal/restaurant icon + label `Add meal`. Never scrolls.
- **Only the chip region scrolls horizontally**: `flex-1 min-w-0 overflow-x-auto`,
  `overscroll-behavior-x: contain` so it does not chain to the page.
- **Hide the scrollbar, keep the scrolling.** Add one utility to `global.css`:
  ```css
  .scrollbar-none { scrollbar-width: none; -ms-overflow-style: none; }
  .scrollbar-none::-webkit-scrollbar { display: none; }
  ```
  Touch, wheel, trackpad and keyboard all still work — chips are focusable buttons, so
  Tab scrolls them into view natively.
- **Chip order, non-negotiable:** `Custom` (plus icon) → repeat-meal shortcuts (newest
  first) → `Meal` → `Snack`. Custom and repeats always precede the generic presets.
- Each chip is a button opening `MealDrawer` with `draftFor(preset)`.
- Chips are `--radius-chip` (3px), visually compact, **44px hit box**.
- Must not grow the plan card more than the 48px row.

### 10.4 `TodaysMeals.tsx`

Home section, **below the activity chart** (§1.2, §11.2).

- Header `Today's meals` + `All →` linking to `/app/meals`.
- Rows: time (**teal**, `tabular-nums`) · size · kind · source in quiet capitalisation.
- 1px `--color-border-soft` dividers between rows, card at `--radius-card` (6px).
- Empty state: `No meals logged yet.`
- Seeds from `getCached<MealLog[]>('meals:today')` then revalidates — the SWR shape
  `ProfileView` already uses.

### 10.5 Full logger — `FullMealLogger.tsx` + `src/pages/app/meals/log.astro`

**A dedicated page, not another modal.** Opened by the drawer's secondary button.

- Header: Back, `Log a meal`, quiet `Full logger` marker.
- Body scrolls independently; Save footer pinned. Because `App.astro` already owns a
  non-scrolling shell with `[data-scroll-root]`, the footer is `sticky bottom-0` **inside**
  the scroller — the Logger's Finish bar pattern. **Never anchor it to the viewport**;
  `audit:shell` guards this and `docs/LESSONS.md` explains why `sticky bottom-0` on the
  viewport detaches on iOS.
- Shows **all** fields flat (no drawer collapsing except Hunger): Time, Size, Kind, Source,
  Photo, Date, collapsible hunger sliders, tags + custom-tag creation, Notes.
- Same `MealDraft` state and the same §10.1 components. Zero duplicated field code.
- Back returns to the previous surface. Use the existing ClientRouter/scroll-restoration
  patterns; do not reset unrelated home scroll.

`src/pages/app/meals/log.astro` — the standard 6-line wrapper. Note `plan.astro` and
`plan/` already coexist, so `meals.astro` + `meals/log.astro` is an established shape.

### 10.6 History — `MealsView.tsx` + `src/pages/app/meals.astro`

Where `All →` goes. Grouped by day, newest first, rows in one `ListCard` with hairline
dividers. Tapping a row opens the drawer with `toDraft(row)` for edit; Delete removes the
row and its storage object. `EchoText text="MEALS" className={ECHO_APP_TITLE}` — **not**
`ECHO_HERO`; everything under `/app` uses the one size. Thumbnails resolve
`mealPhotoUrl(path)` into a `Record<string,string>` in state — **never call it in render**,
it is async and would loop.

---

## 11. Wiring

### 11.1 Chip rail into the active-plan card — `ProfileView.tsx`

The card has **two branches** and the rail goes in **both**:

- **Plan present:** after the Start row's closing `</div>` (~line 671), before the
  `<div className="flex justify-end">` that holds `Coach →` (~line 672).
- **No active plan:** after the `Start workout` / `Coach` row (~line 709).

Do not move the meal action above Start workout, and do not restyle the plan card.

### 11.2 Today's meals — `ProfileView.tsx`

Between the `ActivityStrip` `<Item>` (closes ~line 725) and the `StatStrip` `<Item>`
(~line 731):

```tsx
{mode === 'app' ? (
  <Item>
    <section className="mb-6">
      <TodaysMeals />
    </section>
  </Item>
) : null}
```

**`mode === 'app'` is mandatory, not cosmetic.** `ProfileView` also renders `/showcase`
through the anonymous client, which has no read access to `meal_logs` by design. Rendering
it there would show a permanently empty card to the public. Same gate on the chip rail.

### 11.3 Drawer state

Chip rail and Today's meals both open the drawer. Hoist `const [draft, setDraft] =
useState<MealDraft | null>(null)` into `ProfileView` and pass an opener down, rather than
giving each a drawer — one dialog, one focus trap, one scroll lock.

### 11.4 `src/layouts/App.astro`

One entry in the non-showcase `groups` array (~line 50) under **Today**:
`{ href: '/app/meals', label: 'Meals' }`.

**Do not touch the `tabs` array.** The bottom ribbon stays at five slots.

---

## 12. What this change must not break

- `npm run audit:mobile` is **green at 24/24 for the first time ever**. This change adds
  many targets and asks for compact controls. See §0.1. Keep it green — a red baseline is
  worse than a failing one.
- `npm run audit:flicker` is **8/8 with zero skips**. §0.3 modifies `Modal`, which every
  sheet uses. Run it before and after.
- No new `backdrop-blur` without `pointer-fine:`.
- No `box-shadow` anywhere. Surfaces separate with a 1px border and a surface-tone step.
- **No raw hex.** §0.2.
- `font-display` never paired with a weight utility.
- Nothing anchored to the **viewport** bottom (`audit:shell`).
- The active training plan stays the dominant element; its card is not redesigned.

---

## 13. Tests

Vitest, `environment: 'node'`, co-located `src/lib/<module>.test.ts`. Pure logic only —
no jsdom, no component tests in this repo. Prose header per file naming the bug it guards.

**`mealLogs.test.ts`** — copy the fake PostgREST client from `userStatsRow.test.ts`
(chain: `.from().select().order().order().limit()`).
- `'10:30:00'` → `'10:30'` (the input-blanking bug)
- null `tags` → `[]`
- `size: 'enormous'` → `'medium'`; `size: 'toString'` → `'medium'` (prototype-chain trap)
- empty result → `[]`, not a throw

**`mealDraft.test.ts`** — the product logic, and the densest test file here.
- `draftFor({kind:'snack'})` → `kind='snack'`, `size='light'`
- `draftFor({kind:'meal'})` → `kind='meal'`, `size='medium'`
- `draftFor({kind:'custom'})` → all defaults, no tags
- `draftFor({kind:'repeat',tag:'post-workout'})` → `customTags` contains it, `kind='meal'`
- `toInput` merges `tags` + `customTags` into one array, drops `photoUrl`, empty note → null
- `splitTags(['protein','post-workout'])` → suggested `['protein']`, custom `['post-workout']`
- `normalizeTag('  Post   Workout ')` → `'post workout'`; `normalizeTag('   ')` → `null`
- `repeatShortcuts` — newest first, deduped, seed unioned not duplicated, capped at
  `MEAL_REPEAT_LIMIT`

**`mealPhoto.test.ts`** — `fitWithin` only (the rest needs a browser).
- 4032×3024 max 1280 → 1280×960; 3024×4032 → 960×1280; 800×600 → 800×600 (no upscale);
  2000×2000 → 1280×1280
- `todayLocal` returns the **local** day for a time already tomorrow in UTC

---

## 14. Docs (`docs-upkeep`)

`npm run audit:docs` fails if the docs name code that no longer exists.

- **`docs/SPEC.md` §8** — a `meal_logs` bullet: columns, the wall-clock decision,
  "owner-only, no anon policy, never add one", the `meal-photos` bucket and its path
  convention, and that repeat shortcuts are derived rather than stored.
- **`docs/ROADMAP.md`** — a Phase 10 entry stating plainly that this is **capture only**.
  Under "Deliberately not done": no macros/calories/scoring/recommendations, no calendar
  integration, no Coach input, one photo per meal, no offline queue.
- **`docs/LESSONS.md`** — only if something actually bit you. Likely candidates: Postgres
  `time` blanking `<input type="time">`; EXIF rotation without `imageOrientation`; the
  `visualViewport` inset on `Modal`. Symptom first, so it can be grepped.

---

## 15. Supabase handover

The connector is authorized and healthy; §3 was read from the live project. What remains
is short.

### Blocked in the planning session

`execute_sql` worked read-only, but **`list_migrations` returned
`MCP tool call requires approval`** and the session was non-interactive. `apply_migration`
hits the same gate. **The Magic Patterns MCP is gated identically** — which is why §1.1's
design has not been read into this document.

### What the implementing session must do

1. **Run interactively** (or where MCP write approvals can be granted). Nothing about the
   connector needs setting up.
2. **Read the Magic Patterns design** (§1.1) before building the UI.
3. **`apply_migration` `0032_meal_logs.sql`.** Head confirmed at `0031_onboarding`.
4. **`apply_migration` `0033_meal_photos_bucket.sql`** — bucket insert only.
5. **Create the four `storage.objects` policies by hand**, Dashboard → Storage → Policies.
   **No migration can do this** (§4.2). Confirm:
   `select policyname from pg_policies where schemaname='storage' and tablename='objects';`
   → expect exactly four.
6. **Confirm the bucket is private:**
   `select id, public from storage.buckets where id='meal-photos';` → `public = false`.
7. **`get_advisors`** (security, then performance) and report the output.

### The one thing only the user can answer

**Storage quota.** ~150KB a photo × three photographed meals a day ≈ 160MB/year; the free
tier is 1GB. Not a blocker — and the only number that cannot be read from the database.

### What does not wait

Build steps 1, 3–4 and 6–16 (§2) run locally with no Supabase access. Only the applied
schema and §16 depend on the above; the photo row specifically stays inert until step 5.

---

## 16. Verification

| Check | What it proves | What it cannot see |
|---|---|---|
| `npm test` | Draft logic, read-boundary normalisation, resize math | Anything visual or in the DB |
| `npm run check` | `astro check`, 0 errors | Runtime behaviour |
| `npm run audit:mobile` | No sub-44px targets, no 375px overflow — **must stay 24/24** | Flicker, colour, dark mode |
| `npm run audit:flicker` | Sheets still behave after the `Modal` change — **8/8, zero skips** | Anything outside sheets |
| `npm run audit:shell` | The full logger's footer did not detach | The iOS symptom itself |
| `npm run audit:docs` | Docs don't name code that doesn't exist | Whether the docs are right |

Manual, at 375px **and** desktop, once the schema is live:

1. Every chip opens a correctly prefilled drawer (Custom blank; Meal `kind=meal`; Snack
   `kind=snack,size=light`; a repeat with its tag selected).
2. The `Add meal` icon and label stay fixed while chips scroll; the page does not scroll
   sideways.
3. More details is collapsed on **every** open, including the second one.
4. Hunger collapses independently; both sliders move with arrow keys and announce a label.
5. A custom tag added with the button, and another with Enter — Enter must not submit the
   drawer. Duplicates and case variants collapse to one.
6. Save → the meal appears in Today's meals, the drawer closes, a toast confirms, and the
   new custom tag is a chip on Home.
7. The expand button opens `/app/meals/log` as a **page**, not a modal; Back preserves home
   scroll.
8. Photo: pick → thumbnail + "Photo added" → remove → re-pick. Portrait phone photo is
   **not rotated** after reload.
9. Escape closes; focus returns to the triggering chip; the page behind does not scroll.
10. Software keyboard open on the Notes field — the footer and the field stay reachable.
11. `/showcase` in a private window → **no meal data anywhere**, no console errors.
12. Light / dark / system → every chip, slider and thumbnail readable in all three.
13. Existing training + navigation flows still work; the plan card is unchanged.

**"Verified" means the symptom was observed to stop.** Naming a check that cannot see the
bug is not evidence.

---

## 17. Acceptance criteria

Verbatim from the brief. All twenty must hold.

1. Activity appears before Today's meals.
2. The Add meal icon and label remain fixed while chips scroll horizontally.
3. Custom appears first.
4. Repeat-meal shortcuts appear before Meal and Snack.
5. Tapping every chip opens a correctly prefilled bottom drawer.
6. Labels and core controls share horizontal rows.
7. Photo selection, preview, and removal work.
8. More details is collapsed on every new drawer open.
9. Hunger is independently collapsible.
10. Hunger defaults are Before 4 and After 1.
11. Both hunger controls are five-point sliders.
12. Suggested tags are optional.
13. Custom tags can be added with the button or Enter.
14. Saved custom tags appear as quick chips on Home.
15. Save adds the meal to Today's meals.
16. The expand button opens a dedicated scrollable logger.
17. Keyboard, focus, Escape, and scroll-lock behavior work.
18. The feature visually matches Verocity's existing carbon/teal system.
19. Existing training and navigation flows still work.
20. TypeScript builds without errors.

---

## 18. Deliberately not doing

- **Any processing.** No calorie targets, macros, meal scores, nutritional judgment, AI
  recommendations, or derived nutrition data.
- **No custom scroll-wheel time picker.** The native input already is one on iOS.
- **No sixth bottom-ribbon tab.** Chip rail + a drawer entry.
- **No design-comparison page, mock phone frames, or "Quick Chips Morph" heading** in the
  app. No marketing copy beside the UI. No second app shell.
- **No redesign of the active training-plan card**, and the meal action never moves above
  Start workout.
- **No multiple photos, cropping, or image analysis.** One optional photo.
- **No offline queueing.** The app has no offline write path (ROADMAP decision #3).
- **No second table for repeat shortcuts** — derived from tags.
- **Not fixing `toISOString().slice(0,10)` elsewhere.** Real bug, out of scope.
