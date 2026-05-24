-- Coach (SPEC §12): on-demand recommendation generation and dispositions run
-- client-side, scoped to the owner. The 0002 policies were read-only (writes
-- reserved for service-role); add owner insert/update so a user can create and
-- act on THEIR OWN recommendations. Still owner-scoped by auth.uid(); other
-- users' rows remain unreachable. (select auth.uid()) keeps the RLS initplan
-- optimization from 0004.
create policy recs_insert_own on public.recommendations
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()));

create policy recs_update_own on public.recommendations
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
