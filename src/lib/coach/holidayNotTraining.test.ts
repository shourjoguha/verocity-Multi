// Planned breaks (migration 0049). Operator ruling 2026-11-03: a holiday is
// not work done, so it never adds a session, a set or a minute — but it is not
// a week of not training either. Its days leave every weekly denominator, and
// the coach is told whether the break was active (hike / dive / ski) or rest.

import { describe, expect, it } from 'vitest';
import { TRAINING } from '@/lib/coach/knowledge';
import { measureTraining } from '@/lib/coach/signals';
import { frequencyBelowTarget } from '@/lib/coach/rules/training';
import type { UserStats, WorkoutLog } from '@/lib/types';

const opts = {
  heavyFraction: TRAINING.strengthIntensityModerate.value,
  strengthRepMax: TRAINING.strengthReps.value,
  hypertrophyReps: TRAINING.hypertrophyReps.value,
  nearFailureRpe: TRAINING.hypertrophyProximityToFailure.value,
  allOutRpe: TRAINING.vo2AllOut.value,
  heavyRestSeconds: TRAINING.strengthRest.value,
};

// Window: 2026-10-08 .. 2026-11-04 (28 days).
const NOV4 = new Date('2026-11-04T12:00:00Z');

function session(date: string): WorkoutLog {
  return {
    started_at: null,
    total_seconds: 60 * 60,
    id: `log-${date}`,
    owner_user_id: 'u',
    plan_id: null,
    log_date: date,
    status: 'done',
    tags: [],
    hr_max: null,
    hr_avg: null,
    data: { sections: [] },
  } as unknown as WorkoutLog;
}

// Three a week for the three weeks at home, nothing during 12–25 Oct away.
const LOGS = ['2026-10-08', '2026-10-10', '2026-10-27', '2026-10-29', '2026-10-31', '2026-11-02', '2026-11-03', '2026-11-04'].map(
  session,
);
const RED_SEA = { kind: 'dive' as const, starts_on: '2026-10-12', ends_on: '2026-10-25' };

describe('holidays in the coach window', () => {
  it('leave the weekly denominator instead of counting as zeros', () => {
    const without = measureTraining(LOGS, opts, NOV4);
    const withBreak = measureTraining(LOGS, { ...opts, holidays: [RED_SEA] }, NOV4);
    expect(without.weeks).toBe(4);
    expect(withBreak.weeks).toBe(2);
    expect(withBreak.sessionsPerWeek.value).toBe(4);
    expect(without.sessionsPerWeek.value).toBe(2);
  });

  it('never add a session, and say how many days were active', () => {
    const s = measureTraining(LOGS, { ...opts, holidays: [RED_SEA] }, NOV4);
    expect(s.sessions).toBe(LOGS.length);
    expect(s.holiday).toMatchObject({ days: 14, activeDays: 14 });
    expect(s.holiday.breaks[0]).toMatchObject({ kind: 'dive', active: true });
    const beach = measureTraining(LOGS, { ...opts, holidays: [{ ...RED_SEA, kind: 'beach' as const }] }, NOV4);
    expect(beach.holiday.activeDays).toBe(0);
  });

  it('a window that was mostly a break has no frequency reading, so the rule stays silent', () => {
    const away = { kind: 'hike' as const, starts_on: '2026-10-09', ends_on: '2026-10-31' };
    const s = measureTraining(LOGS, { ...opts, holidays: [away] }, NOV4);
    expect(s.sessionsPerWeek.sufficiency).toBe('insufficient');
    expect(s.sessionsPerWeek.shortfall).toMatch(/planned break/);
    const stats = { days_per_week: 5 } as unknown as UserStats;
    expect(frequencyBelowTarget(measureTraining(LOGS, opts, NOV4), stats, '2026-W45')).not.toBeNull();
    expect(frequencyBelowTarget(s, stats, '2026-W45')).toBeNull();
  });

  it('a holiday that has not started yet changes nothing', () => {
    const later = { kind: 'ski' as const, starts_on: '2026-12-20', ends_on: '2026-12-28' };
    expect(measureTraining(LOGS, { ...opts, holidays: [later] }, NOV4).weeks).toBe(4);
  });
});
