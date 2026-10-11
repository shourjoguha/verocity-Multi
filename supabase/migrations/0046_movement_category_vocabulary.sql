-- Recovered verbatim from supabase_migrations.schema_migrations (applied
-- 2026-10-03 as version 20261003171832) after the file was found missing from
-- the repo: the database had the constraint and a fresh clone could not rebuild
-- it. Do not edit; a correction is a new migration.
alter table public.movements
  add constraint movements_category_check check (
    category is null or category in (
      'squat', 'hinge', 'push', 'pull', 'olympic', 'core', 'plyo',
      'conditioning', 'accessory', 'mobility', 'warmup', 'skill', 'sport'
    )
  );
