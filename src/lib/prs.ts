// Personal-record detection from logged history. A set is a PR when its
// estimated 1RM beats the best estimated 1RM ever recorded for that movement
// *before now*. Pure; built from the LogDocument JSONB so it works off the same
// data the Logger already loads (getAllLogs).
import { e1rm } from '@/lib/e1rm';
import type { SetActual, WorkoutLog } from '@/lib/types';

export function e1rmOf(a: Pick<SetActual, 'weight' | 'reps'>): number | null {
  if (a.weight == null || a.reps == null) return null;
  return e1rm(a.weight, a.reps);
}

/** Max estimated 1RM per movement across all completed sets in `logs`. */
export function bestE1rmByMovement(logs: WorkoutLog[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const log of logs) {
    for (const section of log.data?.sections ?? []) {
      for (const group of section.groups ?? []) {
        for (const item of group.items ?? []) {
          for (const set of item.sets ?? []) {
            if (!set.actual?.completed) continue;
            const v = e1rmOf(set.actual);
            if (v == null) continue;
            const cur = best.get(item.movement);
            if (cur == null || v > cur) best.set(item.movement, v);
          }
        }
      }
    }
  }
  return best;
}

/**
 * Whether a completed set is a personal record against `prior` (the pre-session
 * best for its movement). Brand-new movements (no prior) do NOT count as a PR —
 * a first attempt isn't a record to beat.
 */
export function isPrSet(actual: SetActual, prior: number | null | undefined): boolean {
  if (!actual.completed || prior == null) return false;
  const v = e1rmOf(actual);
  return v != null && v > prior;
}
