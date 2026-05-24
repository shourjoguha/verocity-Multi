-- Freeze the public showcase at a fixed cutoff. The showcase is served to the
-- anon role, scoped by RLS to the showcase profile; capping the anon SELECT
-- policy on workout_logs at log_date <= 2026-05-21 means newer activity the
-- owner logs never becomes publicly readable — enforced at the DB, not the UI
-- (CLAUDE.md: RLS is the security boundary). The owner's own policies
-- (logs_select_auth etc., scoped by auth.uid()) are untouched, so the
-- authenticated owner still sees everything. Keeps the 0004 initplan wrap.
alter policy logs_select_anon on public.workout_logs
  using (
    owner_user_id = (select public.showcase_profile_id())
    and log_date <= date '2026-05-21'
  );
