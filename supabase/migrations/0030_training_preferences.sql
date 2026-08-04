-- Training preferences: the inputs that decide what a generated plan looks
-- like, as opposed to the anthropometrics 0020 added.
--
-- WHY HERE AND NOT ON `profiles`, again: 0020's header has the long version.
-- `profiles_select_showcase` (0002_rls.sql) is `for select to anon using
-- (is_showcase)` with NO column list, and ProfileView does `.select('*')` with
-- the anon client, so every column on `profiles` is published to unauthenticated
-- visitors the moment it exists. Goals and injuries are the same class of fact:
-- they belong on `user_stats`, which has no anon policy at all.
--
-- WHAT READS THIS. All five columns feed `buildPlanAiPrompt` in
-- src/lib/planTemplate.ts, which renders them into the ATHLETE PROFILE block of
-- the prompt the user copies from /app/plan/upload. That prompt is pasted into
-- an external AI, so this is the first owner data in the app that leaves it —
-- but only by the user's own hand, via their own clipboard. Nothing here is
-- transmitted by the app, and `getUserStats` still returns null for the anon
-- client, so none of it can reach the showcase.
--
-- `goals` was a UI mock before this (GoalsEditor held it in useState and said
-- so). The shape is unchanged from that mock so the editor keeps working.
alter table public.user_stats
  -- Goal[] — { id, label, weight }, weight 0..100. ARRAY ORDER IS THE RANK, so
  -- this is a jsonb array and not an object: `{"strength": 70}` would lose it.
  -- `label` is authoritative, not `id`: the editor allows free-text goals whose
  -- id is a uuid, and the prompt renders labels for exactly that reason.
  add column goals                jsonb not null default '[]'::jsonb,
  -- EXPERIENCE_LEVELS / EQUIPMENT vocabularies live in src/app.config.ts, not in
  -- check constraints — same call 0020 made for `gender` and `body_type`, so
  -- adding an equipment option is a config edit and not a migration.
  add column experience           text,
  add column days_per_week        int,
  -- EquipmentKey[] — order carries no meaning here, unlike `goals`.
  add column equipment            jsonb not null default '[]'::jsonb,
  -- PLAN_LENGTH bounds it to 6..12 in the form; stored unbounded because the
  -- prompt treats it as the athlete's opening bid, not a hard constraint.
  add column preferred_plan_weeks int;

-- Nullable scalars, same reason as 0020: a half-filled form must save, and a
-- user who only sets goals should get the goals benefit. Absence is meaningful
-- downstream — a missing field becomes a question the AI asks in phase 1.

-- No new RLS policies. `us_select_own` / `us_insert_own` / `us_update_own` /
-- `us_delete_own` are table-level and cover new columns automatically. There is
-- still deliberately NO anon policy on this table. Do not add one.

comment on table public.user_stats is
  'Owner anthropometrics, injury history and training preferences. Owner-only by design: holds age, gender, injuries and goals, which must never reach the anon showcase read. Never add an anon policy.';
