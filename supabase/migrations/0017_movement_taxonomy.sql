-- Verocity v2 — per-user movement taxonomy overrides.
--
-- The region / modality / plane classification lives in code
-- (src/lib/movementTaxonomy.ts) and is derived from the movement NAME, because
-- plans and logs reference movements by bare string with no FK to this table.
-- That works for the whole real vocabulary except names the string cannot carry
-- — e.g. "Wtd" and "Deficit", truncated at import. This column is the escape
-- hatch for those, and for any call the user simply disagrees with.
--
-- Matched to logged movements by normalised name, not by id, for the same
-- reason. Saving an override for a name that has no row yet CREATES an
-- owner-scoped row (see createMovement in src/lib/queries.ts), which is also
-- how the largely-empty library finally gets populated.
--
-- Shape mirrors MovementProfile in src/app.config.ts, all keys optional:
--   { "regions": {"back": 0.7, "arms": 0.3}, "modality": "resistance",
--     "planes": {"frontal": 1}, "rotary": null, "systemic": false }
--
-- No policy changes needed: exactly as with 0016, the row policies from
-- 0002/0005 already gate every column, so this inherits the owner-scoped RLS
-- and the locked shared library (owner_user_id IS NULL stays unwritable by any
-- client). Nullable with no default, so every existing row is untouched.

alter table public.movements
  add column taxonomy jsonb;
