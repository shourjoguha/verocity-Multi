// LOAD CHANGE — how the weight on each movement moved since you last did it.
//
// This is the "did I go heavier" read the consistency bar cannot give: the bar
// is work (weight x distance x reps), so heavier-for-fewer-reps can shrink it.
// Here only the load is compared, per movement, against the most recent EARLIER
// session that contained that movement — whatever plan or tag it came from, so
// on a weekly plan it is "same day last week" without knowing about plans.
//
// Load is the mean weight over completed WORKING sets (warm-up and cooldown are
// out, via flattenWorkingSets). Weight is read as logged, so a `/side` set's
// weight is per arm on both sides of the comparison. Bodyweight-only sets carry
// no weight and are skipped: there is no load to move.

import { flattenWorkingSets } from '@/lib/stats';
import { trackName } from '@/lib/notations';
import { formatRound } from '@/lib/format';
import type { WorkoutLog } from '@/lib/types';

export interface LoadChange {
  movement: string;
  /** kg, this session's mean working load minus the previous session's. */
  delta: number;
}

type Entry = { date: string; id: string; mean: number };

/** Mean working load per movement track in one session. */
function meanLoads(log: WorkoutLog): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const s of flattenWorkingSets(log)) {
    if (!s.completed || s.weight == null || s.weight <= 0) continue;
    // A variation is its own line, never a point on the plain lift's.
    const key = trackName(s.movement, s.notations);
    const cur = acc.get(key) ?? { sum: 0, n: 0 };
    cur.sum += s.weight;
    cur.n += 1;
    acc.set(key, cur);
  }
  return new Map([...acc].map(([k, v]) => [k, v.sum / v.n]));
}

/** Every finished session's mean loads, by movement, oldest first. Build once. */
export function buildLoadIndex(logs: WorkoutLog[]): Map<string, Entry[]> {
  const index = new Map<string, Entry[]>();
  const done = logs
    .filter((l) => l.status === 'done')
    .sort((a, b) => a.log_date.localeCompare(b.log_date));
  for (const log of done) {
    for (const [movement, mean] of meanLoads(log)) {
      const list = index.get(movement) ?? [];
      list.push({ date: log.log_date.slice(0, 10), id: log.id, mean });
      index.set(movement, list);
    }
  }
  return index;
}

/**
 * Load change per movement in `log`, largest move first. A movement with no
 * earlier session is left out — a first time has nothing to change from.
 */
export function loadChanges(log: WorkoutLog, index: Map<string, Entry[]>): LoadChange[] {
  const date = log.log_date.slice(0, 10);
  const out: LoadChange[] = [];
  for (const [movement, mean] of meanLoads(log)) {
    const prior = (index.get(movement) ?? []).filter((e) => e.date < date && e.id !== log.id);
    const last = prior[prior.length - 1];
    if (!last) continue;
    out.push({ movement, delta: mean - last.mean });
  }
  return out.sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.movement.localeCompare(b.movement),
  );
}

/** "Front Squat +4 · Snatch +2 · Row = · +1 more", or null when nothing compares. */
export function formatLoadChanges(changes: LoadChange[], max = 3): string | null {
  if (changes.length === 0) return null;
  const shown = changes.slice(0, max).map((c) => {
    const r = Number(formatRound(c.delta, 1));
    const d = r === 0 ? '=' : r > 0 ? `+${r}` : `−${Math.abs(r)}`;
    // Unbreakable inside an item, so a wrapped tooltip breaks only between
    // items and never splits "Iso-lateral Row" at its hyphen.
    return `${c.movement} ${d}`.replace(/ /g, '\u00a0').replace(/-/g, '\u2011');
  });
  const rest = changes.length - max;
  return rest > 0 ? `${shown.join(' · ')} · +${rest} more` : shown.join(' · ');
}
