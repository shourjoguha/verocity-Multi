---
name: movement-taxonomy
description: Owns the movement classification model — muscle regions, modality, plane of motion and rotary role — the name-matching rules that resolve a logged movement string to a profile, the working-minutes aggregation, and the body-map region geometry. Use when adding or correcting a movement mapping, changing the region/modality/plane vocabulary, editing the body silhouette paths, or debugging a wrong or missing classification on /app/body. Do NOT use for the body map's CSS, layout or 3D transforms — that is the ui-change skill — nor for the movements.taxonomy column or RLS, which is db-change.
---

# Movement taxonomy

Classifies a free-text movement name into **regions × modality × plane**, and
aggregates logged work onto a body map. Additive: it replaced nothing.

## The one thing to know first

**Movements are referenced by bare name string.** `LogItem.movement` and
`PlanExercise.movement` are `string`, with no foreign key to the `movements`
table. Everything else follows from that: classification keys off a normalised
name, corrections are matched by normalised name, and a movement that was
logged has no library row to hang data on.

## What you own

| | |
|---|---|
| Vocabulary | `MUSCLE_REGIONS`, `MOVEMENT_MODALITIES`, `MOVEMENT_PLANES`, `ROTARY_ROLES`, `LOAD` in `src/app.config.ts` |
| Matching | `src/lib/movementTaxonomy.ts` — normalisation, `EXACT`, `RULES` |
| Aggregation | `src/lib/bodyLoad.ts` |
| Geometry | `src/lib/bodyRegions.ts` |
| Tests | `movementTaxonomy.test.ts`, `bodyLoad.test.ts`, `bodyRegions.test.ts` |

**You do not own** `BodyMap.tsx`, `BodyView.tsx`, `TaxonomyEditor.tsx` or the
`.bodymap-*` CSS (→ **ui-change**), nor `movements.taxonomy`, `types.ts` or
`queries.ts` (→ **db-change**).

## Invariants

**1. Never touch `MOVEMENT_FAMILIES` or `familyOf`.** They are a *different*
roll-up, owned by Stats, and they are **wrong on real data**:

```
familyOf('Med-Ball Throw')        === 'pull'   // "th-row" contains "row"
familyOf('Rower Intervals')       === 'pull'
familyOf('Zone 2 (row/bike/walk)') === 'pull'
```

Those answers are **pinned by test on purpose**, in
`movementTaxonomy.test.ts`. Correcting them changes the rendered RPE
fingerprint and Top-families cards for existing logs, which is a deliberate
Stats change, not a side effect of taxonomy work.

**2. Unknown is a first-class value.** An unresolvable name returns
`source: 'unknown'` with `regions: {}` and `modality: null`, and surfaces in the
unmapped list. Never add a fallback bucket. `"Wtd"` and `"Deficit"` — truncated
at import — are the canonical cases and are asserted to stay unknown.

**3. Longest matched fragment wins.** Rule array order is *not* load-bearing,
and a test shuffles `RULES` and asserts identical output. Do not reintroduce
order-dependence: if `rower interval` must beat `row`, make the fragment longer,
don't move it up. Reach for `not` only for a genuine veto.

**4. Strip parentheticals before matching.** `Zone 2 (row/bike/walk)` must not
carry a `row` into the matcher. This is exactly the bug in invariant 1, and it
is asserted.

**5. Weights sum to 1.** Region and plane weights are normalised so one set's
load distributes rather than double-counting. Asserted for every entry.

**6. No bare `weighted` fragment in `RULES`.** It would swallow
`Weighted Pull-up` and `Weighted Dips`, which have `EXACT` entries.

**7. Region ids are the geometry ids.** `bodyRegions.test.ts` asserts the two
sets match in *both* directions. A region with no path is a hole in the
silhouette; a path with no region is dead weight. Neither throws at runtime.

**8. The classifier is pure.** No DOM, no storage, no `Date`, no `queries.ts`.
Overrides are passed in as an argument. This is what keeps it testable in
vitest's node environment.

**9. Working minutes, not tonnage.** `weight × reps` is zero for Ski-Erg, Box
Jump and Side Plank, which is why `sessionVolume` cannot answer this question.
Do not add a per-modality multiplier — every such coefficient is a number
nobody can defend when the chart looks wrong. Tonnage and hard sets ship as
*secondary*, resistance-only readouts.

## Adding a movement

1. Add it to `EXACT` keyed by its **normalised** form — run
   `normalizeMovementName` on it first; a test asserts every key round-trips.
2. Add the raw string to `VOCABULARY` in `movementTaxonomy.test.ts`. That list
   is a ratchet: everything in it must classify.
3. If it is a *class* of movement rather than one name, add a rule instead, and
   add a named case asserting what it must NOT match.

## Verify

```
npm test        # the only check that can see a classifier regression
npm run check
```

**What `npm test` cannot see: whether a mapping is anatomically correct.**
`Box Jump` classified as `resistance` passes every check in this repo. The
taxonomy's correctness lives entirely in the expected values a human reads in
`movementTaxonomy.test.ts` — there is no automated substitute, so review those
values rather than the green tick.

`npm run audit:mobile` and `npm run audit:flicker` say nothing about any of
this; they see overflow, tap targets and overlay behaviour only.
