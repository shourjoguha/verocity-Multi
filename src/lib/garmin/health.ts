// Garmin recovery/health read helpers — pure (plan §6, §7). Turn the dated
// garmin_health_daily rows (ascending by calendar_date) into the snapshot +
// trend shapes the recovery surface renders. No I/O, no formatting beyond
// numbers — the component handles display. Days missing a metric are skipped
// rather than zero-filled, so a sparse export doesn't draw phantom zeros.
import type { GarminHealthDaily } from '@/lib/types';

// The numeric daily-health fields the recovery surface trends or snapshots.
export type HealthMetricKey =
  | 'resting_hr'
  | 'hrv_ms'
  | 'sleep_seconds'
  | 'sleep_score'
  | 'body_battery_high'
  | 'vo2max'
  | 'steps'
  | 'stress_avg'
  | 'deep_sleep_seconds'
  | 'rem_sleep_seconds'
  | 'light_sleep_seconds';

export interface HealthPoint {
  date: string;
  value: number;
}

/** Most recent entry carrying a non-null value for `key` (rows ascending). */
export function latestEntry(rows: GarminHealthDaily[], key: HealthMetricKey): HealthPoint | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key];
    if (typeof v === 'number') return { date: rows[i].calendar_date, value: v };
  }
  return null;
}

/** Chronological {date,value} series, skipping days missing this metric. */
export function metricSeries(rows: GarminHealthDaily[], key: HealthMetricKey): HealthPoint[] {
  const out: HealthPoint[] = [];
  for (const r of rows) {
    const v = r[key];
    if (typeof v === 'number') out.push({ date: r.calendar_date, value: v });
  }
  return out;
}

/** Whether any displayed metric is present at all — gates the section's visibility. */
export function hasHealthData(rows: GarminHealthDaily[]): boolean {
  return rows.some(
    (r) =>
      r.resting_hr !== null ||
      r.hrv_ms !== null ||
      r.sleep_seconds !== null ||
      r.body_battery_high !== null ||
      r.vo2max !== null ||
      r.steps !== null,
  );
}

/** Latest night's sleep stage split, when the most recent slept day has stages. */
export function latestSleepStages(
  rows: GarminHealthDaily[],
): { deep: number; rem: number; light: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.sleep_seconds === null) continue;
    const deep = r.deep_sleep_seconds ?? 0;
    const rem = r.rem_sleep_seconds ?? 0;
    const light = r.light_sleep_seconds ?? 0;
    if (deep + rem + light > 0) return { deep, rem, light };
    return null;
  }
  return null;
}
