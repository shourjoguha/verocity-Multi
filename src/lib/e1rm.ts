// Estimated 1-rep max (Brzycki). Returns null when inputs can't yield an estimate.
export function e1rm(weight: number, reps: number): number | null {
  if (!weight || reps < 1 || reps >= 37) return null;
  if (reps === 1) return weight;
  return weight / (1.0278 - 0.0278 * reps);
}

// Best e1RM across a set list (used for "top e1RM" rollups).
export function bestE1rm(sets: { weight?: number; reps?: number }[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (s.weight == null || s.reps == null) continue;
    const est = e1rm(s.weight, s.reps);
    if (est != null && (best == null || est > best)) best = est;
  }
  return best;
}
