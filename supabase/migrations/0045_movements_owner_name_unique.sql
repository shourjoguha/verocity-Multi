-- One custom movement per name per owner, case-insensitively — the owner-scoped
-- twin of movements_shared_name_unique (shared rows only). Nothing stopped a
-- second "Skull crusher" before this; the picker offered "Add …" whenever its
-- search missed, and it missed on a trailing space.
--
-- Verified before applying: zero (owner_user_id, lower(name)) duplicates.
-- trim() is included so "Pistol " cannot sit beside "Pistol".
create unique index movements_owner_name_unique
  on public.movements (owner_user_id, lower(trim(name)))
  where owner_user_id is not null;
