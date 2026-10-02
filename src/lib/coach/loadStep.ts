// Where each ranged lift sits in its own double progression.
//
// A plan that writes a lift as "4x10-12 RPE8" is saying: hold the load, add reps
// until every set reaches the top of the range at that effort or less, then take
// the load step and restart at the bottom. The plan states the rule; this module
// reads the athlete's logs against it.
//
// NOTHING HERE IS A THRESHOLD OF ITS OWN. The range and the set count come from
// the plan's label, the effort cap from the label's RPE (falling back to the
// athlete's own RPE_LADDER.nearFailure), and the load step from the exercise's
// own cycle note ("... then +2.5 kg and restart at 10"). A lift whose label has
// no range ("8x20 RPE8", "3x3") is not a double progression and is never read.
//
// DELOAD SESSIONS ARE INVISIBLE. A deload is lighter on purpose; comparing the
// session after it to the deload would call every return to normal load a jump,
// and comparing the deload to the session before would call it a missed step.
//
// Weeks come from `planWeekByLog`, not the stored week_number, for the same
// reason the Logger uses it: the Nth logged session of a day is program week N.

import { RPE_LADDER } from '@/app.config';
import { parsePlanned } from '@/lib/logBuilder';
import { normalizeMovementName } from '@/lib/movementTaxonomy';
import { blockForWeek, planWeekByLog, planWeekCount } from '@/lib/progression';
import type { Measured } from '@/lib/coach/types';
import type { LogItem, Plan, PlanExercise, WorkoutLog } from '@/lib/types';

export interface RepRange {
  sets: number;
  low: number;
  high: number;
  /** Highest RPE at which a top-of-range set counts as earned. */
  rpeCap: number;
}

/** One logged session of a ranged lift, reduced to what the rule needs. */
export interface RangedSession {
  logDate: string;
  week: number;
  /** Heaviest completed set; 0 for unloaded work. */
  load: number;
  /** Fewest reps across completed sets. */
  minReps: number;
  maxRpe: number | null;
  completedSets: number;
  /** Every prescribed set done, each at the top of the range, none above the cap. */
  toppedOut: boolean;
}

export type LoadStepState =
  /** Last session topped the range: the next one takes the step. */
  | 'due'
  /** The session before topped the range; the last one held load and topped it again. */
  | 'missed';

export interface LoadStepEntry {
  movement: string;
  range: RepRange;
  /** The plan's own wording for the step ("+2.5 kg"), when its note states one. */
  step: string | null;
  state: LoadStepState;
  last: RangedSession;
  previous: RangedSession | null;
}

export interface LoadStepSignals {
  /** Ranged lifts with at least one non-deload session on this plan. */
  tracked: number;
  entries: LoadStepEntry[];
}

/** Sessions on a ranged lift below which the rule stays quiet. One is enough
 *  for `due`; `missed` needs two by construction. */
const MIN_TRACKED_FOR_OK = 3;

/** "3-5 RPE8", "8-12/side RPE8" → the range; anything without "a-b" → null. */
export function parseRepRange(planned: string): RepRange | null {
  const { count, label } = parsePlanned(planned);
  const m = label.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return null;
  const low = parseInt(m[1], 10);
  const high = parseInt(m[2], 10);
  if (!(low > 0 && high > low)) return null;
  const rpe = label.match(/RPE\s*(\d+(?:\.\d+)?)/i);
  return { sets: count, low, high, rpeCap: rpe ? Number(rpe[1]) : RPE_LADDER.nearFailure };
}

/** The step the plan names in its cycle note: "... then +5 kg and restart at 3". */
export function parseLoadStep(note: string | undefined): string | null {
  const m = note?.match(/then\s+(.+?)\s+and restart/i);
  return m ? m[1].trim() : null;
}

