-- Verocity v2 — Hyrox / structured-session support.
--
-- Two changes:
--
-- 1. Give `sessions` room for workout-format metadata that has no home on the
--    current template model (time cap, AMRAP/EMOM duration, round count,
--    partner flag, prose instructions, provenance). Legacy strength sessions
--    leave every new column NULL; a row is "structured" iff `session_type` is
--    set. The `frame` JSONB is unchanged at the SQL layer — the round/circuit
--    structure lives as an optional `groups[]` array on SessionFrame (see
--    src/lib/types.ts) and is stored inside the existing `frame` column.
--
-- 2. Let `sessions` carry shared-library rows (`owner_user_id IS NULL`),
--    matching the movements pattern from 0002/0005. Anon and authenticated
--    users can read shared sessions; only server-side seeds (this migration
--    and 0024) can write them. Client writes remain owner-scoped, guarded
--    both by RLS and by explicit NULL rejection.

-- 1. Session-level structured fields ------------------------------------------

alter table public.sessions
  add column session_type text
    check (session_type in (
      'AMRAP','EMOM','FOR_TIME','FOR_TOTAL_REPS','FOR_TOTAL_DISTANCE',
      'FOR_LOAD','INTERVALS','ROUNDS_FOR_TIME','CHIPPER','PARTNER','OTHER'
    )),
  add column time_cap_seconds  int,
  add column duration_seconds  int,
  add column rounds            int,
  add column partner           boolean not null default false,
  add column instructions      text,
  add column source            text,
  add column source_text       text;

-- 2. Allow shared sessions (owner_user_id IS NULL) ----------------------------

alter table public.sessions alter column owner_user_id drop not null;
create index if not exists sessions_shared_idx
  on public.sessions (owner_user_id) where owner_user_id is null;

-- Selects: extend to shared rows for both roles. Preserve the (select ...)
-- initplan optimization from 0004.
drop policy if exists sessions_select_auth on public.sessions;
create policy sessions_select_auth on public.sessions
  for select to authenticated
  using (owner_user_id is null or owner_user_id = (select auth.uid()));

drop policy if exists sessions_select_anon on public.sessions;
create policy sessions_select_anon on public.sessions
  for select to anon
  using (owner_user_id is null
         or owner_user_id = (select public.showcase_profile_id()));

-- Writes: explicitly reject NULL-owned rows, mirroring 0005 for movements.
drop policy if exists sessions_insert_own on public.sessions;
create policy sessions_insert_own on public.sessions
  for insert to authenticated
  with check (owner_user_id is not null
              and owner_user_id = (select auth.uid()));

drop policy if exists sessions_update_own on public.sessions;
create policy sessions_update_own on public.sessions
  for update to authenticated
  using (owner_user_id is not null
         and owner_user_id = (select auth.uid()))
  with check (owner_user_id is not null
              and owner_user_id = (select auth.uid()));

drop policy if exists sessions_delete_own on public.sessions;
create policy sessions_delete_own on public.sessions
  for delete to authenticated
  using (owner_user_id is not null
         and owner_user_id = (select auth.uid()));

-- 3. Idempotent seed key for shared movements ---------------------------------
-- 0024 upserts 18 shared movements; give it a conflict target keyed by
-- lowercased name within the shared library only.
create unique index if not exists movements_shared_name_unique
  on public.movements (lower(name)) where owner_user_id is null;
