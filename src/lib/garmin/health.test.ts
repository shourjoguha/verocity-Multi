import { describe, expect, it } from 'vitest';
import {
  hasHealthData,
  latestEntry,
  latestSleepStages,
  metricSeries,
} from '@/lib/garmin/health';
import type { GarminHealthDaily } from '@/lib/types';

// Minimal row builder — only the fields under test, rest nulled.
function row(date: string, p: Partial<GarminHealthDaily>): GarminHealthDaily {
  return {
    id: date,
    owner_user_id: 'u',
    calendar_date: date,
    resting_hr: null,
    avg_hr: null,
    max_hr: null,
    hrv_ms: null,
    stress_avg: null,
    body_battery_high: null,
    body_battery_low: null,
    sleep_seconds: null,
    sleep_score: null,
    deep_sleep_seconds: null,
    rem_sleep_seconds: null,
    light_sleep_seconds: null,
    awake_seconds: null,
    respiration_avg: null,
    spo2_avg: null,
    steps: null,
    calories: null,
    vo2max: null,
    raw: {},
    garmin_updated_at: null,
    created_at: date,
    ...p,
  };
}

const rows = [
  row('2024-09-20', { resting_hr: 50, hrv_ms: 60 }),
  row('2024-09-21', { resting_hr: 48 }), // no hrv this day
  row('2024-09-22', { hrv_ms: 65, sleep_seconds: 27000, deep_sleep_seconds: 6000, rem_sleep_seconds: 9000, light_sleep_seconds: 12000 }),
];

describe('health helpers', () => {
  it('latestEntry returns the most recent non-null, skipping gaps', () => {
    expect(latestEntry(rows, 'resting_hr')).toEqual({ date: '2024-09-21', value: 48 });
    expect(latestEntry(rows, 'hrv_ms')).toEqual({ date: '2024-09-22', value: 65 });
    expect(latestEntry(rows, 'vo2max')).toBeNull();
  });

  it('metricSeries skips days missing the metric', () => {
    expect(metricSeries(rows, 'hrv_ms')).toEqual([
      { date: '2024-09-20', value: 60 },
      { date: '2024-09-22', value: 65 },
    ]);
    expect(metricSeries(rows, 'steps')).toEqual([]);
  });

  it('hasHealthData reflects whether any displayed metric exists', () => {
    expect(hasHealthData(rows)).toBe(true);
    expect(hasHealthData([row('2024-09-23', { stress_avg: 30 })])).toBe(false); // stress alone isn't a snapshot metric
    expect(hasHealthData([])).toBe(false);
  });

  it('latestSleepStages pulls the most recent night with a stage split', () => {
    expect(latestSleepStages(rows)).toEqual({ deep: 6000, rem: 9000, light: 12000 });
    expect(latestSleepStages([row('2024-09-22', { sleep_seconds: 20000 })])).toBeNull(); // slept, no stages
    expect(latestSleepStages([])).toBeNull();
  });
});
