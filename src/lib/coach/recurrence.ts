// Stage 5: may a rule the athlete has already decided on speak AGAIN, and why?
//
// WHAT THIS REPLACES, AND WHY IT HAD TO GO. `evaluate.ts` used to price the
// right to re-speak as a single comparison:
//
//     moved = driftNow - driftOnTheDecidedRow
//     if (moved < 0.15) return 'unchanged'
//
// which asks "has this got WORSE?" — and that is the wrong question in three
// separate ways, each of which was live in production:
//
//   1. IT IS UNSATISFIABLE AT THE TOP OF THE SCALE. Drift is clamped 0..1 by
//      every helper in impact.ts. A finding acted on at drift 1.00 needed 1.15
//      to be heard again, so it was gagged until DECISION_EXPIRY_DAYS — six
//      months — no matter what the athlete did. One real account had thirteen
//      decided rules of which every single one was held by this gate alone;
//      the day and session halves had long since passed.
//   2. IT PUNISHES SUCCESS WITH SILENCE. Act on advice, fix the problem, and
//      the rule can never speak again to say so. There was no way for the coach
//      to close a loop it had opened.
//   3. IT CANNOT SEE A RELAPSE. The anchor is frozen at the decision. Go from
//      1.00 to 0.10 and back to 0.90 and `moved` is -0.10 — "unchanged" — even
//      though the athlete has just undone the whole of their own gain.
//
// The repair is not a bigger or smaller constant. It is a different REFERENCE:
// not the drift at the moment of the decision, but the trajectory since it,
// which is what `coach_observations` (migration 0042) now records. Relapse is
// measured from the athlete's own BEST since deciding, persistence from the
// SLOPE, and resolution from a run of readings under a floor.
//
// WHAT THIS IS NOT. It is not a ranking. `impact.ts` decides what leads the
// page and this module decides only whether a rule is allowed onto it at all;
// `confidence` was overloaded as a priority once already and impact.ts exists
// entirely to undo that. Keep recurrence a gate and impact a sort, or the page
// has two numbers fighting over the same row.

import type { Recommendation } from '@/lib/types';

/** A single drift reading. The row shape of `coach_observations`, narrowed to
 *  what a trajectory needs — this module never touches the database. */
export interface Reading {
  /** 'YYYY-MM-DD'. */
  observedOn: string;
  drift: number;
  /** Did the rule produce a finding that day? A rule can be true and suppressed,
   *  so this is not derivable from the presence of a recommendation row. */
  fired: boolean;
}

/** Which decision is being re-examined. Snoozes are handled by the clock in
 *  `isSuppressed` and never reach here. */
export type DecisionStatus = 'dismissed' | 'acted';

/**
 * New completed sessions that fully unlock a decided rule.
 *
 * Unchanged in value from the old SESSIONS_TO_RESPEAK — that half was never the
 * bug. Acting needs fewer than rejecting because the point of the acted window
 * is to let a change land before grading it, and three sessions is roughly when
 * a 28-day measurement could have moved.
 */
export const RESPEAK_SESSIONS = { dismissed: 6, acted: 3 } as const;

/**
 * ...or this much calendar time, for the athlete who trains twice a week and
 * would otherwise wait a month to reach six sessions.
 *
 * DAYS AND SESSIONS ARE AN `OR`, NOT AN `AND`. The old gate required both and
 * that is defensible, but it makes the coach's cadence a function of training
 * frequency in the wrong direction: the athlete training least often — the one
 * a frequency rule most wants to reach — waits longest to hear anything. The
 * short floor in `MIN_SILENCE_DAYS` is the `AND` that still matters, and it is
 * enforced before this module is called.
 */
export const RESPEAK_DAYS = { dismissed: 28, acted: 14 } as const;

/** Drift at or below this reads as clean. Not zero: a rule sitting a rounding
 *  error past its own threshold is not a problem anyone needs telling about. */
export const RESOLUTION_FLOOR = 0.1;

/** Consecutive readings at or under the floor before a rule counts as cleared.
 *  One quiet week is a quiet week; two is a change. */
export const RESOLUTION_HOLD = 2;

