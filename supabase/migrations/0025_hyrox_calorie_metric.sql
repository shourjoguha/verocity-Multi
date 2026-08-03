-- Verocity v2 — retag calorie-scored Hyrox movements with the new "cal" metric.
--
-- 0024 seeded these movements as primaryMetric "distance" because "cal" did
-- not exist yet as a MetricKey (src/app.config.ts METRICS). The source WODs
-- score them by calories, not meters — "40 second Max Calorie Ski Erg",
-- "5-10-15-20-25 calorie Row" — so the Logger's set input should be a
-- calorie count, not a distance. This is a data fix, not a schema change:
-- `frame` stays jsonb, only twelve movement entries' `primaryMetric` flip
-- from "distance" to "cal" across each session's `exercises[]` mirror and its
-- authoritative `groups[].items[]`. Never edit 0024 — it already applied.
--
-- Positions were confirmed against the live rows before writing this (each
-- session's frame was fetched and the exercises/groups indices verified to
-- match what's below).

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,1,primaryMetric}', '"cal"'),
  '{groups,0,items,1,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Beverly Hills' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,3,primaryMetric}', '"cal"'),
  '{groups,0,items,3,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Changning' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(frame, '{exercises,0,primaryMetric}', '"cal"'),
      '{exercises,2,primaryMetric}', '"cal"'
    ),
    '{groups,0,items,0,primaryMetric}', '"cal"'
  ),
  '{groups,0,items,2,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Flint' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,1,primaryMetric}', '"cal"'),
  '{groups,1,items,0,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Hetfield' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,0,primaryMetric}', '"cal"'),
  '{groups,0,items,0,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Miller' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(frame, '{exercises,0,primaryMetric}', '"cal"'),
      '{exercises,2,primaryMetric}', '"cal"'
    ),
    '{groups,0,items,0,primaryMetric}', '"cal"'
  ),
  '{groups,0,items,2,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Cliff' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,2,primaryMetric}', '"cal"'),
  '{groups,0,items,2,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Nelson' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,0,primaryMetric}', '"cal"'),
  '{groups,0,items,0,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Holly' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(frame, '{exercises,0,primaryMetric}', '"cal"'),
      '{exercises,2,primaryMetric}', '"cal"'
    ),
    '{groups,0,items,0,primaryMetric}', '"cal"'
  ),
  '{groups,0,items,2,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Reed' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,2,primaryMetric}', '"cal"'),
  '{groups,2,items,0,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Nash' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,0,primaryMetric}', '"cal"'),
  '{groups,0,items,0,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Smith (Partner)' and owner_user_id is null;

update public.sessions
set frame = jsonb_set(
  jsonb_set(frame, '{exercises,0,primaryMetric}', '"cal"'),
  '{groups,0,items,0,primaryMetric}', '"cal"'
)
where name = 'Hyrox · Cash (Partner)' and owner_user_id is null;
