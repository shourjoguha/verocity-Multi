// What was this loaded work FOR?
//
// Strength, hypertrophy and loaded conditioning are three different jobs done
// with the same equipment, and a log records all three identically: a movement,
// a weight, some reps. The obvious discriminator is the rep count, and on real
// data it does not work. Across one athlete's four rest bands the mean reps
// moved 11.7 -> 10.2 while the mean top load moved 35 -> 58.5 kg. Reps alone
// would have called every one of those sets hypertrophy.
//
// WHAT DOES SEPARATE THEM is how the set is SPACED and what it is spaced
// AGAINST — prescribed rest, and whether the movement shares a superset with
// something that fatigues the same muscles. On the same data, as prescribed
// rest lengthened the load climbed monotonically and supersets disappeared
// (39% -> 50% -> 13% -> 0%).
//
// PRESCRIBED REST IS THE RIGHT FIELD, and it is worth being explicit about why,
// because it looks like a weakness. `SetActual` has no `rest` member: the app
// has never recorded rest TAKEN, only rest PLANNED on the item. For this
// question that is not a compromise but the correct reading — intent is what
// the work was for, and the plan is where intent is written down.
//
// THE CORPUS CORRECTS THE OBVIOUS VERSION OF THIS RULE. "Superset means it is
// not strength work" is wrong, and `TRAINING.strengthRest`'s own caveat says
// so: Galpin "explicitly allows the rest to be filled by supersetting an
// unrelated muscle group — resting is not the same as standing still." So a
// superset only argues against strength intent when the partner movement
// fatigues the SAME muscles, which the region profiles already know. That
// distinction is the whole reason this module needs the taxonomy and not just
// the numbers on the set.
//
// NOTHING HERE IS A THRESHOLD OF ITS OWN. The boundary is 120 seconds, and it
// arrives from both directions in the existing pack: `strengthRest` puts heavy
// work at two-to-four minutes, `hypertrophyRest` puts hypertrophy at "the two
// minute range at most". The same number, named by both claims. This module
// applies them; it does not invent.

import { classifyMovement, type OverrideMap } from '@/lib/movementTaxonomy';
import type { RegionKey } from '@/app.config';
import type { LogGroup, LogItem } from '@/lib/types';

/** What a piece of loaded work appears to be for. */
export type LoadedIntent =
  /** Spaced long enough, and not fighting a fatigued partner. */
  | 'strength'
  /** The middle: moderate rest, or a superset that shares muscles. */
  | 'hypertrophy'
  /** Short rest against a partner that fatigues the same tissue. */
  | 'conditioning'
  /** Loaded, but nothing said about how it was spaced. */
  | 'unspecified';

/**
 * Region overlap between two movements, 0..1.
 *
 * The sum of the smaller share in each region they have in common — 1.0 for two
 * movements that train exactly the same muscles in the same proportions, 0 for
 * two that share none. This is what makes an "unrelated muscle group" superset
 * (Galpin's filled rest) distinguishable from a genuine density pairing.
 */
export function regionOverlap(
  a: Partial<Record<RegionKey, number>>,
  b: Partial<Record<RegionKey, number>>,
): number {
  let shared = 0;
  for (const [region, wa] of Object.entries(a) as [RegionKey, number][]) {
    const wb = b[region];
    if (wb != null) shared += Math.min(wa, wb);
  }
  return Number(shared.toFixed(2));
}

/**
 * Above this the superset partner counts as the SAME muscle group, so the
 * pairing is a density choice rather than Galpin's filled rest.
 *
 * Editorial, like MEANINGFUL_REGION_SHARE and the impact weights — a judgement
 * about when two movements stop being unrelated, not a claim about the body.
 */
export const RELATED_OVERLAP = 0.3;

/** Rest at or under which a pairing reads as deliberately dense. Below the
 *  hypertrophy ceiling by a clear margin, so the middle band stays the middle. */
export const DENSE_REST_SECONDS = 60;

export interface IntentInput {
  item: LogItem;
  group: LogGroup;
  /** `TRAINING.strengthRest.value[0]`, which is also `hypertrophyRest.value`. */
  restBoundarySeconds: number;
  overrides?: OverrideMap;
}

export interface IntentVerdict {
  intent: LoadedIntent;
  /** Prescribed rest actually found, item first then group. Null is meaningful
   *  and is why `unspecified` exists. */
  restSeconds: number | null;
  /** Highest region overlap with a partner in the same superset or circuit. */
  partnerOverlap: number | null;
}

/**
 * Classify one item's loaded work.
 *
 * Deliberately returns `unspecified` rather than guessing when no rest was
 * prescribed. On the data that prompted this, unspecified loaded items look
 * statistically like the short-rest band — but that is a correlation across 31
 * items, not a fact, and the codebase has been bitten before by treating an
 * absent value as a measured one (the RPE prefill, and `drift: 0` against no
 * reading at all). A caller that wants the optimistic reading can say so; the
 * measurement will not say it for them.
 */
export function classifyIntent(input: IntentInput): IntentVerdict {
  const { item, group, restBoundarySeconds } = input;
  const rest = item.restSeconds ?? group.restSeconds ?? null;

  const mine = classifyMovement(item.movement, { overrides: input.overrides }).profile.regions;
  let partnerOverlap: number | null = null;
  for (const other of group.items) {
    if (other.id === item.id) continue;
    const theirs = classifyMovement(other.movement, { overrides: input.overrides }).profile.regions;
    const o = regionOverlap(mine, theirs);
    if (partnerOverlap == null || o > partnerOverlap) partnerOverlap = o;
  }
  const relatedPartner = partnerOverlap != null && partnerOverlap >= RELATED_OVERLAP;

  if (rest == null) return { intent: 'unspecified', restSeconds: null, partnerOverlap };

  // Long rest is strength work — UNLESS it is being spent on a partner that
  // fatigues the same muscles, which is the one case the corpus's own caveat
  // does not cover.
  if (rest >= restBoundarySeconds) {
    return {
      intent: relatedPartner ? 'hypertrophy' : 'strength',
      restSeconds: rest,
      partnerOverlap,
    };
  }
  // Short rest against a related partner is density work under load.
  if (rest <= DENSE_REST_SECONDS && relatedPartner) {
    return { intent: 'conditioning', restSeconds: rest, partnerOverlap };
  }
  return { intent: 'hypertrophy', restSeconds: rest, partnerOverlap };
}

/** Loaded sets by what they appear to be for. Counts SETS, not items, because
 *  an item is a row in a logger and a set is the unit of work. */
export type IntentMix = Record<LoadedIntent, number>;

export function emptyMix(): IntentMix {
  return { strength: 0, hypertrophy: 0, conditioning: 0, unspecified: 0 };
}

/**
 * The share each intent takes of the sets that SAID what they were for.
 *
 * `unspecified` is excluded from the denominator and reported alongside, so a
 * log that prescribes rest on a third of its items cannot read as "two thirds
 * of your work is hypertrophy" when the honest statement is "of the third that
 * said, two thirds were hypertrophy-shaped".
 */
export function mixShares(mix: IntentMix): {
  shares: Record<Exclude<LoadedIntent, 'unspecified'>, number>;
  specified: number;
  unspecified: number;
} {
  const specified = mix.strength + mix.hypertrophy + mix.conditioning;
  const share = (n: number) => (specified > 0 ? Number((n / specified).toFixed(2)) : 0);
  return {
    shares: {
      strength: share(mix.strength),
      hypertrophy: share(mix.hypertrophy),
      conditioning: share(mix.conditioning),
    },
    specified,
    unspecified: mix.unspecified,
  };
}
