-- Verocity v2 — reusable subroutines in the movement library.
-- A subroutine is a saved free-text block (title + description + optional link)
-- that can be inserted into a workout like a movement. It lives in the existing
-- movements table so it inherits the owner-scoped RLS and the locked shared
-- library (owner_user_id IS NULL) with no policy changes — the row policies from
-- 0002/0005 already gate every column.
--
--   kind        — 'movement' (default, back-compat with every existing row) or
--                 'subroutine'.
--   url         — optional link shown as a clickable "Link" on read surfaces.
--   description — reuses the existing movements.notes column (unused by the
--                 client today), so no new column is needed for the body text.

alter table public.movements
  add column kind text not null default 'movement'
    check (kind in ('movement', 'subroutine')),
  add column url text;
