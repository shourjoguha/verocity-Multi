import { describe, expect, it } from 'vitest';
import { currentWeekStreak } from '@/lib/streak';

const today = new Date(2026, 5, 24); // Wed 2026-06-24 (local); week starts Mon 06-22
const done = (d: string) => ({ log_date: d, status: 'done' });

describe('currentWeekStreak', () => {
  it('counts consecutive weeks with a done session, ending this week', () => {
    expect(currentWeekStreak([done('2026-06-22'), done('2026-06-17'), done('2026-06-08')], today)).toBe(3);
  });

  it('one session a week is enough — rest days do not break it', () => {
    expect(currentWeekStreak([done('2026-06-23'), done('2026-06-16')], today)).toBe(2);
  });

  it('stays alive through last week when this week is not logged yet', () => {
    expect(currentWeekStreak([done('2026-06-21'), done('2026-06-15')], today)).toBe(1);
    expect(currentWeekStreak([done('2026-06-19'), done('2026-06-10')], today)).toBe(2);
  });

  it('is broken when the most recent log is older than last week', () => {
    expect(currentWeekStreak([done('2026-06-14'), done('2026-06-08')], today)).toBe(0);
  });

  it('stops at the first empty week', () => {
    expect(currentWeekStreak([done('2026-06-22'), done('2026-06-08'), done('2026-06-01')], today)).toBe(1);
  });

  it('treats Sunday as the end of its Monday-start week', () => {
    const sunday = new Date(2026, 5, 28);
    expect(currentWeekStreak([done('2026-06-28'), done('2026-06-22'), done('2026-06-21')], sunday)).toBe(2);
  });

  it('ignores non-done logs', () => {
    const logs = [{ log_date: '2026-06-22', status: 'planned' }, done('2026-06-16')];
    expect(currentWeekStreak(logs, today)).toBe(1);
  });

  it('returns 0 for no logs', () => {
    expect(currentWeekStreak([], today)).toBe(0);
  });
});
