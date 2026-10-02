import { TRAINING } from '@/lib/coach/knowledge';
import type { LoadStepEntry, LoadStepSignals } from '@/lib/coach/loadStep';
import type { Finding, Measured } from '@/lib/coach/types';
import type { UserStats } from '@/lib/types';

/** Goal weight 0..100, or 0 when the athlete never ranked it. */
function goalWeight(stats: UserStats | null, id: string): number {
  return stats?.goals?.find((g) => g.id === id)?.weight ?? 0;
}

/** The same floor `heavyRestTooShort` and `loadedTooLight` gate on. */
const GOAL_FLOOR = 25;

const fmtLoad = (kg: number) => (kg > 0 ? `${kg} kg` : 'bodyweight');

function line(e: LoadStepEntry): string {
  const { range, last } = e;
  const step = e.step ?? 'the load step in its note';
  const at = `${last.completedSets}×${last.minReps}+ at ${fmtLoad(last.load)}${last.maxRpe != null ? `, RPE ≤${last.maxRpe}` : ''}`;
  return e.state === 'missed'
    ? `${e.movement}: topped ${range.low}–${range.high} twice running (${at}) without the step — take ${step} and restart at ${range.low}.`
    : `${e.movement}: topped ${range.low}–${range.high} last time (${at}) — next session take ${step} and restart at ${range.low}.`;
}

/**
 * Ranged lifts that have earned their load step, or earned it and not taken it.
 *
 * Reads the plan's own double progression (see ../loadStep.ts): the range, the
 * effort cap and the step are all the athlete's prescription. The rule only
 * says when the prescription's condition has been met. A held load BELOW the top
 * of the range is never a finding — Galpin is explicit that progressing every
 * two or three weeks is fine.
 */
export function loadStepDue(
  m: Measured<LoadStepSignals>,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  if (m.sufficiency === 'insufficient') return null;
  if (goalWeight(stats, 'strength') < GOAL_FLOOR && goalWeight(stats, 'hypertrophy') < GOAL_FLOOR) {
    return null;
  }
  const { entries, tracked } = m.value;
  if (entries.length === 0) return null;

  const missed = entries.filter((e) => e.state === 'missed');
  const due = entries.filter((e) => e.state === 'due');
  const lead = missed[0] ?? due[0];
  const others = entries.length - 1;
  const tldr =
    missed.length > 0
      ? `${lead.movement}: load step earned, not taken${others ? ` (+${others})` : ''}`
      : `${lead.movement}: top of range, add load${others ? ` (+${others})` : ''}`;

  return {
    ruleId: 'training.progression.load-step-due',
    periodKey,
    tldr: tldr.length > 60 ? `${tldr.slice(0, 57)}…` : tldr,
    action:
      missed.length > 0
        ? `Take the load step on ${missed.map((e) => e.movement).join(', ')} next session and restart at the bottom of the range.`
        : `Next session, take the load step on ${due.map((e) => e.movement).join(', ')} and restart at the bottom of the range.`,
    body: [
      ...entries.map(line),
      `Your plan progresses these lifts by reps first, then load — Galpin's "${TRAINING.progressiveOverload.quote}" — and he is plain that "${TRAINING.consistentOverload.quote}" A range topped at the effort cap is the plan's own signal that the reps have done their job.`,
      m.sufficiency === 'partial' && m.shortfall ? m.shortfall : '',
    ]
      .filter(Boolean)
      .join(' '),
    drift: Math.min(1, (missed.length + 0.5 * due.length) / tracked),
    confidence: missed.length > 0 ? 0.6 : 0.5,
    sufficiency: m.sufficiency,
    claims: [TRAINING.progressiveOverload, TRAINING.consistentOverload],
    observed: {
      rangedLifts: tracked,
      due: due.length,
      missed: missed.length,
      lifts: entries.map((e) => `${e.movement}:${e.state}`).join('|'),
    },
  };
}
