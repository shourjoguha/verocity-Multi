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
  ENDURANCE,
  LOAD,
  MODALITY_KEYS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  ROM,
  RPE,
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
import type { LogSet, WorkoutLog } from '@/lib/types';

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
  resistanceSets: Record<RegionKey, number>;
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

    for (const section of log.data?.sections ?? []) {
      for (const group of section.groups ?? []) {
        for (const item of group.items ?? []) {
          if (isSubroutine(item)) continue;

          const minutes = item.sets.reduce((acc, s) => acc + setMinutes(s), 0);
          if (minutes <= 0) continue;

          const c = classifyMovement(item.movement, { overrides });
          const hasRegions = Object.keys(c.profile.regions).length > 0;

          if (!hasRegions) {
            unmappedMinutes += minutes;
            const entry = unmapped.get(item.movement) ?? { minutes: 0, sessions: new Set<string>() };
            entry.minutes += minutes;
            entry.sessions.add(log.id);
            unmapped.set(item.movement, entry);
            continue;
          }

          classifiedMinutes += minutes;

          const profile: MovementProfile = c.profile;
          const modality =
            profile.modality ?? inferModality(item.sets, item.primaryMetric, section.key);

          // Unweighted by intensity/explosiveness on purpose: those are
          // axis-specific weightings the radar applies in summarizeTrainingVolume,
          // and the body map must not inherit them. This is raw scaled volume,
          // ROM-adjusted so a calf raise stops matching a squat at equal tonnage.
          const rom = romFactor(profile);
          const bw = bwLoadFactor(profile);
          const itemVolume = item.sets.reduce(
            (acc, s) => acc + setVolume(s, unweightedKg, rom, bw),
            0,
          );

          // Which lens this item's work belongs to. An item whose modality could
          // not be inferred still counts in the all-modality totals but lands in
          // no lens — it has no defensible one, and inventing a bucket would put
          // unclassifiable work behind a label that claims to know better.
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
          }

          for (const [plane, weight] of Object.entries(profile.planes) as [PlaneKey, number][]) {
            planeMinutes[plane] += minutes * weight;
          }

          if (modality) modalityMinutes[modality] += minutes;
          if (profile.rotary) rotaryMinutes[profile.rotary] += minutes;
          if (profile.systemic) systemicMinutes += minutes;
        }
      }
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
