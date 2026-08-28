import { describe, expect, it } from 'vitest';
import { matchActivityToLog, type CandidateLog } from '@/lib/garmin/matchLogs';
import type { NormalizedActivity } from '@/lib/garmin/normalize';

function activity(over: Partial<NormalizedActivity> = {}): NormalizedActivity {
  return {
    provider_activity_id: 'a1',
    activity_type: 'strength_training',
    start_time: '2024-09-22T17:00:00.000Z',
    duration_seconds: 3600,
    distance_m: null,
    avg_hr: 141,
    max_hr: 185,
    calories: 420,
    avg_speed: null,
    elevation_gain_m: null,
    garmin_updated_at: null,
    raw: {},
    ...over,
  };
}

function log(over: Partial<CandidateLog> = {}): CandidateLog {
  return {
    id: 'log-1',
    log_date: '2024-09-22',
    started_at: '2024-09-22T17:05:00.000Z',
    ended_at: '2024-09-22T18:00:00.000Z',
    source: 'manual',
    garmin_activity_id: null,
    total_seconds: null,
    hr_avg: null,
    hr_max: null,
    ...over,
  };
}

describe('matchActivityToLog', () => {
  it('attaches to an overlapping manual log and backfills empty columns', () => {
    const res = matchActivityToLog(activity(), [log()]);
    expect(res).toEqual({
      kind: 'attach',
      logId: 'log-1',
      patch: { total_seconds: 3600, hr_avg: 141, hr_max: 185 },
    });
  });

  it('never overwrites values the user already entered', () => {
    const res = matchActivityToLog(activity(), [log({ hr_avg: 150, total_seconds: 3300 })]);
    expect(res).toEqual({ kind: 'attach', logId: 'log-1', patch: { hr_max: 185 } });
  });

  it('inserts when no log overlaps in time', () => {
    // Same day, but the session ran in the morning and the activity at 17:00.
    const morning = log({
      started_at: '2024-09-22T06:00:00.000Z',
      ended_at: '2024-09-22T07:00:00.000Z',
    });
    expect(matchActivityToLog(activity(), [morning])).toEqual({ kind: 'insert' });
  });

  it('picks the log with the greatest overlap', () => {
    const grazing = log({
      id: 'log-graze',
      started_at: '2024-09-22T17:50:00.000Z',
      ended_at: '2024-09-22T19:00:00.000Z',
    });
    const solid = log({ id: 'log-solid' });
    const res = matchActivityToLog(activity(), [grazing, solid]);
    expect(res).toMatchObject({ kind: 'attach', logId: 'log-solid' });
  });

  it('ignores garmin-sourced and already-claimed logs', () => {
    const projected = log({ id: 'log-g', source: 'garmin' });
    const linked = log({ id: 'log-l', garmin_activity_id: 'other-activity' });
    expect(matchActivityToLog(activity(), [projected, linked])).toEqual({ kind: 'insert' });
  });

  it('will not attach two activities in a batch to the same log', () => {
    const claimed = new Set(['log-1']);
    expect(matchActivityToLog(activity(), [log()], claimed)).toEqual({ kind: 'insert' });
  });

  it('falls back to a lone same-date log with no recorded start', () => {
    const undated = log({ started_at: null, ended_at: null });
    expect(matchActivityToLog(activity(), [undated])).toMatchObject({
      kind: 'attach',
      logId: 'log-1',
    });
  });

  it('inserts rather than guessing between two undated logs on one date', () => {
    const a = log({ id: 'log-a', started_at: null, ended_at: null });
    const b = log({ id: 'log-b', started_at: null, ended_at: null });
    expect(matchActivityToLog(activity(), [a, b])).toEqual({ kind: 'insert' });
  });

  it('treats a log with a start but no end as lasting its recorded duration', () => {
    const open = log({ ended_at: null, total_seconds: 3000 });
    expect(matchActivityToLog(activity(), [open])).toMatchObject({ kind: 'attach' });
  });

  it('inserts when the activity has no usable start time', () => {
    expect(matchActivityToLog(activity({ start_time: null }), [log()])).toEqual({ kind: 'insert' });
  });
});
