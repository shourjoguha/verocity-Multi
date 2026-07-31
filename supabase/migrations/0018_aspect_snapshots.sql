-- Derived fitness-profile snapshots (Stats spider chart). One row per owner per
-- period: `metrics` holds the raw, unit-ful measurements for that window and
-- `scores` holds the 1–10 the radar drew at the time.
--
-- This table is what makes the radar's scores RELATIVE. Each axis is placed
-- against the distribution of the owner's own past values for the same metric
-- (lib/aspects.ts), so the midpoint reads "typical for you" and the polygon can
-- always move. The previous model scored against hardcoded absolute constants
-- and clamped, so a committed user pinned every reachable axis at the top of the
-- scale and the chart went inert.
--
-- `metrics` is the load-bearing column — scores are a presentation of it and are
-- stored only so a past reading can be shown as it was. Reading a longer
-- baseline must be able to change a score; it must never change a metric.
--
-- Written by the browser (owner-scoped, RLS is the boundary) rather than a
-- scheduled job: there is no pg_cron or scheduler anywhere in this project, and
-- the coach set the precedent of computing on demand instead. Owner-scoped like
-- fitness_assessments; anon reads only the showcase profile's rows so the public
-- profile can render its radar.
create table public.aspect_snapshots (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  period_end    date not null,
  window_days   int not null,
  metrics       jsonb not null default '{}'::jsonb,
  scores        jsonb not null default '{}'::jsonb,
  computed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  -- Full unique, deliberately NOT partial: supabase-js `upsert` cannot target a
  -- partial unique index, which is why garmin-ingest has to hand-split its
  -- insert/update. Recomputing a period must be a plain idempotent upsert.
  unique (owner_user_id, period_end, window_days)
);
create index aspect_snapshots_owner_idx
  on public.aspect_snapshots (owner_user_id, period_end desc);

alter table public.aspect_snapshots enable row level security;

create policy as_select_auth on public.aspect_snapshots
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy as_select_anon on public.aspect_snapshots
  for select to anon using (owner_user_id = (select public.showcase_profile_id()));
create policy as_insert_own on public.aspect_snapshots
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy as_update_own on public.aspect_snapshots
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy as_delete_own on public.aspect_snapshots
  for delete to authenticated using (owner_user_id = (select auth.uid()));
