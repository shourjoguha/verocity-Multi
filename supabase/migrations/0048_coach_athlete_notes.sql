-- The athlete's notes on an open finding, for the weekly coach-tuning routine.
--
-- `recommendations.disposition_note` only lands when the athlete DECIDES (did
-- it / modified / skipped). Context written on a finding they have not decided
-- yet — "I rest short on purpose, the gym is packed after six" — had nowhere to
-- go: the textarea was discarded unless a decision button was pressed. "Noted"
-- is that missing verb. It records context and decides nothing, so the finding
-- stays open and every cooldown, recurrence and scorecard reading is untouched.
--
-- APPEND-ONLY FOR THE ATHLETE. One row per note, never overwritten, because the
-- routine reads how the athlete's context moves week to week and an overwritten
-- column would show only the latest. No update policy: the athlete adds or
-- deletes, and the review columns are set by the routine through the service
-- role (docs/COACH_TUNING.md), which bypasses RLS. An athlete-writable
-- `reviewed_at` would let the page claim a review that never happened.
--
-- NOTHING IN src/lib/coach/** READS THIS TABLE. A note reaches the coach only
-- the way every model-side input does: the routine turns it into a governed
-- `coach_rule_notes` context note or a brief. It cannot silence a rule — that
-- is what Dismiss is for — and athleteNotes.test.ts pins the
-- engine's blindness to it.
create table public.coach_athlete_notes (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null references public.profiles (id) on delete cascade,
  -- The finding the note was written on. SET NULL rather than cascade: the
  -- athlete's words outlive a recommendation row being replaced.
  recommendation_id uuid references public.recommendations (id) on delete set null,
  -- Copied from the finding at write time, so the routine can group notes by
  -- rule even after the recommendation row is gone. NULL for pre-0036 rows.
  rule_id           text,
  body              text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at        timestamptz not null default now(),
  -- Set by the routine only. `review_ref` says what the note became: a
  -- coach_briefs id, a coach_rule_notes id, or free text such as 'no change'.
  reviewed_at       timestamptz,
  reviewed_by       text,
  review_ref        text
);

create index coach_athlete_notes_owner_idx
  on public.coach_athlete_notes (owner_user_id, created_at desc);
create index coach_athlete_notes_rec_idx
  on public.coach_athlete_notes (recommendation_id);
-- The routine's inbox.
create index coach_athlete_notes_unreviewed_idx
  on public.coach_athlete_notes (owner_user_id, created_at)
  where reviewed_at is null;

-- RLS. Owner-only select / insert / delete, `(select auth.uid())` per 0004.
-- No update policy (see above) and no anon policy: these are the athlete's own
-- words about their training and /showcase renders through the anon role.
alter table public.coach_athlete_notes enable row level security;

create policy can_select_own on public.coach_athlete_notes
  for select to authenticated using (owner_user_id = (select auth.uid()));
-- An insert may not pre-mark itself reviewed.
create policy can_insert_own on public.coach_athlete_notes
  for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and reviewed_at is null and reviewed_by is null and review_ref is null
  );
create policy can_delete_own on public.coach_athlete_notes
  for delete to authenticated using (owner_user_id = (select auth.uid()));

comment on table public.coach_athlete_notes is
  'Athlete-written context on a finding ("Noted"), read by the weekly coach-tuning routine. Decides nothing: the finding stays open. Never read by src/lib/coach/**. Athlete inserts/deletes only; reviewed_* set by the routine via service role. Owner-only; never add an anon policy.';
