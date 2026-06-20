// Garmin normalization — pure, source-agnostic mappers (plan §5, §14).
//
// Every ingestion source (the GDPR "Export All Data" ZIP, the unofficial daily
// client, and the eventual official Health/Activity API) hands raw JSON to these
// functions, which map it onto the normalized table shapes (garmin_activities,
// garmin_health_daily) and the workout_logs projection. The mappers are
// deliberately TOLERANT and ADDITIVE: unknown fields are ignored (the full raw
// payload is stored alongside), missing fields become null, and field names are
// resolved through alias lists so the same mapper handles both the raw GDPR
// export names (e.g. `distance`, `duration`) and the official API's explicit
// names (e.g. `distanceInMeters`, `durationInSeconds`).
//
// UNIT ASSUMPTIONS: the raw GDPR export uses internal Garmin units that differ
// from the official API. Those conversions are isolated in GDPR_UNITS below so a
// single edit corrects them once a real export is inspected (plan: "verify on
// first export — it's messy").

import { GARMIN_ACTIVITY_TAG_MAP, GARMIN_DEFAULT_TAG } from '@/app.config';
import type { ActivityTagKey } from '@/app.config';
import type { LogDocument } from '@/lib/types';

export type RawRecord = Record<string, unknown>;

// Raw GDPR-export unit conversions (vs the official API's *InMeters/*InSeconds).
const GDPR_UNITS = {
  // summarizedActivities `distance` is centimetres; the official
  // `distanceInMeters` is already metres and bypasses this.
  distanceCmToM: 0.01,
} as const;

// ---- normalized output shapes (the columns the mappers fill; owner_user_id and
// surrogate ids are added by the writer) ----

export interface NormalizedActivity {
  provider_activity_id: string;
  activity_type: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  avg_speed: number | null;
  elevation_gain_m: number | null;
  garmin_updated_at: string | null;
  raw: RawRecord;
}

export interface NormalizedHealthDaily {
  calendar_date: string;
  resting_hr: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  hrv_ms: number | null;
  stress_avg: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  sleep_seconds: number | null;
  sleep_score: number | null;
  deep_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  awake_seconds: number | null;
  respiration_avg: number | null;
  spo2_avg: number | null;
  steps: number | null;
  calories: number | null;
  vo2max: number | null;
  garmin_updated_at: string | null;
  raw: RawRecord;
}

// The numeric metric columns of a daily row, used by the by-date merge.
const DAILY_METRIC_KEYS = [
  'resting_hr',
  'avg_hr',
  'max_hr',
  'hrv_ms',
  'stress_avg',
  'body_battery_high',
  'body_battery_low',
  'sleep_seconds',
  'sleep_score',
  'deep_sleep_seconds',
  'rem_sleep_seconds',
  'light_sleep_seconds',
  'awake_seconds',
  'respiration_avg',
  'spo2_avg',
  'steps',
  'calories',
  'vo2max',
] as const satisfies readonly (keyof NormalizedHealthDaily)[];

// ---- primitive helpers ----

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function firstNum(obj: RawRecord, keys: string[]): number | null {
  for (const k of keys) {
    const n = num(obj[k]);
    if (n !== null) return n;
  }
  return null;
}

