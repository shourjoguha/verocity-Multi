import type { WorkoutLog } from '@/lib/types';
import { ACTIVITY_TAGS, type ActivityTagKey } from '@/app.config';
import { blockCounts } from '@/lib/sessionShape';
import { sessionTagColors } from '@/lib/tags';

// The Log tab reads sessions by DAY: one card per date, one point per date on
// the month chart. A day with one session is that session; a day with several
// sums them, so the card, the chart and its readout always show one number.

/** The month chart's four bands. Warm-up and cool-down share one. */
export const DAY_BANDS = ['warmcool', 'main', 'accessory', 'conditioning'] as const;
export type DayBand = (typeof DAY_BANDS)[number];

export interface DaySummary {
  date: string; // YYYY-MM-DD
  logs: WorkoutLog[]; // in the order given
  bands: Record<DayBand, number>; // completed sets per band
  /** Working sets: prep excluded, unless the day had nothing but prep. */
  sets: number;
  seconds: number;
  colors: string[];
  label: string;
}

function tagLabel(tag: string): string {
  return ACTIVITY_TAGS[tag as ActivityTagKey]?.label ?? tag.charAt(0).toUpperCase() + tag.slice(1);
}

/** "Strength + Mobility" — the day's distinct tags, falling back to activity type. */
export function sessionsLabel(logs: WorkoutLog[]): string {
  const seen = new Set<string>();
  for (const log of logs) {
    const tags = log.tags.length ? log.tags : [log.activity_type ?? 'strength'];
    for (const t of tags) seen.add(tagLabel(t));
  }
  return [...seen].join(' + ');
}

function bandsOf(log: WorkoutLog): Record<DayBand, number> {
  const c = blockCounts(log);
  return {
    warmcool: (c.warmup ?? 0) + (c.cooldown ?? 0),
    main: c.main ?? 0,
    accessory: c.accessory ?? 0,
    conditioning: c.conditioning ?? 0,
  };
}

/**
 * Working sets for one session. Prep is logged, not loaded (PREP_SECTIONS), so
 * it is left out — except for a session that is nothing but prep, which counts
 * in full, the same rule `workingSections` applies.
 */
export function sessionSets(log: WorkoutLog): number {
  const b = bandsOf(log);
  const working = b.main + b.accessory + b.conditioning;
  return working > 0 ? working : b.warmcool;
}

/** Group logs by date, newest day first; within a day, the given order is kept. */
export function summarizeDays(logs: WorkoutLog[]): DaySummary[] {
  const byDate = new Map<string, WorkoutLog[]>();
  for (const log of logs) {
    const key = log.log_date.slice(0, 10);
    const list = byDate.get(key);
    if (list) list.push(log);
    else byDate.set(key, [log]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayLogs]) => {
      const bands: Record<DayBand, number> = { warmcool: 0, main: 0, accessory: 0, conditioning: 0 };
      for (const log of dayLogs) {
        const b = bandsOf(log);
        for (const k of DAY_BANDS) bands[k] += b[k];
      }
      const colors = [...new Set(dayLogs.flatMap((l) => sessionTagColors(l.tags, l.activity_type)))];
      return {
        date,
        logs: dayLogs,
        bands,
        sets: dayLogs.reduce((a, l) => a + sessionSets(l), 0),
        seconds: dayLogs.reduce((a, l) => a + (l.total_seconds ?? 0), 0),
        colors,
        label: sessionsLabel(dayLogs),
      };
    });
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson). Between two points the curve
 * never leaves the range of their values, so a smoothed band never dips below
 * zero or rises above a real session. `xs` must be strictly increasing.
 */
export function monotone(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => ys[0];
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    m.push((ys[i + 1] - ys[i]) / dx[i]);
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] =
      m[i - 1] * m[i] <= 0
        ? 0
        : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = dx[i];
    const s = (x - xs[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * ys[i] +
      (s3 - 2 * s2 + s) * h * t[i] +
      (-2 * s3 + 3 * s2) * ys[i + 1] +
      (s3 - s2) * h * t[i + 1]
    );
  };
}
