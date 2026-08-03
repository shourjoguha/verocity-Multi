-- Verocity v2 — idempotent import key for sessions.
-- sessions had no uniqueness (see 0024 comment); imported WODs need a stable
-- per-workout key so a re-import is a no-op. Legacy/user rows leave source_ref
-- NULL and are unaffected by the partial unique index.
alter table public.sessions add column source_ref text;
create unique index if not exists sessions_source_ref_unique
  on public.sessions (source, source_ref) where source_ref is not null;
