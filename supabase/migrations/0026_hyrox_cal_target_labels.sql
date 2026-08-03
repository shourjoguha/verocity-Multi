-- Verocity v2 — swap the time-window planned label for the real calorie
-- target on the three Hyrox EMOM movements that have one.
--
-- 0025 retagged calorie-scored movements to primaryMetric "cal", but left
-- `planned` as the per-minute time window ("1x60s") wherever it was
-- authored that way — correct for genuinely unbounded max-effort stations
-- (Beverly Hills, Cliff, Reed: "40/60 second Max Calorie X" has no fixed
-- number, so the time window is the only real constraint and stays as the
-- badge). But Miller, Nelson and Nash's calorie movements DO have a fixed
-- Rx target buried in `notes` ("20/15 cal · Minute 1", "15 cal · Minute 3",
-- "12 cal") — for those the set-row badge should show the calorie count,
-- not a leftover "60S" that reads as a time metric next to a calories input.
--
-- Sibling reps-metric movements in these same sessions (Wall Ball, Burpee)
-- keep their "60s" planned label — out of scope here; only the
-- calorie-tagged movements change.

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,0,planned}', '"1x20"'),
  '{groups,0,items,0,planned}', '"1x20"'
)
where name = 'Hyrox · Miller' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,2,planned}', '"1x15"'),
  '{groups,0,items,2,planned}', '"1x15"'
)
where name = 'Hyrox · Nelson' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,2,planned}', '"1x12"'),
  '{groups,2,items,0,planned}', '"1x12"'
)
where name = 'Hyrox · Nash' and owner_user_id is null;
