import { describe, expect, it } from 'vitest';
import { ASPECT_WINDOW_DAYS } from '@/app.config';
import { aspectWindows, logsInWindow } from '@/lib/aspects';
import type { WorkoutLog } from '@/lib/types';

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const spanDays = (a: string, b: string) =>
  Math.round((day(b).getTime() - day(a).getTime()) / 86_400_000) + 1; // inclusive

// These pin the rolling behaviour, which is the whole point of the change: the
// radar's legend read a fixed "Jun 21 (now)" for weeks because nothing tied the
// window to the day being rendered.
describe('aspectWindows', () => {
  it('ends the current window on the given day', () => {
    expect(aspectWindows(day('2026-07-30')).current.end).toBe('2026-07-30');
  });

  it('spans exactly ASPECT_WINDOW_DAYS, inclusive', () => {
    const { current, prior } = aspectWindows(day('2026-07-30'));
    expect(spanDays(current.start, current.end)).toBe(ASPECT_WINDOW_DAYS);
    expect(spanDays(prior.start, prior.end)).toBe(ASPECT_WINDOW_DAYS);
  });

  it('places prior immediately before current, with no overlap or gap', () => {
    const { current, prior } = aspectWindows(day('2026-07-30'));
    expect(prior.end < current.start).toBe(true);
    expect(spanDays(prior.end, current.start)).toBe(2); // adjacent days
  });

  it('moves with the day it is given', () => {
    const a = aspectWindows(day('2026-07-30'));
    const b = aspectWindows(day('2026-07-31'));
    expect(b.current.end).not.toBe(a.current.end);
    expect(b.current.start).not.toBe(a.current.start);
    expect(b.prior.start).not.toBe(a.prior.start);
  });

  it('crosses month boundaries and a 28-day February', () => {
    const { current } = aspectWindows(day('2026-03-01'), 60);
    expect(current.start).toBe('2026-01-01');
    expect(current.end).toBe('2026-03-01');
  });

  it('crosses a year boundary', () => {
    const { current, prior } = aspectWindows(day('2026-01-15'), 30);
    expect(current.start).toBe('2025-12-17');
    expect(prior.start).toBe('2025-11-17');
    expect(prior.end).toBe('2025-12-16');
  });

  it('honours an explicit window length', () => {
    const { current } = aspectWindows(day('2026-07-30'), 7);
    expect(current.start).toBe('2026-07-24');
    expect(spanDays(current.start, current.end)).toBe(7);
  });
});

describe('logsInWindow', () => {
  const log = (log_date: string) => ({ log_date }) as WorkoutLog;

  it('includes both bounds and excludes outside', () => {
    const w = { start: '2026-06-01', end: '2026-06-30' };
    const kept = logsInWindow(
      [log('2026-05-31'), log('2026-06-01'), log('2026-06-15'), log('2026-06-30'), log('2026-07-01')],
      w,
    );
    expect(kept.map((l) => l.log_date)).toEqual(['2026-06-01', '2026-06-15', '2026-06-30']);
  });

  it('tolerates a timestamp-shaped log_date', () => {
    const w = { start: '2026-06-01', end: '2026-06-30' };
    expect(logsInWindow([log('2026-06-15T09:30:00Z')], w)).toHaveLength(1);
  });

  it('splits a fetched range into two disjoint blocks that lose nothing', () => {
    const { current, prior } = aspectWindows(day('2026-07-30'));
    const all = [prior.start, prior.end, current.start, current.end].map(log);
    const a = logsInWindow(all, prior);
    const b = logsInWindow(all, current);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(a.length + b.length).toBe(all.length);
  });
});