/** The exercise's range, read from its most common ranged label. */
function rangeOf(ex: PlanExercise): RepRange | null {
  const counts = new Map<string, number>();
  for (const v of Object.values(ex.plannedByWeek)) {
    if (parseRepRange(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [v, n] of counts) if (best == null || n > (counts.get(best) ?? 0)) best = v;
  return best ? parseRepRange(best) : null;
}

function stepOf(ex: PlanExercise): string | null {
  for (const note of Object.values(ex.notesByWeek ?? {})) {
    const step = parseLoadStep(note);
    if (step) return step;
  }
  return null;
}

function findItem(log: WorkoutLog, name: string): LogItem | null {
  for (const section of log.data?.sections ?? []) {
    for (const group of section.groups) {
      for (const item of group.items) {
        if (normalizeMovementName(item.movement) === name) return item;
      }
    }
  }
  return null;
}

export function summarize(
  item: LogItem,
  range: RepRange,
  logDate: string,
  week: number,
): RangedSession | null {
  const done = item.sets.filter((s) => s.actual.completed && s.actual.reps != null);
  if (done.length === 0) return null;
  const reps = done.map((s) => s.actual.reps as number);
  const rpes = done.map((s) => s.actual.rpe).filter((r): r is number => r != null);
  const maxRpe = rpes.length ? Math.max(...rpes) : null;
  const minReps = Math.min(...reps);
  return {
    logDate,
    week,
    load: Math.max(...done.map((s) => s.actual.weight ?? 0)),
    minReps,
    maxRpe,
    completedSets: done.length,
    toppedOut:
      done.length >= range.sets && minReps >= range.high && (maxRpe == null || maxRpe <= range.rpeCap),
  };
}

export function measureLoadSteps(
  logs: WorkoutLog[],
  plan: Plan | null | undefined,
  today: Date,
): Measured<LoadStepSignals> {
  const empty: Measured<LoadStepSignals> = {
    value: { tracked: 0, entries: [] },
    samples: 0,
    sufficiency: 'insufficient',
    shortfall: 'No plan lift written as a rep range has been logged yet.',
  };
  if (!plan?.parsed?.days) return empty;

  const cutoff = today.toISOString().slice(0, 10);
  const planLogs = logs.filter(
    (l) => l.plan_id === plan.id && l.status === 'done' && l.log_date.slice(0, 10) <= cutoff,
  );
  const weekByLog = planWeekByLog(plan.id, planLogs, planWeekCount(plan.parsed));

  let tracked = 0;
  const entries: LoadStepEntry[] = [];
  for (const day of plan.parsed.days) {
    const dayLogs = planLogs
      .filter((l) => l.day_key === day.dayKey)
      .sort((a, b) =>
        a.log_date === b.log_date
          ? a.created_at.localeCompare(b.created_at)
          : a.log_date.localeCompare(b.log_date),
      );
    for (const ex of day.exercises) {
      const range = rangeOf(ex);
      if (!range) continue;
      const name = normalizeMovementName(ex.movement);
      const sessions: RangedSession[] = [];
      for (const log of dayLogs) {
        const week = weekByLog.get(log.id) ?? 1;
        if (blockForWeek(plan.parsed.blocks, week) === 'deload') continue;
        const item = findItem(log, name);
        const s = item ? summarize(item, range, log.log_date.slice(0, 10), week) : null;
        if (s) sessions.push(s);
      }
      if (sessions.length === 0) continue;
      tracked++;
      const last = sessions[sessions.length - 1];
      const previous = sessions.length > 1 ? sessions[sessions.length - 2] : null;
      // Held load AND still at the top of the range. A drop back in reps at the
      // same load is how a harder variant (a pause, a long lever) reads in the
      // log, and it is also how a bad day reads — neither is a missed step.
      const missed =
        previous != null &&
        previous.toppedOut &&
        last.load <= previous.load &&
        last.minReps >= range.high;
      const state: LoadStepState | null = missed ? 'missed' : last.toppedOut ? 'due' : null;
      if (state) entries.push({ movement: ex.movement, range, step: stepOf(ex), state, last, previous });
    }
  }

  if (tracked === 0) return empty;
  return {
    value: { tracked, entries },
    samples: tracked,
    sufficiency: tracked >= MIN_TRACKED_FOR_OK ? 'ok' : 'partial',
    shortfall:
      tracked >= MIN_TRACKED_FOR_OK
        ? undefined
        : `Only ${tracked} ranged lift${tracked === 1 ? '' : 's'} logged on this plan so far.`,
  };
}
