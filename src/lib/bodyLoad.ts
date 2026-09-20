// Aggregates logged work into per-region / per-modality / per-plane totals.
//
// UNIT: WORKING MINUTES. Tonnage (weight × reps) is deliberately not the
// primary currency — it is exactly zero for Ski-Erg Intervals, Box Jump and
// Side Plank, which is why `sessionVolume` in lib/stats.ts cannot answer this
// question. Minutes are the one unit that spans resistance, endurance,
// plyometric, isometric and mobility work without a per-modality fudge factor
// that nobody could defend when the chart looks wrong.
//
// Tonnage and hard sets still ship as secondary readouts, restricted to
// resistance work, so the numbers reconcile with Stats.
//
// This walks the log itself rather than reusing `flattenSets` because it needs
// `section` and `primaryMetric` for the modality fallback, and widening
// `FlatSet` would touch a type stats.test.ts asserts on.

import {
  BODY_LENSES,
  BODY_LENS_KEYS,
  COMPOUND,
  ENDURANCE,
  LOAD,
  MODALITY_KEYS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  ROM,
  RPE,
  SESSION_CLOCK,
  VOLUME,
  type BodyLensKey,
  type ModalityKey,
  type MovementProfile,
  type PlaneKey,
  type RegionKey,
  type RotaryRole,
  type SectionKey,
} from '@/app.config';
import { classifyMovement, type OverrideMap } from '@/lib/movementTaxonomy';
import { isSubroutine } from '@/lib/subroutine';
import type { LogItem, LogSet, WorkoutLog } from '@/lib/types';

export interface UnmappedMovement {
  name: string;
  minutes: number;
  sessions: number;
}

/**
 * Tunables the walkers accept. Every field is optional and every default
 * reproduces the pre-bodyweight behaviour exactly, so a caller with no
 * `user_stats` row — including the anon showcase client, which cannot read the
 * table at all — gets the same numbers it always did.
 */
export interface BodyLoadOptions {
  /** Kg-equivalent of one unweighted rep. From `unweightedRepKg(stats)`. */
  unweightedKg?: number;
}

