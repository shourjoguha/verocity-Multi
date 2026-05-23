-- Verocity v2 — Row Level Security (SPEC §6, §8).
-- RLS is THE security boundary (CLAUDE.md). Private by default: authenticated
-- users read/write only their own rows. Anon reads only the showcase profile
-- plus the shared movement library. invites/shares writes stay server-side or
-- owner-scoped. Cross-user reads happen only via the share-read edge function
-- (service-role), never ambient.

alter table public.profiles        enable row level security;
alter table public.movements       enable row level security;
alter table public.plans           enable row level security;
alter table public.workout_logs    enable row level security;
alter table public.movement_subs   enable row level security;
alter table public.recommendations enable row level security;
alter table public.invites         enable row level security;
alter table public.shares          enable row level security;

-- ---- profiles ----
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_select_showcase on public.profiles
  for select to anon using (is_showcase);
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---- movements (own + shared library; anon: showcase + shared) ----
create policy movements_select_auth on public.movements
  for select to authenticated
  using (owner_user_id = auth.uid() or owner_user_id is null);
create policy movements_select_anon on public.movements
  for select to anon
  using (owner_user_id is null or owner_user_id = public.showcase_profile_id());
create policy movements_insert_own on public.movements
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy movements_update_own on public.movements
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy movements_delete_own on public.movements
  for delete to authenticated using (owner_user_id = auth.uid());

-- ---- plans (own + public; anon: showcase) ----
create policy plans_select_auth on public.plans
  for select to authenticated using (owner_user_id = auth.uid() or is_public);
create policy plans_select_anon on public.plans
  for select to anon using (owner_user_id = public.showcase_profile_id());
create policy plans_insert_own on public.plans
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy plans_update_own on public.plans
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy plans_delete_own on public.plans
  for delete to authenticated using (owner_user_id = auth.uid());

-- ---- workout_logs (own; anon: showcase) ----
create policy logs_select_auth on public.workout_logs
  for select to authenticated using (owner_user_id = auth.uid());
create policy logs_select_anon on public.workout_logs
  for select to anon using (owner_user_id = public.showcase_profile_id());
create policy logs_insert_own on public.workout_logs
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy logs_update_own on public.workout_logs
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy logs_delete_own on public.workout_logs
  for delete to authenticated using (owner_user_id = auth.uid());

-- ---- movement_subs (own; anon: showcase, read-only) ----
create policy subs_select_auth on public.movement_subs
  for select to authenticated using (owner_user_id = auth.uid());
create policy subs_select_anon on public.movement_subs
  for select to anon using (owner_user_id = public.showcase_profile_id());
create policy subs_insert_own on public.movement_subs
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy subs_update_own on public.movement_subs
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy subs_delete_own on public.movement_subs
  for delete to authenticated using (owner_user_id = auth.uid());

-- ---- recommendations (own + anon showcase, read-only; writes are service-role) ----
create policy recs_select_auth on public.recommendations
  for select to authenticated using (owner_user_id = auth.uid());
create policy recs_select_anon on public.recommendations
  for select to anon using (owner_user_id = public.showcase_profile_id());

-- ---- invites: no client policies → all client access denied (service-role only) ----

-- ---- shares: owners manage their own; reads for resolution go through the
--      share-read edge function using the service-role key (bypasses RLS) ----
create policy shares_select_own on public.shares
  for select to authenticated using (owner_user_id = auth.uid());
create policy shares_insert_own on public.shares
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy shares_update_own on public.shares
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy shares_delete_own on public.shares
  for delete to authenticated using (owner_user_id = auth.uid());
