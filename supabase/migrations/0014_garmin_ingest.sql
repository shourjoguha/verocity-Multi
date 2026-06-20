-- Garmin integration — ingest schema (plan §6, §8, §14).
-- Raw + normalized, owner-scoped, lossless. Every ingestion source (the GDPR ZIP
-- importer, the unofficial daily client, and the eventual official push) writes
-- these SAME tables, so the source can be swapped without touching storage. Reads
-- are owner-scoped via RLS; writes are service-role only (the worker / import
-- function), so there are deliberately no client insert/update policies. Health
-- signals are GDPR special-category data, so — unlike workout_logs — these tables
-- get NO anon/showcase policy and are never publicly readable.

-- ---- raw landing / audit log (lossless; replay + dedupe) ----
-- One row per Garmin "summary" (an activity, a day's wellness, a night's sleep).
-- `source` records which adapter wrote it; `payload` keeps the untouched JSON so
-- nothing is lost even when the normalizer ignores fields it doesn't map yet.
create table public.garmin_raw_events (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  source        text not null check (source in ('zip','client','webhook')),
  summary_type  text not null,        -- 'activity' | 'daily' | 'sleep' | …
  summary_id    text not null,        -- stable per-summary id from Garmin
  payload       jsonb not null,
  status        text not null default 'received'
                  check (status in ('received','processed','error')),
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text,
  -- Idempotency: re-importing the same export, or overlapping daily windows, must
  -- converge to one row rather than duplicate.
  unique (owner_user_id, summary_type, summary_id)
);
create index garmin_raw_events_owner_idx
  on public.garmin_raw_events (owner_user_id, received_at desc);

alter table public.garmin_raw_events enable row level security;
create policy garmin_raw_select_own on public.garmin_raw_events
  for select to authenticated using (owner_user_id = (select auth.uid()));
-- writes: service-role only (no insert/update/delete policies).

-- ---- normalized activities (source of truth for rich per-activity fields) ----
create table public.garmin_activities (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null references public.profiles (id) on delete cascade,
  provider_activity_id text not null,
  activity_type       text,
  start_time          timestamptz,
  duration_seconds    int,
  distance_m          numeric,
  avg_hr              int,
  max_hr              int,
  calories            int,
  avg_speed           numeric,
  elevation_gain_m    numeric,
  raw                 jsonb not null default '{}'::jsonb,
  garmin_updated_at   timestamptz,
  created_at          timestamptz not null default now(),
  unique (owner_user_id, provider_activity_id)
);
create index garmin_activities_owner_start_idx
  on public.garmin_activities (owner_user_id, start_time desc);

alter table public.garmin_activities enable row level security;
create policy garmin_activities_select_own on public.garmin_activities
  for select to authenticated using (owner_user_id = (select auth.uid()));
-- writes: service-role only.

-- ---- normalized all-day health (one row per user per calendar date) ----
-- Multiple summary types (daily summary, sleep, HRV) upsert into the same dated
-- row, so each ingest run fills whichever columns it has.
create table public.garmin_health_daily (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null references public.profiles (id) on delete cascade,
  calendar_date       date not null,
  resting_hr          int,
  avg_hr              int,
  max_hr              int,
  hrv_ms              numeric,
  stress_avg          int,
  body_battery_high   int,
  body_battery_low    int,
  sleep_seconds       int,
  sleep_score         int,
  deep_sleep_seconds  int,
  rem_sleep_seconds   int,
  light_sleep_seconds int,
  awake_seconds       int,
  respiration_avg     numeric,
  spo2_avg            numeric,
  steps               int,
  calories            int,
  vo2max              numeric,
  raw                 jsonb not null default '{}'::jsonb,
  garmin_updated_at   timestamptz,
  created_at          timestamptz not null default now(),
  unique (owner_user_id, calendar_date)
);
create index garmin_health_daily_owner_date_idx
  on public.garmin_health_daily (owner_user_id, calendar_date desc);

alter table public.garmin_health_daily enable row level security;
create policy garmin_health_select_own on public.garmin_health_daily
  for select to authenticated using (owner_user_id = (select auth.uid()));
-- writes: service-role only.

-- ---- projection into workout_logs (the hybrid model, plan §6) ----
-- A Garmin activity is projected into a normal workout_logs row so Calendar /
-- Stats / HR light up with zero new read code. `source` flags its origin so it
-- never collides with manual logs; `garmin_activity_id` links back to the rich
-- row and gives the importer a stable key to upsert against (one log per
-- activity).
alter table public.workout_logs
  add column source text not null default 'manual'
    check (source in ('manual','garmin')),
  add column garmin_activity_id uuid references public.garmin_activities (id) on delete set null;

create unique index workout_logs_garmin_activity_idx
  on public.workout_logs (garmin_activity_id)
  where garmin_activity_id is not null;

-- Keep Garmin-sourced sessions OUT of the public showcase by default (health
-- data is private by default, CLAUDE.md). Existing rows default to 'manual', so
-- the showcase is unchanged; only manual logs remain anon-readable. Opt-in
-- exposure can relax this later.
drop policy logs_select_anon on public.workout_logs;
create policy logs_select_anon on public.workout_logs
  for select to anon
  using (owner_user_id = (select public.showcase_profile_id()) and source = 'manual');