export interface BodyLoadSummary {
  regionMinutes: Record<RegionKey, number>;
  /**
   * Scaled training volume distributed across regions on the SAME profile
   * weights as `regionMinutes`. Unlike `resistanceTonnage` this is non-zero for
   * ergs, jumps and planks — `setVolume` prices unweighted work — which is what
   * made minutes the only viable currency before it existed. A scaled index,
   * not kilograms: render it without a unit.
   */
  regionVolume: Record<RegionKey, number>;
  /**
   * The same two currencies, split by BODY_LENSES.
   *
   * ADDITIVE on purpose. `regionMinutes` and `regionVolume` above keep their
   * all-modality meaning, because they are read by nothing outside the body map
   * and changing them in place would have been indistinguishable, at the call
   * site, from changing what the radar and the coach see — those read
   * `totalMinutes`, `modalityMinutes`, `resistanceSets` and `coverage` off this
   * same summary. Adding a field cannot move them; filtering an existing one
   * could have.
   *
   * Every lens's minutes sum to `regionMinutes`, and its volume to
   * `regionVolume`, except for work whose modality could not be inferred at all.
   */
  byLens: Record<BodyLensKey, { minutes: Record<RegionKey, number>; volume: Record<RegionKey, number> }>;
  modalityMinutes: Record<ModalityKey, number>;
  planeMinutes: Record<PlaneKey, number>;
  rotaryMinutes: Record<RotaryRole, number>;
  systemicMinutes: number;
  /**
   * Fractional share of each resistance set, per region. Sums across regions to
   * the total completed resistance-set count.
   *
   * KEPT AS IT WAS, and read by the body map. `hardSetsByRegion` below is the
   * one the coach reads; the two answer different questions and the previous
   * bug was using this one to answer the other's.
   */
  resistanceSets: Record<RegionKey, number>;
  /**
   * WHOLE sets per region — one per set for every region the movement
   * meaningfully trains (see meaningfulRegionShare), across every loaded set
   * whatever its modality (see isLoadedSet).
   *
   * This is the currency `TRAINING.hypertrophyWeeklySets` is stated in, and it
   * does NOT sum to the session's set count: a squat set legitimately counts
   * once for quads and once for glutes. Never total it.
   */
  hardSetsByRegion: Record<RegionKey, number>;
  resistanceTonnage: Record<RegionKey, number>;
  unmapped: UnmappedMovement[];
  totalMinutes: number;
  // classified / (classified + unmapped), 0..1
  coverage: number;
  sessions: number;
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

// Minutes of work represented by one set. Only completed sets count —
// DELIBERATELY unlike sessionVolume, which counts every set. A planned-but-not-
// performed set is not work done to a region.
export function setMinutes(set: LogSet): number {
  const a = set.actual;
  if (!a.completed) return 0;
  if (a.time != null) return a.time / 60;
  if (a.reps != null) return (a.reps * LOAD.repSeconds) / 60;
  if (a.distance != null) return a.distance / LOAD.metersPerMinute;
  return LOAD.fallbackSetMinutes;
}

/**
 * Does this region take enough of a movement to count as trained by it?
 *
 * THE UNIT BUG THIS EXISTS TO FIX. `resistanceSets` adds a region's SHARE of
 * each set (`+= weight`), and `normalizeWeights` makes those shares sum to
 * exactly 1.0 per movement. So one squat set is 0.6 quads + 0.18 glutes + the
 * rest — while the evidence it is compared against
 * (`TRAINING.hypertrophyWeeklySets`, "10 sets per muscle group per week")
 * counts that same set as 1 for quads AND 1 for glutes. A share was measured
 * against a whole, which understates every region by roughly the number of
 * muscles the movement touches.
 *
 * On one real log the effect was not subtle: shoulders read 2.7 sets a week
 * fractionally and 14.8 counted properly, so the coach reported "no muscle
 * group reaches 10" when three of them did. Its own suggested fix —
 * "you need roughly 51 more hard sets a week" — was `9 regions x 10` minus a
 * FRACTIONAL total, subtracting two different units in one expression.
 *
 * WHY THIS IS RELATIVE AND NOT A FLAT NUMBER. The first attempt used a flat
 * 0.2 and was wrong on the very movements it existed for: Back Squat carries
 * `glutes 0.18` and Sled Push `calves 0.15`, so a squat counted for quads alone
 * and 26 sets of sled contributed nothing to calves. A flat floor also
 * penalises exactly the movements that spread widest — a loaded carry, whose
 * largest region is 0.35, would lose almost everything.
 *
 * So a region counts when it takes at least a QUARTER of what the movement's
 * biggest region takes, with an absolute floor so a nearly-flat profile cannot
 * enrol every muscle in the body. Both numbers are this product's editorial
 * judgement about when a muscle is really being trained — like the impact
 * weights, and unlike anything in knowledge.ts, which is why they live here and
 * not there.
 */
export const REGION_SHARE_OF_PRIMARY = 0.25;
export const REGION_SHARE_FLOOR = 0.1;

/** The cutoff for one movement's region profile. */
export function meaningfulRegionShare(regions: Partial<Record<string, number>>): number {
  const top = Math.max(0, ...Object.values(regions).map((v) => v ?? 0));
  return Math.max(REGION_SHARE_FLOOR, REGION_SHARE_OF_PRIMARY * top);
}

/**
 * Did this set carry external or bodyweight load?
 *
 * Decides whether a set counts toward hard-set volume, and deliberately asks
 * about the SET rather than the movement's modality. A loaded carry classifies
 * as `endurance` and a kettlebell swing as `plyometric` — correct for the body
 * map and the radar, which is why neither is being changed — but both are
 * weight moved by muscle, and excluding them from the hypertrophy count dropped
 * 50 of one athlete's 204 completed sets, Farmer Carry's fourteen among them.
 *
 * Bodyweight resistance still counts: a pull-up has no `weight` and is
 * obviously loaded. What does not count is work with neither load nor reps —
 * a mobility flow, a stretch, a timed erg piece.
 */
export function isLoadedSet(set: LogSet, profile: { bwLoad?: number } | null): boolean {
  const a = set.actual;
  if (!a.completed) return false;
  if ((a.weight ?? 0) > 0) return true;
  // No external load: it only counts if the movement loads bodyweight AND the
  // set was counted in reps. A 20-minute row logs `time`, not reps, and is not
  // a set of anything.
  return (profile?.bwLoad ?? 0) > 0 && (a.reps ?? 0) > 0;
}

const clamp = (n: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, n));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// How many reps' worth of work a set represents. Time and distance convert
// through the same LOAD constants `setMinutes` uses, so every modality lands in
// one currency rather than needing a per-modality fudge factor.
function repEquivalents(a: LogSet['actual']): number {
  if (a.reps != null) return a.reps;
  if (a.time != null) return a.time / LOAD.repSeconds;
  if (a.distance != null) return (a.distance / LOAD.metersPerMinute) * 60 / LOAD.repSeconds;
  return 1;
}

