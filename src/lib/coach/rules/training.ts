// Training-type rules: does the work performed match the adaptation it is being
// counted as?
//
// Every rule here returns `null` rather than a weak finding. Silence is the
// correct output when the inputs are thin, and it is also what keeps the coach
// from becoming a weekly recital of the same four complaints — see the cooldown
// in ../evaluate.ts for the other half of that problem.

import { TRAINING } from '@/lib/coach/knowledge';
import type { Finding } from '@/lib/coach/types';
import type { TrainingSignals } from '@/lib/coach/signals';
import type { UserStats } from '@/lib/types';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const round = (n: number, d = 0) => Number(n.toFixed(d));

/** Goal weight 0..100, or 0 when the athlete never ranked it. */
function goalWeight(stats: UserStats | null, id: string): number {
  return stats?.goals?.find((g) => g.id === id)?.weight ?? 0;
}

/**
 * The main lift is being loaded like accessory work.
 *
 * Gated on the athlete actually claiming strength as a goal: a lifter who ranked
 * strength at zero and trains their primary slot at 70% is not making a mistake,
 * they are training for something else, and telling them otherwise is the coach
 * imposing a goal they did not set.
 */
export function primaryTooLight(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const intensity = s.primaryIntensity;
  if (intensity.sufficiency === 'insufficient') return null;
  const weight = goalWeight(stats, 'strength');
  if (weight < 25) return null;

  const { share, atOrAboveHeavy, total } = intensity.value;
  const heavy = TRAINING.strengthIntensity.value;
  // A third of main-lift sets landing heavy is the product's line for "there is
  // real strength work in here", not a number from the corpus. It is placed low
  // on purpose — Galpin's own Prilipin discussion has even a strength-focused
  // lifter spending most of their reps below 80%, so a high bar here would fire
  // on a correctly-programmed block.
  if (share >= 1 / 3) return null;

  return {
    ruleId: 'training.intent.primary-too-light',
    periodKey,
    tldr: `Main lifts rarely reach ${pct(heavy)}`,
    action: `Take one main lift per session to ${pct(heavy)} of its best for sets of ${TRAINING.strengthReps.value} or fewer.`,
    body: `Only ${atOrAboveHeavy} of ${total} main-lift sets in the last ${s.windowDays} days were loaded at or above ${pct(heavy)} of that movement's own best estimate. ${TRAINING.strengthIntensity.source === 'galpinStrength' ? 'Galpin' : 'The source'} puts true strength work ${TRAINING.strengthIntensity.quote} at ${TRAINING.strengthReps.value} reps or fewer — below that the adaptation on offer is size, not force. You ranked strength at ${weight}/100, so this is work that is not paying into the goal you set for it.`,
    drift: round(Math.min(1, (1 / 3 - share) / (1 / 3)), 2),
    confidence: intensity.sufficiency === 'ok' ? 0.7 : 0.45,
    sufficiency: intensity.sufficiency,
    claims: [TRAINING.strengthIntensity, TRAINING.strengthReps],
    observed: { heavySets: atOrAboveHeavy, loadedSets: total, share: round(share, 2), goalWeight: weight },
  };
}

/**
 * Muscle regions sitting under the weekly-set floor while hypertrophy is a
 * stated goal.
 *
 * Reports the regions, never a single one: naming only the worst would have the
 * athlete chase it, hit the floor, and get the same finding about the next
 * region a fortnight later.
 */
