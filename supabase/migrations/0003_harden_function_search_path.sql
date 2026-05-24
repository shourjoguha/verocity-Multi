-- Verocity v2 — harden function search_path (security advisor lint 0011).
-- Both functions already fully-qualify their object references, so pinning an
-- empty search_path is safe (pg_catalog stays implicitly available for now()
-- etc.) and removes the role-mutable search_path warning.
alter function public.showcase_profile_id() set search_path = '';
alter function public.bump_movement_sub(uuid, text, text, text) set search_path = '';
