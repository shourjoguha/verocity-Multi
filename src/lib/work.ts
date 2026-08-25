// WORK DONE — the Stats screen's currency. See the `WORK` block in app.config.ts
// for the model; the short version is `force x displacement`, output in kg.m.
//
// This is NOT `setVolume` in lib/bodyLoad.ts and must not be merged with it.
// That function prices STIMULUS for the radar — it multiplies in RPE and load
// relative to your own e1RM, and converts every metric into rep-equivalents
// through one global pace. Both choices are right for stimulus and wrong for
// work: RPE is perceived effort, not weight moved, and the global pace made the
// same 50m sled push score 4.5x differently depending on which box the logger
// filled. Nothing here reads RPE, and nothing here converts through time.
//
// The lane follows THE METRIC ACTUALLY LOGGED, not the movement's modality: a
// sled push is `modality: 'resistance'` but is logged in distance, and distance
// is what determines which formula can even run.

import { VOLUME, WORK, type MovementProfile } from '@/app.config';
import { classifyMovement, type OverrideMap } from '@/lib/movementTaxonomy';
import { isSubroutine } from '@/lib/subroutine';
import type { LogSet, UserStats, WorkoutLog } from '@/lib/types';

/** kg.m of work, split by lane. Never summed for display — see WORK. */
export interface WorkTotals {
  resistance: number;
  cardio: number;
}

export const ZERO_WORK: WorkTotals = { resistance: 0, cardio: 0 };

/**
 * Bodyweight to price the force term against.
 *
 * Falls back through the same two constants `unweightedRepKg` uses, so a user
 * with no `user_stats` row — including the anon showcase client, which cannot
 * read the table at all — gets a coherent number from both models rather than
 * two different guesses.
 */
export function workBodyWeight(stats: UserStats | null): number {
  const kg = stats?.body_weight_kg;
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return WORK.fallbackBodyWeightKg;
  return kg;
}

/**
 * The force this set moved, in kg: the athlete's own borne share plus whatever
 * was on the bar.
 *
 * `forceFactor` before `bwLoad` is the whole reason that field exists — see
 * MovementProfile. `|| 0` and not `?? 0` on the external weight, because
 * voice.ts has always written 0 to mean "bodyweight", the same as writing
 * nothing.
 */
function forceKg(set: LogSet, profile: MovementProfile | null, bodyWeightKg: number): number {
  const fraction = profile?.forceFactor ?? profile?.bwLoad ?? VOLUME.bodyweightFraction;
  const borne = bodyWeightKg * fraction;
  const external = set.actual.weight || 0;
  return borne + external;
}

/**
 * Which lane a set belongs to, or null when it does no measurable work.
 *
 * TIME IS DELIBERATELY UNSCORED. A minute is not a quantity of work — it says
 * nothing about how much was moved, where a rep and a metre both say it
 * directly — so an isometric or a time-capped bout scores zero here and keeps
 * its minutes on the body map instead. Normalising reps and distance THROUGH
 * time would be inventing the very coefficient the numbers already contain.
 */
function laneOf(a: LogSet['actual']): 'resistance' | 'cardio' | null {
  if (!a.completed) return null;
  if (a.reps != null) return 'resistance';
  if (a.distance != null || a.calories != null) return 'cardio';
  return null;
}

/**
 * Work done by one set, in kg.m, added into `into`.
 *
 * Resistance: `force x romMetres x reps x side x tempo`. `rom` is read as REAL
 * METRES here, not as the ratio to `ROM.referenceM` that `romFactor` returns —
 * that ratio is a stimulus weighting, and this is the displacement itself.
 *
 * Cardio: `force x metres x horizFactor`. No side and no tempo: neither
 * notation means anything on a distance, and applying them would be noise.
 */
export function addSetWork(
  set: LogSet,
  profile: MovementProfile | null,
  bodyWeightKg: number,
  into: WorkTotals,
): void {
  const a = set.actual;
  const lane = laneOf(a);
  if (lane == null) return;

  const force = forceKg(set, profile, bodyWeightKg);
  if (force <= 0) return;

  if (lane === 'resistance') {
    const metres = profile?.rom ?? WORK.defaultRomM;
    // Both notations are the same claim — more time under tension per rep than
    // a touch-and-go one — so both earn the same scaling.
    const tempo =
      set.notations.includes('(p)') || set.notations.includes('(t)') ? VOLUME.pauseFactor : 1;
    const side = set.notations.includes('/side') ? 2 : 1;
    into.resistance += force * metres * (a.reps ?? 0) * side * tempo;
    return;
  }

  // Calories are erg distance in another unit. A set carrying both is scored on
  // the distance, which was measured rather than converted.
  const metres =
    a.distance != null ? a.distance : (a.calories ?? 0) * (profile?.calMetres ?? WORK.defaultCalMetres);
  into.cardio += force * metres * (profile?.horizFactor ?? WORK.defaultHorizFactor);
}