/**
 * Scaled training volume for one set — the currency of the strength and power
 * axes. Only completed sets count, deliberately unlike `sessionVolume`, which
 * counts every set: a planned-but-not-performed set is not work done.
 *
 * The three scalars are the point. All of them are already in the LogDocument
 * and none of them were being read:
 *
 * - `/side`  reps are logged PER SIDE and nothing in the app doubles them, so
 *            the second side has always been uncounted work.
 * - `(p)`    a paused rep is more time under tension than a touch-and-go one.
 * - `rpe`    near-failure work is a bigger stimulus at equal tonnage. Absent
 *            RPE scores 1.0 — never a penalty, or the metric would reward the
 *            habit of logging RPE rather than the training itself.
 *
 * Note both notations are ITEM-level in practice: `toggleItemNotation` writes
 * them to every set in the item. Reading them per set is still correct, just
 * finer than the UI can currently express.
 *
 * `unweightedKg` is what one rep of unloaded work costs. It defaults to the
 * flat constant so every existing caller and test is unchanged; pass
 * `unweightedRepKg(stats)` to price it against the lifter's own mass instead.
 */
export function setVolume(
  set: LogSet,
  unweightedKg: number = VOLUME.unweightedRepKg,
  rom: number = 1,
  bwLoad: number = VOLUME.bodyweightFraction,
): number {
  const a = set.actual;
  if (!a.completed) return 0;

  // ADDITIVE, not a replacement. External weight sits ON TOP of the part of the
  // athlete the movement makes them carry, so a loaded set can never price below
  // the same movement unloaded — which the old `a.weight ?? unweightedKg` did,
  // routinely: at 86kg it put a bodyweight squat at 55.9 and a squat with 20kg
  // on the bar at 20.
  //
  // `unweightedKg` already carries VOLUME.bodyweightFraction baked in, so
  // dividing it back out recovers the athlete's mass (or the flat fallback when
  // no bodyweight is on file) before applying THIS movement's share. A pull-up
  // (bwLoad 1) therefore costs exactly bodyweight, a bench (bwLoad 0) costs only
  // the plate, and a movement with no estimate lands on unweightedKg — precisely
  // its old value, so unmapped work is unchanged.
  //
  // `|| 0` and not `?? 0`: a set logged with 0 is bodyweight, the same as one
  // logged with no weight at all. voice.ts has always written 0 for "bodyweight",
  // and under the old `??` that priced the set at zero work.
  const borne = unweightedKg * (bwLoad / VOLUME.bodyweightFraction);
  const external = a.weight || 0;
  // A completed set is never zero work. `borne` is 0 for a movement that carries
  // none of the athlete — a seated erg, a machine — and if nothing external was
  // logged either, the additive sum is 0 and the set would vanish. An erg
  // interval is real work performed against resistance the logger never records
  // as weight, so fall back to the generic unloaded-rep price, exactly as an
  // unestimated movement does. Absence is never a penalty (docs/LESSONS.md).
  const load = borne + external > 0 ? borne + external : unweightedKg;
  const reps = repEquivalents(a);
  const side = set.notations.includes('/side') ? 2 : 1;
  const pause = set.notations.includes('(p)') ? VOLUME.pauseFactor : 1;
  const rpe =
    a.rpe != null
      ? clamp(1 + (a.rpe - RPE.default) * VOLUME.rpePerPoint, VOLUME.rpeFactorRange)
      : 1;

  return load * reps * side * pause * rpe * rom;
}

/**
 * How far the load travels on this movement, relative to a reference compound
 * bar path (`ROM.referenceM`). A calf raise moves the bar a quarter as far as a
 * squat at identical tonnage, and without this they scored the same.
 *
 * Dimensionless on purpose — see the note on `ROM` in app.config.ts. A movement
 * with no estimate scores 1.0: absence is neutral, never a penalty, so an
 * isometric is not priced at zero work for displacing nothing.
 */
/**
 * What fraction of the athlete this movement makes them lift, for `setVolume`.
 *
 * Absent means "not estimated" and falls back to the global
 * `VOLUME.bodyweightFraction`, never to zero — the same rule `rom` follows, and
 * for the same reason: absence must not be a penalty, or every unmapped
 * bodyweight movement would price at nothing. A 0 in the table is a positive
 * claim (a bench bears none of you) and is honoured.
 */
export function bwLoadFactor(profile: { bwLoad?: number } | null | undefined): number {
  const v = profile?.bwLoad;
  if (v == null || !Number.isFinite(v) || v < 0) return VOLUME.bodyweightFraction;
  return v;
}

export function romFactor(profile: { rom?: number } | null | undefined): number {
  const m = profile?.rom;
  if (m == null || !Number.isFinite(m) || m <= 0) return 1;
  return m / ROM.referenceM;
}

/** How heavy a set was relative to that movement's own best, as a multiplier. */
function intensityFactor(a: LogSet['actual'], best: number | undefined): number {
  // `!a.weight` rather than a null check: a bodyweight set has no external
  // intensity to compare against a best e1RM, whether it stored 0 or nothing.
  if (!a.weight || best == null || best <= 0) return 1;
  return clamp(a.weight / best / VOLUME.refIntensity, VOLUME.intensityFactorRange);
}

