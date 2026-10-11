# Muscle map: build plan

Status: **in progress.** Phase B and C1 started 2026-10-11. Canonical copy of the plan. The review page
the owner filled in is a claude.ai artifact; everything decided there is
recorded in the appendix below, so no session needs the artifact to proceed.

Goal: replace the 9-region body map with a 21-muscle **Plates** map, with
**Engraved** and **Thermal** as per-device alternatives in Settings, and make
the movement→muscle mapping accurate enough that the extra detail carries
information rather than decoration.

## Ground rules every phase inherits

1. **Regions stay the coach's unit.** Each muscle has exactly one parent region.
   A region's weight is the sum of its muscles' weights, derived, never authored.
   `hardSetsByRegion` and every coach threshold keep reading regions (decision D6:
   revisit later). A phase that changes a coach number without a row in the
   review CSV saying so is a bug.
2. **Author once, at muscle level.** Profiles are written in muscles; region
   weights are computed. Never hand-maintain both.
3. **The movement-taxonomy invariants still hold**: unknown stays unknown, longest
   fragment wins, parentheticals are stripped, weights sum to 1, no bare
   `weighted` fragment, `familyOf` is untouched, the classifier stays pure.
4. **Geometry ids are muscle ids**, asserted both ways by test (today's
   region↔path assertion moves to muscles).
5. **Values are estimates reviewed by the owner**, recorded in
   `docs/muscle-map-review.csv` (same round-trip pattern as
   `docs/bwload-review.csv`). Code is transcribed from that file and tested
   against it.

## The muscle vocabulary (decision D1: accepted)

| Region (parent) | Muscles |
|---|---|
| chest | pecs |
| shoulders | frontDelts, sideDelts, rearDelts |
| arms | biceps, triceps, forearms |
| back | traps, lats, upperBack (rhomboids, teres, rotator cuff), lowerBack (erectors) |
| core | abs, obliques, **hipFlexors** |
| glutes | gluteMax, gluteMed |
| quads | quads, **adductors** |
| hamstrings | hamstrings |
| calves | calves, **tibialis** |

Bold = new; decision D2 makes them children of today's regions, which is exactly
where they are filed now, so the coach's totals do not move by adding them.

**Default region→muscle split** (decision D4). Used for (a) per-user overrides
stored at region level, and (b) any profile not yet re-authored. Proposed, to be
confirmed in Phase B:

| Region | Split |
|---|---|
| chest | pecs 1.0 |
| shoulders | frontDelts 0.40, sideDelts 0.35, rearDelts 0.25 |
| arms | biceps 0.40, triceps 0.40, forearms 0.20 |
| back | lats 0.40, upperBack 0.25, traps 0.20, lowerBack 0.15 |
| core | abs 0.50, obliques 0.35, hipFlexors 0.15 |
| glutes | gluteMax 0.80, gluteMed 0.20 |
| quads | quads 0.90, adductors 0.10 |
| hamstrings | hamstrings 1.0 |
| calves | calves 0.85, tibialis 0.15 |

The map shows muscles filled from a default split as **estimated**, and the Body
page shows the share of the period's work that was mapped at muscle level.

## Phases

Model column: **Sonnet** = mechanical, tightly scoped, acceptance is a test or
a diff against a file; **Opus** = needs judgment (anatomy, type design,
WebKit/3D traps, tap-target design). Every Sonnet phase ends with a
`/code-review` pass before merge.

| Phase | What | Owner skill | Model | Depends on | Ships |
|---|---|---|---|---|---|
| A | Inventory of real names and overrides | db-change (read only) | Sonnet | DB access | no |
| B | Author muscle weights for every movement into the review CSV | movement-taxonomy | Opus | owner answers, A | no; **owner gate** |
| C1 | Types, derivation, default split, override read path | movement-taxonomy + db-change | Opus | B started | no |
| C2 | Transcribe the CSV into `EXACT` / `RULES` + tests | movement-taxonomy | Sonnet | B approved, C1 | **yes**: better 9-region accuracy, same visuals |
| D | Per-muscle aggregation | movement-taxonomy | Opus | C1 | no |
| F1 | Port muscle geometry into `bodyRegions.ts` | movement-taxonomy | Sonnet | C1 | no |
| F2 | Plates renderer in `BodyMap.tsx` (3D slab kept) | ui-change | Opus | D, F1 | **yes**: Plates live |
| F3 | Body-map style pref + Settings picker | ui-change | Sonnet | F2 | with F4 |
| F4a | Engraved renderer | ui-change | Sonnet | F2 | yes |
| F4b | Thermal renderer | ui-change | Opus + owner iPhone check | F2 | yes, if flicker-clean |
| E | Tap-to-pick muscle editor for corrections | ui-change | Opus | F2, C1 | yes |
| G | Docs: LESSONS, SPEC, skill, CLAUDE.md routing | docs-upkeep | Sonnet | each ship | with each ship |

