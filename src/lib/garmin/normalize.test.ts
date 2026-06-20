import { describe, expect, it } from 'vitest';
import {
  garminActivityTag,
  mergeHealthDaily,
  normalizeActivity,
  normalizeDailySummary,
  normalizeSleep,
  projectActivityToLog,
  type NormalizedHealthDaily,
} from '@/lib/garmin/normalize';

// Fixtures mirror the two real shapes the mappers must tolerate: the raw GDPR
// "Export All Data" export (internal names, cm distance) and the official
// Health/Activity API (explicit *InMeters/*InSeconds names).

const gdprActivity = {
  activityId: 987654321,
  activityType: 'running',
  startTimeGmt: '2024-09-22 06:30:00',
  duration: 1830, // seconds
  distance: 500000, // centimetres → 5000 m
  avgHr: 152,
  maxHr: 176,
  calories: 410,
  avgSpeed: 2.73,
  elevationGain: 42,
  someUnknownField: 'ignored',
};

const officialActivity = {
  summaryId: 'a-42',
  activityType: { typeKey: 'lap_swimming' },
  startTimeInSeconds: 1_700_000_000, // epoch seconds
  durationInSeconds: 2400,
  distanceInMeters: 1500,
  averageHeartRateInBeatsPerMinute: 138,
  maxHeartRateInBeatsPerMinute: 150,
  activeKilocalories: 320,
};

describe('garminActivityTag', () => {
  it('maps explicit Garmin type codes', () => {
    expect(garminActivityTag('running')).toBe('endurance');
    expect(garminActivityTag('strength_training')).toBe('strength');
    expect(garminActivityTag('yoga')).toBe('mobility');
    expect(garminActivityTag('soccer')).toBe('sport');
  });

  it('is case-insensitive', () => {
    expect(garminActivityTag('Lap_Swimming')).toBe('endurance');
  });

  it('falls back to keyword matching for unlisted codes', () => {
    expect(garminActivityTag('virtual_run')).toBe('endurance');
    expect(garminActivityTag('e_bike_mountain')).toBe('endurance');
    expect(garminActivityTag('power_yoga')).toBe('mobility');
  });

  it('defaults to sport for unknown, and for null', () => {
    expect(garminActivityTag('underwater_basket_weaving')).toBe('sport');
    expect(garminActivityTag(null)).toBe('sport');
  });
});

describe('normalizeActivity', () => {
  it('maps the raw GDPR shape, converting cm→m and parsing GMT time', () => {
    const a = normalizeActivity(gdprActivity)!;
    expect(a.provider_activity_id).toBe('987654321');
    expect(a.activity_type).toBe('running');
    expect(a.start_time).toBe('2024-09-22T06:30:00.000Z');
    expect(a.duration_seconds).toBe(1830);
    expect(a.distance_m).toBe(5000);
    expect(a.avg_hr).toBe(152);
    expect(a.max_hr).toBe(176);
    expect(a.calories).toBe(410);
    expect(a.elevation_gain_m).toBe(42);
    expect(a.raw).toBe(gdprActivity); // full payload preserved
  });

  it('maps the official API shape (explicit units, epoch seconds, typeKey)', () => {
    const a = normalizeActivity(officialActivity)!;
    expect(a.provider_activity_id).toBe('a-42');
    expect(a.activity_type).toBe('lap_swimming');
    expect(a.start_time).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(a.duration_seconds).toBe(2400);
    expect(a.distance_m).toBe(1500); // distanceInMeters bypasses the cm factor
    expect(a.avg_hr).toBe(138);
    expect(a.max_hr).toBe(150);
    expect(a.calories).toBe(320);
  });

  it('returns null when there is no stable id', () => {
    expect(normalizeActivity({ activityType: 'running' })).toBeNull();
  });

  it('tolerates missing fields (null, no throw)', () => {
    const a = normalizeActivity({ activityId: 1 })!;
    expect(a.provider_activity_id).toBe('1');
    expect(a.activity_type).toBeNull();
    expect(a.start_time).toBeNull();
    expect(a.distance_m).toBeNull();
    expect(a.avg_hr).toBeNull();
  });
});

