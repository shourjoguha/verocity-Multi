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
  | 'conditioning';

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

/**
 * What to assume when the rest PICKER was never touched.
 *
 * `LogItem.restSeconds` is set by the manual selector in the movement sheet
 * (`TIMERS.restPresets`). Absent means the athlete never opened it — and the
 * athlete whose log this was built against says that reliably means a short
 * rest, which the data agrees with: their unlogged loaded items sit with the
 * under-60s band on load and on superset share, not with the long-rest one.
 *
 * DO NOT REACH FOR `TIMERS.defaultRestSeconds` HERE. That constant is 120 and
 * belongs to the on-screen countdown, which is a different thing entirely — it
 * is what the timer starts at, not a claim about what was rested, and nothing
 * writes its elapsed value back to the set. Using it would put every unlogged
 * item at exactly the strength boundary and classify the majority of a real log
 * as strength work, which is the precise opposite of what it is.
 *
 * This is an ASSUMPTION and is reported as one: every verdict carries
 * `restAssumed`, and the mix counts assumed sets separately so a surface can
 * say how much of its own answer rests on this number.
 */
export const UNLOGGED_REST_SECONDS = 30;

export interface IntentInput {
  item: LogItem;
  group: LogGroup;
  /** `TRAINING.strengthRest.value[0]`, which is also `hypertrophyRest.value`. */
  restBoundarySeconds: number;
  /** Override the assumption for an untouched picker. Defaults to
   *  UNLOGGED_REST_SECONDS; pass it explicitly to test the sensitivity. */
  unloggedRestSeconds?: number;
  overrides?: OverrideMap;
}

export interface IntentVerdict {
  intent: LoadedIntent;
  /** The rest the verdict was reached on — the logged value, or the assumed one
   *  when the picker was never touched. */
  restSeconds: number;
  /** True when `restSeconds` is the assumption rather than a logged choice. A
   *  caller that does not report this is overstating what it knows. */
  restAssumed: boolean;
  /** Highest region overlap with a partner in the same superset or circuit. */
  partnerOverlap: number | null;
}

/**
 * Classify one item's loaded work.
 *
 * An untouched rest picker resolves to UNLOGGED_REST_SECONDS rather than
 * refusing to answer — but the verdict says so via `restAssumed`, and every
 * caller must carry that through. This is the narrow case where assuming beats
 * abstaining: the alternative left most of a real log unclassified, and the
 * assumption is a stated fact about how the picker gets used rather than an
 * inference the engine invented for itself. It is NOT a licence to do the same
 * with a missing RPE or a missing reading — those have no such fact behind
 * them, which is why `rpeWasRated` and `coach_observations` still refuse.
 */
export function classifyIntent(input: IntentInput): IntentVerdict {
  const { item, group, restBoundarySeconds } = input;
  const logged = item.restSeconds ?? group.restSeconds ?? null;
  // 0 is a real selection ("no rest"), not an absent one — `??` keeps it.
  const restAssumed = logged == null;
  const rest = logged ?? input.unloggedRestSeconds ?? UNLOGGED_REST_SECONDS;

  const mine = classifyMovement(item.movement, { overrides: input.overrides }).profile.regions;
  let partnerOverlap: number | null = null;
  for (const other of group.items) {
    if (other.id === item.id) continue;
    const theirs = classifyMovement(other.movement, { overrides: input.overrides }).profile.regions;
    const o = regionOverlap(mine, theirs);
    if (partnerOverlap == null || o > partnerOverlap) partnerOverlap = o;
  }
  const relatedPartner = partnerOverlap != null && partnerOverlap >= RELATED_OVERLAP;

  // Long rest is strength work — UNLESS it is being spent on a partner that
  // fatigues the same muscles, which is the one case the corpus's own caveat
  // does not cover.
  if (rest >= restBoundarySeconds) {
    return {
      intent: relatedPartner ? 'hypertrophy' : 'strength',
      restSeconds: rest,
      restAssumed,
      partnerOverlap,
    };
  }
  // Short rest against a related partner is density work under load.
  if (rest <= DENSE_REST_SECONDS && relatedPartner) {
    return { intent: 'conditioning', restSeconds: rest, restAssumed, partnerOverlap };
  }
  return { intent: 'hypertrophy', restSeconds: rest, restAssumed, partnerOverlap };
}

/**
 * Loaded sets by what they appear to be for, plus how many of them leaned on
 * the unlogged-rest assumption.
 *
 * Counts SETS, not items: an item is a row in a logger and a set is the unit of
 * work, and rest is prescribed on the item and applies to each of its sets —
 * the same shape as the `/side` and `(p)` notations.
 */
export interface IntentMix {
  strength: number;
  hypertrophy: number;
  conditioning: number;
  /** Of the above, how many were classified on an assumed rest. Not a fourth
   *  category — these are already counted in the three. */
  assumed: number;
}

export function emptyMix(): IntentMix {
  return { strength: 0, hypertrophy: 0, conditioning: 0, assumed: 0 };
}

export function countIntent(mix: IntentMix, verdict: IntentVerdict, sets = 1): void {
  mix[verdict.intent] += sets;
  if (verdict.restAssumed) mix.assumed += sets;
}

/**
 * The share each intent takes, and how much of that rests on an assumption.
 *
 * `assumed` is NOT removed from the denominator — every set now has a verdict,
 * so the shares are over all of them. It is reported beside so a surface can
 * say how much of its own answer is inference: on a log that prescribes rest on
 * a third of its items, "most of your loaded work is hypertrophy-shaped" is
 * true but two thirds of it is true BY ASSUMPTION, and a reader is entitled to
 * know which.
 */
export function mixShares(mix: IntentMix): {
  shares: Record<LoadedIntent, number>;
  total: number;
  assumed: number;
  /** 0..1 — how much of the verdict leans on UNLOGGED_REST_SECONDS. */
  assumedShare: number;
} {
  const total = mix.strength + mix.hypertrophy + mix.conditioning;
  const share = (n: number) => (total > 0 ? Number((n / total).toFixed(2)) : 0);
  return {
    shares: {
      strength: share(mix.strength),
      hypertrophy: share(mix.hypertrophy),
      conditioning: share(mix.conditioning),
    },
    total,
    assumed: mix.assumed,
    assumedShare: share(mix.assumed),
  };
}
