-- Per-workout heart rate: average and max BPM, captured post-session like
-- total_seconds (a plain column, not part of the LogDocument JSONB, so stats
-- and the coach can aggregate it directly). Owner RLS already covers every
-- column on workout_logs, so no policy change is needed.
alter table public.workout_logs
  add column hr_avg int,
  add column hr_max int;
