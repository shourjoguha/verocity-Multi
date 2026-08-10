-- First use of Supabase Storage in this project. Private bucket: there is no
-- public URL for a meal photo, ever. Reads go through a short-lived signed URL
-- minted by the owner's own session, which the select policy allows.
--
-- Path convention is '<owner uuid>/<uuid>.jpg' and it is load-bearing: every
-- policy keys on the first folder segment. src/lib/mealPhoto.ts is the only
-- place that builds a path.
--
-- `on conflict do nothing` is an exception to this project's "migrations are
-- not idempotent" rule, and a deliberate one: this bucket may have been created
-- by hand in the dashboard first, and failing the whole migration for that
-- would be worse than a no-op.
insert into storage.buckets (id, name, public)
values ('meal-photos', 'meal-photos', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- THE FOUR OBJECT POLICIES ARE NOT IN THIS MIGRATION, AND CANNOT BE.
--
-- storage.objects is owned by `supabase_storage_admin`. Migrations here run as
-- `postgres`, which on this project is NOT a superuser, NOT a member of that
-- role, and holds no admin option on it (all three verified against the live
-- DB). `create policy ... on storage.objects` as `postgres` therefore fails
-- with "must be owner of table objects" and would abort this migration.
--
-- Create them once from Dashboard -> Storage -> Policies. Recorded verbatim
-- here so the schema is not undocumented; this block is a comment, not dead
-- SQL to uncomment.
--
--   create policy meal_photos_select_own on storage.objects
--     for select to authenticated
--     using (
--       bucket_id = 'meal-photos'
--       and (storage.foldername(name))[1] = (select auth.uid())::text
--     );
--
--   ... insert (with check), update (using + with check), delete (using),
--       all four with the identical predicate.
-- ---------------------------------------------------------------------------
