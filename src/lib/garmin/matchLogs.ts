// Garmin → app-session matching (the enrichment rule).
//
// The app is the source of truth for WHAT you did; Garmin is the source of
// truth for what your body did while you did it. So a Garmin activity that
// corresponds to a session you already logged must ATTACH to that log rather
// than project a second one — otherwise the same session is counted twice by
// Calendar, Stats and every aspect metric that sums over workout_logs.
//
// This module is the pure decision half: given one normalized activity and the
// candidate logs on its date, decide attach-or-insert and compute the backfill
// patch. The writer (supabase/functions/garmin-ingest) does the I/O and mirrors
// this rule — the `@/` alias cannot cross the Node→Deno boundary, so like the
// request types it is duplicated there by hand and this file is the spec.
//
// BIAS: a wrong attachment is worse than a duplicate. A duplicate is visible
// and deletable; a wrong attach silently rewrites the wrong session's numbers.
// So an ambiguous match inserts instead of guessing.

import type { NormalizedActivity } from '@/lib/garmin/normalize';

// The workout_logs columns the matcher reads. A subset of WorkoutLog, so the
// writer can select only these.
export interface CandidateLog {
  id: string;
  log_date: string;
  started_at: string | null;
  ended_at: string | null;
  source: string;
  garmin_activity_id: string | null;
  total_seconds: number | null;
  hr_avg: number | null;
  hr_max: number | null;
}

// Fill a null column from Garmin; never overwrite a value the user entered.
// The writer adds garmin_activity_id — only it knows the surrogate id, which
// exists just after the activity upsert.
export interface LogBackfill {
  total_seconds?: number;
  hr_avg?: number;
  hr_max?: number;
}

export type MatchDecision =
  | { kind: 'attach'; logId: string; patch: LogBackfill }
  | { kind: 'insert' };

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Seconds of overlap between two half-open intervals, 0 when disjoint. */
function overlapSeconds(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 1000;
}

// A candidate is eligible when it is a manual log that no Garmin activity has
// claimed. Garmin-sourced logs are excluded: those are projections, and linking
// one activity to another's projection would be nonsense.
function eligible(log: CandidateLog, claimed: ReadonlySet<string>): boolean {
  return log.source === 'manual' && log.garmin_activity_id === null && !claimed.has(log.id);
}

/**
 * Decide whether `activity` enriches one of `candidates` or needs its own log.
 *
 * Matching is by TIME OVERLAP where the log has a start (the logger records
 * started_at/ended_at), because a date alone cannot separate a morning run from
 * an evening lift. A log with no start falls back to a same-date match, but
 * only when it is the sole such candidate — two undated logs on one day are
 * ambiguous and get a new row instead of a coin flip.
 *
 * `claimed` carries log ids already taken by earlier activities in the same
 * batch, so two activities never attach to one session.
 */
export function matchActivityToLog(
  activity: NormalizedActivity,
  candidates: CandidateLog[],
  claimed: ReadonlySet<string> = new Set(),
): MatchDecision {
  const startIso = activity.start_time;
  const start = ms(startIso);
  if (startIso === null || start === null) return { kind: 'insert' };
  const end = start + (activity.duration_seconds ?? 0) * 1000;
  const open = candidates.filter((c) => eligible(c, claimed));

  // 1. Best time overlap wins.
  let best: { log: CandidateLog; seconds: number } | null = null;
  for (const log of open) {
    const logStart = ms(log.started_at);
    if (logStart === null) continue;
    // An in-progress or crashed session may have no end; treat it as lasting
    // its recorded duration, or as instantaneous when it has neither.
    const logEnd = ms(log.ended_at) ?? logStart + (log.total_seconds ?? 0) * 1000;
    const seconds = overlapSeconds(start, end, logStart, logEnd);
    if (seconds > 0 && (!best || seconds > best.seconds)) best = { log, seconds };
  }
  if (best) return { kind: 'attach', logId: best.log.id, patch: patchFor(activity, best.log) };

  // 2. Fall back to an unambiguous same-date log with no recorded start.
  const date = startIso.slice(0, 10);
  const undated = open.filter((c) => c.log_date === date && ms(c.started_at) === null);
  if (undated.length === 1) {
    return { kind: 'attach', logId: undated[0].id, patch: patchFor(activity, undated[0]) };
  }

  return { kind: 'insert' };
}

/** Backfill only the columns the user left empty — the app stays authoritative. */
function patchFor(activity: NormalizedActivity, log: CandidateLog): LogBackfill {
  const patch: LogBackfill = {};
  if (log.total_seconds === null && activity.duration_seconds !== null) {
    patch.total_seconds = activity.duration_seconds;
  }
  if (log.hr_avg === null && activity.avg_hr !== null) patch.hr_avg = activity.avg_hr;
  if (log.hr_max === null && activity.max_hr !== null) patch.hr_max = activity.max_hr;
  return patch;
}