Order: A ∥ B → (owner gate) → C1 → C2 → D ∥ F1 → F2 → F3 ∥ F4a ∥ F4b ∥ E → G.

---

### Phase A: Inventory (Sonnet)

**Why:** the audit covered code and seeds only. The Supabase MCP connection
failed in the planning session, so names logged since the test vocabulary was
written, and saved per-movement corrections, were never seen.

**Do:** run read-only SQL against production and write
`docs/muscle-map-inventory.csv` with columns
`name,normalized,occurrences,last_logged,source,matched_ids,override_json`.

```sql
-- distinct movement names across logs and plans
select item->>'movement' as name, count(*) as occurrences, max(l.created_at) as last_logged
from workout_logs l,
     jsonb_path_query(l.data, '$.sections[*].items[*]') as item
group by 1 order by 2 desc;
-- saved overrides
select name, owner_user_id, taxonomy from movements where taxonomy is not null;
```

Check the JSON path against `LogDocument` in `lib/types.ts` before trusting it;
superset/circuit items may nest one level deeper. Classify every name with
`classifyMovement` in a throwaway vitest file (delete it after) to fill
`source` and `matched_ids`.

**Acceptance:** CSV committed; every name present; unknowns listed first.
**Stop and report if:** DB access is unavailable. Do not guess names.

### Phase B: Author muscle weights (Opus, owner gate)

**Do:** write `docs/muscle-map-review.csv`, one row per `EXACT` key, per rule,
per unknown library name and per inventory name, columns:

`key,source,modality,current_regions,proposed_muscles,derived_regions,region_delta,confidence,rationale,owner_note,your_muscles`

- `owner_note` is pre-filled from the appendix.
- `region_delta` is non-empty wherever the derived region weights differ from
  today's by more than 0.02. Those rows are the ones that change coach numbers,
  and the owner must see them.
- Rules that need splitting (below) appear as several rows with their
  must-match and must-not-match names in `rationale`.

**Known required changes** (from the audit plus owner input):

