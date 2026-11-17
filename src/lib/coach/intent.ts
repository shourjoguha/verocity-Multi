// What was this loaded work FOR?
//
// Strength, hypertrophy and loaded conditioning are three different jobs done
// with the same equipment, and a log records all three identically: a movement,
// a weight, some reps. Which job a set did is read from WHERE it sits and HOW it
// was spaced, in this order (the owner's rules, 2026-11-17):
//
//   1. A loaded set in a conditioning block is conditioning. Rest is not asked:
//      a HIIT circuit has none by design, and an EMOM or AMRAP's rest is
//      whatever the athlete had left on the day — absence there is the
//      prescription, not missing data.
//   2. A superset (or circuit) outside a conditioning block is hypertrophy.
//   3. A single movement is strength when it was rested for at least
//      `strengthRest`'s floor (120s) AND ran under `hypertrophyReps`' floor
//      (8). Anything else is hypertrophy.
//   4. A single movement with no rest logged is read on its reps alone, and the
//      verdict says so (`restAssumed`). Rest tagging was added to the logger
//      after the first logs, so its absence on old work is not a statement
//      about short rest.
//
// Reps alone do not separate the jobs — on one athlete's log the mean reps
// barely moved (11.7 -> 10.2) while top load climbed 35 -> 58.5 kg with tagged
// rest — which is why rule 3 needs BOTH, and rule 4 is flagged as inference.
//
// THE REST TAG. Rest lives on the item as `restSeconds` and optionally per set
// as `SetActual.rest` ("vary by set"); both mean the rest taken AFTER the set.
// There is no countdown behind it: the tag is a statement, not a timing. A
// superset's GROUP rest is taken at the end of the round, not between its
// movements (`loggedRestAfter`), unless an item carries its own tag.
//
// NOTHING HERE IS A THRESHOLD OF ITS OWN. 120 seconds is `strengthRest`'s floor
// and `hypertrophyRest`'s ceiling; 8 reps is `hypertrophyReps`' floor. Both are
// passed in from the claim-cited pack.

import { classifyMovement, type OverrideMap } from '@/lib/movementTaxonomy';
import { LOAD, type RegionKey } from '@/app.config';
import type { LogGroup, LogItem, LogSet } from '@/lib/types';

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

/** The rest LOGGED after set `ki`: the set's own override ("vary by set"),
 *  else the item's tag, else the group's. Null when none was logged.
 *
 *  A group's rest belongs to the END of a superset's round: between its
 *  movements the athlete goes straight on, so an untagged item that is not the
 *  last in the round rested 0 — a stated 0, because the group's tag said where
 *  the rest goes. Reading the group's rest after every movement counted it once
 *  per movement and made a two-movement superset look twice as rested. */
export function loggedRestAfter(item: LogItem, group: LogGroup, ki: number): number | null {
  const own = item.sets[ki]?.actual.rest ?? item.restSeconds;
  if (own != null) return own;
  if (group.restSeconds == null) return null;
  const movers = group.items.filter((it) => it.kind !== 'subroutine');
  return movers.length > 1 && movers[movers.length - 1] !== item ? 0 : group.restSeconds;
}

/** How long a set itself took: its logged time, else reps at LOAD.repSeconds. */
function setWorkSeconds(set: LogSet): number {
  return set.actual.time ?? (set.actual.reps ?? 0) * LOAD.repSeconds;
}

export interface RestGap {
  /** Effective seconds of recovery for this movement's muscles. */
  seconds: number;
  /** True when any rest in the gap (own or a partner's) was not logged. */
  assumed: boolean;
  /** Whether the movement's OWN rest after the set was logged. */
  ownLogged: boolean;
  /** Highest region overlap with any partner in the group, for reporting. */
  partnerOverlap: number | null;
}

/**
 * The recovery a movement's muscles got around set `ki`, in a group whose sets
 * alternate in item order (pull-up 1, dip 1, pull-up 2, dip 2 ...).
 *
 * The gap after set k runs to the movement's own set k+1. In it: its own rest,
 * then every later partner's set k and that partner's rest, then every earlier
 * partner's set k+1 and its rest. A partner set that was not done is simply not
 * in the gap: with 5 pull-ups against 4 dips, dip 4 sits between pull-ups 4
 * and 5, and nothing sits between dip 4 and the end; with 5 against 6, dip 5
 * to dip 6 had no pull-up between them, so that gap is the dip's own rest.
 *
 * Overlap enters continuously, never as a cutoff: a partner that shares a
 * fraction `ov` of this movement's muscles reloads that fraction, so for it the
 * clock restarts when the partner's set ends. Effective rest is the full gap
 * minus `ov` times the time elapsed up to the end of the most-overlapping
 * partner set. Fully unrelated (ov 0) counts the whole gap; identical (ov 1)
 * counts only what came after the partner.
 *
 * The LAST set has no gap after it, so it reads the gap that led into it; a
 * one-set movement reads its own rest alone.
 */