/** And this much training must have landed, so a holiday cannot resolve a rule
 *  by simply removing the sessions that would have shown the problem. */
export const RESOLUTION_MIN_SESSIONS = 4;

/**
 * How far a finding must have FALLEN for clearing it to be worth saying.
 *
 * Without this, the two standing targets — `nutrition.dose.protein-target` and
 * `nutrition.style.carb-concentration`, both true at drift 0 by construction —
 * would "resolve" the instant they were acted on, congratulating the athlete
 * for a number that never moved.
 */
export const MIN_RESOLVED_DROP = 0.2;

/**
 * How far drift must climb back off its own best to count as a relapse.
 *
 * Same magnitude as the constant it replaces, deliberately: the old number was
 * never wrong about how much movement is material, only about what to measure
 * it FROM.
 */
export const REGRESSION_DELTA = 0.15;

/** Drift per reading. A trend flatter than this is not improving, whatever its
 *  sign — noise in a 28-day window moves the number by more than this between
 *  two check-ins a week apart. */
export const PERSISTENCE_FLAT_SLOPE = -0.02;

/** With no readings yet (every account, the day this ships), the only reference
 *  available is the decision itself. A fall of at least this much counts as
 *  improvement; anything less is the problem persisting. */
export const IMPROVEMENT_EPS = 0.1;

/**
 * What a sibling firing is worth, priced in sessions.
 *
 * INTERACTION IS NOT A BRANCH. It was written as one first — a fifth case below
 * `persisting` — and it was dead code the moment it shipped: `persisting`
 * already covers every state where a rule is true and not improving, so nothing
 * could ever fall through to it. What a sibling firing actually changes is how
 * SOON a rule is allowed to speak, not what kind of thing it is. So it is paid
 * in the currency the gate already counts, and capped at two sessions' worth:
 * it can bring a re-speak forward, and it can never manufacture one out of an
 * athlete who has done nothing since deciding.
 */
export const INTERACTION_SESSION_CREDIT = 2;

/** Score at or above which a rule may speak. */
export const SPEAK_THRESHOLD = 0.5;

/**
 * Why a rule wants to speak — or does not.
 *
 * `improving` is deliberately distinct from `quiet`. They were one value
 * ('unchanged') before, and collapsing them cost the surface the only sentence
 * an athlete mid-fix actually wants: not "nothing has moved" but "this is
 * moving, keep going".
 */
export type RecurrenceReason =
  /** Decided, training has landed, and the number has not improved. */
  | 'persisting'
  /** Climbed back off its own best since the decision. */
  | 'regressing'
  /** Fell below the floor and stayed there. Good news, and said once. */
  | 'resolved'
  /** True, and a sibling in the same theme has just started firing. */
  | 'interacting'
  /** Genuinely getting better. Not yet cleared, and not worth re-raising. */
  | 'improving'
  /** Nothing to say. */
  | 'quiet';

export interface RecurrenceInput {
  status: DecisionStatus;
  /** ISO timestamp of the decision. */
  decidedOn: string;
  /** Drift frozen on the decided row. The reference of last resort — used only
   *  when no readings have accumulated since. */
  driftAtDecision: number;
  /** This run's drift for the rule. */
  drift: number;
  /** Did the rule produce a finding this run, before suppression? */
  fired: boolean;
  /** Completed sessions logged strictly after the decision day. */
  newSessions: number;
  /** Readings strictly after the decision day, oldest first, excluding this
   *  run. Empty is the normal state for a freshly-decided rule. */
  since: Reading[];
  /** A rule in the same theme started firing this run. Raises a quiet sibling,
   *  but only one that is independently true — see `interacting` below. */
  siblingFired?: boolean;
  today: Date;
}

