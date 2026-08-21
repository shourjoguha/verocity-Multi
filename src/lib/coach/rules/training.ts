// Training-type rules: does the work performed match the adaptation it is being
// counted as?
//
// Every rule here returns `null` rather than a weak finding. Silence is the
// correct output when the inputs are thin, and it is also what keeps the coach
// from becoming a weekly recital of the same four complaints — see the cooldown
// in ../evaluate.ts for the other half of that problem.

import { READINESS, TRAINING } from '@/lib/coach/knowledge';
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
 * Loaded work rarely reaching the intensity the strength adaptation needs.
 *
 * Reads every resistance section, not just `primary` — see the note on
 * `loadedIntensity` in ../signals.ts for why that distinction cost this rule its
 * voice in the first version.
 *
 * Gated on the athlete actually claiming strength as a goal: a lifter who ranked
 * strength at zero and works at 60% is not making a mistake, they are training
 * for something else, and telling them otherwise is the coach imposing a goal
 * they did not set.
 */
export function loadedTooLight(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const intensity = s.loadedIntensity;
  if (intensity.sufficiency === 'insufficient') return null;
  const weight = goalWeight(stats, 'strength');
  if (weight < 25) return null;

  const { share, atOrAboveHeavy, total, topMovement, topMovementBestKg, topMovementMeanFraction } =
    intensity.value;
  const heavy = TRAINING.strengthIntensity.value;
  // A fifth of loaded sets landing heavy is the product's line for "there is
  // real strength work in here", not a number from the corpus, and it is set
  // low on purpose. Galpin's own Prilipin discussion has even a strength-focused
  // lifter spending roughly a third of their reps at 55-65% of max, so a high
  // bar here would fire on a correctly-programmed block.
  if (share >= 0.2) return null;

  const lift =
    topMovement && topMovementMeanFraction != null && topMovementBestKg != null
      ? ` Your highest estimated 1RM in the window is ${topMovement} at ${topMovementBestKg} kg, and your working sets on it average ${pct(topMovementMeanFraction)} of that.`
      : '';

  return {
    ruleId: 'training.intent.loaded-too-light',
    periodKey,
    tldr: `${pct(share)} of loaded sets reach ${pct(heavy)}`,
    action: `Take one lift per session to ${pct(heavy)} of its best for sets of ${TRAINING.strengthReps.value} or fewer.`,
    body: `${atOrAboveHeavy} of ${total} loaded sets in the last ${s.windowDays} days sat at or above ${pct(heavy)} of that movement's own best estimate.${lift} Galpin puts true strength work "${TRAINING.strengthIntensity.quote}" at ${TRAINING.strengthReps.value} reps or fewer — below that the adaptation on offer is size, not force. You ranked strength at ${weight}/100, so this is work that is not paying into the goal you set for it. His caveat: that 85% is for the moderately-to-highly trained; at a lower training age far less will do.`,
    drift: round(Math.min(1, (0.2 - share) / 0.2), 2),
    confidence: intensity.sufficiency === 'ok' ? 0.7 : 0.45,
    sufficiency: intensity.sufficiency,
    claims: [TRAINING.strengthIntensity, TRAINING.strengthReps],
    observed: {
      heavySets: atOrAboveHeavy,
      loadedSets: total,
      share: round(share, 2),
      topMovement,
      topMovementBestKg,
      goalWeight: weight,
    },
  };
}

/**
 * Hypertrophy-range sets that are not being taken near failure.
 *
 * The rep range is only half of what the source prescribes; its stated caveat is
 * that the set must reach muscular failure. RPE is recorded on effectively every
 * set in real logs, which makes this the best-measured finding available — and
 * it is the one the rep-band rule alone would miss entirely, because the reps
 * look correct.
 *
 * The RPE-to-failure translation is the app's, not Galpin's, and the body says
 * so. He speaks in failure; RPE 8.5 is roughly one to two reps in reserve.
 */
