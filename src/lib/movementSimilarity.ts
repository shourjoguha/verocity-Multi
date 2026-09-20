// Is one movement a stand-in for another?
//
// Adherence has to answer "I did Lat Pulldown where the plan said Pull-up — did
// I follow the plan?" with yes, and "I did Overhead Press where it said Bench
// Press" with no. Nothing else in the app needed that question answered, so
// this module exists for `planAdherence.ts` alone.
//
// WHY NOT `familyOf` (lib/stats.ts). MOVEMENT_FAMILIES already lists
// `pull: ['pull-up', ..., 'lat pulldown']` and `press: ['bench press',
// 'incline press', ...]`, which looks like exactly this answer. It is not
// usable here on two counts. It matches by bare substring and carries misfires
// pinned by test on purpose — `familyOf('Med-Ball Throw') === 'pull'`, because
// "th-row" contains "row" — so a med-ball throw would be a legal substitute for
// a barbell row, and the misfire cannot be corrected without changing rendered
// Stats output. And it is too coarse in the other direction: `press` holds
// Bench Press and Overhead Press together, which is the single case this
// module most needs to separate.
//
// The taxonomy's region profiles do separate them. Measured over the
// classifier (see the table in movementSimilarity.test.ts): the swaps a lifter
// would call minor score 0.95-1.00 on region cosine, and the ones they would
// not score 0.17-0.42. SIMILARITY.minRegionCosine sits in that gap with room
// on both sides.
//
// Pure: no DOM, no storage, no Date, no queries.

import { SIMILARITY, type ModalityKey, type RegionWeights } from '@/app.config';
import { classifyMovement, type OverrideMap } from '@/lib/movementTaxonomy';

/**
 * Cosine similarity of two region-weight vectors, over the union of their
 * regions. 1 = identical shape, 0 = no shared region. Weights are normalised
 * per movement upstream, so this compares SHAPE and not magnitude — which is
 * what "trains the same thing" means.
 */
export function regionCosine(a: RegionWeights, b: RegionWeights): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const x = (a as Record<string, number>)[k] ?? 0;
    const y = (b as Record<string, number>)[k] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * A movement that trains exactly one region — an isolation lift.
 *
 * THE GATE COSINE CANNOT PROVIDE. Lateral Raise is `{shoulders: 1}` and
 * Overhead Press is `{shoulders: 0.6, arms: 0.25, core: 0.15}`: they point the
 * same way, so cosine reads 0.899 and would call swapping one for the other
 * minor. Leg Extension `{quads: 1}` against Back Squat scores 0.929 the same
 * way. Both are real substitutions a lifter would notice, and the difference
 * is compound-vs-isolation, which a direction-only measure cannot see.
 *
 * So an isolation may stand in for another isolation (Bicep Curl → Hammer
 * Curl, both `{arms: 1}`) and a compound for another compound, but never
 * across.
 */
function isIsolation(regions: RegionWeights): boolean {
  return Object.keys(regions).length === 1;
}

const ENDURANCE: ModalityKey = 'endurance';

export type SwapVerdict = 'same' | 'minor' | 'major' | 'unknown';

/**
 * How far a logged movement strays from the one that was prescribed.
 *
 * - `same`    — the same movement, once names are normalised.
 * - `minor`   — trains the same thing; counts as following the plan.
 * - `major`   — a different prescription; counts as a miss.
 * - `unknown` — at least one name did not classify, so no claim is made.
 *               Treated as a major by the caller, because an unverifiable
 *               substitution is not evidence of adherence.
 */
export function compareMovements(
  prescribed: string,
  logged: string,
  overrides?: OverrideMap,
): SwapVerdict {
  const a = classifyMovement(prescribed, { overrides });
  const b = classifyMovement(logged, { overrides });

  if (a.normalized === b.normalized) return 'same';

  const ra = a.profile.regions;
  const rb = b.profile.regions;
  if (Object.keys(ra).length === 0 || Object.keys(rb).length === 0) return 'unknown';

  // Modality first: it is the coarsest thing that makes two movements different
  // prescriptions. Plank and Hanging Leg Raise are both `{core: 1}` and score a
  // perfect cosine; one is isometric and the other is not, and that is the
  // whole difference between them.
  if (a.profile.modality !== b.profile.modality) return 'major';

  // Conditioning is prescribed as duration, distance or intensity — never as a
  // muscle. Region overlap is the wrong question for it, and answering it
  // anyway rejects swaps that are plainly fine: Run → Row Erg scores 0.499
  // because an erg pulls with the upper body, while Run → Bike scores 0.920.
  // Those two deserve the same verdict. The region weights on an erg exist so
  // the body map can shade a silhouette, not so adherence can rank ergs against
  // each other.
  //
  // This does accept Run → Burpee, and that is the intended reading: a
  // conditioning slot filled with conditioning was filled.
  if (a.profile.modality === ENDURANCE) return 'minor';

  if (isIsolation(ra) !== isIsolation(rb)) return 'major';

  return regionCosine(ra, rb) >= SIMILARITY.minRegionCosine ? 'minor' : 'major';
}

/** Does `logged` count as having done `prescribed`? */
export function isAcceptableSwap(
  prescribed: string,
  logged: string,
  overrides?: OverrideMap,
): boolean {
  const v = compareMovements(prescribed, logged, overrides);
  return v === 'same' || v === 'minor';
}
