-- Rule identity and provenance for the deterministic coach.
--
-- WHY THE TABLE NEEDED CHANGING AT ALL. Before this, `analyze()` called
-- `insertRecommendations` and every check-in appended a fresh row. Two check-ins
-- in one day produced two identical "Adherence is 62% lately" rows and nothing
-- in the schema could tell they were the same observation, because a
-- recommendation had no identity beyond its own uuid and its prose. The
-- rule-based coach could get away with that when it fired four times a year; a
-- deterministic engine over a stable habit re-derives the same conditions on
-- every single run, so identity is now load-bearing rather than nice to have.
--
-- WHY `evidence` IS A COLUMN AND NOT A LINE OF MARKDOWN IN body_md. The coach's
-- claim to be evidence-grounded is only as good as the citation surviving next
-- to the number. Prose citations rot silently — they get truncated by the 2000
-- char slice, reworded by a later copy edit, and cannot be queried when the
-- question is "which findings rested on the protein floor?". The payload stores
-- the RESOLVED claim (statement, value, quote, caveat, speaker, url), not a
-- reference to it, so a row written under knowledge pack 2026.08.1 still renders
-- the number it was actually built on after the pack has moved on. See
-- src/lib/coach/types.ts (EvidencePayload) for the shape; it is deliberately not
-- constrained here, matching how meal_logs.tag_mix and aspect_snapshots.metrics
-- are validated at the read boundary rather than by the database.
alter table public.recommendations
  -- Dotted slug, e.g. 'goal.underserved.endurance'. Stable across runs by
  -- contract — see the note on Finding.ruleId. NULL for every row written
  -- before this migration and for anything the AI edge function writes, which
  -- is why the unique index below is partial rather than a table constraint.
  add column if not exists rule_id      text,
  -- The window the finding is about: an ISO week ('2026-W34') for weekly rules,
  -- a month ('2026-08') for standing targets. Paired with rule_id this is what
  -- lets the SAME rule speak again next week without duplicating itself now.
  add column if not exists period_key   text,
  -- Which knowledge pack produced it. Not derivable from created_at: a pack can
  -- be revised without a deploy date that lines up.
  add column if not exists pack_version text,
  add column if not exists evidence     jsonb;

-- One live row per (owner, rule, period). PARTIAL on rule_id being present so
-- the AI edge function and every pre-existing row are untouched, and this is
-- also the conflict target the client upserts against.
--
-- NOTE it deliberately does NOT filter on status. Constraining only open rows
-- would let a dismissed finding be re-inserted the same week under the same
-- key, which is exactly the nag-that-survives-being-told-no this design is
-- trying to avoid. Suppression after a dismissal is a COOLDOWN, enforced in
-- src/lib/coach/evaluate.ts (isSuppressed) and measured from the athlete's
-- decision — the database only guarantees uniqueness, never silence.
create unique index if not exists recommendations_rule_period_idx
  on public.recommendations (owner_user_id, rule_id, period_key)
  where rule_id is not null;

-- Reading a rule's history is the hot path for suppression: the client fetches
-- prior rows per rule to decide whether a cooldown is still running.
create index if not exists recommendations_owner_rule_idx
  on public.recommendations (owner_user_id, rule_id, created_at desc)
  where rule_id is not null;

-- No RLS changes. 0002_rls.sql and 0007_recs_owner_writes.sql are table-level
-- and cover new columns automatically; there is no anon policy on this table
-- and none should be added — a recommendation quotes the owner's goals, meals
-- and injuries back at them.

comment on column public.recommendations.rule_id is
  'Stable dotted slug identifying which deterministic coach rule produced this row. NULL for AI-generated and pre-0036 rows.';
comment on column public.recommendations.evidence is
  'Resolved citation payload (EvidencePayload in src/lib/coach/types.ts): the claims, verbatim quotes, speaker caveats and observed numbers behind the finding, frozen at write time.';