/**
 * Work done in one session, by lane. Only completed sets count — a
 * planned-but-not-performed set is not work done, which is deliberately unlike
 * `sessionVolume` in lib/stats.ts, the tonnage figure this replaces.
 */
export function sessionWork(
  log: WorkoutLog,
  bodyWeightKg: number,
  overrides: OverrideMap = {},
): WorkTotals {
  const totals: WorkTotals = { resistance: 0, cardio: 0 };
  for (const section of log.data?.sections ?? []) {
    for (const group of section.groups ?? []) {
      for (const item of group.items ?? []) {
        if (isSubroutine(item)) continue;
        // An unresolvable movement still did work: the profile is null and every
        // term falls back to its global default, which is the same rule the rest
        // of the taxonomy follows. Absence is never a penalty.
        const c = classifyMovement(item.movement, { overrides });
        const profile = c.source === 'unknown' ? null : c.profile;
        for (const set of item.sets) addSetWork(set, profile, bodyWeightKg, totals);
      }
    }
  }
  return totals;
}

/** The largest work seen in each lane across a window. */
export type WorkMaxima = WorkTotals;

export function workMaxima(days: Iterable<WorkTotals>): WorkMaxima {
  const max: WorkMaxima = { resistance: 0, cardio: 0 };
  for (const d of days) {
    if (d.resistance > max.resistance) max.resistance = d.resistance;
    if (d.cardio > max.cardio) max.cardio = d.cardio;
  }
  return max;
}

/**
 * How big a day was FOR ITS KIND, as 0..1 — the max of each lane's ratio to
 * that lane's own maximum.
 *
 * NEVER sum the lanes for this. Both are kg.m, so `resistance + cardio` is
 * dimensionally legal and was shipped on that reasoning; it is still wrong,
 * because the lanes have never been calibrated against each other and cannot
 * be. The counts differ by three orders of magnitude — tens of reps against
 * tens of thousands of metres — while the per-unit prices differ by one, so a
 * hard full lifting session (~8,600) lands at a sixth of a 30km ride (~51,600).
 * On a shared rail every lifting day reads as empty, and no constant fixes
 * that: cycling would have to be distorted to a twentieth of its real cost to
 * make the two look alike. The lanes were split precisely so this comparison
 * would never have to be made.
 *
 * A day that mixes lanes takes the HIGHER ratio: it was a big day if it was big
 * at either thing. Averaging would let an easy run dilute a hard lift.
 *
 * A lane whose maximum is zero contributes nothing rather than dividing by it —
 * an athlete who only lifts still gets a full rail from the lifting lane.
 */
export function workIntensity(work: WorkTotals, max: WorkMaxima): number {
  const res = max.resistance > 0 ? work.resistance / max.resistance : 0;
  const cardio = max.cardio > 0 ? work.cardio / max.cardio : 0;
  return Math.min(1, Math.max(res, cardio));
}

export const addWork = (a: WorkTotals, b: WorkTotals): WorkTotals => ({
  resistance: a.resistance + b.resistance,
  cardio: a.cardio + b.cardio,
});

/**
 * A work figure, compactly. Numbers here run to five and six digits — a single
 * hard session clears 20,000 kg.m — and the weekly table has five columns to
 * fit at 375px, so the full number does not go on screen.
 *
 * Returns the magnitude only. Callers with room append `WORK_UNIT`; the table
 * carries it once in a caption instead of on every cell.
 */
export function formatWork(kgm: number): string {
  if (!Number.isFinite(kgm) || kgm <= 0) return '0';
  if (kgm >= 1_000_000) return `${(kgm / 1_000_000).toFixed(1)}M`;
  if (kgm >= 10_000) return `${Math.round(kgm / 1000)}k`;
  if (kgm >= 1_000) return `${(kgm / 1000).toFixed(1)}k`;
  return String(Math.round(kgm));
}

/** Kilogram-metres: the weight moved, times how far it moved. */
export const WORK_UNIT = 'kg·m';
