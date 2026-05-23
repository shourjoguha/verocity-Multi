import type { SetActual, WorkoutLog } from '@/lib/types';
import { flattenSets } from '@/lib/stats';

// Most recent completed performance for a movement across prior logs, used to
// prefill sets. Logs should be passed newest-first.
export function lastPerformance(logs: WorkoutLog[], movement: string): SetActual | null {
  const target = movement.toLowerCase();
  for (const log of logs) {
    const match = flattenSets(log).find(
      (s) => s.movement.toLowerCase() === target && s.completed && s.weight != null,
    );
    if (match) {
      return {
        weight: match.weight,
        reps: match.reps,
        rpe: match.rpe,
        completed: false,
        prefilled: true,
      };
    }
  }
  return null;
}
