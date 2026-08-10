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
