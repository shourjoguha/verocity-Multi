-- The coach's memory of what it MEASURED, not only of what it said.
--
-- THE HOLE THIS FILLS. `runCoach` evaluates every rule on every check-in and
-- then throws away everything it does not write: a rule that is suppressed, or
-- simply not true this week, leaves no trace at all. `recommendations` is
-- therefore a record of the coach's OUTPUT, and there is no record of its
-- INPUT. That makes three obvious questions unanswerable:
--
--   * "Has this improved since I acted on it?"  — no samples between decisions.
--   * "Has it come back?"                       — no best-since to regress from.
--   * "Did that advice ever work?"              — nothing to compare.
--
-- And it is why suppression had to be priced against `drift_score` frozen on
-- the decided row. That anchor only moves in one direction: evaluate.ts asked
-- for drift 0.15 WORSE than at the decision, so a rule acted on at drift 1.00
-- (clamped, by construction the maximum) could never speak again until
-- DECISION_EXPIRY_DAYS, and a rule the athlete actually FIXED went quiet
-- permanently with no way to say so. See src/lib/coach/recurrence.ts.
--
-- WHY A SEPARATE TABLE AND NOT MORE COLUMNS ON `recommendations`. A row there
-- is a thing the coach SAID and the athlete can act on, dismiss or snooze; a
-- row here is a reading. They have different cardinality (one reading per rule
-- per check-in day, whether or not anything was said), different lifetimes and
-- different privacy weight. Folding readings into recommendations would also
-- break the (owner, rule_id, period_key) uniqueness that makes check-ins
-- idempotent.
create table public.coach_observations (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  -- Dotted slug, same identity as recommendations.rule_id. NOT NULL here: a
  -- reading with no rule is not a reading. Deliberately no FK to anything —
  -- rule ids live in code (src/lib/coach/rules/**), never in the database, and
  -- a retired rule's history must survive the rule being deleted.
  rule_id       text not null,
  -- The day the check-in ran, not a timestamp. Two check-ins on one day are the
  -- same reading of the same window and must collapse, which is what the unique
  -- index below enforces; a timestamptz would make every tap a new sample and
  -- let an anxious afternoon out-vote a month of training.
  --
  -- UTC, derived by `localDay` in src/lib/coach/evaluate.ts — matching
  -- `windowStart` and `isoWeekKey` in signals.ts rather than the viewer's
  -- clock. Every date the coach compares (the decision timestamp, the window
  -- edges, a reading) is in that frame, and one local date among them would
  -- file readings a day either side of the decisions they are meant to follow.
  observed_on   date not null,
  -- 0..1, the rule's own distance past its own threshold, exactly as written to
  -- recommendations.drift_score. 0 means MEASURED AND CLEAN — a rule that could
  -- not be measured writes no row at all rather than a zero, because "we do not
  -- know" and "you are fine" must never be the same number. See the family
  -- adequacy gate in runCoach.
  drift         numeric not null check (drift >= 0 and drift <= 1),
  confidence    numeric check (confidence >= 0 and confidence <= 1),
  -- 'ok' | 'partial'. Never 'insufficient' — see above.
  sufficiency   text not null default 'ok',
  -- Did the rule actually produce a finding this run? A rule can be true and
  -- still silent (suppressed), so this is NOT derivable from the presence of a
  -- recommendation row, and `drift > 0` is not a proxy either: a rule can sit
  -- marginally past its threshold and be judged not worth saying.
  fired         boolean not null default false,
  -- Completed sessions inside the measurement window at the time of reading.
  -- Carried so "three sessions have landed since you decided" can be answered
  -- from this table alone, without re-deriving it from workout_logs on a page
  -- that has not fetched them.
  sessions      int not null default 0,
  -- The rule's own numbers, same shape as EvidencePayload.observed. Kept so a
  -- trajectory can be explained ("volume went 9 -> 14 -> 16 sets") rather than
  -- only scored.
  observed      jsonb,
  created_at    timestamptz not null default now()
);

-- One reading per rule per day. This is also the conflict target the client
-- upserts against, so it MUST NOT be partial: PostgREST's `on_conflict=` can
-- only carry a column list, and Postgres will not infer a partial index without
-- its predicate (42P10) — the exact failure migration 0038 had to undo.
create unique index coach_observations_rule_day_idx
  on public.coach_observations (owner_user_id, rule_id, observed_on);

-- The read path is always "this rule's recent series, newest first".
create index coach_observations_owner_rule_idx
  on public.coach_observations (owner_user_id, rule_id, observed_on desc);

alter table public.coach_observations enable row level security;

-- Owner-only, all four verbs, `(select auth.uid())` per 0004_rls_initplan_perf.
-- There is deliberately NO anon policy: a reading quotes the athlete's training
-- and eating back at them just as a recommendation does, and /showcase renders
-- through the anon role.
create policy co_select_own on public.coach_observations
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy co_insert_own on public.coach_observations
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy co_update_own on public.coach_observations
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy co_delete_own on public.coach_observations
  for delete to authenticated using (owner_user_id = (select auth.uid()));

comment on table public.coach_observations is
  'One drift reading per coach rule per check-in day, written whether or not the rule spoke. The trajectory substrate for src/lib/coach/recurrence.ts: improvement, persistence and relapse are all derived from this series, never from the drift frozen on a decided recommendation. Owner-only; never add an anon policy.';
comment on column public.coach_observations.drift is
  'Measured and clean is 0. Unmeasurable writes NO ROW — the two must never share a value.';
