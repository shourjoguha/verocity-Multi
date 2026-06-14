import type { AspectScores } from '@/lib/types';
import type { WorkoutLog } from '@/lib/types';
import { ASPECT_SCALE } from '@/app.config';
import { flattenSets } from '@/lib/stats';
import { e1rm } from '@/lib/e1rm';

const clampScore = (n: number) =>
  Math.min(ASPECT_SCALE.max, Math.max(ASPECT_SCALE.min, Math.round(n)));

// Hybrid spider chart: compute a *suggested* 1–10 for the axes we can defend
// from logged data. These seed the check-in and are fully overridable; the
// non-derivable axes (power, mobility) are left for the user to rate. Heuristics
// are deliberately simple — they're a starting point, not a verdict.
export function computeAspectSuggestions(logs: WorkoutLog[]): AspectScores {
  const out: AspectScores = {};
  if (logs.length === 0) return out;

  // Consistency: set-completion adherence across the window.
  let total = 0;
  let done = 0;
  for (const l of logs) {
    for (const s of flattenSets(l)) {
      total += 1;
      if (s.completed) done += 1;
    }
  }
  if (total > 0) out.consistency = clampScore((done / total) * ASPECT_SCALE.max);

  // Recovery: average vibe — sleep + energy + inverted soreness, on 1–5 → 1–10.
  const vibes = logs.map((l) => l.data?.session?.vibe).filter((v): v is NonNullable<typeof v> => !!v);
  if (vibes.length > 0) {
    const avg =
      vibes.reduce((a, v) => a + (v.sleep + v.energy + (6 - v.soreness)) / 3, 0) / vibes.length;
    out.recovery = clampScore(((avg - 1) / 4) * 9 + 1);
  }

  // Endurance: conditioning frequency + sessions with heart-rate captured.
  // ~12 such sessions in the window reads as a 10.
  const conditioningSessions = logs.filter((l) =>
    (l.data?.sections ?? []).some((s) => s.key === 'conditioning' && s.groups.some((g) => g.items.length > 0)),
  ).length;
  const hrSessions = logs.filter((l) => l.hr_avg != null).length;
  if (conditioningSessions > 0 || hrSessions > 0) {
    out.endurance = clampScore(((conditioningSessions + hrSessions) / 12) * ASPECT_SCALE.max + 1);
  }

  // Strength: best e1RM trend, first half vs second half of the window. A ~5%
  // improvement nudges roughly +1; flat sits near the middle of the scale.
  const sorted = [...logs].sort((a, b) => a.log_date.localeCompare(b.log_date));
  const midDate = sorted[Math.floor(sorted.length / 2)]?.log_date ?? '';
  const bestE1rm = (subset: WorkoutLog[]) => {
    let best = 0;
    for (const l of subset) {
      for (const s of flattenSets(l)) {
        if (s.weight == null || s.reps == null) continue;
        const est = e1rm(s.weight, s.reps);
        if (est != null) best = Math.max(best, est);
      }
    }
    return best;
  };
  const b1 = bestE1rm(sorted.filter((l) => l.log_date < midDate));
  const b2 = bestE1rm(sorted.filter((l) => l.log_date >= midDate));
  if (b1 > 0 && b2 > 0) {
    const ratio = b2 / b1; // > 1 = improving
    out.strength = clampScore(5 + (ratio - 1) * 20);
  }

  return out;
}