export function hypertrophyEffortLow(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const effort = s.hypertrophyEffort;
  if (effort.sufficiency === 'insufficient') return null;
  if (goalWeight(stats, 'hypertrophy') < 25) return null;

  const mark = TRAINING.hypertrophyProximityToFailure.value;
  const { meanRpe, nearFailure, total } = effort.value;
  if (meanRpe >= mark - 0.5) return null;

  return {
    ruleId: 'training.hypertrophy.effort-low',
    periodKey,
    tldr: `Hypertrophy sets average RPE ${round(meanRpe, 1)}`,
    action: `Take the last set of each movement to RPE ${mark} or beyond — one or two reps left, not three or four.`,
    body: `Across ${total} sets in the ${TRAINING.hypertrophyReps.value[0]}–${TRAINING.hypertrophyReps.value[1]} rep range you logged an average RPE of ${round(meanRpe, 1)}, and ${nearFailure} of them reached RPE ${mark} or higher. The rep range on its own is not the prescription — Galpin's stated caveat is "${TRAINING.hypertrophyProximityToFailure.quote}". At RPE ${round(meanRpe, 1)} you are leaving roughly ${round(10 - meanRpe, 1)} reps in reserve, which is the one variable that would make correct-looking sets under-deliver. RPE ${mark} as the near-failure mark is this app's translation; he speaks in failure, not in RPE.`,
    drift: round(Math.min(1, (mark - meanRpe) / 3), 2),
    confidence: effort.sufficiency === 'ok' ? 0.7 : 0.45,
    sufficiency: effort.sufficiency,
    claims: [TRAINING.hypertrophyProximityToFailure, TRAINING.hypertrophyReps],
    observed: {
      meanRpe: round(meanRpe, 1),
      nearFailureSets: nearFailure,
      hypertrophySets: total,
      nearFailureMark: mark,
    },
  };
}

/**
 * Heavy low-rep sets prescribed less rest than the strength band names.
 *
 * `restSeconds` is the PRESCRIBED rest on the item or its group; nothing in this
 * app records the rest actually taken. So this reads programming intent and the
 * body says as much rather than claiming to have timed anything.
 */
