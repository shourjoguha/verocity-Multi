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

describe('currentWeekStreak — holidays pause, never break', () => {
  // today: Wed 2026-06-24, weeks start Mon 06-22, 06-15, 06-08, 06-01.
  const away = (starts_on: string, ends_on: string) => ({ kind: 'hike' as const, starts_on, ends_on });

  it('steps over a week away with no session', () => {
    const logs = [done('2026-06-23'), done('2026-06-10'), done('2026-06-03')];
    expect(currentWeekStreak(logs, today)).toBe(1);
    expect(currentWeekStreak(logs, today, [away('2026-06-13', '2026-06-21')])).toBe(3);
  });

  it('a long weekend away is not a pause', () => {
    const logs = [done('2026-06-23'), done('2026-06-10')];
    expect(currentWeekStreak(logs, today, [away('2026-06-20', '2026-06-21')])).toBe(1);
  });

  it('a week away that still holds a session counts', () => {
    const logs = [done('2026-06-23'), done('2026-06-17'), done('2026-06-10')];
    expect(currentWeekStreak(logs, today, [away('2026-06-15', '2026-06-21')])).toBe(3);
  });

  it('a holiday this week keeps last week alive', () => {
    const logs = [done('2026-06-17'), done('2026-06-10')];
    expect(currentWeekStreak(logs, today, [away('2026-06-22', '2026-06-28')])).toBe(2);
  });

  it('a holiday before the first session does not invent weeks', () => {
    const logs = [done('2026-06-23')];
    expect(currentWeekStreak(logs, today, [away('2026-06-08', '2026-06-21')])).toBe(1);
  });
});
