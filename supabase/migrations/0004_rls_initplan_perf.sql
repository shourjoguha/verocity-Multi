-- Verocity v2 — RLS init-plan performance fix (advisor lint 0003).
-- auth.uid() and public.showcase_profile_id() were evaluated once PER ROW in
-- every policy. Wrapping each call in a scalar subquery `(select ...)` makes
-- Postgres hoist it into an InitPlan and evaluate it once per query. Pure
-- performance change — the boolean logic of each policy is unchanged.
-- showcase_profile_id() benefits most (it runs a query against profiles), even
-- though the linter only flags the auth.uid() calls.

-- ---- profiles (profiles_select_showcase uses only is_showcase — no change) ----
alter policy profiles_select_own  on public.profiles using (id = (select auth.uid()));
alter policy profiles_insert_self on public.profiles with check (id = (select auth.uid()));
alter policy profiles_update_own  on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---- movements ----
alter policy movements_select_auth on public.movements
  using (owner_user_id = (select auth.uid()) or owner_user_id is null);
alter policy movements_select_anon on public.movements
  using (owner_user_id is null or owner_user_id = (select public.showcase_profile_id()));
alter policy movements_insert_own on public.movements with check (owner_user_id = (select auth.uid()));
alter policy movements_update_own on public.movements
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
alter policy movements_delete_own on public.movements using (owner_user_id = (select auth.uid()));

-- ---- plans ----
alter policy plans_select_auth on public.plans
  using (owner_user_id = (select auth.uid()) or is_public);
alter policy plans_select_anon on public.plans
  using (owner_user_id = (select public.showcase_profile_id()));
alter policy plans_insert_own on public.plans with check (owner_user_id = (select auth.uid()));
alter policy plans_update_own on public.plans
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
alter policy plans_delete_own on public.plans using (owner_user_id = (select auth.uid()));

-- ---- workout_logs ----
alter policy logs_select_auth on public.workout_logs using (owner_user_id = (select auth.uid()));
alter policy logs_select_anon on public.workout_logs
  using (owner_user_id = (select public.showcase_profile_id()));
alter policy logs_insert_own on public.workout_logs with check (owner_user_id = (select auth.uid()));
alter policy logs_update_own on public.workout_logs
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
alter policy logs_delete_own on public.workout_logs using (owner_user_id = (select auth.uid()));

-- ---- movement_subs ----
alter policy subs_select_auth on public.movement_subs using (owner_user_id = (select auth.uid()));
alter policy subs_select_anon on public.movement_subs
  using (owner_user_id = (select public.showcase_profile_id()));
alter policy subs_insert_own on public.movement_subs with check (owner_user_id = (select auth.uid()));
alter policy subs_update_own on public.movement_subs
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
alter policy subs_delete_own on public.movement_subs using (owner_user_id = (select auth.uid()));

-- ---- recommendations ----
alter policy recs_select_auth on public.recommendations using (owner_user_id = (select auth.uid()));
alter policy recs_select_anon on public.recommendations
  using (owner_user_id = (select public.showcase_profile_id()));

-- ---- shares ----
alter policy shares_select_own on public.shares using (owner_user_id = (select auth.uid()));
alter policy shares_insert_own on public.shares with check (owner_user_id = (select auth.uid()));
alter policy shares_update_own on public.shares
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
alter policy shares_delete_own on public.shares using (owner_user_id = (select auth.uid()));