| Item | Change |
|---|---|
| `rule:erg-endurance` | Split. **SkiErg** gets its own rule: lats, triceps, abs primary, with some hip-hinge glutes/hamstrings (Concept2 lists lats, triceps, abs as primary). **Rower** (`row`, `rower`, `row erg`) stays leg-led: Concept2 estimates 60% legs, 20% core, 20% arms. Treadmill, stairmaster and elliptical move to locomotion. |
| `rule:jump-plyo` | Split into three: **lower-body jumps** (box, broad, bound, hop: quads, glutes, calves, small hipFlexors share); **throws and slams** (med ball, slam: obliques, abs, lats, shoulders, triceps); **Olympic lifts** (see next row). |
| Olympic lifts | New rules. Pulls (clean, snatch, and their power/hang/squat forms): gluteMax and hamstrings lead, then quads, traps, lowerBack; snatch adds shoulders/upperBack. **Jerk / push jerk**: quad-led dip-drive plus frontDelts and triceps (not glute-led; see Q5). |
| `rule:squat-pattern` | Overhead squat gets its own rule with a shoulder/upperBack share. Thruster and wall ball already have shoulders; confirm. |
| `rule:push-up` | Correct for push-ups (owner: right). Add a `pike` fragment that routes **Pike Push-up** to the handstand push-up profile (owner). This is a matching fix, not an anatomy change. |
| `rule:hinge-pattern` | Split: conventional/trap-bar **deadlift** (gluteMax > hamstrings, plus lowerBack and quads); **RDL** incl. single-leg and split-stance (hamstrings > gluteMax); **swing** (gluteMax, lowerBack, abs, less hamstring); hip thrust and bridge unchanged. |
| `rule:core-dynamic` | Split: ab wheel / rollout = abs; knee raise, leg raise, toes-to-bar = hipFlexors + abs (+ forearms when hanging); sit-up = abs + hipFlexors. |
| `hanging knee raise` | hipFlexors + abs, forearms for the hang. |
| `rule:copenhagen` | adductors + obliques. |
| `adductor work`, `rule:adductor-mobility` | adductors. |
| `rule:hip-flexor-mobility`, `couch stretch` | hipFlexors, some quads (owner: couch stretch right as quads; keep a quads share). |
| `rule:tibialis` | tibialis. |
| `cossack squat`, `rule:lateral-lunge` | See Q2/Q3: adductors and gluteMed share, not "outer quads". |
| `shoulder raise` | **Retire as a target name.** Add `front raise` → frontDelts, `side raise` / `lateral raise` → sideDelts. Keep the `shoulder raise` key at frontDelts 0.5 / sideDelts 0.5 so historical logs (stored as the bare name) resolve without rewriting them. |
| `face pull`, `band pull apart`, `rule:upper-back-prehab` | rearDelts + upperBack, not the whole back. Pull-apart is mostly mobility per owner; keep modality, weight it lighter only if the owner says so. |
| `farmer carry`, `rule:carry` | forearms + traps + obliques/abs bracing + gluteMed. A **suitcase** carry (one side) shifts to obliques; bilateral farmer carries are grip and traps first. |
| `front squat` | Owner's numbers: quads 0.65, gluteMax 0.15, abs 0.15, forearms 0.05. |
| `heel elevated back squat` | As front squat without forearms; much more quads than glutes. |
| `rope climb` | Right; at muscle level lats, biceps, forearms. |
| Unknown: **Toes-to-Bar** | hipFlexors, abs (lower), forearms. |
| Unknown: **Burpee Box Step-Over** | pecs (floor), quads + gluteMax (step-over); conditioning. Plain **burpee**: pecs, quads, calves. |
| Unknown: **Pull-to-Stand** | The rope-climb scaling in the CrossFit seed (lying, pull hand over hand to standing): lats, biceps, forearms. Confirm (Q7). |
| Unknown: **Devil Press** | Burpee plus double-dumbbell swing to overhead (owner, Q1). |
| `row` (bare) | The rowing machine (owner, D5). Not SkiErg, not any loaded row. Unchanged. |

**Acceptance:** CSV covers every key; muscle weights sum to 1 per row; the owner
has filled or blanked `your_muscles` on every row with a `region_delta`.

### Phase C1: Types, derivation, default split (Opus)

Two-owner change (`app.config.ts`, `lib/types.ts` are shared files; backend
leads). Not done until `npm test` and `npm run check` are green.

- `app.config.ts`: `MUSCLES` (id, label, short, parent region) and
  `MUSCLE_KEYS`; `MUSCLE_DEFAULT_SPLIT` per region (the table above).
- `MovementProfile` gains `muscles: MuscleWeights`. `regions` stays on the type
  for every existing reader but is **derived** in `p()` and in override merging.
- Override read path: `movements.taxonomy` may carry `regions` (old) or
  `muscles` (new). Region-only overrides expand through the default split **at
  read time**. No migration, so it is reversible. Column 0017 has no check
  constraint, so no DB change is needed; confirm with the advisors.
- Tests: every muscle has a parent; default splits sum to 1; derived regions of
  every profile sum to 1; a region-only override yields the default split.

### Phase C2: Transcribe the CSV (Sonnet)

**Input:** the approved `docs/muscle-map-review.csv`. **Only** the rows'
values; do not re-judge anatomy.

- Rewrite each `EXACT` entry and rule profile with muscle weights from
  `your_muscles` (fall back to `proposed_muscles` where it is blank).
- Add the new rules and vetoes. For each, add a test naming the movements it
  must match and must not match (taken from `rationale`).
- Add the four library unknowns and the inventory names to `VOCABULARY`.
- Golden test: for every row, the derived region weights equal the CSV's
  `derived_regions` within 0.005.
