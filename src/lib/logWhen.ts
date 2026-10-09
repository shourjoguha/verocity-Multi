import type { WorkoutLog } from '@/lib/types';

// When a finished session happened, as the athlete edits it after the fact.
//
// The start time lives in `started_at`, which the Logger stamps when it opens
// and also uses as the stopwatch's anchor and the 2-hour auto-end clock. That is
// why this is only offered on a session that is no longer in progress: moving
// a live session's start to yesterday would trip auto-end within 30 seconds.
//
// The time and date are the athlete's LOCAL wall clock, the same as the meal
// "When" row; `started_at` is stored as UTC.

const pad = (n: number) => String(n).padStart(2, '0');

/** 'HH:MM' of an ISO timestamp in local time, or '' when there is none. */
export function localTimeOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The patch that moves a session to `date` at `time`, keeping its duration:
 * `ended_at` moves by the same amount, or is derived from `total_seconds` when
 * the session never recorded one. An empty `time` moves the date only.
 */
export function retimeLog(
  log: Pick<WorkoutLog, 'started_at' | 'ended_at' | 'total_seconds'>,
  date: string,
  time: string,
): Pick<WorkoutLog, 'log_date'> & Partial<Pick<WorkoutLog, 'started_at' | 'ended_at'>> {
  if (!time) return { log_date: date };
  const start = new Date(`${date}T${time}`);
  const priorStart = log.started_at ? new Date(log.started_at).getTime() : null;
  const priorEnd = log.ended_at ? new Date(log.ended_at).getTime() : null;
  const durationMs =
    priorStart != null && priorEnd != null
      ? priorEnd - priorStart
      : log.total_seconds != null
        ? log.total_seconds * 1000
        : null;
  return {
    log_date: date,
    started_at: start.toISOString(),
    ended_at: durationMs != null ? new Date(start.getTime() + durationMs).toISOString() : log.ended_at,
  };
}
