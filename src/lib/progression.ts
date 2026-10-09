import type { BlockKey } from '@/app.config';
import type { ParsedPlan, PlanBlock, WorkoutLog } from '@/lib/types';

// Program weeks are driven by logging progress, not the calendar. A CYCLE is one
// pass through the plan's days: it closes the moment a day already logged in it
// comes up again, and that log opens the next cycle. Every log takes the cycle
// it fell in as its program week, so all days share one counter — a skipped day
// is a miss in that cycle, not a day that lags behind the others and reaches
// its deload weeks after them. (Per-day counters did exactly that: in a real
// block the upper day reached cycle 9 while the full-body day sat at 5.)
//
// Everything here derives from a plan's non-cancelled logs, so it needs no
// stored cursor and self-heals when a log's stored week_number is stale.

// The plan's programmed week count — the max across block ranges and every
// exercise's planned-by-week keys (min 1). Weeks aren't a top-level field.
export function planWeekCount(parsed: ParsedPlan): number {
  return Math.max(
    1,
    ...parsed.blocks.map((b) => b.endWeek),
    ...parsed.days.flatMap((d) =>
      d.exercises.flatMap((e) => Object.keys(e.plannedByWeek).map(Number)),
    ),
  );
}

export interface PlanCycles {
  /** Cycle each non-cancelled plan log fell in, keyed by log id. Unclamped. */
  cycleByLog: Map<string, number>;
  /** The cycle in progress (1 with no logs). Unclamped: past the plan's end
   *  once a day repeats in its final cycle. */
  current: number;
  /** Day keys already logged in the current cycle. */
  loggedInCurrent: Set<string>;
}

// Walk a plan's non-cancelled logs in logged order (log_date, then created_at as
// a stable tiebreak within a day), opening a new cycle whenever a day repeats.
export function planCycles(planId: string, logs: WorkoutLog[]): PlanCycles {
  const ordered = logs
    .filter((l) => l.plan_id === planId && l.day_key && l.status !== 'cancelled')
    .sort((a, b) =>
      a.log_date === b.log_date
        ? a.created_at.localeCompare(b.created_at)
        : a.log_date.localeCompare(b.log_date),
    );
  const cycleByLog = new Map<string, number>();
  let current = 1;
  let loggedInCurrent = new Set<string>();
  for (const log of ordered) {
    const dayKey = log.day_key as string;
    if (loggedInCurrent.has(dayKey)) {
      current += 1;
      loggedInCurrent = new Set();
    }
    loggedInCurrent.add(dayKey);
    cycleByLog.set(log.id, current);
  }
  return { cycleByLog, current, loggedInCurrent };
}

// The cycle a plan day's NEXT log will fall in, unclamped: the current cycle,
// or the one after it when this day has already been logged in it.
function nextCycleForDay(cycles: PlanCycles, dayKey: string): number {
  return cycles.loggedInCurrent.has(dayKey) ? cycles.current + 1 : cycles.current;
}

// The week to stamp on the NEXT log of a plan day, clamped to the plan's week
// count.
export function nextWeekForDay(
  logs: WorkoutLog[],
  planId: string,
  dayKey: string,
  maxWeek: number,
): number {
  return Math.min(nextCycleForDay(planCycles(planId, logs), dayKey), maxWeek);
}

// Where one plan day stands: the cycle its next log falls in (unclamped, so
// `next > maxWeek` means the day is finished) and how many closed cycles went by
// without it.
export function dayCycleStatus(
  logs: WorkoutLog[],
  planId: string,
  dayKey: string,
  maxWeek: number,
): { next: number; missed: number } {
  const cycles = planCycles(planId, logs);
  const hit = new Set<number>();
  for (const log of logs) {
    const c = cycles.cycleByLog.get(log.id);
    if (c != null && log.day_key === dayKey) hit.add(c);
  }
  const closed = Math.min(cycles.current - 1, maxWeek);
  let missed = 0;
  for (let c = 1; c <= closed; c += 1) if (!hit.has(c)) missed += 1;
  return { next: nextCycleForDay(cycles, dayKey), missed };
}

// Cycle week for every non-cancelled log of a plan, keyed by log id, clamped to
// maxWeek. Used to overlay actuals onto the plan grid regardless of any stored
// week_number.
export function planWeekByLog(
  planId: string,
  logs: WorkoutLog[],
  maxWeek: number,
): Map<string, number> {
  const byLog = new Map<string, number>();
  for (const [id, c] of planCycles(planId, logs).cycleByLog) byLog.set(id, Math.min(c, maxWeek));
  return byLog;
}

// The cycle in progress (min 1) — the "current week" shown on the dashboard and
// used for the coach's block lookup.
export function currentProgramWeek(planId: string, logs: WorkoutLog[], maxWeek: number): number {
  return Math.min(planCycles(planId, logs).current, maxWeek);
}

// The block covering a program week, or null when no block spans it.
export function blockForWeek(blocks: PlanBlock[], week: number): BlockKey | null {
  return blocks.find((b) => week >= b.startWeek && week <= b.endWeek)?.type ?? null;
}