export interface Recurrence {
  reason: RecurrenceReason;
  /** 0..1. `raw x readiness`. */
  score: number;
  /** How far through its re-speak window the decision is, 0..1. */
  readiness: number;
  /** Lowest drift observed since the decision, EXCLUDING this run — the
   *  reference a relapse is measured from. Null when nothing has been read yet. */
  best: number | null;
  /** Least-squares drift change per reading. Negative is improvement. Null
   *  below three readings, where a slope is an opinion rather than a trend. */
  slope: number | null;
  speaks: boolean;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r2 = (n: number) => Number(n.toFixed(2));

/** Whole days between an ISO timestamp and `today`. */
export function daysBetween(iso: string, today: Date): number {
  return (today.getTime() - Date.parse(iso)) / 86_400_000;
}

/**
 * Least-squares slope of drift against reading index.
 *
 * Index, not date: readings are check-ins, and the athlete who checks in twice
 * in a week has not thereby made their trend twice as steep. Null below three
 * points — two readings define a line through both of them and call it a trend.
 */
export function driftSlope(readings: readonly Reading[]): number | null {
  const n = readings.length;
  if (n < 3) return null;
  const meanX = (n - 1) / 2;
  const meanY = readings.reduce((a, r) => a + r.drift, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (readings[i].drift - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? null : Number((num / den).toFixed(3));
}

/**
 * Has this cleared and stayed clear?
 *
 * Reads the tail of the series WITH this run appended, so the newest reading
 * always counts — a rule that cleared two check-ins ago and is back over the
 * floor today is not resolved.
 */
function held(series: readonly Reading[], hold: number): boolean {
  if (series.length < hold) return false;
  return series.slice(-hold).every((r) => r.drift <= RESOLUTION_FLOOR);
}

/**
 * The whole decision, in one pure pass.
 *
 * Order matters and is an editorial claim, not an implementation detail:
 * resolution outranks relapse (closing a loop the athlete finished beats
 * reopening one they have started to lose), relapse outranks persistence
 * (losing ground you had is more urgent than never having gained it), and
 * interaction is last because it is the weakest evidence of the four — a
 * correlation the coach noticed, not a threshold the athlete crossed.
 */
export function recurrence(input: RecurrenceInput): Recurrence {
  const { status, drift, fired, newSessions, since, today } = input;
  const days = daysBetween(input.decidedOn, today);
  const current: Reading = { observedOn: today.toISOString().slice(0, 10), drift, fired };
  const series = [...since, current];

  // A sibling firing buys sessions, not a branch. See INTERACTION_SESSION_CREDIT.
  const interacting = (input.siblingFired ?? false) && newSessions >= 1 && fired;
  const creditedSessions = newSessions + (interacting ? INTERACTION_SESSION_CREDIT : 0);

  // Both halves of "enough has happened", as an OR. See RESPEAK_DAYS.
  const readiness = clamp01(
    Math.max(days / RESPEAK_DAYS[status], creditedSessions / RESPEAK_SESSIONS[status]),
  );
  const readinessAlone = clamp01(
    Math.max(days / RESPEAK_DAYS[status], newSessions / RESPEAK_SESSIONS[status]),
  );
  // EXCLUDES this run on purpose: with the current reading in the set, `best`
  // is the minimum of a set containing the value being compared against it, so
  // a relapse can never exceed zero.
  const best = since.length > 0 ? Math.min(...since.map((r) => r.drift)) : null;
  const slope = driftSlope(series);

  const out = (reason: RecurrenceReason, raw: number): Recurrence => {
    const score = r2(clamp01(raw) * readiness);
    return { reason, score, readiness: r2(readiness), best, slope, speaks: score >= SPEAK_THRESHOLD };
  };

  // 1. Resolved. ACTED ONLY — a dismissal means "I have heard this and I do not
  //    want it", and coming back to report that it cleared anyway is the nag
  //    the whole suppression design exists to prevent.
  if (
    status === 'acted' &&
    input.driftAtDecision - RESOLUTION_FLOOR >= MIN_RESOLVED_DROP &&
    newSessions >= RESOLUTION_MIN_SESSIONS &&
    held(series, RESOLUTION_HOLD)
  ) {
    return out('resolved', 1);
  }

  // 2. Relapse, measured from the athlete's own best rather than from the
  //    decision. With no readings yet there is no best, so this falls back to
  //    the decision anchor — which is exactly the old comparison, kept only as
  //    the degenerate case it was always correct for.
  const relapseFrom = best ?? input.driftAtDecision;
  // Rounded to the 2dp every rule already reports drift at. Comparing the raw
  // subtraction makes the gate miss by one ulp — 0.35 - 0.2 is 0.1499999… — so
  // a relapse of exactly the material amount reads as no relapse at all. The
  // code this replaces carried the same note; dropping the rounding with it was
  // a regression caught by the first test written against the new module.
  const climb = r2(drift - relapseFrom);
  if (climb >= REGRESSION_DELTA && drift > RESOLUTION_FLOOR) {
    return out('regressing', 0.6 + 0.4 * clamp01((climb - REGRESSION_DELTA) / 0.3));
  }

  // Improving is decided by the slope once there is one, and by the fall from
  // the decision before that. The fallback is what unlocks the thirteen
  // gagged rules on the first check-in after this ships: with no series, a rule
  // that has NOT fallen is persisting, where the old gate demanded it rise.
  const improving =
    slope != null
      ? slope <= PERSISTENCE_FLAT_SLOPE
      : r2(input.driftAtDecision - drift) >= IMPROVEMENT_EPS;

  // 3. Persisting — the rule is still true and the number has not come down —
  //    and with it, interaction, which is the same verdict reached sooner.
  //
  //    NO SECOND SESSION CHECK HERE. `readiness` already IS the "enough has
  //    happened" test, and re-imposing RESPEAK_SESSIONS as a hard gate would
  //    quietly turn the documented OR back into an AND: the athlete who trains
  //    twice a week would wait a month regardless of the calendar half, which is
  //    the asymmetry RESPEAK_DAYS exists to remove.
  //
  //    THE `improving` GUARD IS LOAD-BEARING FOR INTERACTION and not
  //    hypothetical. Every theme has two or more members, so on the test fixture
  //    a sibling firing re-opened seven improving rules at once the first time
  //    this ran. A finding the athlete is visibly fixing must not be dragged
  //    back onto the page by an unrelated sibling; that is the nag wearing a
  //    pattern's clothes.
  if (fired && !improving) {
    const raw = 0.5 + 0.5 * clamp01(drift);
    // The reason is 'interacting' only when the sibling credit is WHY it spoke.
    // Labelling every persisting finding as an interaction because a sibling
    // happened to fire would make the word mean nothing.
    const withCredit = r2(raw * readiness) >= SPEAK_THRESHOLD;
    const aloneSpeaks = r2(raw * readinessAlone) >= SPEAK_THRESHOLD;
    return out(interacting && withCredit && !aloneSpeaks ? 'interacting' : 'persisting', raw);
  }

  if (improving) return out('improving', 0);
  return out('quiet', 0);
}

/**
 * Turn the rows for one rule into the readings `recurrence` wants.
 *
 * Strictly AFTER the decision day, on the date part only: a reading taken the
 * same day as the decision measures the window that produced the finding, not
 * the athlete's response to it.
 */
export function readingsSince(
  rows: readonly { observed_on: string; drift: number; fired: boolean }[],
  decidedOn: string,
): Reading[] {
  const cutoff = decidedOn.slice(0, 10);
  return rows
    .filter((r) => r.observed_on > cutoff)
    .sort((a, b) => (a.observed_on < b.observed_on ? -1 : 1))
    .map((r) => ({ observedOn: r.observed_on, drift: Number(r.drift), fired: r.fired }));
}

/** `training.endurance.zone2-short` -> `outcome.resolved.training.endurance.zone2-short`. */
export function resolvedRuleId(ruleId: string): string {
  return `outcome.resolved.${ruleId}`;
}

/**
 * Has this rule already been told it cleared?
 *
 * A resolution is said ONCE. The unique index on (owner, rule, period) stops a
 * duplicate inside one period; this stops the same congratulation reappearing
 * every period thereafter, which is the same monotony failure in a friendlier
 * costume.
 */
export function alreadyResolved(ruleId: string, existing: readonly Recommendation[]): boolean {
  const id = resolvedRuleId(ruleId);
  return existing.some((r) => r.rule_id === id);
}
