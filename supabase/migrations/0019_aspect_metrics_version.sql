-- Version the derived radar metrics, and clear the rows written under the old
-- definition.
--
-- `aspect_snapshots.metrics` holds raw measurements, and the radar scores each
-- axis against the MEDIAN of the owner's own past values for that metric. So a
-- change to what a metric *means* silently poisons every score built on it:
-- `strength` was a mean best e1RM in kilograms (~110); it is now scaled training
-- volume per week. A baseline holding both yields a median that describes
-- neither, and nothing on screen would reveal it — the polygon would just be
-- quietly wrong.
--
-- A bare `delete from aspect_snapshots` would fix today and become a landmine:
-- re-applied against a database that has since rebuilt a good baseline, it would
-- wipe it. Versioning makes the reset precise and the migration idempotent —
-- re-running this deletes nothing once every row carries the current version.
--
-- The next change to computeAspectMetrics bumps ASPECT_METRICS_VERSION and adds
-- a two-line migration in this shape. See the AspectMetrics contract in
-- src/lib/types.ts.
alter table public.aspect_snapshots
  add column metrics_version int not null default 1;

comment on column public.aspect_snapshots.metrics_version is
  'Which definition of computeAspectMetrics produced `metrics`. Rows below the app''s ASPECT_METRICS_VERSION are stale and must never enter a baseline.';

-- 1 = e1RM-based strength, plyometric minutes for power, aerobic-only endurance.
-- 2 = scaled training volume for strength/power, three-component endurance.
delete from public.aspect_snapshots where metrics_version < 2;