/** Low-rep sets are the explosive ones; junk-rep sets are not. */
function explosiveFactor(a: LogSet['actual']): number {
  const reps = repEquivalents(a);
  if (reps <= 0) return 1;
  return clamp(VOLUME.explosiveRefReps / reps, VOLUME.explosiveFactorRange);
}

export interface TrainingVolumeSummary {
  /** Scaled volume per modality, with the axis weighting already applied. */
  modalityVolume: Record<ModalityKey, number>;
  /** Working minutes of resistance work, for the endurance density term. */
  resistanceMinutes: number;
  /** 0..1 — how much of this window's resistance work was on short rests. */
  density: number;
}

/**
 * One walk over the logs producing the volume figures the radar's strength and
 * power axes need. Separate from `summarizeBodyLoad` because it applies
 * axis-specific weighting (intensity, explosiveness) that the body map must not
 * inherit — but it lives here so everything that classifies movements while
 * walking a LogDocument stays in one file.
 *
 * `bests` maps movement name → best e1RM, from `bestE1rmByMovement`.
 */
export function summarizeTrainingVolume(
  logs: WorkoutLog[],
  overrides: OverrideMap = {},
  bests: Map<string, number> = new Map(),
  opts: BodyLoadOptions = {},
): TrainingVolumeSummary {
  const unweightedKg = opts.unweightedKg ?? VOLUME.unweightedRepKg;
  const modalityVolume = zeroed(MODALITY_KEYS);
  let resistanceMinutes = 0;
  let denseMinutes = 0;
  let restedMinutes = 0;

  for (const log of logs) {
    if (log.status !== 'done') continue;

    // Measured density: working minutes against wall-clock elapsed. Actual rest
    // is never recorded anywhere, so this and the prescribed `restSeconds` below
    // are the only two reads available. NOTE total_seconds is capped at 7200 by
    // migration 0015, so a very long session reads as denser than it was.
    const elapsedMinutes = (log.total_seconds ?? 0) / 60;
    let logWorkingMinutes = 0;
    let logResistanceMinutes = 0;
    let logDenseMinutes = 0;

    for (const section of log.data?.sections ?? []) {
      for (const group of section.groups ?? []) {
        for (const item of group.items ?? []) {
          if (isSubroutine(item)) continue;

          const minutes = item.sets.reduce((acc, s) => acc + setMinutes(s), 0);
          if (minutes <= 0) continue;
          logWorkingMinutes += minutes;

          const c = classifyMovement(item.movement, { overrides });
          if (Object.keys(c.profile.regions).length === 0) continue;

          const modality =
            c.profile.modality ?? inferModality(item.sets, item.primaryMetric, section.key);
          if (!modality) continue;

          const best = bests.get(item.movement);
          const rom = romFactor(c.profile);
          const bw = bwLoadFactor(c.profile);
          for (const s of item.sets) {
            const base = setVolume(s, unweightedKg, rom, bw);
            if (base <= 0) continue;
            const weighted =
              modality === 'resistance'
                ? base * intensityFactor(s.actual, best)
                : modality === 'plyometric'
                  ? base * explosiveFactor(s.actual)
                  : base;
            modalityVolume[modality] += weighted;
          }

          if (modality === 'resistance') {
            logResistanceMinutes += minutes;
            // Prescribed rest: user-set intent, defaulting to 120, so an
            // untouched item reads as un-dense whatever actually happened.
            if (item.restSeconds != null && item.restSeconds < ENDURANCE.denseRestSeconds) {
              logDenseMinutes += minutes;
            }
          }
        }
      }
    }

    if (logResistanceMinutes <= 0) continue;
    resistanceMinutes += logResistanceMinutes;

    const clockDensity =
      elapsedMinutes > 0 ? Math.min(1, logWorkingMinutes / elapsedMinutes) : null;
    const restDensity = logResistanceMinutes > 0 ? logDenseMinutes / logResistanceMinutes : null;
    // Neither read is complete on its own, so average them where both exist.
    const signals = [clockDensity, restDensity].filter((n): n is number => n != null);
    const sessionDensity = signals.length > 0 ? mean(signals) : 0;
    denseMinutes += logResistanceMinutes * sessionDensity;
    restedMinutes += logResistanceMinutes;
  }

  return {
    modalityVolume,
    resistanceMinutes,
    density: restedMinutes > 0 ? denseMinutes / restedMinutes : 0,
  };
}

