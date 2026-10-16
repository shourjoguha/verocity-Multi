// Stage 5b: what a closing finding is allowed to SAY.
//
// recurrence.ts decides that a decided rule has gone quiet and stayed quiet.
// This module decides what that means, and there are two very different
// answers that used to share one sentence:
//
//   - CLEARED. The rule is measured the same way it was when the athlete acted,
//     and the number came down. That is their change holding.
//   - RE-MEASURED. The coach changed how it measures the rule after the athlete
//     decided, and under the new measure it reads clean. The number fell
//     because the ruler moved; the athlete may or may not have changed too, and
//     the coach cannot tell which.
//
// THE BUG THIS EXISTS FOR. On 2026-10-09 commit 9f8cb58 moved the strength line
// for intermediates from 85% to 75% of best, and `training.intent.loaded-too-
// light` fell from drift 0.68 to 0.12 overnight with no new training at all.
// On 2026-10-13 the coach then wrote "Cleared: 8% of loaded sets reach 85%",
// with a body saying "that is a change holding, not a quiet week". Both halves
// were false: the headline restated the OLD problem as if it were a current
// number, and the body credited the athlete with a change the code had made.
// The athlete's note on it was confusion, which is the correct reading of a
// card that contradicts itself. Sep 30's "Cleared: 53 min/week of aerobic
// work" had the same headline fault without the re-measure.
//
// SO THE HEADLINE NEVER BORROWS THE OLD TLDR ANY MORE. It names the rule's
// subject in neutral words (`RULE_SUBJECT`) — "Cleared: heavy loading" — and
// the old sentence moves into the body, quoted and dated as what it read THEN.
//
// HOW A RE-MEASURE IS DETECTED, AND WHY BY CHANGELOG. Three signals were on the
// table:
//
//   1. `pack_version` on the decided row vs now. Too coarse: the pack bumps for
//      any claim in any rule, so every decision older than the last bump would
//      read as re-measured. And too blind: most measurement changes — which
//      sections count, which sessions count — are code, not claims, and never
//      bump the pack at all (both this PR's other two fixes are that kind).
//   2. A sharp drift drop between consecutive `coach_observations` with no new
//      sessions in between. Not robust: the window slides daily, so drift moves
//      with zero new sessions as old ones age out, and one session logged
//      between check-ins makes a code change invisible. It also cannot say WHAT
//      changed, and "the coach changed something" is barely better than silence.
//   3. An explicit, dated changelog of measurement changes per rule. Exact when
//      kept, names what changed in words the athlete can read, and testable.
//      Its weakness is discipline: a change nobody records is not seen.
//
// (3) is primary. A narrow form of (1) backs it up for the commonest unrecorded
// case: the decided row stores the claims it rested on WITH their values
// (`toEvidence` in ./evaluate.ts), so a claim whose value has since been edited
// in knowledge.ts is caught generically, no entry required. It cannot catch a
// rule switching to a DIFFERENT claim (the 9f8cb58 case), which is why the
// changelog is not optional.
//
// DATES, NOT VERSIONS. Rows already decided carry no definition stamp, and the
// rows that matter most are those. A change counts against a decision when it
// lands on or after the decision's DAY — same-day counts, because the coach
// cannot know whether the athlete decided before or after the deploy, and
// calling a real fix a re-measure costs less than crediting the athlete with
// the code's change, which is the lie this module exists to stop.
//
// Recording a change: add a `DefinitionChange` below in the same PR as the
// change, dated the day it is written. `what` is rendered to the athlete.

import { CLAIMS } from '@/lib/coach/knowledge';
import {
  RESOLUTION_FLOOR,
  RESOLUTION_HOLD,
  resolvedRuleId,
  type Recurrence,
} from '@/lib/coach/recurrence';
import type { EvidencePayload, Finding } from '@/lib/coach/types';
import type { Recommendation } from '@/lib/types';

/** One change to how a rule is measured. */
export interface DefinitionChange {
  ruleId: string;
  /** 'YYYY-MM-DD', the day the change was written. */
  on: string;
  /** What changed, as a clause the athlete can read: "only main-block sets…". */
  what: string;
}

/**
 * Measurement changes, oldest first. Starts at the changes that could still
 * matter — anything older than DECISION_EXPIRY_DAYS can never reach a live
 * decision — and is not a full history of the engine.
 */
