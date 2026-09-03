import { PREFILL, type MetricKey } from '@/app.config';
import type { SetActual, WorkoutLog } from '@/lib/types';
import { parsePlanned } from '@/lib/logBuilder';
import { flattenSets } from '@/lib/stats';
import { e1rm } from '@/lib/e1rm';

// Most recent completed performance for a movement across prior logs, used to
// prefill sets. Logs should be passed newest-first.
//
// `skipLogIds` drops logs that must not be the reference — in practice the
// deload weeks of the active plan. Without it the most recent log wins
// unconditionally, so the week after a deload prefilled the deload's reduced
// load and the programmed step up never happened: week 6 (intensification)
// built on week 5 (deload) instead of on week 4. Skipping deloads makes the
// reference the last week that was actually pushed.
export function lastPerformance(
  logs: WorkoutLog[],
  movement: string,
  skipLogIds?: ReadonlySet<string>,
): SetActual | null {
  const target = movement.toLowerCase();
  for (const log of logs) {
    if (skipLogIds?.has(log.id)) continue;
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

// Re-price a reference load for a different rep target, holding the estimated
// 1RM constant (Brzycki, inverted). This is what turns "the same weight as last
// time" into the week's actual prescription: an intensification week that cuts
// 12s to 5s asks for more load at the same strength, and copying last block's
// weight across silently under-prescribes it.
//
// Deliberately NOT a percentage bump per week — the plan carries no %1RM, so
// any fixed step would be invented. The rep target is real data, and the
// athlete's own last set supplies the strength estimate.
//
// Rounds DOWN to a plate increment, and declines outside PREFILL.maxRefReps
// where the formula stops being trustworthy. Returns null when there is nothing
// defensible to say, in which case the caller keeps the reference weight.
export function repAdjustedWeight(
  weight: number | undefined,
  refReps: number | undefined,
  targetReps: number | null,
): number | null {
  if (!weight || weight <= 0 || !refReps || !targetReps) return null;
  if (refReps === targetReps) return null;
  if (refReps > PREFILL.maxRefReps || targetReps > PREFILL.maxRefReps) return null;
  const est = e1rm(weight, refReps);
  if (est == null) return null;
  const raw = est * (1.0278 - 0.0278 * targetReps);
  const rounded = Math.floor(raw / PREFILL.roundKg) * PREFILL.roundKg;
  return rounded > 0 ? rounded : null;
}