// Modality fallback, used ONLY when the taxonomy is silent on a name. Static
// classification always wins: a Back Squat inside a conditioning circuit is
// still resistance. The taxonomy answers "what kind of movement is this", not
// "how did this session feel" — which is exactly why the session tag is the
// last resort and never overrides.
function inferModality(
  sets: LogSet[],
  primaryMetric: string,
  section: SectionKey,
): ModalityKey | null {
  const done = sets.filter((s) => s.actual.completed);
  const looksEndurance = done.some(
    (s) => (s.actual.time != null || s.actual.distance != null) && !s.actual.weight,
  );
  if (looksEndurance) return 'endurance';
  if (primaryMetric === 'time' || primaryMetric === 'distance') {
    return section === 'warmup' || section === 'cooldown' ? 'mobility' : 'endurance';
  }
  if (primaryMetric === 'weight') return 'resistance';
  if (section === 'conditioning') return 'endurance';
  if (section === 'warmup' || section === 'cooldown') return 'mobility';
  return null;
}

// Which lens a modality belongs to. Null for an un-inferrable modality, which
// is deliberate — see the note at the accumulation site.
function lensFor(modality: ModalityKey | null): BodyLensKey | null {
  if (!modality) return null;
  for (const key of BODY_LENS_KEYS) {
    if ((BODY_LENSES[key].modalities as readonly string[]).includes(modality)) return key;
  }
  return null;
}

// ---- session-clock allocation ---------------------------------------------
//
// See SESSION_CLOCK in app.config.ts for why minutes are allocated from the
// session's own wall clock rather than summed from `setMinutes`.

/**
 * How much more of a session one set of this movement is worth than one set of
 * an isolation movement. Read off what the taxonomy already knows — region
 * spread and `systemic` — so there is no new hand-maintained column, and
 * clamped to COMPOUND.range so it can only nudge the split.
 */
function compoundFactor(profile: MovementProfile): number {
  const regions = Object.keys(profile.regions).length;
  if (regions === 0) return 1;
  return clamp(
    1 + (regions - 1) * COMPOUND.perExtraRegion + (profile.systemic ? COMPOUND.systemicBonus : 0),
    COMPOUND.range,
  );
}

/**
 * The key the remainder is spread by: what this item plausibly COST the clock.
 *
 * Rest is in it deliberately. A set of squats and a set of curls do not occupy
 * the session equally, and `setMinutes` — time under tension only — says they
 * nearly do. `restSeconds` is real logged intent on most items and is the one
 * recorded number that captures the difference; the compound factor covers the
 * rest of it. Only a distribution key, never a total: it decides how the
 * remainder splits, never how big the remainder is.
 */
function itemShareWeight(item: LogItem, profile: MovementProfile): number {
  const rest = item.restSeconds ?? SESSION_CLOCK.restFallbackSeconds;
  let seconds = 0;
  for (const s of item.sets) {
    if (!s.actual.completed) continue;
    seconds += setMinutes(s) * 60 + rest;
  }
  return (seconds / 60) * compoundFactor(profile);
}

/**
 * Minutes a non-remainder block claims off the clock before the split.
 * A set that logged real time always beats the stand-in — a 5-minute rower
 * interval in a conditioning block is 5 minutes, not the 1-minute default.
 */
function claimMinutes(item: LogItem, modality: ModalityKey | null): number {
  let logged = 0;
  let done = 0;
  for (const s of item.sets) {
    if (!s.actual.completed) continue;
    done += 1;
    if (s.actual.time != null) logged += s.actual.time / 60;
  }
  if (logged > 0) return logged;
  return (
    done *
    (modality === 'mobility' ? SESSION_CLOCK.mobilitySetMinutes : SESSION_CLOCK.enduranceSetMinutes)
  );
}

function tagModality(tags: string[] | null | undefined): ModalityKey | null {
  const table = SESSION_CLOCK.tagModality as Record<string, ModalityKey | undefined>;
  for (const t of tags ?? []) {
    const m = table[t];
    if (m) return m;
  }
  return null;
}

function remainderFloor(tags: string[] | null | undefined): number {
  const t = tags ?? [];
  return (SESSION_CLOCK.mixedTags as readonly string[]).some((k) => t.includes(k))
    ? SESSION_CLOCK.mixedFloor
    : SESSION_CLOCK.resistanceFloor;
}

/** One item of a session, after classification and before allocation. */
interface WalkItem {
  item: LogItem;
  section: SectionKey;
  profile: MovementProfile;
  hasRegions: boolean;
  modality: ModalityKey | null;
  /** Raw `setMinutes` — the OLD currency, kept only to rank modalities. */
  raw: number;
  /** Allocated share of the session clock. The currency everything else reads. */
  minutes: number;
}

