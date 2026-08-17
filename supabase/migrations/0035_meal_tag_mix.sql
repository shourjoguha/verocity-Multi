-- Per-meal tag composition. A meal already carries a set of `tags`; this adds
-- the *proportion* each tag contributes, as a JSON object of integer percents
-- that sum to 100 (e.g. {"protein":60,"carbs":40}). NULL means "no composition
-- recorded" — every row before this migration, and any meal saved without
-- opening the mix. Kept out of the `tags` array so the two never disagree and
-- the existing tag semantics (splitTags, repeat shortcuts) are untouched.
--
-- Nullable with no default and no check: the shape is enforced in the app
-- (mealDraft.ts), not the database, matching how size/kind/source vocabularies
-- are validated at the read boundary rather than by constraint. RLS is
-- unchanged — this is another column on an owner-scoped row.
alter table public.meal_logs
  add column if not exists tag_mix jsonb;

comment on column public.meal_logs.tag_mix is
  'Optional per-tag composition: integer percents summing to 100, keyed by tag. NULL = not recorded.';
