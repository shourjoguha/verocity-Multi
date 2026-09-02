// Stage 3: run every rule, then decide which of its findings are allowed to
// speak. Pure — it takes the athlete's existing recommendations as an argument
// and returns rows to write, so the whole decision is testable without a client.
//
// SUPPRESSION IS THE HARD HALF, not deduplication. A unique index on
// (owner, rule_id, period_key) stops the same finding being written twice this
// week, and that is easy. The real failure of a deterministic engine over a
// stable habit is different: the conditions barely move, so left alone it emits
// the same three findings every week forever, and a finding the athlete has
// already dismissed reopens the moment they check in again — because the data
// that produced it cannot change for weeks. That builds a nag that survives
// being told no.
//
// So dismissal, action and snoozing all buy silence, and a rule that is STILL
// TRUE is not automatically a rule that should still speak.
//
// BUT SILENCE USED TO BE PRICED IN CALENDAR DAYS, AND THAT WAS THE BUG.
// Cooldowns ran 42/14 days from `created_at` and nothing in the decision looked
// at whether the athlete had trained since. Worse, a rule whose row was still
// `open` from an earlier period was muted outright. Put those together over a
// few weeks of ordinary use and every rule is either open-from-last-week or
// inside a cooldown, so `write` comes back empty and the check-in reports
// "Nothing new since last check-in" — to an athlete who has logged ten sessions
// since. The coach looked finished. It was gagged.
//
// The gate is now EVIDENCE, not the clock. A decided rule speaks again when new
// training has actually landed AND its measurement has moved materially against
// the number the athlete decided on. An open row is refreshed in place rather
// than muting its own rule, so this week's numbers replace last week's on the
// row already on the page. The clock survives only as a short floor (so a
// same-day re-check is quiet) and a long stop (so a decision cannot buy silence
// forever on a measurement that never moves).

import { KNOWLEDGE_PACK_VERSION } from '@/lib/coach/knowledge';
import { byImpact } from '@/lib/coach/impact';
import {
  COACH_WINDOW_DAYS,
  isoWeekKey,
  measureFuelTiming,
  measureGoals,
  measureNutrition,
  measureTraining,
} from '@/lib/coach/signals';
import { NUTRITION as N, TRAINING as T } from '@/lib/coach/knowledge';
import { TRAINING_RULES, rpeCalibration } from '@/lib/coach/rules/training';
import { goalDrift } from '@/lib/coach/rules/goals';
import {
  arrivingHungry,
  carbSourceConcentration,
  carbTimingWindow,
  longSessionUnfed,
  proteinGapDays,
  proteinTarget,
} from '@/lib/coach/rules/nutrition';
import type { EvidencePayload, Finding } from '@/lib/coach/types';
import { SOURCES, CLAIMS } from '@/lib/coach/knowledge';
import { RPE_LADDER } from '@/app.config';
import { unweightedRepKg } from '@/lib/userStats';
import type { OverrideMap } from '@/lib/movementTaxonomy';
import type { MealLog, Recommendation, UserStats, WorkoutLog, Plan } from '@/lib/types';

/**
 * The short floor: a decision is honoured for at least this long no matter what
 * lands, so a check-in an hour after dismissing something is quiet.
 *
 * Dismissal buys more than acting because it is the stronger signal — "I have
 * heard this and I do not want it" — but neither is the 42/14 days it used to
 * be. Those numbers were doing the work that SESSIONS_TO_RESPEAK does now, and
 * doing it blind to whether the athlete had trained at all.
 */
export const MIN_SILENCE_DAYS = { dismissed: 10, acted: 5 } as const;

/**
 * New completed sessions that must land before a decided rule may speak again.
 *
 * This is the half that actually answers "I have new workouts". Acting on
 * advice needs fewer sessions to re-evaluate than rejecting it does: the point
 * of the acted cooldown is to let the change land before grading it, and three
 * sessions is roughly when the measurement could have moved.
 */
export const SESSIONS_TO_RESPEAK = { dismissed: 6, acted: 3 } as const;

/**
 * And the measurement must have MOVED. New sessions that reproduce the same
 * number are not new evidence — re-raising a dismissed finding on identical
 * data is precisely the nag the cooldown existed to stop. Only worsening
 * counts; a finding that improved and is still technically true has nothing new
 * to say.
 */
export const MATERIAL_DRIFT_DELTA = 0.15;

/**
 * The long stop. Without it the evidence gate becomes the mirror of the bug it
 * replaced: a rule dismissed once, on a measurement that is stable by nature
 * (the standing protein target, a habitual session length), would be silenced
 * permanently. Past this a decision has simply expired.
 */
export const DECISION_EXPIRY_DAYS = 180;

/** `goal.underserved.mobility` -> `goal`; `training.hypertrophy.x` -> `training`. */
export function family(ruleId: string): string {
  return ruleId.split('.')[0];
}

