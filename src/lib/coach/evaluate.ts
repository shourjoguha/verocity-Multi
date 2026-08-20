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
// So dismissal, action and snoozing all buy silence for a period, and the
// cooldown is measured from the athlete's decision rather than from the data.
// A rule that is STILL TRUE is not automatically a rule that should still speak.

import { KNOWLEDGE_PACK_VERSION } from '@/lib/coach/knowledge';
import {
  COACH_WINDOW_DAYS,
  isoWeekKey,
  measureGoals,
  measureNutrition,
  measureTraining,
} from '@/lib/coach/signals';
import { TRAINING as T } from '@/lib/coach/knowledge';
import { TRAINING_RULES } from '@/lib/coach/rules/training';
import { goalDrift } from '@/lib/coach/rules/goals';
import {
  arrivingHungry,
  carbTimingWindow,
  proteinGapDays,
  proteinTarget,
} from '@/lib/coach/rules/nutrition';
import type { EvidencePayload, Finding } from '@/lib/coach/types';
import { SOURCES, CLAIMS } from '@/lib/coach/knowledge';
import { unweightedRepKg } from '@/lib/userStats';
import type { OverrideMap } from '@/lib/movementTaxonomy';
import type { MealLog, Recommendation, UserStats, WorkoutLog, Plan } from '@/lib/types';

/**
 * How long a decision buys silence on that rule.
 *
 * Dismissal is the longest because it is the strongest signal the athlete can
 * send — "I have heard this and I do not want it". Acting is shorter but not
 * zero: a fortnight is roughly the soonest a change in training could move the
 * measurement that produced the finding, so speaking again sooner would be
 * grading them before the work could land.
 */
export const COOLDOWN_DAYS = { dismissed: 42, acted: 14 } as const;

/** At most this many findings per check-in, highest confidence first. A page of
 *  nine true things is read as a wall and actioned as none of them. */
export const MAX_FINDINGS = 4;

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

/**
 * May this rule speak right now?
 *
 * Looks at the most recent row for the rule only. Older rows are history: a
 * finding dismissed in April and acted on in July is in its acted cooldown, not
 * its dismissed one.
 */
export function isSuppressed(
  ruleId: string,
  periodKey: string,
  existing: Recommendation[],
  today: Date,
): boolean {
  const prior = existing
    .filter((r) => r.rule_id === ruleId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const last = prior[0];
  if (!last) return false;

  // Same rule, same period, still open — this is an update of the live row, not
  // a new voice. Not suppressed; the caller upserts onto it.
  if (last.status === 'open' && last.period_key === periodKey) return false;

  if (last.status === 'open') {
    // Open from an earlier period. Leave it alone rather than minting a second
    // row for the same unresolved point.
    return true;
  }
  if (last.status === 'snoozed') {
    return last.snooze_until != null && Date.parse(last.snooze_until) > today.getTime();
  }
  if (last.status === 'dismissed') return daysSince(last.created_at, today) < COOLDOWN_DAYS.dismissed;
  if (last.status === 'acted') return daysSince(last.created_at, today) < COOLDOWN_DAYS.acted;
  return false;
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
  suppressed: { ruleId: string; reason: 'cooldown' }[];
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

  const findings: Finding[] = [];
  for (const rule of TRAINING_RULES) {
    const f = rule(training, input.stats, weekKey);
    if (f) findings.push(f);
  }
  const g = goalDrift(goals, training, weekKey);
  if (g) findings.push(g);

  // Monthly cadence for the standing protein target — it restates a number that
  // only moves when bodyweight does. Everything else is weekly.
  const nutritionFindings = [
    proteinTarget(nutrition, input.stats, monthKey),
    proteinGapDays(nutrition, input.meals, weekKey),
    arrivingHungry(nutrition, weekKey),
    carbTimingWindow(nutrition, training, input.stats, weekKey),
  ];
  for (const f of nutritionFindings) if (f) findings.push(f);

  const suppressed: { ruleId: string; reason: 'cooldown' }[] = [];
  const live = findings.filter((f) => {
    if (isSuppressed(f.ruleId, f.periodKey, input.existing, today)) {
      suppressed.push({ ruleId: f.ruleId, reason: 'cooldown' });
      return false;
    }
    return true;
  });

  const write = live
    .sort((a, b) => b.confidence - a.confidence || b.drift - a.drift)
    .slice(0, MAX_FINDINGS)
    .map((f) => ({
      rule_id: f.ruleId,
      period_key: f.periodKey,
      pack_version: KNOWLEDGE_PACK_VERSION,
      tldr: f.tldr.slice(0, 200),
      action: f.action.slice(0, 400),
      body_md: f.body.slice(0, 2000),
      drift_score: f.drift,
      confidence: f.confidence,
      evidence: toEvidence(f, f.sufficiency),
    }));

  return { write, suppressed, findings };
}

export { CLAIMS };
