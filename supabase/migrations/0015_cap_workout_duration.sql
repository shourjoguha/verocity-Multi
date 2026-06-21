-- Retro-cap historical workout durations at 2 hours, matching the new auto-end
-- policy (the Logger now auto-ends sessions left running past 2h). One-off,
-- idempotent: re-running changes nothing once all rows are <= 7200s. Only
-- total_seconds (the displayed/aggregated duration) is adjusted; started_at is
-- left intact so the original start is preserved.
update public.workout_logs
  set total_seconds = 7200
  where total_seconds > 7200;
