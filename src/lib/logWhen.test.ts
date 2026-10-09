import { describe, expect, it } from 'vitest';
import { localTimeOf, retimeLog } from '@/lib/logWhen';

describe('retimeLog', () => {
  it('moves start and end together, keeping the recorded duration', () => {
    const p = retimeLog(
      { started_at: '2026-05-10T09:00:00Z', ended_at: '2026-05-10T10:15:00Z', total_seconds: 3600 },
      '2026-05-08',
      '18:30',
    );
    expect(p.log_date).toBe('2026-05-08');
    expect(p.started_at).toBe(new Date('2026-05-08T18:30').toISOString());
    expect(new Date(p.ended_at!).getTime() - new Date(p.started_at!).getTime()).toBe(75 * 60_000);
  });

  it('derives the end from total_seconds when no end was recorded', () => {
    const p = retimeLog({ started_at: null, ended_at: null, total_seconds: 2700 }, '2026-05-08', '07:00');
    expect(new Date(p.ended_at!).getTime() - new Date(p.started_at!).getTime()).toBe(2700_000);
  });

  it('leaves the end alone when there is no duration to keep', () => {
    const p = retimeLog({ started_at: null, ended_at: null, total_seconds: null }, '2026-05-08', '07:00');
    expect(p.ended_at).toBeNull();
  });

  it('moves only the date when no time is given', () => {
    expect(
      retimeLog({ started_at: '2026-05-10T09:00:00Z', ended_at: null, total_seconds: 60 }, '2026-05-08', ''),
    ).toEqual({ log_date: '2026-05-08' });
  });
});

describe('localTimeOf', () => {
  it('round-trips a local wall-clock time and is empty without a timestamp', () => {
    expect(localTimeOf(new Date('2026-05-08T18:30').toISOString())).toBe('18:30');
    expect(localTimeOf(null)).toBe('');
  });
});