export function hypertrophyVolumeShort(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  if (s.regionSetsPerWeek.sufficiency === 'insufficient') return null;
  const weight = goalWeight(stats, 'hypertrophy');
  if (weight < 25) return null;
  // Below this the taxonomy could not place enough of the work for a per-region
  // count to mean anything, and the shortfall would be the classifier's, not
  // the athlete's.
  if (s.coverage < 0.6) return null;

  const floor = TRAINING.hypertrophyWeeklySets.value;
  const per = s.regionSetsPerWeek.value;
  // Regions with literally zero sets are excluded: a region that was never
  // trained at all is more likely an unmapped movement or a body part this
  // athlete deliberately does not train than a volume shortfall.
  const short = Object.entries(per)
    .filter(([, v]) => v > 0 && v < floor)
    .sort((a, b) => a[1] - b[1]);
  if (short.length === 0) return null;

  const named = short.slice(0, 3).map(([k, v]) => `${k} (${round(v, 1)})`).join(', ');
  const worst = short[0][1];
  const trained = Object.values(per).filter((v) => v > 0).length;
  // EVERY trained region under the floor is not eight findings about eight
  // muscles, it is one finding about total resistance volume. Listing regions
  // there would have the athlete chase calves, clear it, and get the same
  // finding about chest a fortnight later — the monotony failure this engine is
  // most prone to. So the framing switches when nothing clears the bar.
  const global = short.length === trained && trained >= 4;
  const total = Object.values(per).reduce((a, b) => a + b, 0);

  return {
    ruleId: global
      ? 'training.hypertrophy.total-volume-short'
      : 'training.hypertrophy.region-volume-short',
    periodKey,
    tldr: global
      ? `No muscle group reaches ${floor} sets/week`
      : `${short.length} muscle group${short.length > 1 ? 's' : ''} under ${floor} sets/week`,
    action: global
      ? `Add a second resistance session a week, or extend the ones you do — you need roughly ${Math.ceil(trained * floor - total)} more hard sets a week to bring every group to ${floor}.`
      : `Add a set or two per session to ${short.slice(0, 2).map(([k]) => k).join(' and ')} until each clears ${floor} hard sets a week.`,
    body: global
      ? `None of the ${trained} muscle groups you trained in the last ${s.windowDays} days reached ${floor} hard sets a week — you average ${round(total, 0)} across all of them, against the ${trained * floor} that floor implies. The figure the guest series settles on for an all-round trainee is "${TRAINING.hypertrophyWeeklySets.quote}". When every group is short the constraint is total resistance volume, not any one muscle, so this is one finding rather than ${trained}. You ranked hypertrophy at ${weight}/100.`
      : `Averaged over the last ${s.windowDays} days: ${named} hard sets per week. The figure the guest series settles on for an all-round trainee is "${TRAINING.hypertrophyWeeklySets.quote}" — a floor for maintaining or building, not an optimum. You ranked hypertrophy at ${weight}/100. Note this counts only work the movement taxonomy could place; ${pct(s.coverage)} of your logged minutes were classifiable.`,
    drift: round(Math.min(1, (floor - worst) / floor), 2),
    confidence: s.regionSetsPerWeek.sufficiency === 'ok' ? 0.6 : 0.4,
    sufficiency: s.regionSetsPerWeek.sufficiency,
    claims: [TRAINING.hypertrophyWeeklySets],
    observed: {
      regionsShort: short.length,
      lowestSetsPerWeek: round(worst, 1),
      coverage: round(s.coverage, 2),
      goalWeight: weight,
    },
  };
}

/** Weekly conversational-pace minutes below the general-health band. */
export function zone2Short(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  if (s.sessionMinutesPerWeek.sufficiency === 'insufficient') return null;
  const [floor] = TRAINING.zone2Weekly.value;
  // Elapsed, not working minutes. The claim is about time spent doing cardio,
  // and for continuous work the two are close anyway — but mixing units across
  // rules would make two findings on the same screen disagree about the same
  // week.
  const actual = s.sessionMinutesPerWeek.value.endurance;
  if (actual >= floor) return null;
  const weight = goalWeight(stats, 'endurance');

  return {
    ruleId: 'training.endurance.zone2-short',
    periodKey,
    tldr: `${Math.round(actual)} min/week of aerobic work`,
    action: `Add ${Math.ceil((floor - actual) / 30)} × 30-minute conversational-pace sessions a week.`,
    body: `You spent about ${Math.round(actual)} minutes a week on aerobic work over the last ${s.windowDays} days${weight ? `, having ranked endurance at ${weight}/100` : ''}. The band the guest series treats as the general-health floor is ${TRAINING.zone2Weekly.value[0]}–${TRAINING.zone2Weekly.value[1]} minutes at a pace where you "can just barely have a conversation". It need not all be structured training — Galpin explicitly allows walking and daily activity to cover part of it. If you add it on lifting days, prefer the bike or rower: he reports "much more interference with running" on hypertrophy "than we do cycling".`,
    drift: round(Math.min(1, (floor - actual) / floor), 2),
    confidence: s.sessionMinutesPerWeek.sufficiency === 'ok' ? 0.65 : 0.4,
    sufficiency: s.sessionMinutesPerWeek.sufficiency,
    claims: [TRAINING.zone2Weekly, TRAINING.interferenceModality],
    observed: { minutesPerWeek: Math.round(actual), floor, goalWeight: weight },
  };
}

