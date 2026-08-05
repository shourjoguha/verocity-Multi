-- New-user onboarding: the guided first-run flow that fills the `user_stats`
-- preferences 0030 added, plus the two fields that flow needs but 0020/0030
-- didn't have — the discipline the athlete trains in, and a marker that the
-- flow has been seen.
--
-- WHY HERE AND NOT ON `profiles`, once more: 0020's header has the long
-- version. `profiles_select_showcase` (0002_rls.sql) publishes every column on
-- `profiles` to anon, so preference facts belong on `user_stats`, which has no
-- anon policy at all. `disciplines` is the same class of fact as `equipment`
-- and `goals`; `onboarded_at` is a private flag with no reason to be public.
--
-- WHAT READS THIS.
--   `disciplines` — rendered into the ATHLETE PROFILE block of
--     `buildPlanAiPrompt` (src/lib/planTemplate.ts) alongside `equipment`, and
--     editable afterwards in Settings (UserStatsPanel). Its vocabulary is
--     DISCIPLINES in src/app.config.ts, NOT a check constraint — same call 0020
--     and 0030 made for gender / experience / equipment, so adding a discipline
--     is a config edit and not a migration.
--   `onboarded_at` — set by OnboardingView when the flow is finished OR skipped,
--     read by the post-signup redirect so a returning user is never re-prompted.
alter table public.user_stats
  -- DisciplineKey[] — order carries no meaning, like `equipment`.
  add column disciplines  jsonb not null default '[]'::jsonb,
  -- Null until the onboarding flow is completed or dismissed. Nullable so a
  -- pre-existing user (who never saw onboarding) simply reads as "not yet",
  -- and so a half-filled flow that the user abandons still leaves the row valid.
  add column onboarded_at timestamptz;

-- No new RLS policies. `us_select_own` / `us_insert_own` / `us_update_own` /
-- `us_delete_own` are table-level and cover new columns automatically. There is
-- still deliberately NO anon policy on this table. Do not add one.