/**
 * What the session was mostly about — the modality that owns its clock.
 *
 * Ranked over the session's MAIN WORK — the items outside warmup, cooldown and
 * conditioning — because those three sections are by definition not what the
 * session was, and a session that has no main work at all (a run logged as one
 * conditioning block, a yoga class logged as one cooldown block) falls back to
 * ranking everything.
 *
 * Ranked by `itemShareWeight`, NOT by raw setMinutes. Ranking by raw minutes
 * reproduces the exact bias being fixed: two sets of stretching out-score a set
 * of squats on time under tension, so a lift with a cooldown would elect
 * mobility as its own main work.
 *
 * Extracted from `allocateSession` so `sessionLens` can ask the same question
 * without allocating anything. Unchanged in behaviour — allocation still calls
 * it for the remainder owner.
 */
function ownerModality(log: WorkoutLog, walk: WalkItem[]): ModalityKey | null {
  const main = walk.filter(
    (w) => !(SESSION_CLOCK.claimSections as readonly string[]).includes(w.section),
  );
  const candidates = main.length > 0 ? main : walk;

  const byModality = new Map<ModalityKey, number>();
  for (const w of candidates) {
    if (w.modality) {
      byModality.set(w.modality, (byModality.get(w.modality) ?? 0) + itemShareWeight(w.item, w.profile));
    }
  }
  const ranked = [...byModality.entries()].sort((a, b) => b[1] - a[1]);
  const tagged = tagModality(log.tags);
  const top = ranked[0];
  const tiedAtTop = top != null && ranked.filter(([, v]) => v === top[1]).length > 1;
  return top == null
    ? tagged
    : tiedAtTop && tagged != null && byModality.get(tagged) === top[1]
      ? tagged
      : top[0];
}

/**
 * Spend one session's wall clock across its items, in place.
 *
 * Warmup, cooldown and conditioning claim an explicit share first; whatever is
 * left goes to what the session mostly WAS, spread across its items by
 * `itemShareWeight`. The owner is chosen by the classifier — a tag only breaks
 * a tie or fills a silence — because a tag is what a session was called and the
 * taxonomy is what was performed, and real logs disagree often enough to matter.
 */
function allocateSession(log: WorkoutLog, walk: WalkItem[]): void {
  const rawTotal = walk.reduce((a, w) => a + w.raw, 0);
  if (rawTotal <= 0) return;

  // A clock below the floor is not a measurement — real data holds sessions at
  // 0s and 203s carrying 13-20 completed sets. Fall back to working minutes
  // rather than dropping the session: the timer was not running, the work was.
  //
  // Nothing is reallocated in that case. There is no session time to spend, so
  // every item keeps exactly what `setMinutes` gave it and the session behaves
  // as it did before this existed. Claiming and the floor both need a real
  // clock to mean anything: applied to a total that IS the sum of the parts,
  // the floor would reshape data that was never mismeasured.
  const elapsed = (log.total_seconds ?? 0) / 60;
  if (elapsed < SESSION_CLOCK.minPlausibleMinutes) {
    for (const w of walk) w.minutes = w.raw;
    return;
  }
  const sessionMinutes = elapsed;

  const owner = ownerModality(log, walk);

  const isClaim = walk.map((w) => w.modality != null && w.modality !== owner);
  const claims = walk.map((w, i) => (isClaim[i] ? claimMinutes(w.item, w.modality) : 0));
  let claimed = claims.reduce((a, b) => a + b, 0);

  // The guard: the session's main work can never be claimed below its floor.
  // Measured over 48 real sessions this never fires (lowest strength remainder
  // 76%, lowest hyrox 79%) — it is here so a conditioning-heavy log cannot
  // claim away the lifting it was mostly made of.
  const floor = owner === 'resistance' ? remainderFloor(log.tags) : 0;
  const maxClaim = sessionMinutes * (1 - floor);
  if (claimed > maxClaim) {
    const k = claimed > 0 ? maxClaim / claimed : 0;
    for (let i = 0; i < claims.length; i += 1) claims[i] *= k;
    claimed = maxClaim;
  }
  const remainder = Math.max(0, sessionMinutes - claimed);

  const weights = walk.map((w, i) => (isClaim[i] ? 0 : itemShareWeight(w.item, w.profile)));
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  const rawRemainder = walk.reduce((a, w, i) => a + (isClaim[i] ? 0 : w.raw), 0);
  const remainderCount = isClaim.filter((x) => !x).length;

  for (let i = 0; i < walk.length; i += 1) {
    const w = walk[i];
    if (isClaim[i]) {
      w.minutes = claims[i];
      continue;
    }
    w.minutes =
      weightTotal > 0
        ? remainder * (weights[i] / weightTotal)
        : rawRemainder > 0
          ? remainder * (w.raw / rawRemainder)
          : remainderCount > 0
            ? remainder / remainderCount
            : 0;
    // Work the taxonomy could not place still consumed this session, and the
    // session's character is known. Unknown work in a lifting session is
    // lifting time. This does NOT touch `coverage`, which is about regions.
    if (w.modality == null) w.modality = owner;
  }
}