/**
 * Hard conditioning placed before the resistance work in a mixed session.
 *
 * Honours the caveat rather than the headline. San-Millán's objection is that
 * early lactate suppresses fat oxidation for the aerobic block that follows, so
 * this fires only when the athlete is actually chasing the aerobic adaptation.
 */
export function intervalOrdering(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  if (s.mixedSessions < 3) return null;
  if (s.mixedConditioningFirst === 0) return null;
  if (goalWeight(stats, 'endurance') < 25) return null;
  const share = s.mixedConditioningFirst / s.mixedSessions;
  if (share < 0.5) return null;

  return {
    ruleId: 'training.endurance.interval-ordering',
    periodKey,
    tldr: 'Conditioning is landing before the lifting',
    action: 'Put the conditioning block last in sessions that contain both.',
    body: `${s.mixedConditioningFirst} of your ${s.mixedSessions} mixed sessions opened with the conditioning block. San-Millán's rule for a session carrying both is that "${TRAINING.vo2Ordering.quote}" — lactate raised early suppresses lipolysis, so the aerobic work that follows returns less than it should. His caveat matters as much as the rule: this bites for the fat-oxidation and aerobic goal specifically, not as a general law of session order.`,
    drift: round(share, 2),
    confidence: 0.5,
    sufficiency: s.mixedSessions >= 5 ? 'ok' : 'partial',
    claims: [TRAINING.vo2Ordering],
    observed: { conditioningFirst: s.mixedConditioningFirst, mixedSessions: s.mixedSessions },
  };
}

/**
 * A long unbroken run of training days.
 *
 * Galpin wants performance, a biomarker AND symptoms together before calling
 * overreaching, and this has only one of the three. So it is deliberately
 * phrased as a question rather than a verdict, and carries low confidence.
 */
export function consecutiveDays(
  s: TrainingSignals,
  _stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const run = TRAINING.overreachingRun.value;
  if (s.longestConsecutiveDays < run) return null;

  return {
    ruleId: 'training.recovery.consecutive-days',
    periodKey,
    tldr: `${s.longestConsecutiveDays} straight training days`,
    action: 'Take a full day off, or drop one session to RPE 6 and half the range of motion.',
    body: `You trained ${s.longestConsecutiveDays} calendar days in a row inside the last ${s.windowDays}. Galpin's threshold for paying attention is "${TRAINING.overreachingRun.quote}" — but he wants three signals together before calling it overreaching: a performance drop, a moving biomarker, and symptoms. This is only the first, so treat it as worth a look, not a diagnosis. His preferred response is a lighter session rather than a cancelled one.`,
    drift: round(Math.min(1, (s.longestConsecutiveDays - run + 1) / 5), 2),
    confidence: 0.35,
    sufficiency: 'ok',
    claims: [TRAINING.overreachingRun],
    observed: { longestRun: s.longestConsecutiveDays, threshold: run },
  };
}

/** Sessions per week against the athlete's own stated target. */
export function frequencyBelowTarget(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const target = stats?.days_per_week ?? null;
  if (target == null) return null;
  if (s.sessionsPerWeek.sufficiency === 'insufficient') return null;
  const actual = s.sessionsPerWeek.value;
  // Within three quarters of target is on plan; life happens.
  if (actual >= target * 0.75) return null;

  return {
    ruleId: 'training.frequency.below-target',
    periodKey,
    tldr: `${round(actual, 1)} sessions/week vs your ${target}`,
    action: `Schedule the missing ${Math.max(1, Math.round(target - actual))} session${target - actual >= 1.5 ? 's' : ''} as fixed appointments this week.`,
    body: `Over the last ${s.windowDays} days you completed ${s.sessions} sessions — ${round(actual, 1)} a week against the ${target} you set in Settings. This is your own target, not one the coach picked. If ${target} is no longer realistic, lowering it in Settings is a better fix than carrying a standing shortfall: everything else the coach says about volume is measured per week.`,
    drift: round(Math.min(1, (target - actual) / target), 2),
    confidence: s.sessionsPerWeek.sufficiency === 'ok' ? 0.75 : 0.5,
    sufficiency: s.sessionsPerWeek.sufficiency,
    claims: [],
    observed: { sessionsPerWeek: round(actual, 1), target, sessions: s.sessions },
  };
}

export const TRAINING_RULES = [
  primaryTooLight,
  hypertrophyVolumeShort,
  zone2Short,
  intervalOrdering,
  consecutiveDays,
  frequencyBelowTarget,
] as const;