export interface CoachInput {
  logs: WorkoutLog[];
  meals: MealLog[];
  stats: UserStats | null;
  plan?: Plan | null;
  /** Recommendations already on file — the suppression memory. */
  existing: Recommendation[];
  overrides?: OverrideMap;
  today?: Date;
  windowDays?: number;
}

/** A row ready for upsert. Mirrors `recommendations` after migration 0036. */
export interface CoachRecInput {
  rule_id: string;
  period_key: string;
  pack_version: string;
  tldr: string;
  action: string;
  body_md: string;
  drift_score: number;
  confidence: number;
  evidence: EvidencePayload;
}

function daysSince(iso: string, today: Date): number {
  return (today.getTime() - Date.parse(iso)) / 86_400_000;
}

/** Why a rule stayed quiet. Reported so the UI can tell a gagged coach from an
 *  empty one, which is the distinction the old single 'cooldown' reason lost. */
export type SuppressionReason =
  /** Inside the short floor after a decision. */
  | 'too-soon'
  /** Decided, and not enough training has landed since to re-measure. */
  | 'no-new-training'
  /** New training landed and the number did not move. */
  | 'unchanged'
  | 'snoozed';

/** What `isSuppressed` needs beyond the rule's own history. Optional so the
 *  function stays callable on history alone, in which case no new evidence has
 *  been established and a decided rule stays quiet. */
export interface EvidenceDelta {
  /** Completed sessions logged after the decided row was written. */
  newSessions: number;
  /** The rule's drift right now, to compare against the decided row's. */
  drift: number;
}

/**
 * May this rule speak right now?
 *
 * Looks at the most recent row for the rule only. Older rows are history: a
 * finding dismissed in April and acted on in July is in its acted cooldown, not
 * its dismissed one.
 *
 * An OPEN row never suppresses its own rule any more, in any period. The rule
 * re-measures and the caller upserts the fresh numbers onto that row (see
 * `runCoach`), so an unaddressed finding stays current instead of freezing at
 * the week it first fired and muting itself thereafter.
 */
