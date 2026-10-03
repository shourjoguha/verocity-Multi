import { HR, SESSION_SHAPE, type SectionKey } from '@/app.config';
import type { WorkoutLog } from '@/lib/types';

// The session-shape bar: what a session was made of, and how big each part was
// next to the same part in the athlete's other sessions of the same kind.
//
// Width is a block's share of the session's COMPLETED sets. Set counts are the
// one unit every section shares — load is zero for warm-ups and most
// conditioning, and no per-movement time is logged.
//
// Height is relative, never absolute: the block's set count against the
// referencePercentile of that block across sessions with the same first tag.
// Sport and endurance sessions (SESSION_SHAPE.hrTags) instead get one block
// whose height is heart-rate effort, because their set counts are meaningless.

export type ShapeBlockKey = 'warmup' | 'main' | 'accessory' | 'conditioning' | 'cooldown';

export const SHAPE_BLOCKS: readonly ShapeBlockKey[] = [
  'warmup',
  'main',
  'accessory',
  'conditioning',
  'cooldown',
];

// Primary and secondary read as one block: both are the session's main lifting.
const BLOCK_OF: Record<SectionKey, ShapeBlockKey> = {
  warmup: 'warmup',
  primary: 'main',
  secondary: 'main',
  accessory: 'accessory',
  conditioning: 'conditioning',
  cooldown: 'cooldown',
};

export type SessionShape =
  | { kind: 'sets'; blocks: { key: ShapeBlockKey; sets: number; share: number; height: number }[] }
  | { kind: 'hr'; height: number; avg: number; max: number | null }
  | { kind: 'no-hr' };

type Counts = Partial<Record<ShapeBlockKey, number>>;

/** Linear-interpolated percentile of the positive values; null when there are none. */
export function percentile(values: number[], p: number): number | null {
  const s = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function toHeight(ratio: number): number {
  const { minHeight } = SESSION_SHAPE;
  return minHeight + (1 - minHeight) * Math.max(0, Math.min(1, ratio));
}

function groupOf(log: WorkoutLog): string {
  return log.tags[0] ?? log.activity_type ?? '';
}

function isHrGroup(group: string): boolean {
  return (SESSION_SHAPE.hrTags as readonly string[]).includes(group);
}

export function blockCounts(log: WorkoutLog): Counts {
  const counts: Counts = {};
  for (const section of log.data?.sections ?? []) {
    const key = BLOCK_OF[section.key];
    if (!key) continue;
    for (const group of section.groups) {
      for (const item of group.items) {
        const done = item.sets.filter((s) => s.actual?.completed).length;
        if (done > 0) counts[key] = (counts[key] ?? 0) + done;
      }
    }
  }
  return counts;
}

/** Average dominates; a higher max is a slight bonus. Missing max counts as the average. */
export function hrEffort(avg: number, max: number | null): number {
  const { avg: wa, max: wm } = SESSION_SHAPE.hrWeights;
  return wa * avg + wm * (max ?? avg);
}

/**
 * Builds a shape function over one history. Precomputes the per-group
 * references once, so a list of N rows costs one pass over the history.
 */
export function sessionShaper(history: WorkoutLog[]): (log: WorkoutLog) => SessionShape | null {
  const p = SESSION_SHAPE.referencePercentile;

  const perGroup = new Map<string, Record<ShapeBlockKey, number[]>>();
  const efforts: number[] = [];
  let maxSeen = 0;
  for (const log of history) {
    const group = groupOf(log);
    if (isHrGroup(group)) {
      if (log.hr_avg) efforts.push(hrEffort(log.hr_avg, log.hr_max));
    } else {
      const counts = blockCounts(log);
      let lists = perGroup.get(group);
      if (!lists) {
        lists = { warmup: [], main: [], accessory: [], conditioning: [], cooldown: [] };
        perGroup.set(group, lists);
      }
      for (const key of SHAPE_BLOCKS) if (counts[key]) lists[key].push(counts[key]!);
    }
    if (log.hr_max && log.hr_max > maxSeen) maxSeen = log.hr_max;
  }
  const hrFloor = (maxSeen || HR.maxFallback) * SESSION_SHAPE.hrFloorOfMax;
  const hrRef = percentile(efforts, p);
  const blockRefs = new Map<string, Partial<Record<ShapeBlockKey, number | null>>>();

  function blockRef(group: string, key: ShapeBlockKey): number | null {
    let refs = blockRefs.get(group);
    if (!refs) blockRefs.set(group, (refs = {}));
    if (!(key in refs)) refs[key] = percentile(perGroup.get(group)?.[key] ?? [], p);
    return refs[key] ?? null;
  }

  return (log) => {
    const group = groupOf(log);
    if (isHrGroup(group)) {
      if (!log.hr_avg) return { kind: 'no-hr' };
      const effort = hrEffort(log.hr_avg, log.hr_max);
      // No reference above the floor yet (first HR session, or all of them
      // easy): draw at full height rather than divide by nothing.
      const height = hrRef !== null && hrRef > hrFloor ? toHeight((effort - hrFloor) / (hrRef - hrFloor)) : 1;
      return { kind: 'hr', height, avg: log.hr_avg, max: log.hr_max };
    }
    const counts = blockCounts(log);
    const total = SHAPE_BLOCKS.reduce((a, k) => a + (counts[k] ?? 0), 0);
    if (total === 0) return null;
    return {
      kind: 'sets',
      blocks: SHAPE_BLOCKS.filter((k) => counts[k]).map((key) => {
        const sets = counts[key]!;
        const ref = blockRef(group, key);
        return { key, sets, share: sets / total, height: ref ? toHeight(sets / ref) : 1 };
      }),
    };
  };
}