export function restGap(
  group: LogGroup,
  ii: number,
  ki: number,
  opts: { unloggedRestSeconds: number; overrides?: OverrideMap },
): RestGap {
  const item = group.items[ii];
  const restOf = (it: LogItem, k: number) => {
    const r = loggedRestAfter(it, group, k);
    return { seconds: r ?? opts.unloggedRestSeconds, logged: r != null };
  };
  const n = item.sets.length;
  const k = n >= 2 ? Math.min(ki, n - 2) : 0;
  const own = restOf(item, k);
  let assumed = !own.logged;
  if (n < 2) return { seconds: own.seconds, assumed, ownLogged: own.logged, partnerOverlap: null };

  const mine = classifyMovement(item.movement, { overrides: opts.overrides }).profile.regions;
  let elapsed = own.seconds;
  let reload = 0;
  let partnerOverlap: number | null = null;
  // Walk the rotation from the item after this one, wrapping to those before it.
  const order = [
    ...group.items.slice(ii + 1).map((it) => ({ it, idx: k })),
    ...group.items.slice(0, ii).map((it) => ({ it, idx: k + 1 })),
  ];
  for (const { it, idx } of order) {
    if (it.kind === 'subroutine') continue;
    const set = it.sets[idx];
    if (!set?.actual.completed) continue;
    const ov = regionOverlap(mine, classifyMovement(it.movement, { overrides: opts.overrides }).profile.regions);
    if (partnerOverlap == null || ov > partnerOverlap) partnerOverlap = ov;
    elapsed += setWorkSeconds(set);
    reload = Math.max(reload, ov * elapsed);
    const r = restOf(it, idx);
    if (!r.logged) assumed = true;
    elapsed += r.seconds;
  }
  return {
    seconds: Math.max(0, Math.round(elapsed - reload)),
    assumed,
    ownLogged: own.logged,
    partnerOverlap,
  };
}

export interface IntentInput {
  item: LogItem;
  group: LogGroup;
  /** Which of the item's sets is being classified. */
  setIndex: number;
  /** The logger section the group sits in (`SECTIONS`). */
  sectionKey: string;
  /** `TRAINING.strengthRest.value[0]`, which is also `hypertrophyRest.value`. */
  restBoundarySeconds: number;
  /** `TRAINING.hypertrophyReps.value[0]`: strength runs below it. */
  hypertrophyRepFloor: number;
}

export interface IntentVerdict {
  intent: LoadedIntent;
  /** The rest logged after the set; null when the verdict did not need it or
   *  none was logged. */
  restSeconds: number | null;
  /** True when a single movement had no rest logged and was read on reps
   *  alone. A caller that does not report this overstates what it knows. */
  restAssumed: boolean;
}

/** Classify one set by where it sits and how it was spaced — see the header. */
export function classifyIntent(input: IntentInput): IntentVerdict {
  const { item, group, setIndex, sectionKey } = input;
  if (sectionKey === 'conditioning') return { intent: 'conditioning', restSeconds: null, restAssumed: false };
  const grouped = group.items.filter((it) => it.kind !== 'subroutine').length > 1;
  if (grouped) return { intent: 'hypertrophy', restSeconds: null, restAssumed: false };

  const reps = item.sets[setIndex]?.actual.reps;
  const lowReps = reps != null && reps < input.hypertrophyRepFloor;
  const rest = loggedRestAfter(item, group, setIndex);
  if (rest == null) return { intent: lowReps ? 'strength' : 'hypertrophy', restSeconds: null, restAssumed: true };
  return {
    intent: lowReps && rest >= input.restBoundarySeconds ? 'strength' : 'hypertrophy',
    restSeconds: rest,
    restAssumed: false,
  };
}

/**
 * Loaded sets by what they appear to be for, plus how many of them leaned on
 * the unlogged-rest assumption.
 *
 * Counts SETS, not items: an item is a row in a logger and a set is the unit of
 * work, and rest is tagged on the item and applies to each of its sets —
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
  /** 0..1 — how much of the verdict was read on reps alone, with no rest logged. */
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
