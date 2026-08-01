-- Owner anthropometrics and injury history, edited on /app/settings.
--
-- WHY THIS IS NOT COLUMNS ON `profiles`, which is the obvious place for it:
-- `profiles_select_showcase` (0002_rls.sql) is `for select to anon using
-- (is_showcase)` — a WHOLE-ROW grant with no column list — and ProfileView
-- fetches `.select('*')` with the anon client to render /showcase. Every column
-- added to `profiles` is therefore published to unauthenticated visitors the
-- moment it exists. Age, gender and injury history must never travel that way,
-- so they live here instead, with NO anon policy at all: the deny-all shape
-- already used by `invites` and `garmin_connections`.
--
-- Two of these fields reach a metric. `body_weight_kg` prices unweighted work
-- (VOLUME.bodyweightFraction in src/app.config.ts), replacing a flat 40kg that
-- was the same for a 55kg and a 110kg lifter. `birth_year` supplies 220−age as
-- the last-resort HR ceiling. `height_cm`, `gender`, `body_type` and `injuries`
-- are stored and read by nothing — see the app.config.ts note on BODY_TYPES.
--
-- ONE CURRENT ROW, NOT A TIME SERIES. A log from six months ago is priced with
-- today's bodyweight. That is a real inaccuracy and an accepted one: a
-- bodyweight history is the known next step if pricing drift ever shows up on
-- screen, and it would be a new table rather than a change to this one.
create table public.user_stats (
  -- PK is the owner: exactly one stats row per profile, and the upsert target.
  owner_user_id  uuid primary key references public.profiles (id) on delete cascade,
  body_weight_kg numeric(5,2),
  height_cm      numeric(5,1),
  -- Birth YEAR, not age — age derived at read time so the row never goes stale.
  birth_year     int,
  -- Vocabulary lives in app.config.ts (GENDERS / BODY_TYPES), not in a check
  -- constraint: adding a body-type option must not require a migration, and
  -- nothing downstream branches on the value.
  gender         text,
  body_type      text,
  -- Injury[] — { id, region, label, year?, notes? }. `region` is a RegionKey
  -- from MUSCLE_REGIONS so /app/body can later flag load on an injured region
  -- without a data migration. Nothing reads it yet.
  injuries       jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- Every column but `injuries` is nullable: a half-filled form must save, and a
-- user who only ever enters bodyweight should get the bodyweight benefit.

alter table public.user_stats enable row level security;

-- Owner-only, all four verbs. There is deliberately NO `_select_anon` policy —
-- see the header. Do not add one.
create policy us_select_own on public.user_stats
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy us_insert_own on public.user_stats
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy us_update_own on public.user_stats
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy us_delete_own on public.user_stats
  for delete to authenticated using (owner_user_id = (select auth.uid()));

comment on table public.user_stats is
  'Owner anthropometrics + injury history. Owner-only by design: holds age, gender and injuries, which must never reach the anon showcase read. Never add an anon policy.';
