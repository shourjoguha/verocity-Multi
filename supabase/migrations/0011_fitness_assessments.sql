-- Fitness-profile self-assessments (Stats spider chart). Each row is a dated
-- snapshot of 1–10 scores per fitness aspect (scores jsonb keyed by AspectKey),
-- so the radar can overlay the latest snapshot against an earlier baseline to
-- show progress. Owner-scoped like sessions; anon reads only the showcase
-- profile's rows (so the public profile can render its radar).
create table public.fitness_assessments (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  taken_at      timestamptz not null default now(),
  scores        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index fitness_assessments_owner_idx
  on public.fitness_assessments (owner_user_id, taken_at desc);

alter table public.fitness_assessments enable row level security;

create policy fa_select_auth on public.fitness_assessments
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy fa_select_anon on public.fitness_assessments
  for select to anon using (owner_user_id = (select public.showcase_profile_id()));
create policy fa_insert_own on public.fitness_assessments
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy fa_update_own on public.fitness_assessments
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy fa_delete_own on public.fitness_assessments
  for delete to authenticated using (owner_user_id = (select auth.uid()));
