-- Make the coach's conflict target reachable from PostgREST.
--
-- THE BUG. 0036 created the uniqueness guarantee as a PARTIAL index:
--
--   create unique index recommendations_rule_period_idx
--     on public.recommendations (owner_user_id, rule_id, period_key)
--     where rule_id is not null;
--
-- Postgres will only use a partial index to resolve `ON CONFLICT (cols)` if the
-- statement repeats the index's predicate — an inference clause must be provably
-- narrower than the index. PostgREST's `on_conflict=` parameter can only carry a
-- COLUMN LIST; it has no way to emit `where rule_id is not null`. So every
-- `.upsert(..., { onConflict: 'owner_user_id,rule_id,period_key' })` failed with
--
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- and, because `upsertCoachFindings` only returned a boolean, the whole check-in
-- surfaced as a generic "Check-in failed". Every deterministic finding since 0036
-- was silently discarded: `select count(rule_id) from recommendations` was 0.
--
-- THE FIX is simply to drop the predicate. It was never doing any work:
--
--   * `rule_id` is NULL on every pre-0036 row and on anything the AI edge
--     function writes. In a UNIQUE index Postgres treats NULLs as DISTINCT (the
--     default, and unchanged here — this is NOT `nulls not distinct`), so a
--     thousand rows with a NULL rule_id never collide with each other or with
--     anything else. The partial predicate was excluding rows that a full index
--     would already have ignored.
--   * The uniqueness that matters — one live row per (owner, rule, period) —
--     is identical under both shapes.
--
-- The lookup index below keeps its predicate. A partial index is perfectly fine
-- for a plain read path; the restriction is specific to ON CONFLICT inference.
drop index if exists public.recommendations_rule_period_idx;

create unique index if not exists recommendations_rule_period_idx
  on public.recommendations (owner_user_id, rule_id, period_key);

comment on index public.recommendations_rule_period_idx is
  'Conflict target for upsertCoachFindings. MUST NOT be partial: PostgREST on_conflict can only send a column list, and Postgres will not infer a partial index without its predicate (42P10). NULL rule_id rows do not collide — NULLs are distinct in a unique index.';
