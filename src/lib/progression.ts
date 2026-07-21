import type { ParsedPlan, WorkoutLog } from '@/lib/types';

// Program weeks are driven by logging progress, not the calendar: the Nth logged
// session of a given plan day is program week N. Everything here derives from a
// plan's non-cancelled logs, so it needs no stored cursor and self-heals when a
// log's stored week_number is stale.

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

// A plan's non-cancelled logs for one day, in logged order (log_date, then
// created_at as a stable tiebreak within a day).
function orderedDayLogs(logs: WorkoutLog[], planId: string, dayKey: string): WorkoutLog[] {
  return logs
    .filter((l) => l.plan_id === planId && l.day_key === dayKey && l.status !== 'cancelled')
    .sort((a, b) =>
      a.log_date === b.log_date
        ? a.created_at.localeCompare(b.created_at)
        : a.log_date.localeCompare(b.log_date),
    );
}

// The week to stamp on the NEXT log of a plan day: one past however many times
// that day has already been logged, clamped to the plan's week count.
export function nextWeekForDay(
  logs: WorkoutLog[],
  planId: string,
  dayKey: string,
  maxWeek: number,
): number {
  const prior = logs.filter(
    (l) => l.plan_id === planId && l.day_key === dayKey && l.status !== 'cancelled',
  ).length;
  return Math.min(Math.max(1, prior + 1), maxWeek);
}

// Cycle week for every non-cancelled log of a plan, keyed by log id: within each
// day key, the 1st log is week 1, the 2nd is week 2, ... clamped to maxWeek. Used
// to overlay actuals onto the plan grid regardless of any stored week_number.
export function planWeekByLog(
  planId: string,
  logs: WorkoutLog[],
  maxWeek: number,
): Map<string, number> {
  const byLog = new Map<string, number>();
  const dayKeys = new Set(
    logs.filter((l) => l.plan_id === planId && l.day_key).map((l) => l.day_key as string),
  );
  for (const dayKey of dayKeys) {
    orderedDayLogs(logs, planId, dayKey).forEach((log, i) => {
      byLog.set(log.id, Math.min(i + 1, maxWeek));
    });
  }
  return byLog;
}

// The furthest cycle the athlete has reached across all days (min 1) — the
// "current week" shown on the dashboard and used for the coach's block lookup.
export function currentProgramWeek(planId: string, logs: WorkoutLog[], maxWeek: number): number {
  const dayKeys = new Set(
    logs.filter((l) => l.plan_id === planId && l.day_key).map((l) => l.day_key as string),
  );
  let furthest = 1;
  for (const dayKey of dayKeys) {
    furthest = Math.max(
      furthest,
      logs.filter(
        (l) => l.plan_id === planId && l.day_key === dayKey && l.status !== 'cancelled',
      ).length,
    );
  }
  return Math.min(Math.max(1, furthest), maxWeek);
}
