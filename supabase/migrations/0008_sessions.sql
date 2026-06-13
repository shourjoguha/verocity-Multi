-- Verocity v2 — saved session templates ("Sessions" library, SPEC §8).
-- A session is a standalone, named, tagged workout frame: a plan day minus the
-- multi-week dimension (one planned string per exercise). Created from scratch,
-- from any plan day, or from a finished workout. Owner-scoped like plans/logs;
-- anon reads only the showcase profile's rows (consistency with plans).

create table public.sessions (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.profiles (id) on delete cascade,
  name           text not null,
  tags           text[] not null default '{}',
  frame          jsonb not null default '{}'::jsonb,
  -- provenance when saved from a plan day (informational only)
  source_plan_id uuid references public.plans (id) on delete set null,
  source_day_key text,
  created_at     timestamptz not null default now()
);
create index sessions_owner_idx on public.sessions (owner_user_id);

-- Link a logged workout back to the session template it was launched from
-- (mirrors plan_id; null for blank/plan-launched workouts).
alter table public.workout_logs
  add column session_id uuid references public.sessions (id) on delete set null;
create index workout_logs_session_idx on public.workout_logs (session_id);

-- RLS: private by default, owner CRUD + anon showcase read (mirror plans).
alter table public.sessions enable row level security;

create policy sessions_select_auth on public.sessions
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy sessions_select_anon on public.sessions
  for select to anon using (owner_user_id = (select public.showcase_profile_id()));
create policy sessions_insert_own on public.sessions
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy sessions_update_own on public.sessions
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy sessions_delete_own on public.sessions
  for delete to authenticated using (owner_user_id = (select auth.uid()));