function firstStr(obj: RawRecord, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

const round = (v: number | null): number | null => (v === null ? null : Math.round(v));

// ---- field extraction ----

function calendarDateOf(obj: RawRecord): string | null {
  const d = obj.calendarDate ?? obj.calendar_date;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return null;
}

function startTimeOf(obj: RawRecord): string | null {
  const secs = num(obj.startTimeInSeconds);
  if (secs !== null) return new Date(secs * 1000).toISOString();
  const beginMs = num(obj.beginTimestamp);
  if (beginMs !== null) return new Date(beginMs).toISOString();
  const gmt = obj.startTimeGmt ?? obj.startTimeGMT;
  if (typeof gmt === 'string' && gmt.trim() !== '') {
    const t = gmt.includes('T') ? gmt : gmt.replace(' ', 'T');
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function activityTypeOf(obj: RawRecord): string | null {
  const t = obj.activityType;
  if (typeof t === 'string' && t.trim() !== '') return t.trim();
  if (t && typeof t === 'object') {
    const key = (t as RawRecord).typeKey;
    if (typeof key === 'string' && key.trim() !== '') return key.trim();
  }
  return firstStr(obj, ['activityTypeKey']);
}

function sleepScoreOf(obj: RawRecord): number | null {
  const direct = firstNum(obj, ['overallSleepScore', 'sleepScore']);
  if (direct !== null) return direct;
  const scores = obj.sleepScores;
  if (scores && typeof scores === 'object') {
    const overall = (scores as RawRecord).overall;
    if (overall && typeof overall === 'object') return num((overall as RawRecord).value);
  }
  return null;
}

// ---- activity ----

/** Map the Garmin activity-type code to one of our five activity tags. */
export function garminActivityTag(type: string | null): ActivityTagKey {
  if (!type) return GARMIN_DEFAULT_TAG;
  const key = type.toLowerCase().trim();
  const mapped = GARMIN_ACTIVITY_TAG_MAP[key];
  if (mapped) return mapped;
  // Keyword fallback for codes not in the explicit map.
  const keywords: [string, ActivityTagKey][] = [
    ['run', 'endurance'],
    ['bik', 'endurance'],
    ['cycl', 'endurance'],
    ['swim', 'endurance'],
    ['walk', 'endurance'],
    ['hik', 'endurance'],
    ['row', 'endurance'],
    ['ellipt', 'endurance'],
    ['cardio', 'endurance'],
    ['strength', 'strength'],
    ['climb', 'strength'],
    ['yoga', 'mobility'],
    ['pilates', 'mobility'],
    ['stretch', 'mobility'],
    ['mobility', 'mobility'],
    ['breath', 'recovery'],
    ['meditat', 'recovery'],
  ];
  for (const [needle, tag] of keywords) if (key.includes(needle)) return tag;
  return GARMIN_DEFAULT_TAG;
}

/** Normalize one raw activity. Returns null when it has no stable id. */
export function normalizeActivity(raw: RawRecord): NormalizedActivity | null {
  const id = firstStr(raw, ['activityId', 'summaryId', 'activityUuid', 'uuid']);
  if (!id) return null;

  const metres = firstNum(raw, ['distanceInMeters']);
  const rawDistance = firstNum(raw, ['distance']);
  const distance_m =
    metres !== null ? metres : rawDistance !== null ? rawDistance * GDPR_UNITS.distanceCmToM : null;

  return {
    provider_activity_id: id,
    activity_type: activityTypeOf(raw),
    start_time: startTimeOf(raw),
    duration_seconds: round(firstNum(raw, ['durationInSeconds', 'duration', 'elapsedDuration'])),
    distance_m,
    avg_hr: round(firstNum(raw, ['averageHeartRateInBeatsPerMinute', 'averageHR', 'avgHr'])),
    max_hr: round(firstNum(raw, ['maxHeartRateInBeatsPerMinute', 'maxHR', 'maxHr'])),
    calories: round(firstNum(raw, ['activeKilocalories', 'calories'])),
    avg_speed: firstNum(raw, ['averageSpeedInMetersPerSecond', 'avgSpeed', 'averageSpeed']),
    elevation_gain_m: firstNum(raw, ['totalElevationGainInMeters', 'elevationGain']),
    garmin_updated_at: firstStr(raw, ['lastUpdated', 'lastUpdatedDate']),
    raw,
  };
}

// ---- health daily ----

function emptyDaily(
  calendar_date: string,
  raw: RawRecord,
  overrides: Partial<NormalizedHealthDaily>,
): NormalizedHealthDaily {
  return {
    calendar_date,
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
    garmin_updated_at: null,
    raw,
    ...overrides,
  };
}

/** Normalize a daily wellness summary (UDSFile-style). Null when undated. */
export function normalizeDailySummary(raw: RawRecord): NormalizedHealthDaily | null {
  const date = calendarDateOf(raw);
  if (!date) return null;
  return emptyDaily(date, raw, {
    resting_hr: round(firstNum(raw, ['restingHeartRate'])),
    max_hr: round(firstNum(raw, ['maxHeartRate'])),
    steps: round(firstNum(raw, ['totalSteps', 'steps'])),
    calories: round(firstNum(raw, ['totalKilocalories', 'calories', 'activeKilocalories'])),
    stress_avg: round(firstNum(raw, ['averageStressLevel', 'avgStressLevel'])),
    body_battery_high: round(firstNum(raw, ['bodyBatteryHighestValue', 'highestBatteryLevel'])),
    body_battery_low: round(firstNum(raw, ['bodyBatteryLowestValue', 'lowestBatteryLevel'])),
    spo2_avg: firstNum(raw, ['averageSpo2', 'avgSpo2']),
    respiration_avg: firstNum(raw, ['avgWakingRespirationValue', 'averageRespirationValue']),
    vo2max: firstNum(raw, ['vo2MaxValue', 'vo2Max', 'vo2max']),
  });
}

/** Normalize a sleep summary (sleepData-style). Null when undated. */
export function normalizeSleep(raw: RawRecord): NormalizedHealthDaily | null {
  const date = calendarDateOf(raw);
  if (!date) return null;
  const deep = round(firstNum(raw, ['deepSleepSeconds']));
  const rem = round(firstNum(raw, ['remSleepSeconds']));
  const light = round(firstNum(raw, ['lightSleepSeconds']));
  const awake = round(firstNum(raw, ['awakeSleepSeconds', 'awakeSeconds']));
  let total = round(firstNum(raw, ['sleepTimeSeconds']));
  if (total === null && (deep !== null || rem !== null || light !== null)) {
    total = (deep ?? 0) + (rem ?? 0) + (light ?? 0);
  }
  return emptyDaily(date, raw, {
    sleep_seconds: total,
    deep_sleep_seconds: deep,
    rem_sleep_seconds: rem,
    light_sleep_seconds: light,
    awake_seconds: awake,
    sleep_score: round(sleepScoreOf(raw)),
    hrv_ms: firstNum(raw, ['avgOvernightHrv', 'averageHrv', 'hrvValue']),
    respiration_avg: firstNum(raw, ['averageRespirationValue', 'averageRespiration']),
  });
}

/**
 * Merge dated partials into one row per calendar date (a daily summary and a
 * night's sleep land on the same date). A non-null incoming value fills a null
 * slot; an already-present value is kept (sources are largely disjoint). Raw
 * payloads are shallow-merged so every source's JSON is preserved.
 */
export function mergeHealthDaily(rows: NormalizedHealthDaily[]): NormalizedHealthDaily[] {
  const byDate = new Map<string, NormalizedHealthDaily>();
  for (const row of rows) {
    const existing = byDate.get(row.calendar_date);
    if (!existing) {
      byDate.set(row.calendar_date, { ...row });
      continue;
    }
    for (const key of DAILY_METRIC_KEYS) {
      if (existing[key] === null && row[key] !== null) existing[key] = row[key];
    }
    existing.raw = { ...existing.raw, ...row.raw };
    if (!existing.garmin_updated_at && row.garmin_updated_at) {
      existing.garmin_updated_at = row.garmin_updated_at;
    }
  }
  return [...byDate.values()];
}

// ---- projection into workout_logs (hybrid model) ----

export interface ProjectedLog {
  log_date: string;
  status: 'done';
  activity_type: string | null;
  tags: ActivityTagKey[];
  total_seconds: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  source: 'garmin';
  data: LogDocument;
}

/**
 * Project a normalized activity onto the workout_logs columns so it surfaces in
 * Calendar / Stats with no new read code. The writer adds owner_user_id and the
 * garmin_activity_id link. Returns null when the activity has no usable date
 * (workout_logs.log_date is NOT NULL).
 */
export function projectActivityToLog(activity: NormalizedActivity): ProjectedLog | null {
  if (!activity.start_time) return null;
  return {
    log_date: activity.start_time.slice(0, 10),
    status: 'done',
    activity_type: activity.activity_type,
    tags: [garminActivityTag(activity.activity_type)],
    total_seconds: activity.duration_seconds,
    hr_avg: activity.avg_hr,
    hr_max: activity.max_hr,
    source: 'garmin',
    data: { sections: [] },
  };
}
