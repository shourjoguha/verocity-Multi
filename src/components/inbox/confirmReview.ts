// Confirming a review row outside the editor, and where review goes next
// (§5.4.3, §5.4.5). The pure rules are lib/reviewFlow.ts and lib/sharedLog.ts;
// this sequences them against the query layer.
import { TIMERS } from '@/app.config';
import { createMovement, getMovements, resolveMovement, updateLog } from '@/lib/queries';
import { invalidateLogs, loadAllLogs } from '@/lib/logStore';
import { DEFAULT_PRIMARY_METRIC } from '@/lib/metrics';
import { confirmPatch, nextReviewHref } from '@/lib/reviewFlow';
import { choosePlanDay, sameDayOverlap } from '@/lib/sharedLog';
import { isSubroutine } from '@/lib/subroutine';
import type { LogDocument, Plan, WorkoutLog } from '@/lib/types';

/**
 * Give every movement in `doc` a library row — the same sweep the Logger runs
 * on every way out (persistDocumentMovements), for the one confirm that never
 * opens the Logger. An empty library means the load failed; inserting against
 * it would duplicate the shared rows, so skip.
 */
export async function sweepMovements(doc: LogDocument): Promise<void> {
  const library = await getMovements();
  if (library.length === 0) return;
  for (const section of doc.sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        const name = item.movement?.trim();
        if (!name || isSubroutine(item) || resolveMovement(name, library)) continue;
        const created = await createMovement({
          name,
          category: null,
          primary_metric: item.primaryMetric ?? DEFAULT_PRIMARY_METRIC,
          default_rest_seconds: TIMERS.defaultRestSeconds,
        });
        if (created) library.push(created);
      }
    }
  }
}

/** Confirm as is is only offered when there is no same-day log to resolve —
 *  that case needs the duplicates sheet, which lives in the Logger. */
export function canConfirmAsIs(log: WorkoutLog, myLogs: WorkoutLog[]): boolean {
  return log.status === 'needs_review' && sameDayOverlap(log.data, log.log_date, myLogs, log.id) === null;
}

/**
 * Confirm as is: `done`, the document untouched, attached to my active plan
 * when choosePlanDay says so (the same chooser the bulk path and the Logger's
 * Counts-toward preselect use).
 */
export async function confirmAsIs(log: WorkoutLog, plan: Plan | null, myLogs: WorkoutLog[]): Promise<boolean> {
  const others = myLogs.filter((l) => l.id !== log.id);
  const link = choosePlanDay({ doc: log.data, logDate: log.log_date, plan, logs: others });
  const ok = await updateLog(log.id, confirmPatch(link));
  if (!ok) return false;
  await sweepMovements(log.data);
  return true;
}

/** Where review goes after `current` is confirmed or discarded, read fresh. */
export async function nextReviewAfter(queue: string[], current: string): Promise<string> {
  if (queue.length === 0) return '/app/inbox';
  invalidateLogs();
  const logs = await loadAllLogs();
  return nextReviewHref(queue, current, new Map(logs.map((l) => [l.id, l])));
}
