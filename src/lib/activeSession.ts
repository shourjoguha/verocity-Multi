import { TIMERS } from '@/app.config';
import type { WorkoutLog } from '@/lib/types';

// The single answer to "is a session live right now?".
//
// A session left running survives navigation — you can leave the Logger by its
// Home button, browse the app, and resume from Home. What makes that safe is
// this staleness gate: an `in_progress` row is only offered for resume while it
// is inside the same wall-clock cap the Logger auto-ends at, so a tab closed
// last Tuesday does not have Home shimmering "Resume" forever.
//
// Narrow input, full row out: callers pass whole logs and get one back (they
// need `id` and `day_key`), but only these two fields decide the answer.
// `now` is injectable for the tests only.
type LiveLog = Pick<WorkoutLog, 'status' | 'started_at'>;

export function activeSessionOf<T extends LiveLog>(logs: T[], now: number = Date.now()): T | null {
  let best: T | null = null;
  let bestStart = 0;
  for (const log of logs) {
    if (log.status !== 'in_progress' || !log.started_at) continue;
    const started = new Date(log.started_at).getTime();
    if (Number.isNaN(started)) continue;
    if ((now - started) / 1000 >= TIMERS.maxWorkoutSeconds) continue;
    // Newest wins: starting a second workout is confirmed, not blocked, so more
    // than one can briefly be in progress.
    if (!best || started > bestStart) {
      best = log;
      bestStart = started;
    }
  }
  return best;
}
