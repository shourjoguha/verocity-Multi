-- Resting heart rate on the athlete's profile, for heart-rate effort.
--
-- An activity (tennis, a run) usually has no RPE but often has avg / max heart
-- rate. Effort is read from % of heart-rate reserve,
-- (avg - resting) / (peak - resting), which needs a resting rate
-- (lib/enduranceIntensity.ts, ENDURANCE_INTENSITY in app.config.ts). Null means
-- unknown: the heart-rate channel stays silent and the activity's default
-- intensity applies. Garmin's daily resting HR lives in garmin_health_daily and
-- is not read here; this is the athlete's own stated value.
--
-- Additive and nullable. user_stats' existing owner-only RLS covers it.

alter table public.user_stats
  add column resting_hr int check (resting_hr between 25 and 120);
