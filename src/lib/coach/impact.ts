// Stage 4: how much a true finding is WORTH SAYING, which is not the same
// question as whether it is true.
//
// WHY THIS IS NOT knowledge.ts. Every value in that file is an external claim
// by a named person and changes when the corpus changes. Nothing here is a
// claim about the body — a consequence weight is this product's editorial
// judgement about what an athlete should read first, and it changes when we
// change our minds. Two provenances, two cadences, two files. It is not
// app.config.ts either: that holds domain vocabulary the whole app shares, and
// nothing outside the coach ranks a rule.
//
// WHAT WAS WRONG BEFORE. `evaluate.ts` ranked on `confidence * drift`, and both
// halves of that product are weaker than they look:
//
//   - `drift` is each rule's own distance-past-its-own-threshold, normalised by
//     a denominator the rule picked. `(floor - actual) / floor` and
//     `(mark - meanRpe) / 3` are both "0..1" and mean nothing like each other.
//   - `confidence` is a hardcoded constant per rule (0.35–0.8). It was already
//     acting as a static priority; it just never admitted it, and it is the
//     wrong axis to overload because a well-measured trivial finding then
//     outranks a roughly-measured serious one.
//   - Nothing anywhere encoded CONSEQUENCE. Training four days a week short of
//     target and putting your intervals in the wrong order scored the same, so
//     which one led the page came down to whichever arithmetic happened to
//     normalise larger. That is what "it feels random" was measuring.
//
// So consequence is now explicit, per rule, in one table you can argue with.

/**
 * How much it costs the athlete to be wrong about this, 0..1.
 *
 * Read the numbers as a ladder, not as precision:
 *   1.00  structural — the training does not add up to the goal at all
 *   0.75  a limiting factor: the work is happening but a required quality is missing
 *   0.50  a real inefficiency with a known fix
 *   0.30  a refinement, worth doing once the above are clear
 *   0.15  informational — a standing number, true whether or not you act on it
 *
 * A rule missing from this table gets FAMILY_DEFAULT, which is deliberately
 * mid-ladder: a new rule should rank plausibly on the day it ships, and should
 * still be given a considered weight before it ships twice.
 */
export const RULE_IMPACT: Record<string, number> = {
  // Structural: the plan cannot produce the goal on this volume/frequency.
  'training.frequency.below-target': 1.0,
  'training.hypertrophy.total-volume-short': 1.0,
  'goal.underserved': 0.9,
  'training.hypertrophy.region-volume-short': 0.75,
  'training.endurance.zone2-short': 0.75,

  // Limiting factors: the work happens, a required quality is absent.
  'training.hypertrophy.effort-low': 0.75,
  'training.intent.loaded-too-light': 0.75,
  'training.endurance.intervals-not-all-out': 0.7,

  // Recovery. Weighted above its confidence deserves on purpose: the cost of
  // missing accumulating fatigue is asymmetric with the cost of mentioning it.
  'training.recovery.symptoms-and-load': 0.8,
  'training.recovery.consecutive-days': 0.5,

  // Real inefficiencies with a known fix.
  'training.strength.rest-too-short': 0.5,
  'nutrition.timing.long-session-unfed': 0.5,
  'nutrition.style.protein-gap-days': 0.5,
  'nutrition.timing.carb-window': 0.45,

  // Refinements.
  'training.endurance.interval-ordering': 0.3,
  'nutrition.style.carb-concentration': 0.3,
  'nutrition.timing.arriving-hungry': 0.3,

  // Measurement hygiene: it changes what every other rule is allowed to say,
  // but it is not itself a training problem.
  'training.effort.rpe-calibration': 0.4,

  // Standing numbers. True at drift 0 by construction, so this weight only ever
  // decides their order among themselves.
  'nutrition.dose.protein-target': 0.15,
};

const FAMILY_DEFAULT = 0.5;

/**
 * `goal.underserved.endurance` is one rule per aspect and must not need a table
 * row per aspect — the aspect list is app.config's to grow. Falls back from the
 * full id to its first two segments, then to the family default.
 */
export function impactWeight(ruleId: string): number {
  const exact = RULE_IMPACT[ruleId];
  if (exact != null) return exact;
  const prefix = RULE_IMPACT[ruleId.split('.').slice(0, 2).join('.')];
  if (prefix != null) return prefix;
  return FAMILY_DEFAULT;
}

/**
 * The floor under drift's contribution, and with it the whole ordering policy.
 *
 * Multiplying straight through by drift discards the weight entirely as drift
 * approaches 0, which ranked a marginal miss on a structural rule below a large
 * miss on a cosmetic one — the exact inversion this module exists to fix.
 *
 * The value sets how much authority consequence has over magnitude. At 0.35 the
 * magnitude term spans 0.35..1 (under 3:1) while the weight spans 0.15..1
 * (nearly 7:1), so a rule that matters more wins on all but the most lopsided
 * comparison. That is the intended reading of "consequence first": drift orders
 * findings WITHIN a tier of seriousness and rarely across one. Lower it and the
 * loudest arithmetic leads the page again.
 */
const DRIFT_FLOOR = 0.35;

export interface Rankable {
  ruleId: string;
  drift: number;
  confidence: number;
}

/**
 * consequence × magnitude × certainty, in that order of authority.
 *
 * Bounded 0..1 so it can be stored, compared across packs and read out loud.
 * NOT persisted: it is recomputed from `rule_id`, `drift_score` and
 * `confidence` wherever it is needed, so re-weighting a rule re-ranks rows that
 * are already on the page instead of leaving them frozen at yesterday's order.
 */
export function impactScore(f: Rankable): number {
  const magnitude = DRIFT_FLOOR + (1 - DRIFT_FLOOR) * Math.min(1, Math.max(0, f.drift));
  return impactWeight(f.ruleId) * magnitude * f.confidence;
}

/** Descending impact, ties broken by drift then rule id so it is total and stable. */
export function byImpact(a: Rankable, b: Rankable): number {
  return impactScore(b) - impactScore(a) || b.drift - a.drift || a.ruleId.localeCompare(b.ruleId);
}

// ---- Shared drift normalisation -------------------------------------------
//
// Every rule reports drift as "how far past the threshold, as a fraction of a
// span that counts as fully off". The span is the argument you have to think
// about; the clamp and the rounding are not. These exist so the choice of span
// is visible at each call site instead of being buried in an inline expression
// that looks like arithmetic.

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r2 = (n: number) => Number(n.toFixed(2));

/** Actual is below a floor. Fully off = zero. The natural span for a volume. */
export function shortfall(actual: number, floor: number): number {
  return r2(clamp01((floor - actual) / floor));
}

/** Actual is above a ceiling, `span` past it counting as fully off. */
export function excess(actual: number, ceiling: number, span: number): number {
  return r2(clamp01((actual - ceiling) / span));
}

/** Actual is below a mark on a bounded scale (RPE, hunger), `span` = fully off. */
export function below(actual: number, mark: number, span: number): number {
  return r2(clamp01((mark - actual) / span));
}

/** A count out of an opportunity count — days, sessions, bouts. */
export function share(part: number, whole: number): number {
  return r2(clamp01(part / Math.max(1, whole)));
}

/**
 * RPE spans. Both effort rules previously normalised RPE distance by a
 * denominator they each picked (2 and 3), so the same one-point miss ranked
 * 0.50 in one rule and 0.33 in the other. One unit, one span.
 */
export const RPE_DRIFT_SPAN = 2;
