-- Holidays: a planned break, recorded as a DATE RANGE, never as workout_logs.
--
-- WHY NOT A LOG. An activity type writes one workout_logs row for one day, and
-- every stat, the body map and the coach read those rows as training. A
-- holiday is the opposite claim: "these days were not training, on purpose".
-- Writing it as logs would put eight days of hiking into sessionLens and the
-- body map. So it lives here, and the readers that care (the streak, the
-- coach's weekly rates, the calendar and consistency grid) consult it
-- explicitly. Nothing that measures training volume reads this table.
--
-- `kind` is the holiday's character, not a modality: hike / dive / ski are
-- ACTIVE breaks (moving, not sedentary — the coach is told so), beach is
-- plain rest. The vocabulary is HOLIDAY_KINDS in src/app.config.ts.
--
-- No two holidays of one owner may overlap: an exclusion constraint on the
-- inclusive date range, so the UI's overlap check is a courtesy and the
-- database is the guard.
create extension if not exists btree_gist with schema extensions;

create table public.holidays (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.profiles (id) on delete cascade,
  kind           text not null check (kind in ('hike', 'dive', 'ski', 'beach')),
  name           text check (name is null or char_length(btrim(name)) between 1 and 40),
  starts_on      date not null,
  ends_on        date not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint holidays_order check (ends_on >= starts_on),
  -- HOLIDAY.maxDays in app.config.ts. A longer break is split in two.
  constraint holidays_length check (ends_on - starts_on < 60),
  constraint holidays_no_overlap exclude using gist (
    owner_user_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  )
);

create index holidays_owner_start_idx on public.holidays (owner_user_id, starts_on);

-- RLS. Owner-only, `(select auth.uid())` per 0004. No anon policy: /showcase
-- renders through the anon role and a holiday is the athlete's own calendar.
alter table public.holidays enable row level security;

create policy hol_select_own on public.holidays
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy hol_insert_own on public.holidays
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy hol_update_own on public.holidays
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy hol_delete_own on public.holidays
  for delete to authenticated using (owner_user_id = (select auth.uid()));

comment on table public.holidays is
  'Planned breaks as inclusive date ranges. Never training: excluded from the streak and from the coach''s weekly rates, never read by volume/body-map code. Owner-only — never add an anon policy.';