export const DEFINITION_CHANGES: readonly DefinitionChange[] = [
  {
    ruleId: 'training.hypertrophy.region-volume-short',
    on: '2026-09-19',
    what: 'sets per muscle group are now counted whole — a squat is a set for quads and a set for glutes — instead of split across the muscles a movement trains',
  },
  {
    ruleId: 'training.intent.loaded-too-light',
    on: '2026-10-09',
    what: 'the strength line for an intermediate lifter moved from 85% to 75% of best, Galpin’s own number for the moderately trained',
  },
  {
    ruleId: 'training.endurance.intervals-not-all-out',
    on: '2026-10-09',
    what: 'only RPE you actually rated counts now, not the value the logger carries over, and a heart rate near your own peak counts as all-out',
  },
  {
    ruleId: 'training.intent.loaded-too-light',
    on: '2026-10-16',
    what: 'only main-block sets of five reps or fewer are counted now, not every loaded set',
  },
  {
    ruleId: 'training.recovery.consecutive-days',
    on: '2026-10-16',
    what: 'only the run still going counts now, not the longest run in four weeks, and recovery sessions are not training days',
  },
  {
    ruleId: 'training.recovery.symptoms-and-load',
    on: '2026-10-16',
    what: 'the run of training days it reads is the one still going, not the longest in four weeks',
  },
];

/** Changes recorded for a rule on or after the day it was decided. */
export function definitionChangesSince(
  ruleId: string,
  decidedOn: string,
  changes: readonly DefinitionChange[] = DEFINITION_CHANGES,
): DefinitionChange[] {
  const day = decidedOn.slice(0, 10);
  return changes.filter((c) => c.ruleId === ruleId && c.on >= day);
}

function formatClaimValue(value: unknown, unit: string): string {
  if (Array.isArray(value)) return value.map((v) => formatClaimValue(v, unit)).join('–');
  if (typeof value === 'number' && unit.startsWith('fraction')) return `${Math.round(value * 100)}%`;
  return String(value);
}

/**
 * Claims the decided row rested on whose value has since changed in the pack,
 * phrased for the athlete. Rows without evidence, or claims since retired,
 * contribute nothing — absence is not a change anyone can name.
 */
export function claimValueChanges(
  evidence: unknown,
  claims: Record<string, { value: unknown; unit: string }> = CLAIMS,
): string[] {
  const stored = (evidence as Partial<EvidencePayload> | null)?.claims;
  if (!Array.isArray(stored)) return [];
  const out: string[] = [];
  for (const c of stored) {
    const now = claims[c.id];
    if (!now || JSON.stringify(now.value) === JSON.stringify(c.value)) continue;
    out.push(
      `the line it is measured against moved from ${formatClaimValue(c.value, c.unit)} to ${formatClaimValue(now.value, now.unit)}`,
    );
  }
  return out;
}

/**
 * What each rule is ABOUT, in neutral words — the subject of a closing
 * headline. Neutral on purpose: "Cleared: heavy loading" names the thing
 * without restating a number that is no longer true. Falls back on the first
 * two id segments, like `impactWeight`, so one entry covers a per-aspect family.
 */
export const RULE_SUBJECT: Record<string, string> = {
  'training.frequency.below-target': 'sessions per week',
  'training.hypertrophy.total-volume-short': 'weekly hard sets',
  'training.hypertrophy.region-volume-short': 'sets per muscle group',
  'goal.underserved': 'time on your top-ranked goal',
  'training.endurance.zone2-short': 'weekly zone 2 time',
  'training.hypertrophy.effort-low': 'effort on hypertrophy sets',
  'training.intent.loaded-too-light': 'heavy loading',
  'training.endurance.intervals-not-all-out': 'interval intensity',
  'training.progression.load-step-due': 'load steps',
  'training.recovery.symptoms-and-load': 'sleep and soreness under load',
  'training.recovery.consecutive-days': 'days in a row',
  'training.recovery.soreness-source': 'soreness',
  'training.strength.rest-too-short': 'rest on heavy sets',
  'nutrition.timing.long-session-unfed': 'fuel for long sessions',
  'nutrition.style.protein-gap-days': 'low-protein days',
  'nutrition.timing.carb-window': 'carbs around training',
  'training.endurance.interval-ordering': 'interval order',
  'nutrition.style.carb-concentration': 'carb sources',
  'nutrition.timing.arriving-hungry': 'arriving hungry',
  'training.effort.rpe-calibration': 'RPE ratings',
  'training.effort.interval-rpe-underreads': 'interval RPE against heart rate',
  'nutrition.dose.protein-target': 'protein target',
};

