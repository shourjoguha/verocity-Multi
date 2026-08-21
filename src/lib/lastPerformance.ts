import type { MetricKey } from '@/app.config';
import type { SetActual, WorkoutLog } from '@/lib/types';
import { parsePlanned } from '@/lib/logBuilder';
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

// Reps the PRESCRIPTION asks for, read off a per-set planned label ("12",
// "10/side", "3x12 R7"). Load-bearing for prefill: `lastPerformance` copies
// last session's reps, and if that number outranks the target on screen the
// programmed increase never lands — a plan that went 12 → 15 → 18 was logged
// as 12, 12, 12 for a month because the prefill kept winning. The target is
// what the athlete is meant to read, so it takes precedence and last session's
// reps become the fallback for movements with no rep prescription.
//
// `metric` gates the read: on a time or distance movement the leading number
// is seconds or metres (a 360s mobility flow, a 40m carry), and prefilling
// that as reps would be nonsense.
export function plannedReps(label: string | null, metric: MetricKey): number | null {
  if (!label || (metric !== 'weight' && metric !== 'reps')) return null;
  // Legacy labels kept the whole "3x12 R7" form; parsePlanned strips the count
  // so both that and a bare "12" land on the rep number.
  const m = parsePlanned(label).label.match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}
