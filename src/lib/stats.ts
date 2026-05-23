import { MOVEMENT_FAMILIES } from '@/app.config';
import type { WorkoutLog } from '@/lib/types';

export interface FlatSet {
  movement: string;
  weight?: number;
  reps?: number;
  rpe?: number;
  completed: boolean;
}

export function flattenSets(log: WorkoutLog): FlatSet[] {
  return (log.data?.sections ?? []).flatMap((section) =>
    section.groups.flatMap((group) =>
      group.items.flatMap((item) =>
        item.sets.map((set) => ({
          movement: item.movement,
          weight: set.actual.weight,
          reps: set.actual.reps,
          rpe: set.actual.rpe,
          completed: set.actual.completed,
        })),
      ),
    ),
  );
}

// Total tonnage (sum of weight × reps) for a session.
export function sessionVolume(log: WorkoutLog): number {
  return flattenSets(log).reduce((acc, s) => acc + (s.weight ?? 0) * (s.reps ?? 0), 0);
}

// Map a movement name to its family key (substring match), or null.
export function familyOf(name: string): string | null {
  const n = name.toLowerCase();
  for (const [family, names] of Object.entries(MOVEMENT_FAMILIES)) {
    if (names.some((x) => n.includes(x))) return family;
  }
  return null;
}
