import { describe, expect, it } from 'vitest';
import { currentStreak } from '@/lib/streak';

const today = new Date(2026, 5, 21); // 2026-06-21 (local)
const done = (d: string) => ({ log_date: d, status: 'done' });

describe('currentStreak', () => {
  it('counts consecutive done days ending today', () => {
    expect(currentStreak([done('2026-06-21'), done('2026-06-20'), done('2026-06-19')], today)).toBe(3);
  });

  it('stays alive through yesterday when today is not logged yet', () => {
    expect(currentStreak([done('2026-06-20'), done('2026-06-19')], today)).toBe(2);
  });

  it('is broken when the most recent log is older than yesterday', () => {
    expect(currentStreak([done('2026-06-19'), done('2026-06-18')], today)).toBe(0);
  });

  it('stops at the first gap', () => {
    expect(currentStreak([done('2026-06-21'), done('2026-06-19'), done('2026-06-18')], today)).toBe(1);
  });

  it('ignores non-done logs and dedupes multiple sessions per day', () => {
    const logs = [
      done('2026-06-21'),
      { log_date: '2026-06-21', status: 'planned' },
      done('2026-06-21'),
      done('2026-06-20'),
    ];
    expect(currentStreak(logs, today)).toBe(2);
  });

  it('returns 0 for no logs', () => {
    expect(currentStreak([], today)).toBe(0);
  });
});
