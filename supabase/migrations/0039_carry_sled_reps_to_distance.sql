-- Carries and sled work were logged as weight x REPS. They are weight x DISTANCE.
--
-- Until the metric rework, `weight` was the only primary metric that carried a
-- second field, so the only way to record a loaded carry was to put the metres
-- in the reps box. The data says so plainly: Farmer Carry at "40-60 reps" of
-- 45-47.5kg, Sled Push at "20 reps" of 80-107.5kg. Nobody performs fifty reps
-- of a farmer carry -- those are metres.
--
-- Now that weight is an always-on field on a distance movement, the honest shape
-- is available, so move the number to where it belongs: primaryMetric becomes
-- `distance` and each set's `actual.reps` becomes `actual.distance`. Weight and
-- RPE are untouched, so nothing about the load is lost.
--
-- Scope is guarded twice: the movement name must look like a carry or sled AND
-- the item must still be `weight`-primary. Items already logged as `distance`
-- (there are several) are left alone, and no other movement is touched.
--
-- CONSEQUENCE, deliberately accepted: `setMinutes` in lib/bodyLoad.ts reads
-- time, then reps, then distance, so these sets stop being priced as reps and
-- start being priced through LOAD.metersPerMinute. That is the correction, not a
-- side effect -- they were never reps.

-- Full-table backup first. Small, and this rewrites user history in place.
create table if not exists public.backup_workout_logs_0039 as
  table public.workout_logs;

create or replace function public.__migrate_carry_reps_to_distance(doc jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
-- Written as explicit loops rather than nested jsonb_agg on purpose: the array
-- form needs a cast on every path and operand literal to disambiguate `jsonb -
-- text` from `jsonb - int`, and it failed twice before this. `array[...]` paths
-- carry their own type, so this version cannot be misread by the parser. Order
-- is preserved by construction -- each level rebuilds by appending in place.
declare
  sections jsonb := '[]'::jsonb;
  groups   jsonb;
  items    jsonb;
  sets     jsonb;
  section  jsonb;
  grp      jsonb;
  item     jsonb;
  st       jsonb;
  act      jsonb;
begin
  if doc is null or doc->'sections' is null then
    return doc;
  end if;

  for section in select * from jsonb_array_elements(doc->'sections') loop
    groups := '[]'::jsonb;

    for grp in select * from jsonb_array_elements(section->'groups') loop
      items := '[]'::jsonb;

      for item in select * from jsonb_array_elements(grp->'items') loop
        if lower(item->>'movement') ~ '(sled|farmer|carry)'
           and item->>'primaryMetric' = 'weight' then

          sets := '[]'::jsonb;
          for st in select * from jsonb_array_elements(item->'sets') loop
            act := st->'actual';
            if act ? 'reps'::text then
              -- The metres move from reps to distance. weight and rpe ride along
              -- untouched, which is the whole point: no load information is lost.
              act := (act - 'reps'::text) || jsonb_build_object('distance', act->'reps');
              st  := jsonb_set(st, array['actual'], act);
            end if;
            sets := sets || jsonb_build_array(st);
          end loop;

          item := jsonb_set(item, array['primaryMetric'], to_jsonb('distance'::text));
          item := jsonb_set(item, array['sets'], sets);
        end if;

        items := items || jsonb_build_array(item);
      end loop;

      groups := groups || jsonb_build_array(jsonb_set(grp, array['items'], items));
    end loop;

    sections := sections || jsonb_build_array(jsonb_set(section, array['groups'], groups));
  end loop;

  return jsonb_set(doc, array['sections'], sections);
end
$$;

update public.workout_logs l
set data = public.__migrate_carry_reps_to_distance(l.data)
where exists (
  select 1
  from jsonb_array_elements(l.data->'sections') s
  cross join lateral jsonb_array_elements(s->'groups') g
  cross join lateral jsonb_array_elements(g->'items') item
  where lower(item->>'movement') ~ '(sled|farmer|carry)'
    and item->>'primaryMetric' = 'weight'
);

drop function public.__migrate_carry_reps_to_distance(jsonb);
