-- Make the public showcase LIVE instead of a frozen ten-day exhibit.
--
-- 0006 capped the anon SELECT on workout_logs at 2026-05-21; 0009 then bounded
-- both ends to 2026-04-20…2026-04-29. Both were the right call when the
-- showcase was a static demo: they hid the owner's incidental history behind a
-- tidy window. But they also mean nothing logged since April can ever be
-- public, so the showcase drifted into a museum piece of a single week.
--
-- The showcase is now a live read-only mirror of the app (SPEC §7A), so the
-- date bound goes. What replaces it is a QUALITY bound rather than nothing at
-- all: 0009's own comment is the reason — the raw history carries cancelled
-- stubs and a ~60-hour stopwatch artefact, which are fine for the authenticated
-- owner and messy for a first-time visitor. `status <> 'cancelled'` drops the
-- stubs and keeps every real session, forever, updating as they are logged.
--
-- Scope is unchanged otherwise: TRAINING ONLY. No new table is exposed here.
-- meal_logs (0032) and user_stats (0020) still have no anon policy at all, so
-- meals, anthropometrics and the Garmin health surfaces stay private — the
-- showcase renders no widget for them.
--
-- Enforced at the DB, because RLS is THE security boundary (CLAUDE.md) — the
-- read-only UI is presentation, not permission. The owner's own auth.uid()
-- policies (logs_select_auth etc.) are untouched, so the authenticated owner
-- still sees everything including cancelled rows. Keeps the 0004 initplan wrap
-- so showcase_profile_id() is evaluated once per query rather than per row.
alter policy logs_select_anon on public.workout_logs
  using (
    owner_user_id = (select public.showcase_profile_id())
    and status <> 'cancelled'
  );
