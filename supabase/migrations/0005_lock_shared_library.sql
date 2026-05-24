-- Verocity v2 — lock the shared movement library (CLAUDE.md hard rule).
-- The shared library (owner_user_id IS NULL) is the only ambient cross-user
-- read and must never be writable by clients. The owner-scoped write policies
-- already exclude NULL-owned rows implicitly via three-valued logic
-- (NULL = auth.uid() yields NULL, not TRUE). This makes that guarantee explicit
-- and defensive rather than incidental. Behavior-preserving; preserves the
-- (select auth.uid()) initplan optimization from 0004.

drop policy if exists movements_insert_own on public.movements;
create policy movements_insert_own on public.movements
  for insert to authenticated
  with check (owner_user_id is not null and owner_user_id = (select auth.uid()));

drop policy if exists movements_update_own on public.movements;
create policy movements_update_own on public.movements
  for update to authenticated
  using (owner_user_id is not null and owner_user_id = (select auth.uid()))
  with check (owner_user_id is not null and owner_user_id = (select auth.uid()));

drop policy if exists movements_delete_own on public.movements;
create policy movements_delete_own on public.movements
  for delete to authenticated
  using (owner_user_id is not null and owner_user_id = (select auth.uid()));
