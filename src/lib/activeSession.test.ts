import { describe, expect, it } from 'vitest';
import { activeSessionOf } from '@/lib/activeSession';
import { TIMERS } from '@/app.config';

const now = new Date('2026-06-21T18:00:00.000Z').getTime();
const agoMinutes = (m: number) => new Date(now - m * 60_000).toISOString();

const live = (id: string, minutesAgo: number) => ({
  id,
  status: 'in_progress' as const,
  started_at: agoMinutes(minutesAgo),
});

describe('activeSessionOf', () => {
  it('finds a session started a few minutes ago', () => {
    expect(activeSessionOf([live('a', 12)], now)?.id).toBe('a');
  });

  it('returns null when nothing is in progress', () => {
    const logs = [
      { id: 'a', status: 'done' as const, started_at: agoMinutes(10) },
      { id: 'b', status: 'cancelled' as const, started_at: agoMinutes(5) },
    ];
    expect(activeSessionOf(logs, now)).toBeNull();
  });

  it('ignores a session past the wall-clock cap', () => {
    const stale = TIMERS.maxWorkoutSeconds / 60 + 1;
    expect(activeSessionOf([live('a', stale)], now)).toBeNull();
  });

  it('keeps a session right up to the cap', () => {
    expect(activeSessionOf([live('a', TIMERS.maxWorkoutSeconds / 60 - 1)], now)?.id).toBe('a');
  });

  it('returns the newest when two are in progress', () => {
    expect(activeSessionOf([live('older', 60), live('newer', 5)], now)?.id).toBe('newer');
  });

  it('ignores a row with no or unparseable started_at', () => {
    const logs = [
      { id: 'a', status: 'in_progress' as const, started_at: null },
      { id: 'b', status: 'in_progress' as const, started_at: 'not a date' },
    ];
    expect(activeSessionOf(logs, now)).toBeNull();
  });
});