export function subjectOf(ruleId: string): string {
  return (
    RULE_SUBJECT[ruleId] ??
    RULE_SUBJECT[ruleId.split('.').slice(0, 2).join('.')] ??
    'this finding'
  );
}

/** Confidence for a closing finding. Deliberately NOT scaled by how large the
 *  improvement was: good news that outranks a structural problem is still the
 *  wrong thing to lead a page with. */
const CLOSING_CONFIDENCE = 0.8;

/** Which of the two stories a closing finding tells. */
export type OutcomeKind = 'cleared' | 'remeasured';

/** Read back from a written row, for the surface. Absent on rows written before
 *  this module, which were all told as "cleared". */
export function outcomeKind(evidence: unknown): OutcomeKind {
  const o = (evidence as Partial<EvidencePayload> | null)?.observed?.outcome;
  return o === 'remeasured' ? 'remeasured' : 'cleared';
}

export interface ClosingInput {
  ruleId: string;
  /** The acted row being closed. */
  decision: Recommendation;
  /** This run's finding for the rule, when it fired inside the floor. */
  current?: Finding;
  driftNow: number;
  newSessions: number;
  periodKey: string;
  verdict: Recurrence;
  changes?: readonly DefinitionChange[];
}

/**
 * The closing finding for a rule that went quiet after the athlete acted.
 *
 * `claims` is empty: this is not an assertion about the body, it is a report
 * about their own record, and inventing a citation for it would devalue every
 * real one.
 *
 * `drift` is the CURRENT (low) reading, not the size of the improvement. The
 * column means "distance past the threshold" everywhere else, and overloading
 * it here would let a big win read as a big problem. The improvement is carried
 * in `observed` instead, where it cannot be mistaken for a severity.
 */
export function closingFinding(input: ClosingInput): Finding {
  const { ruleId, decision, current, driftNow, newSessions, periodKey, verdict } = input;
  const was = decision.drift_score ?? 0;
  const decidedOn = decision.created_at.slice(0, 10);
  const then = (decision.tldr ?? '').trim();
  const changed = [
    ...definitionChangesSince(ruleId, decision.created_at, input.changes).map((c) => `${c.what} (${c.on})`),
    ...claimValueChanges(decision.evidence),
  ];
  const kind: OutcomeKind = changed.length > 0 ? 'remeasured' : 'cleared';
  const subject = subjectOf(ruleId);
  const thenClause = then
    ? `when it read “${then}”, ${Math.round(was * 100)}% past its threshold`
    : `when it read ${Math.round(was * 100)}% past its threshold`;
  const nowClause = current ? ` Today it reads “${current.tldr}”, inside the margin.` : '';

  const body =
    kind === 'remeasured'
      ? `You acted on this on ${decidedOn}, ${thenClause}. Since then the coach changed how it measures it: ${changed.join('; ')}. Under the new measure it has read clean for the last ${RESOLUTION_HOLD} check-ins.${nowClause} So the drop is at least partly the measure moving rather than your training, and the coach cannot tell how much of each. The old reading no longer counts as your baseline; the rule stays on watch under the new measure.`
      : `You acted on this on ${decidedOn}, ${thenClause}. It has been at or under ${Math.round(RESOLUTION_FLOOR * 100)}% for the last ${RESOLUTION_HOLD} check-ins, across ${newSessions} sessions since, and the way it is measured has not changed in that time — so this is your change holding, not a quiet week.${nowClause} The rule goes back on watch from here: if it comes back, it will be measured against this new level rather than the old one.`;

  return {
    ruleId: resolvedRuleId(ruleId),
    periodKey,
    tldr: kind === 'remeasured' ? `Re-measured: ${subject}` : `Cleared: ${subject}`,
    action:
      kind === 'remeasured'
        ? 'Nothing to do. This is a note about how the coach measures, not about your training.'
        : 'Nothing to do. Keeping this is the work now.',
    body,
    drift: driftNow,
    confidence: CLOSING_CONFIDENCE,
    sufficiency: 'ok',
    claims: [],
    observed: {
      outcome: kind,
      driftAtDecision: Number(was.toFixed(2)),
      driftNow: Number(driftNow.toFixed(2)),
      improvementPoints: Math.round((was - driftNow) * 100),
      decidedOn,
      readings: verdict.slope != null ? `slope ${verdict.slope}` : 'short series',
      definitionChanges: changed.length > 0 ? changed.join('; ') : null,
    },
  };
}
