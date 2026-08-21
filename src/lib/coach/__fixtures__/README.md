# Coach fixtures

Real logged rows, kept because the coach's failure modes are all shape failures
that synthetic data hides. The bug that made `sessionMinutesPerWeek` necessary —
working minutes reporting a barbell athlete as 57% endurance — is invisible
unless the fixture contains both a set-dense lifting session and a single-set
60-minute ActivityLogger row, which is exactly what hand-written fixtures never
have.

**Scrubbed before commit**: `owner_user_id` is a fixed dummy, every uuid is
rewritten to a stable hash, and every free-text `note` / `notes` field is
nulled. Nothing in `src/lib/coach/` reads those fields, so the fixtures behave
identically. The numbers, timestamps, tags and JSONB structure are untouched —
they are the point.

Because free text is scrubbed, `mealText.ts` and the rules that read notes are
tested on literals in `mealText.test.ts` instead — modelled on the vocabulary
that actually appears in the log, typos included. That is also the only way to
assert on a specific phrase.

Anchor date for every test using these: **2026-08-21**. The newest row is
2026-08-20, so the 28-day window is stable and the tests do not rot.
