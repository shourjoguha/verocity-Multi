-- Verocity v2 — split the posteriorChain region into hamstrings + glutes in
-- stored per-user taxonomy overrides.
--
-- The classifier (src/lib/movementTaxonomy.ts) no longer emits `posteriorChain`;
-- MUSCLE_REGIONS now carries `hamstrings` and `glutes` as separate regions with
-- their own body-map geometry. Live classification and the body map recompute
-- from movement NAMES every read, so plans / logs / snapshots need nothing —
-- the only place a region weight is persisted is `movements.taxonomy`, the
-- per-user override escape hatch (migration 0017).
--
-- At write time no production or seed override used `posteriorChain`, so this is
-- a safety net: it fixes any override saved against the old vocabulary (e.g. in
-- the deploy window) so it renders on the new two-region map instead of on a
-- region that no longer exists. It is idempotent — a second run finds no
-- posteriorChain key and touches nothing.
--
-- Re-split policy: a manual override carries no movement context, so the
-- posteriorChain weight is divided EVENLY between hamstrings and glutes. This
-- conserves the total (weights still sum to 1) and lets both halves light up;
-- a user who wants a different split re-saves the override.

create table if not exists backup_movements_0041 as table public.movements;

do $$
declare
  r record;
  w numeric;
  half numeric;
  regions jsonb;
  new_regions jsonb;
begin
  for r in
    select id, taxonomy
    from public.movements
    where taxonomy is not null
      and taxonomy -> 'regions' ? 'posteriorChain'
  loop
    regions := r.taxonomy -> 'regions';
    w := (regions ->> 'posteriorChain')::numeric;
    half := round(w / 2, 4);

    new_regions := (regions - 'posteriorChain')
      || jsonb_build_object(
        'hamstrings',
        round(coalesce((regions ->> 'hamstrings')::numeric, 0) + half, 4),
        'glutes',
        round(coalesce((regions ->> 'glutes')::numeric, 0) + (w - half), 4)
      );

    update public.movements
    set taxonomy = jsonb_set(taxonomy, '{regions}', new_regions)
    where id = r.id;
  end loop;
end $$;
