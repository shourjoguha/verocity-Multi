# How `docs/PLAN_RUBRIC.md` was generated

`docs/PLAN_RUBRIC.md` is the strength & conditioning policy that gets embedded
verbatim inside the plan-authoring prompt the user copies from
`/app/plan/upload`. It is **domain content, not code** — it was written by an
agent in a separate repository against the spec below, then dropped in whole.

**Regenerate it, don't hand-edit it.** If the plan schema changes — a new
`SECTIONS` key, a new `METRICS` entry, a fifth `BLOCKS` type, a different
`UNITS.weight` — the "fixed vocabulary" section of this prompt goes stale first
and the rubric goes stale with it. Update the prompt, re-run it, replace
`docs/PLAN_RUBRIC.md` wholesale. Rule-by-rule patching is how the two drift
apart silently.

The vocabulary block below is a prose transcription of `src/app.config.ts`
(`SECTIONS`, `METRICS`, `BLOCKS`, `RPE`, `UNITS`) and `ParsedPlan` in
`src/lib/types.ts`. Those files are the source of truth; this prompt is a copy
that has to be kept honest by hand.

Two deliberate exclusions, so a future regeneration doesn't quietly reintroduce
them:

- **No body type / somatotype.** `src/app.config.ts` carries an explicit refusal
  on `BODY_TYPES` — "somatotype has no defensible role in load estimation".
- **No nutrition, supplements, or medical/rehabilitation advice.** Injury rules
  are about what load to prescribe or avoid, nothing else.

The required "If X, then Y" bullet form is not stylistic. It is what lets the
rubric drop into `src/lib/planRubric.ts` as `RubricSection[]` without anyone
rewriting the domain content on the way in.

---

## The exact prompt

````
Write a single self-contained markdown document, `docs/PLAN_RUBRIC.md`. It is
programming guidance for a strength & conditioning coach (a human or an LLM)
who is writing a 6–12 week training plan for one athlete, given that athlete's
profile. It will be embedded verbatim inside an LLM prompt, so it must be
prescriptive policy, not an essay, and it must be readable cold with no other
context.

## What the reader will know about the athlete

Every field is optional and may be absent. Write rules that fire on what is
present and stay silent on what is not.

- Age (whole years), sex (female | male | other | unspecified)
- Bodyweight (kg), height (cm)
- Past injuries: free-text label + optional body region (chest, back,
  shoulders, arms, core, posterior chain, quads, calves) + optional year
- Goals: a RANKED list, each with a 0–100 weight. Suggested set is strength,
  hypertrophy, endurance, mobility, skill work — but the athlete can add
  free-text goals, so rules must degrade gracefully on an unrecognised goal
- Experience: beginner | intermediate | advanced
- Training days available per week (1–7)
- Equipment available (barbell, rack, bench, dumbbells, kettlebells, machines,
  cables, pull-up bar, bands, rower, bike, treadmill, sled, bodyweight only)
- Preferred plan length in weeks (6–12)

## The fixed vocabulary the plan must be expressed in — do not invent terms

The plan is written into a fixed schema. Every rule you write must land in
these terms and no others:

- Periodisation blocks, exactly four types: `accumulation`, `intensification`,
  `realization`, `deload`. Each block covers a contiguous inclusive week range.
  Blocks must tile the plan without overlapping.
- Every prescribed item sits in exactly one section, in this logger order:
  `warmup`, `primary`, `secondary`, `accessory`, `conditioning`, `cooldown`.
- Each item is tracked by exactly one primary metric: `weight` (kg), `reps`,
  `time` (seconds), `distance` (metres), `cal`, `rpe`.
- A prescription is a set spec string: `3x5`, `4x8`, `5x3 @70%`, `1x300`
  (sets x per-set target). Percentages are of 1RM. RPE runs 5–10 in 0.5 steps.
- Prescriptions can vary per week, or be constant across all weeks.
- Non-movement content (a mobility protocol, a breathing drill, instructions,
  a link) is a "subroutine": a short title plus a description of at most 300
  characters, sitting in one of the sections above.
- Supersets and circuits are NOT expressible — the athlete configures those
  later in the app. Adjacent items in the same section plus a note is the only
  way to signal the intent.
- Weight is always kg. There is no unit toggle.

## Required output structure

A `##` heading per section below, and under each, a flat markdown list where
**every bullet is one complete conditional sentence in "If <condition>, then
<prescription>" form**. Each bullet must be independently actionable and must
name concrete numbers (rep ranges, %1RM or RPE bands, set counts, weekly set
volume per region, session counts, block week-counts) rather than adjectives.
Aim for 5–10 bullets per section. No prose paragraphs between bullets.

1. `## Goal weighting → intensity and rep ranges`
   How the top-ranked goal and its weight set the primary/secondary/accessory
   rep ranges and intensity bands. Cover ties and near-ties, and what a
   weight of 70 vs 30 should actually change.
2. `## Goal mix → section emphasis`
   How the goal mix decides how many items go in each section, and
   specifically when `conditioning` earns real volume versus a token finisher.
3. `## Experience level → volume, complexity, progression`
   Weekly set volume, exercise selection complexity, and how progression is
   expressed across weeks (load vs reps vs sets) per experience level.
4. `## Age → selection, volume, recovery`
   Concrete age bands with what each changes. Be specific about what genuinely
   changes with age and explicitly say what does not — do not soften or
   under-prescribe on age alone.
5. `## Sex → selection and prescription`
   Only what is defensibly supported by evidence. If a commonly-repeated
   difference is weak or contested, say so in the bullet and prescribe the
   conservative default rather than omitting the topic.
6. `## Injury history → contraindications and substitutions`
   Per body region: what to avoid, what to substitute, what to add. Frame as
   load management, never as diagnosis or treatment.
7. `## Equipment → movement substitution`
   For each primary movement pattern, the fallback ladder as equipment is
   removed, ending at bodyweight-only.
8. `## Training days per week → split`
   The split for 1–7 days, named by day, in the section vocabulary above.
9. `## Plan length → block structure`
   For each of 6, 8, 10 and 12 weeks: the exact block sequence with week
   ranges (e.g. `accumulation 1-4, intensification 5-7, deload 8-8`), and
   where deloads land. Blocks must tile without overlapping.
10. `## Conflict resolution`
    What wins when rules collide — e.g. an injury contraindication versus a
    top-ranked goal, or a 6-day split request with beginner experience.
    Give an explicit precedence order.
11. `## What to ask the athlete`
    A list of at most 8 questions worth asking when profile fields are
    missing, ordered by how much the answer changes the plan.

## Constraints

- Fitness programming only. No nutrition, no supplements, no medical or
  rehabilitation advice. Injury rules are about what load to prescribe or
  avoid, not about treating anything.
- Every number must be usable as-is. "Moderate volume" is a failure; "12–16
  hard sets per muscle region per week" is the bar.
- Do not reference somatotype or body type in any rule.
- No citations, no hedging preamble, no closing summary. The document opens
  with its first `##` heading.
- Keep the whole document under roughly 250 lines. It gets embedded in a
  prompt; density beats coverage.
````
