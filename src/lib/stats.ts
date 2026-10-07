import { MOVEMENT_FAMILIES, PREP_SECTIONS } from '@/app.config';
import type { LogSection, WorkoutLog } from '@/lib/types';

export interface FlatSet {
  movement: string;
  weight?: number;
  reps?: number;
  rpe?: number;
  time?: number;
  distance?: number;
  calories?: number;
  mark?: number;
  completed: boolean;
  notations: string[];
}

const isPrep = (s: LogSection) => (PREP_SECTIONS as readonly string[]).includes(s.key);

/**
 * The sections that count as training load: everything but warm-up and
 * cooldown, UNLESS the session has nothing else — then all of it, because a
 * mobility or yoga session logged as one cooldown block is the work, and
 * dropping it would delete real training. See PREP_SECTIONS.
 *
 * Every volume, work, set-count, e1RM and RPE reader goes through this. Plan
 * adherence, session summaries, export and the logger read the full document.
 */
export function workingSections(log: WorkoutLog): LogSection[] {
  const all = log.data?.sections ?? [];
  const main = all.filter(
    (s) => !isPrep(s) && (s.groups ?? []).some((g) => (g.items ?? []).some((i) => i.kind !== 'subroutine')),
  );
  return main.length > 0 ? all.filter((s) => !isPrep(s)) : all;
}

/** `flattenSets` over `workingSections` — warm-up and cooldown left out. */
export function flattenWorkingSets(log: WorkoutLog): FlatSet[] {
  return flattenSections(workingSections(log));
}

export function flattenSets(log: WorkoutLog): FlatSet[] {
  return flattenSections(log.data?.sections ?? []);
}

function flattenSections(sections: LogSection[]): FlatSet[] {
  return sections.flatMap((section) =>
    section.groups.flatMap((group) =>
      group.items.flatMap((item) =>
        item.sets.map((set) => ({
          movement: item.movement,
          weight: set.actual.weight,
          reps: set.actual.reps,
          rpe: set.actual.rpe,
          time: set.actual.time,
          distance: set.actual.distance,
          mark: set.actual.mark,
          calories: set.actual.calories,
          completed: set.actual.completed,
          notations: set.notations ?? [],
        })),
      ),
    ),
  );
}

// Home's headline tiles count finished sessions only, over the whole history.
// Two reasons this is its own helper rather than an inline filter: landing on
// /app/log calls createLog({ status: 'in_progress' }) immediately, so anything
// looser counts a logger you opened and backed out of — and disagreed with
// currentWeekStreak(), which has always required 'done'. And the tiles used to be
// derived from getRecentLogs(30), which pinned "Sessions" at 30 forever.
export function completedLogs(logs: WorkoutLog[]): WorkoutLog[] {
  return logs.filter((l) => l.status === 'done');
}

// Map a movement name to its family key (substring match), or null.
export function familyOf(name: string): string | null {
  const n = name.toLowerCase();
  for (const [family, names] of Object.entries(MOVEMENT_FAMILIES)) {
    if (names.some((x) => n.includes(x))) return family;
  }
  return null;
}