export function isSuppressed(
  ruleId: string,
  _periodKey: string,
  existing: Recommendation[],
  today: Date,
  delta?: EvidenceDelta,
): SuppressionReason | null {
  const prior = existing
    .filter((r) => r.rule_id === ruleId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const last = prior[0];
  if (!last) return null;

  if (last.status === 'open') return null;

  if (last.status === 'snoozed') {
    return last.snooze_until != null && Date.parse(last.snooze_until) > today.getTime()
      ? 'snoozed'
      : null;
  }

  const status = last.status === 'dismissed' ? 'dismissed' : 'acted';
  const age = daysSince(last.created_at, today);
  if (age < MIN_SILENCE_DAYS[status]) return 'too-soon';
  // A decision cannot buy silence forever on a number that never moves.
  if (age >= DECISION_EXPIRY_DAYS) return null;
  if ((delta?.newSessions ?? 0) < SESSIONS_TO_RESPEAK[status]) return 'no-new-training';
  const wasDrift = last.drift_score ?? 0;
  // Rounded to the 2dp every rule already reports drift at. Comparing the raw
  // subtraction makes the gate miss by one ulp — 0.35 - 0.2 is 0.1499999… — so
  // a finding that moved exactly the material amount reads as unchanged.
  const moved = Number(((delta?.drift ?? 0) - wasDrift).toFixed(2));
  if (moved < MATERIAL_DRIFT_DELTA) return 'unchanged';
  return null;
}

function toEvidence(f: Finding, sufficiency: EvidencePayload['sufficiency']): EvidencePayload {
  return {
    packVersion: KNOWLEDGE_PACK_VERSION,
    // Resolved, not referenced. A row written under this pack must still render
    // its own reasoning after the pack moves on and a threshold changes; storing
    // only ids would silently re-point old findings at new numbers.
    claims: f.claims.map((c) => {
      const src = SOURCES[c.source];
      return {
        id: c.id,
        statement: c.statement,
        value: c.value,
        unit: c.unit,
        quote: c.quote,
        caveat: c.caveat,
        speaker: src.speaker,
        work: src.work,
        url: src.url,
      };
    }),
    observed: f.observed,
    sufficiency,
  };
}

/**
 * Everything the coach knows, in one pure pass.
 *
 * Returns the findings it would write AND the ones it suppressed, because a
 * suppressed finding is not nothing — it is why the coach looks quiet, and the
 * tests assert on it.
 */
export function runCoach(input: CoachInput): {
  write: CoachRecInput[];
  /** Rule ids in `write` that landed on an already-open row rather than a new one. */
  refreshed: string[];
  suppressed: { ruleId: string; reason: SuppressionReason }[];
  findings: Finding[];
} {
  const today = input.today ?? new Date();
  const windowDays = input.windowDays ?? COACH_WINDOW_DAYS;
  const weekKey = isoWeekKey(today);
  const monthKey = today.toISOString().slice(0, 7);

  const training = measureTraining(
    input.logs,
    {
      heavyFraction: T.strengthIntensity.value,
      strengthRepMax: T.strengthReps.value,
      hypertrophyReps: T.hypertrophyReps.value,
      nearFailureRpe: RPE_LADDER.nearFailure,
      allOutRpe: RPE_LADDER.allOut,
      heavyRestSeconds: T.strengthRest.value,
      overrides: input.overrides,
      // Prices unweighted work against the athlete's own mass rather than the
      // flat constant, exactly as the radar does. Falls back on its own when
      // there is no bodyweight on file.
      unweightedKg: unweightedRepKg(input.stats),
    },
    today,
    windowDays,
  );
  const goals = measureGoals(input.stats, training);
  const nutrition = measureNutrition(input.meals, input.logs, today, windowDays);
  const fuel = measureFuelTiming(
    input.logs,
    input.meals,
    N.fastedDuration.value,
    today,
    windowDays,
  );

  const findings: Finding[] = [];
  for (const rule of TRAINING_RULES) {
    const f = rule(training, input.stats, weekKey);
    if (f) findings.push(f);
  }
  const g = goalDrift(goals, training, weekKey);
  if (g) findings.push(g);
  const cal = rpeCalibration(training, weekKey);
  if (cal) findings.push(cal);

  // Monthly cadence for the standing protein target — it restates a number that
  // only moves when bodyweight does. Everything else is weekly.
  const nutritionFindings = [
    proteinTarget(nutrition, input.stats, monthKey),
    proteinGapDays(nutrition, input.meals, weekKey),
    arrivingHungry(nutrition, weekKey),
    carbTimingWindow(nutrition, training, input.stats, weekKey),
    longSessionUnfed(fuel, input.stats, weekKey),
    // Monthly: what your carbohydrate is made of moves on the scale of habits,
    // not weeks, and restating it weekly would be the monotony this engine is
    // most prone to.
    carbSourceConcentration(nutrition, monthKey),
  ];
  for (const f of nutritionFindings) if (f) findings.push(f);

  // The open row per rule, if any: both the reason a rule is not suppressed and
  // the row the refreshed numbers are written onto.
  const openByRule = new Map<string, Recommendation>();
  for (const r of [...input.existing].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (r.rule_id && r.status === 'open') openByRule.set(r.rule_id, r);
  }

  // Completed sessions logged after a given row was written. `log_date` is a
  // bare date, so compare on the date part only — a session logged the same day
  // as the decision is not evidence against it.
  const doneDates = input.logs
    .filter((l) => l.status === 'done')
    .map((l) => l.log_date)
    .sort();
  const newSessionsSince = (iso: string) => {
    const cutoff = iso.slice(0, 10);
    return doneDates.filter((d) => d > cutoff).length;
  };
  const lastDecisionFor = (ruleId: string) =>
    input.existing
      .filter((r) => r.rule_id === ruleId && (r.status === 'dismissed' || r.status === 'acted'))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  const suppressed: { ruleId: string; reason: SuppressionReason }[] = [];
  const live = findings.filter((f) => {
    const decision = lastDecisionFor(f.ruleId);
    const reason = isSuppressed(
      f.ruleId,
      f.periodKey,
      input.existing,
      today,
      decision
        ? { newSessions: newSessionsSince(decision.created_at), drift: f.drift }
        : undefined,
    );
    if (reason) suppressed.push({ ruleId: f.ruleId, reason });
    return reason === null;
  });

  // EVERYTHING TRUE IS WRITTEN, ranked. The old cap of four was applied here,
  // at the write, which meant a fifth true finding was not deferred — it was
  // destroyed, with no row, no history and no way for the athlete to know it
  // had been measured. Volume control belongs to the surface that renders the
  // page (see SURFACED_LIMIT in CoachView), where "show me the rest" is a
  // disclosure rather than a re-run of the engine.
  const ranked = [...live].sort(byImpact);

  const write = ranked.map((f) => ({
    rule_id: f.ruleId,
    // Refresh in place when this rule already has an open row, whatever period
    // it was opened in. Minting a new weekly row alongside it would leave two
    // live rows for one unresolved point; suppressing the rule instead — which
    // is what used to happen — left the athlete reading last week's numbers.
    period_key: openByRule.get(f.ruleId)?.period_key ?? f.periodKey,
    pack_version: KNOWLEDGE_PACK_VERSION,
    tldr: f.tldr.slice(0, 200),
    action: f.action.slice(0, 400),
    body_md: f.body.slice(0, 2000),
    drift_score: f.drift,
    confidence: f.confidence,
    evidence: toEvidence(f, f.sufficiency),
  }));

  // Split so the caller can say "2 new, 3 updated" instead of "5 new" — the
  // second is a lie the athlete catches immediately, and it is the reason a
  // refreshed row must not be reported as a discovery.
  const refreshed = write.filter((r) => openByRule.has(r.rule_id)).map((r) => r.rule_id);

  // `findings` stays the FULL set, suppressed ones included — a suppressed
  // finding is not nothing, it is why the coach looks quiet, and the tests
  // assert on the difference between the two lists.
  return { write, refreshed, suppressed, findings };
}

export { CLAIMS };
