-- movements.category becomes a fixed vocabulary, mirrored by
-- MOVEMENT_CATEGORIES in src/app.config.ts. Change both together.
--
-- Data was recategorised before this was applied (2026-10-03): every row now
-- carries one of these values. NULL stays legal — a name typed into the
-- Logger mid-workout is created uncategorised and categorised later in the
-- Library.
alter table public.movements
  add constraint movements_category_check check (
    category is null or category in (
      'squat', 'hinge', 'push', 'pull', 'olympic', 'core', 'plyo',
      'conditioning', 'accessory', 'mobility', 'warmup', 'skill', 'sport'
    )
  );