/**
 * Classify a session's items, before any minute is attributed. Shared by
 * `summarizeBodyLoad`'s first pass and by `sessionLens`, which needs the same
 * classification to ask what a session was without allocating its clock.
 */
function buildWalk(log: WorkoutLog, overrides: OverrideMap): WalkItem[] {
  const walk: WalkItem[] = [];
  for (const section of log.data?.sections ?? []) {
    for (const group of section.groups ?? []) {
      for (const item of group.items ?? []) {
        if (isSubroutine(item)) continue;

        const raw = item.sets.reduce((acc, s) => acc + setMinutes(s), 0);
        if (raw <= 0) continue;

        const c = classifyMovement(item.movement, { overrides });
        walk.push({
          item,
          section: section.key,
          profile: c.profile,
          hasRegions: Object.keys(c.profile.regions).length > 0,
          modality: c.profile.modality ?? inferModality(item.sets, item.primaryMetric, section.key),
          raw,
          minutes: 0,
        });
      }
    }
  }
  return walk;
}

/**
 * Which lens a whole session belongs to — what you dedicated that block of time
 * to.
 *
 * WHY THIS IS NOT `summarizeBodyLoad().modalityMinutes`. That splits a session's
 * clock proportionally across the modalities inside it, which is the right
 * question for the body map: it shades muscles, so a lift that ended with ten
 * minutes of stretching really did spend ten minutes on mobility. It is the
 * wrong question for "where did my training time go", which is answered per
 * SESSION: an hour in the gym is an hour of lifting, rest and setup included,
 * and the warm-up does not make it partly a mobility session.
 *
 * Winner-take-all, therefore, and deliberately: a Hyrox session lands wholly in
 * one lens rather than being split. Falls back to the session's tags when
 * nothing classifies, which is what carries Garmin rows and empty documents —
 * they have no set data to rank.
 */
/**
 * How long a session actually took, in seconds.
 *
 * `total_seconds` when the clock is plausible, and the sum of its working sets
 * when it is not — real data holds sessions at 0s and 203s carrying 13-20
 * completed sets, where the timer was not running but the work was. Same floor
 * and same fallback `allocateSession` uses, so "where the time went" and "how
 * the minutes split" cannot disagree about how long a session was.
 */
export function sessionClockSeconds(log: WorkoutLog, overrides: OverrideMap = {}): number {
  const elapsed = log.total_seconds ?? 0;
  if (elapsed / 60 >= SESSION_CLOCK.minPlausibleMinutes) return elapsed;
  return buildWalk(log, overrides).reduce((a, w) => a + w.raw, 0) * 60;
}

export function sessionLens(log: WorkoutLog, overrides: OverrideMap = {}): BodyLensKey | null {
  const walk = buildWalk(log, overrides);
  return lensFor(walk.length > 0 ? ownerModality(log, walk) : tagModality(log.tags));
}