export function heavyRestTooShort(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const rest = s.heavyRest;
  if (rest.sufficiency === 'insufficient') return null;
  if (goalWeight(stats, 'strength') < 25) return null;

  const [floor, ceil] = TRAINING.strengthRest.value;
  const { meanSeconds, belowBand, total } = rest.value;
  if (meanSeconds >= floor) return null;

  return {
    ruleId: 'training.strength.rest-too-short',
    periodKey,
    tldr: `Heavy sets rest ${Math.round(meanSeconds)}s, not ${floor / 60}–${ceil / 60} min`,
    action: `Set ${floor}–${ceil}s rest on your heavy low-rep work, and superset something unrelated to fill it.`,
    body: `${belowBand} of ${total} heavy low-rep sets in the last ${s.windowDays} days were prescribed under ${floor}s rest, averaging ${Math.round(meanSeconds)}s. Galpin's figure is "${TRAINING.strengthRest.quote}", and his reason is that intensity rather than volume drives strength — fatigue carried into the next set costs exactly the signal you came for. He is explicit that the rest need not be idle: superset an unrelated muscle group through it. Note this reads the rest you PRESCRIBED; the app does not record the rest you took. For hypertrophy work the advice inverts — he prefers "${TRAINING.hypertrophyRest.quote}".`,
    drift: round(Math.min(1, (floor - meanSeconds) / floor), 2),
    confidence: rest.sufficiency === 'ok' ? 0.55 : 0.35,
    sufficiency: rest.sufficiency,
    claims: [TRAINING.strengthRest, TRAINING.hypertrophyRest],
    observed: {
      meanRestSeconds: Math.round(meanSeconds),
      setsBelowBand: belowBand,
      heavySets: total,
      bandSeconds: `${floor}-${ceil}`,
    },
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
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const run = TRAINING.overreachingRun.value;
  if (s.longestConsecutiveDays < run) return null;
  // Defer when the symptom channel is also speaking: `readinessAndLoad` says
  // the same thing with two signals instead of one, and emitting both would put
  // the weaker version of a finding next to the stronger one.
  if (readinessAndLoad(s, stats, periodKey) != null) return null;

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

/**
 * Interval work being done, but not hard enough to be the thing it looks like.
 *
 * This is the rule the minute-counting version could not reach. A log full of
 * "Ski-Erg Intervals" reads as VO2max work; the RPE on those bouts says
 * otherwise, and a coach that counted only the minutes would congratulate the
 * athlete for training they are not actually getting.
 *
 * Fires only when bouts EXIST — the point is intensity, not absence. An athlete
 * doing no intervals at all is a different finding and, on this corpus, not
 * obviously a problem: Galpin puts the requirement as low as one 90-second bout
 * a week.
 */
export function intervalsNotAllOut(
  s: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const iv = s.intervals;
  if (iv.sufficiency === 'insufficient') return null;
  const { bouts, boutMinutes, allOutBouts, allOutMinutes, meanBoutSeconds, meanRpe } = iv.value;
  if (bouts === 0 || meanRpe == null) return null;
  const [floorMin] = TRAINING.vo2Weekly.value;
  const perWeek = allOutMinutes / s.weeks;
  if (perWeek >= floorMin) return null;
  const mark = TRAINING.vo2AllOut.value;
  if (meanRpe >= mark) return null;

  return {
    ruleId: 'training.endurance.intervals-not-all-out',
    periodKey,
    tldr: `Intervals average RPE ${round(meanRpe, 1)}, not all-out`,
    action: `Take ${TRAINING.vo2Bouts.value[0]}–${TRAINING.vo2Bouts.value[1]} bouts to genuinely maximal effort, resting until you can breathe through your nose again.`,
    body: `You logged ${bouts} timed conditioning bouts averaging ${Math.round(meanBoutSeconds)}s over the last ${s.windowDays} days — ${round(boutMinutes, 1)} minutes of interval work — but ${allOutBouts === 0 ? 'none of them reached' : `only ${allOutBouts} reached`} RPE ${mark}. The prescription is ${floorMin}–${TRAINING.vo2Weekly.value[1]} minutes a week, and it is about intensity rather than volume: Galpin's bar is "${TRAINING.vo2AllOut.quote}". He is equally explicit that the bout LENGTH does not matter — your ${Math.round(meanBoutSeconds)}-second format is fine — only the effort reached does. RPE ${mark} as the all-out mark is this app's translation; he speaks in heart rate, so a session that logs hr_max is the better read.`,
    drift: round(Math.min(1, (mark - meanRpe) / 3), 2),
    confidence: iv.sufficiency === 'ok' ? 0.6 : 0.4,
    sufficiency: iv.sufficiency,
    claims: [TRAINING.vo2Weekly, TRAINING.vo2AllOut, TRAINING.vo2Bouts],
    observed: {
      bouts,
      boutMinutes: round(boutMinutes, 1),
      allOutBouts,
      allOutMinutesPerWeek: round(perWeek, 1),
      meanBoutSeconds: Math.round(meanBoutSeconds),
      meanRpe: round(meanRpe, 1),
    },
  };
}

/**
 * Symptoms and load pointing the same way.
 *
 * DELIBERATELY WEAK ON ITS OWN. Galpin wants three concurrent signals —
 * performance, a biomarker, and symptoms — before anyone says overreaching. The
 * vibe check is the symptom channel and training density is a load proxy; there
 * is no biomarker here unless Garmin is connected. So this fires only when BOTH
 * available channels agree, tops out at moderate confidence, and says in the
 * body which signal is missing. It supersedes the bare consecutive-days read
 * when it fires, which is why that rule defers to it.
 */
export function readinessAndLoad(
  s: TrainingSignals,
  _stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const r = s.readiness;
  if (r.sufficiency === 'insufficient') return null;
  const { meanSleep, meanEnergy, meanSoreness, lowSleepSessions, highSorenessSessions, rated } =
    r.value;

  // Symptom channel: the athlete's own scale, at its second-worst points.
  const symptom = lowSleepSessions + highSorenessSessions;
  if (symptom < 2) return null;
  // Load channel: a run of consecutive training days, or a week above their own
  // stated frequency. Without one of these there is only a symptom, and a
  // symptom alone is a mood, not a training signal.
  const loadFlag =
    s.longestConsecutiveDays >= TRAINING.overreachingRun.value - 1 ||
    s.sessionsPerWeek.value >= 5;
  if (!loadFlag) return null;

  return {
    ruleId: 'training.recovery.symptoms-and-load',
    periodKey,
    tldr: `${symptom} sessions on poor sleep or high soreness`,
    action: `Keep the session but drop it to RPE ${READINESS.respondLighter.value} — lighter, not cancelled.`,
    body: `Of the ${rated} sessions that recorded a vibe check, ${lowSleepSessions} started on sleep rated 2 or worse and ${highSorenessSessions} on soreness rated 4 or more; your averages are sleep ${round(meanSleep, 1)}, energy ${round(meanEnergy, 1)}, soreness ${round(meanSoreness, 1)} out of 5. Alongside that you trained ${s.longestConsecutiveDays} days in a row. Galpin wants three signals before calling this overreaching — "${TRAINING.overreachingRun.quote.slice(0, 60)}…" is only the load half, and the missing one is a biomarker this app cannot see without a wearable. His response to a bad day is not a cancelled session: "${READINESS.respondLighter.quote}".`,
    drift: round(Math.min(1, symptom / Math.max(1, rated)), 2),
    confidence: 0.45,
    sufficiency: r.sufficiency,
    claims: [READINESS.threeSignals, READINESS.respondLighter],
    observed: {
      lowSleepSessions,
      highSorenessSessions,
      ratedSessions: rated,
      vibeCoverage: round(r.value.coverage, 2),
      meanSleep: round(meanSleep, 1),
      meanEnergy: round(meanEnergy, 1),
      meanSoreness: round(meanSoreness, 1),
      longestConsecutiveDays: s.longestConsecutiveDays,
    },
  };
}

export const TRAINING_RULES = [
  intervalsNotAllOut,
  readinessAndLoad,
  loadedTooLight,
  hypertrophyEffortLow,
  heavyRestTooShort,
  hypertrophyVolumeShort,
  zone2Short,
  intervalOrdering,
  consecutiveDays,
  frequencyBelowTarget,
] as const;