- Do **not** touch `MOVEMENT_FAMILIES` / `familyOf` or the pinned `familyOf`
  tests.

**Acceptance:** `npm test`, `npm run check` green; the golden test passes.
**Stop and report if:** a CSV row is ambiguous, or a new rule changes the
classification of a `VOCABULARY` name the CSV doesn't mention.

### Phase D: Per-muscle aggregation (Opus)

`bodyLoad.ts` adds `minutesByMuscle`, `resistanceSetsByMuscle` and
`hardSetsByMuscle` next to the region outputs, which stay byte-identical for
unchanged profiles. The relative-cutoff rule (`meaningfulRegionShare`) needs a
muscle twin, cut relative to the movement's **top muscle**; decide whether the
cutoff value carries over (it was tuned for regions, and a squat's top muscle
share is lower than its top region share). Warm-up/cooldown exclusion and
`isLoadedSet` apply unchanged. Add a test that summing a muscle output over a
region's children reproduces the region output.

### Phase F1: Geometry (Sonnet)

Port the Plates mock-up's shapes into `src/lib/bodyRegions.ts` on the existing
100×220 grid (the mock-up is 200×440: halve every coordinate). Keep the
data-only, `mirrorX` structure. Changes from the mock-up:

- **Split the front-and-side delt plate** into frontDelts and sideDelts.
- **Draw hipFlexors**: a strip at the front of the hip crease, from the ASIS
  down along the inside of the rectus femoris (iliopsoas/sartorius/TFL
  stand-in). The mock-up has none.
