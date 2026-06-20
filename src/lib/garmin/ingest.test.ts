import { describe, expect, it } from 'vitest';
import { buildIngestRequest } from '@/lib/garmin/ingest';

// Mirrors the two real activity shapes (raw GDPR export + official API) plus the
// daily/sleep summaries that merge onto one date — see normalize.test.ts.

const activity = {
  activityId: 987654321,
  activityType: 'running',
  startTimeGmt: '2024-09-22 06:30:00',
  duration: 1830,
  distance: 500000, // cm → 5000 m
  avgHr: 152,
  maxHr: 176,
};

const dailySummary = {
  calendarDate: '2024-09-22',
  restingHeartRate: 48,
  totalSteps: 11200,
};

const sleepSummary = {
  calendarDate: '2024-09-22',
  sleepTimeSeconds: 27000,
  deepSleepSeconds: 6000,
};

describe('buildIngestRequest', () => {
  it('normalizes + projects an activity and lands its raw event', () => {
    const req = buildIngestRequest('user-1', 'client', [
      { summary_type: 'activity', payload: activity },
    ]);

    expect(req.owner_user_id).toBe('user-1');
    expect(req.source).toBe('client');
    expect(req.activities).toHaveLength(1);

    const [{ activity: norm, log }] = req.activities;
    expect(norm.provider_activity_id).toBe('987654321');
    expect(norm.distance_m).toBe(5000);
    // Projection rides along, keyed for the workout_logs upsert.
    expect(log?.source).toBe('garmin');
    expect(log?.log_date).toBe('2024-09-22');
    expect(log?.hr_avg).toBe(152);

    // Raw event uses the provider activity id as its idempotency key.
    expect(req.raw_events).toEqual([
      { summary_type: 'activity', summary_id: '987654321', payload: activity },
    ]);
  });

  it('merges daily + sleep onto one dated health row but keeps distinct raw events', () => {
    const req = buildIngestRequest('user-1', 'zip', [
      { summary_type: 'daily', payload: dailySummary },
      { summary_type: 'sleep', payload: sleepSummary },
    ]);

    expect(req.health).toHaveLength(1);
    const [day] = req.health;
    expect(day.calendar_date).toBe('2024-09-22');
    expect(day.resting_hr).toBe(48); // from daily
    expect(day.steps).toBe(11200); // from daily
    expect(day.sleep_seconds).toBe(27000); // from sleep
    expect(day.deep_sleep_seconds).toBe(6000); // from sleep

    // Two audit rows on the same date, disambiguated by summary_type.
    expect(req.raw_events.map((r) => r.summary_id)).toEqual([
      '2024-09-22:daily',
      '2024-09-22:sleep',
    ]);
  });

  it('skips summaries the normalizer cannot place (no half-written rows)', () => {
    const req = buildIngestRequest('user-1', 'webhook', [
      { summary_type: 'activity', payload: { noStableId: true } },
      { summary_type: 'daily', payload: { restingHeartRate: 50 } }, // undated
    ]);

    expect(req.activities).toEqual([]);
    expect(req.health).toEqual([]);
    expect(req.raw_events).toEqual([]);
  });
});
