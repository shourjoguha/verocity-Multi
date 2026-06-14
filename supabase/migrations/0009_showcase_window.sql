-- Narrow the public showcase to a tidy, fixed 10-day window.
--
-- Migration 0006 only capped the anon SELECT policy's upper bound at
-- 2026-05-21, which still exposed the owner's incidental/test logs (cancelled
-- stubs, a ~60-hour stopwatch artefact, near-empty sessions) — fine for the
-- authenticated owner, messy for a first-time visitor clicking through the
-- read-only showcase. Bounding BOTH ends to 2026-04-20…2026-04-29 surfaces a
-- clean block of training on 7 of 10 days.
--
-- Enforced at the DB (RLS is THE security boundary, CLAUDE.md). The owner's own
-- auth.uid()-scoped policies (logs_select_auth etc.) are untouched, so the
-- authenticated owner still sees everything. Keeps the 0004 initplan wrap so the
-- showcase_profile_id() lookup is evaluated once, not per row.
alter policy logs_select_anon on public.workout_logs
  using (
    owner_user_id = (select public.showcase_profile_id())
    and log_date between date '2026-04-20' and date '2026-04-29'
  );