describe('normalizeDailySummary', () => {
  it('maps a UDSFile-style daily wellness record', () => {
    const d = normalizeDailySummary({
      calendarDate: '2024-09-22',
      restingHeartRate: 48,
      maxHeartRate: 142,
      totalSteps: 11034,
      totalKilocalories: 2680,
      averageStressLevel: 31,
      bodyBatteryHighestValue: 92,
      bodyBatteryLowestValue: 14,
      averageSpo2: 96,
    })!;
    expect(d.calendar_date).toBe('2024-09-22');
    expect(d.resting_hr).toBe(48);
    expect(d.max_hr).toBe(142);
    expect(d.steps).toBe(11034);
    expect(d.calories).toBe(2680);
    expect(d.stress_avg).toBe(31);
    expect(d.body_battery_high).toBe(92);
    expect(d.body_battery_low).toBe(14);
    expect(d.spo2_avg).toBe(96);
    expect(d.sleep_seconds).toBeNull(); // not a sleep record
  });

  it('returns null when undated', () => {
    expect(normalizeDailySummary({ restingHeartRate: 50 })).toBeNull();
  });
});

describe('normalizeSleep', () => {
  it('maps sleep stages and reads a nested overall score', () => {
    const s = normalizeSleep({
      calendarDate: '2024-09-22',
      deepSleepSeconds: 5400,
      remSleepSeconds: 6300,
      lightSleepSeconds: 12_600,
      awakeSleepSeconds: 900,
      sleepScores: { overall: { value: 82 } },
      avgOvernightHrv: 64,
    })!;
    expect(s.deep_sleep_seconds).toBe(5400);
    expect(s.rem_sleep_seconds).toBe(6300);
    expect(s.light_sleep_seconds).toBe(12_600);
    expect(s.awake_seconds).toBe(900);
    expect(s.sleep_score).toBe(82);
    expect(s.hrv_ms).toBe(64);
    // total derived from the stage sum when sleepTimeSeconds is absent
    expect(s.sleep_seconds).toBe(5400 + 6300 + 12_600);
  });

  it('prefers an explicit sleepTimeSeconds over the stage sum', () => {
    const s = normalizeSleep({
      calendarDate: '2024-09-22',
      deepSleepSeconds: 100,
      sleepTimeSeconds: 28_800,
    })!;
    expect(s.sleep_seconds).toBe(28_800);
  });
});

describe('mergeHealthDaily', () => {
  it('combines a daily summary and a sleep record on the same date', () => {
    const daily = normalizeDailySummary({
      calendarDate: '2024-09-22',
      restingHeartRate: 48,
      totalSteps: 11_034,
    })!;
    const sleep = normalizeSleep({
      calendarDate: '2024-09-22',
      sleepTimeSeconds: 27_000,
      sleepScores: { overall: { value: 82 } },
    })!;
    const merged = mergeHealthDaily([daily, sleep]);
    expect(merged).toHaveLength(1);
    const row = merged[0];
    expect(row.resting_hr).toBe(48);
    expect(row.steps).toBe(11_034);
    expect(row.sleep_seconds).toBe(27_000);
    expect(row.sleep_score).toBe(82);
  });

  it('keeps an existing non-null value and fills only nulls', () => {
    const a: NormalizedHealthDaily = normalizeDailySummary({
      calendarDate: '2024-09-22',
      restingHeartRate: 48,
    })!;
    const b: NormalizedHealthDaily = normalizeDailySummary({
      calendarDate: '2024-09-22',
      restingHeartRate: 99,
      totalSteps: 5000,
    })!;
    const [row] = mergeHealthDaily([a, b]);
    expect(row.resting_hr).toBe(48); // first non-null wins
    expect(row.steps).toBe(5000); // null slot filled
  });

  it('keeps distinct dates separate', () => {
    const d1 = normalizeDailySummary({ calendarDate: '2024-09-22', totalSteps: 1 })!;
    const d2 = normalizeDailySummary({ calendarDate: '2024-09-23', totalSteps: 2 })!;
    expect(mergeHealthDaily([d1, d2])).toHaveLength(2);
  });
});

describe('projectActivityToLog', () => {
  it('projects a normalized activity onto workout_logs columns', () => {
    const activity = normalizeActivity(gdprActivity)!;
    const log = projectActivityToLog(activity)!;
    expect(log.log_date).toBe('2024-09-22');
    expect(log.status).toBe('done');
    expect(log.activity_type).toBe('running');
    expect(log.tags).toEqual(['endurance']);
    expect(log.total_seconds).toBe(1830);
    expect(log.hr_avg).toBe(152);
    expect(log.hr_max).toBe(176);
    expect(log.source).toBe('garmin');
    expect(log.data).toEqual({ sections: [] });
  });

  it('returns null when the activity has no date', () => {
    const activity = normalizeActivity({ activityId: 5 })!;
    expect(projectActivityToLog(activity)).toBeNull();
  });
});