export function summarizeBodyLoad(
  logs: WorkoutLog[],
  overrides: OverrideMap = {},
  opts: BodyLoadOptions = {},
): BodyLoadSummary {
  const unweightedKg = opts.unweightedKg ?? VOLUME.unweightedRepKg;
  const regionMinutes = zeroed(MUSCLE_REGION_KEYS);
  const regionVolume = zeroed(MUSCLE_REGION_KEYS);
  const modalityMinutes = zeroed(MODALITY_KEYS);
  const planeMinutes = zeroed(PLANE_KEYS);
  const rotaryMinutes = zeroed(['rotational', 'antiRotational'] as const);
  const resistanceSets = zeroed(MUSCLE_REGION_KEYS);
  const hardSetsByRegion = zeroed(MUSCLE_REGION_KEYS);
  const resistanceTonnage = zeroed(MUSCLE_REGION_KEYS);
  const byLens = Object.fromEntries(
    BODY_LENS_KEYS.map((k) => [k, { minutes: zeroed(MUSCLE_REGION_KEYS), volume: zeroed(MUSCLE_REGION_KEYS) }]),
  ) as BodyLoadSummary['byLens'];

  let systemicMinutes = 0;
  let classifiedMinutes = 0;
  let unmappedMinutes = 0;
  const unmapped = new Map<string, { minutes: number; sessions: Set<string> }>();
  const countedLogs = new Set<string>();

  for (const log of logs) {
    if (log.status !== 'done') continue;
    countedLogs.add(log.id);

    // PASS 1 — classify. Minutes cannot be attributed yet: the split depends on
    // the whole session, not on any one item.
    const walk = buildWalk(log, overrides);
    if (walk.length === 0) continue;

    // PASS 2 — spend the session clock across them.
    allocateSession(log, walk);

    // PASS 3 — attribute the allocated minutes.
    for (const { item, profile, hasRegions, modality, minutes } of walk) {
      if (minutes <= 0) continue;

      if (!hasRegions) {
        unmappedMinutes += minutes;
        const entry = unmapped.get(item.movement) ?? { minutes: 0, sessions: new Set<string>() };
        entry.minutes += minutes;
        entry.sessions.add(log.id);
        unmapped.set(item.movement, entry);
        continue;
      }

      classifiedMinutes += minutes;

      // Volume is a DIFFERENT currency — scaled load, not time — and is not
      // reallocated. Only minutes were ever in the wrong unit.
      const rom = romFactor(profile);
      const bw = bwLoadFactor(profile);
      // One cutoff per movement, not per region: it is a property of the
      // movement's own profile shape.
      const regionCutoff = meaningfulRegionShare(profile.regions);
      const itemVolume = item.sets.reduce((acc, s) => acc + setVolume(s, unweightedKg, rom, bw), 0);

      const lens = lensFor(modality);

      for (const [region, weight] of Object.entries(profile.regions) as [RegionKey, number][]) {
        regionMinutes[region] += minutes * weight;
        regionVolume[region] += itemVolume * weight;

        if (lens) {
          byLens[lens].minutes[region] += minutes * weight;
          byLens[lens].volume[region] += itemVolume * weight;
        }

        if (modality === 'resistance') {
          for (const s of item.sets) {
            if (!s.actual.completed) continue;
            resistanceSets[region] += weight;
            resistanceTonnage[region] += (s.actual.weight ?? 0) * (s.actual.reps ?? 0) * weight;
          }
        }

        // Whole sets, every modality, gated on the set being loaded and on the
        // region taking a meaningful share. Outside the `resistance` branch on
        // purpose: a loaded carry is endurance by modality and still trains the
        // muscles holding the weight.
        if (weight >= regionCutoff) {
          for (const s of item.sets) {
            if (isLoadedSet(s, profile)) hardSetsByRegion[region] += 1;
          }
        }
      }

      for (const [plane, weight] of Object.entries(profile.planes) as [PlaneKey, number][]) {
        planeMinutes[plane] += minutes * weight;
      }

      if (modality) modalityMinutes[modality] += minutes;
      if (profile.rotary) rotaryMinutes[profile.rotary] += minutes;
      if (profile.systemic) systemicMinutes += minutes;
    }
  }

  const totalMinutes = classifiedMinutes + unmappedMinutes;

  return {
    regionMinutes,
    regionVolume,
    byLens,
    modalityMinutes,
    planeMinutes,
    rotaryMinutes,
    systemicMinutes,
    resistanceSets,
    hardSetsByRegion,
    resistanceTonnage,
    unmapped: [...unmapped.entries()]
      .map(([name, v]) => ({ name, minutes: v.minutes, sessions: v.sessions.size }))
      .sort((a, b) => b.minutes - a.minutes),
    totalMinutes,
    coverage: totalMinutes > 0 ? classifiedMinutes / totalMinutes : 0,
    sessions: countedLogs.size,
  };
}

/** The two currencies the body map can be read in. */
export type BodyCurrency = 'minutes' | 'volume';

// The single funnel every body-map surface reads — the silhouette heat, the
// region list and the callouts all come through here, so the lens only has to be
// threaded once. Omitting it keeps the old all-modality behaviour, which is what
// the tests that predate lenses assert.
export function regionTotals(
  summary: BodyLoadSummary,
  currency: BodyCurrency,
  lens?: BodyLensKey,
): Record<RegionKey, number> {
  const scope = lens ? summary.byLens[lens] : { minutes: summary.regionMinutes, volume: summary.regionVolume };
  return currency === 'volume' ? scope.volume : scope.minutes;
}

// Region intensities normalised 0..1 against the busiest region, for the map.
// Normalisation is per currency: the heat map has to follow whichever the user
// is reading, or the shading would contradict the list beside it.
export function regionIntensities(
  summary: BodyLoadSummary,
  currency: BodyCurrency = 'minutes',
  lens?: BodyLensKey,
): Record<RegionKey, number> {
  const totals = regionTotals(summary, currency, lens);
  const max = Math.max(...Object.values(totals));
  const out = zeroed(MUSCLE_REGION_KEYS);
  if (max <= 0) return out;
  for (const k of MUSCLE_REGION_KEYS) out[k] = totals[k] / max;
  return out;
}