- **Merge serratus into the obliques plate** (serratus isn't a muscle id).
- The three quad heads stay three shapes, all with id `quads`.
- `BODY_SILHOUETTE` stays one outline (the 3D slab's ribs use it).

**Acceptance:** `bodyRegions.test.ts` asserts muscle ids ↔ paths both ways.

### Phase F2: Plates renderer (Opus)

Read `docs/LESSONS.md` § Rendering and the "Body map slab" CSS block first:
nothing between `.bodymap-stage` and the faces may set opacity<1, filter,
clip-path or overflow, or the slab flattens. Plates: per-muscle fill opacity on
`--color-fg`, gaps drawn in `--color-surface`, estimated muscles hatched or
dashed. Region selection still works and highlights a region's muscles.
**Verify:** `npm run audit:mobile`, `npm run audit:flicker` (slab drag), and
check by eye on phone width.

### Phase F3: Style preference + picker (Sonnet)

Copy the `coachSpritePrefs.ts` pattern exactly: `src/lib/bodyMapPrefs.ts`
(localStorage key, change event, guarded reads), `BodyMapStylePicker.tsx`
using `ui/SegmentedTabs`, rendered in `SettingsView.tsx` next to the coach icon
picker. Values: `plates` (default), `engraved`, `thermal`. Per device (D7).

### Phase F4a: Engraved (Sonnet), F4b: Thermal (Opus)

Engraved: one hatch pattern per muscle, line weight by intensity; monochrome.
Thermal: sequential ramp from new `--heat-*` tokens defined in **both** theme
blocks of `global.css`; must keep the numeric readout (colour alone fails the
house rule). The blur filter must live **inside** the SVG, never on a slab
ancestor. Ships only if `npm run audit:flicker` passes **and** the owner
confirms no flicker on an iPhone while dragging the slab. That symptom is
WebKit-only and no audit here observes it.

### Phase E: Tap-to-pick editor (Opus)

`TaxonomyEditor.tsx`: pick the primary muscle and any helpers on the Plates
figure (primary 65%, helpers share 35%, per D3). **Tap-target problem:** at
375px wide, tibialis, sideDelts and gluteMed are under 44px. Taps resolve to
the nearest muscle within a 44px radius, and a muscle list sits under the
figure as the accessible fallback. Writes `muscles` to `movements.taxonomy`.
**Verify:** `npm run audit:mobile`.

### Phase G: Docs (Sonnet)

On each ship: LESSONS entry for anything that cost >20 min; SPEC §8 (profile
shape); movement-taxonomy skill (muscles own the geometry, regions are
derived); CLAUDE.md routing row "Map a movement to a muscle". Then
`npm run audit:docs`.

---

## Owner answers to the open questions (2026-10-11)

- **Q1 Devil Press**: it is the dumbbell burpee plus double-dumbbell swing to
  overhead. Map it as a burpee plus that overhead swing (pecs from the floor,
  gluteMax/hamstrings for the swing, shoulders/traps for the finish).
- **Q2 Outer quads**: dropped. Quads stay one muscle.
- **Q3 Cossack squat / lateral lunge**: adductor and gluteMed share as
  recommended (owner accepted the remaining comments).
- **Q4 Erg**: confirmed. The owner's erg note described the SkiErg; the rower
  stays leg-led (Concept2: 60 legs / 20 core / 20 arms). Split them.
- **Q5 Jerks**: quad-led; move attribution to quads.
- **Q6 Box jump**: small hipFlexors share (≤10%), as recommended.
- **Q7 Pull-to-Stand**: confirmed as rope-climb scaling (lats, biceps, forearms).
- **Pike Push-up**: map to the handstand push-up profile (shoulder-led).
- Folding deep and indistinguishable muscles into neighbours: accepted.

## Appendix: owner input (review page, 2026-10-11)

Decisions: D1 accept the 21 · D2 children of existing regions · D3 primary +
helpers 65/35 ("a little stiff but works") · D4 default split, marked estimated
· D5 bare "Row" = rowing machine · D6 coach on regions for now, revisit later ·
D7 style per device.

D2 note: Copenhagen = adductors + obliques; toes-to-bar and leg raises = hip
flexors; tibialis raises = tibialis. Indirect: adductors in lunges, hip flexors
in box jumps; tibialis in sport (leave sport alone).

Row notes (verdict · note):

- adductor work · wrong · adductors specifically
- band pull apart · right · shoulders and upper back; mostly mobility
- cossack squat · right
- couch stretch · right
- face pull · right · rear delts and upper back, not the whole back
- farmer carry · right · mostly obliques and forearms
- front squat · right · quads 65, glutes 15, abs 15, forearms 5
- hanging knee raise · right · hip flexors and abs
- heel elevated back squat · (none) · as front squat without forearms; much more quads than glutes
- rope climb · right
- row · right · rowing machine, different from SkiErg
- rule:adductor-mobility · wrong · adductors
- rule:carry · right · as farmer carry
- rule:copenhagen · wrong · adductors and obliques
- rule:core-dynamic · wrong · ab wheel/rollout = abs; knee raise mostly hip flexors; sit-up part hip flexor, part abs
- rule:erg-endurance · wrong · lats, core (abs, some hip flexors), some triceps; research the split
- rule:hinge-pattern · unsure · deadlift glutes > hams; RDL hams > glutes; swing glutes with back and core, less hams
- rule:hip-flexor-mobility · wrong · hip flexors
- rule:jump-plyo · wrong · separate lower-body jumps from upper-body throws; lateral bounds outer quads; box jump quads + hip flexors; med-ball throws obliques + some back/shoulders/arms; Olympic lifts glute-heavy, some with shoulders/upper back
- rule:lateral-lunge · right · outer quads, as lateral bounds and cossack
- rule:mobility · right
- rule:push-up · right
- rule:sled · right
- rule:squat-pattern · unsure · overhead squat adds shoulders; also thrusters, wall balls, cleans; jerks/snatches add shoulders and swap quads for glutes
- rule:tibialis · wrong · tibialis
- rule:upper-back-prehab · right
- shoulder raise · wrong · split into front and side raise; historical logs half/half
- unknown burpee box step over · wrong · glutes + quads for the step-over, chest off the ground; plain burpee chest, some quads and calves
- unknown devil press · (none) · core (obliques, abs) and lats, pulling weight in a plank (see Q1)
- unknown pull to stand · unsure
- unknown toe to bar · wrong · lower abs, hip flexors, some forearms
- zone · right

Sources for the erg split: Concept2, "Rowing is a Leg Sport"
(https://www.concept2.com/blog/rowing-is-a-leg-sport); Concept2, "SkiErg
muscles used" (https://www.concept2.com.au/skierg/training/muscles-used).
