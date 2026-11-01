import { describe, expect, it } from 'vitest';
import type { SectionKey } from '@/app.config';
import { monotone, sessionSets, sessionsLabel, summarizeDays } from '@/lib/dayLog';
import type { LogSet, WorkoutLog } from '@/lib/types';

function set(): LogSet {
  return { planned: null, actual: { reps: 5, completed: true, prefilled: false }, notations: [] };
}

function log(
  date: string,
  tags: string[],
  sections: Partial<Record<SectionKey, number>> = {},
  seconds: number | null = null,
): WorkoutLog {
  return {
    log_date: date,
    tags,
    activity_type: null,
    total_seconds: seconds,
    data: {
      sections: Object.entries(sections).map(([key, n]) => ({
        key: key as SectionKey,
        groups: [{ id: key, kind: 'single', items: [{ id: key, movement: 'X', primaryMetric: 'reps', sets: Array.from({ length: n }, set) }] }],
      })),
    },
  } as unknown as WorkoutLog;
}

describe('sessionSets', () => {
  it('leaves warm-up and cool-down out of the count', () => {
    expect(sessionSets(log('2026-09-30', ['strength'], { warmup: 8, primary: 16, accessory: 5, conditioning: 9, cooldown: 2 }))).toBe(30);
  });

  it('counts a prep-only session in full', () => {
    expect(sessionSets(log('2026-09-30', ['mobility'], { cooldown: 6 }))).toBe(6);
  });
});

describe('summarizeDays', () => {
  const logs = [
    log('2026-09-29', ['crossfit'], { primary: 6, conditioning: 22 }, 3360),
    log('2026-09-30', ['strength'], { warmup: 8, primary: 16 }, 4500),
    log('2026-09-30T18:00:00', ['crossfit'], { conditioning: 10 }, 1500),
  ];

  it('groups by date, newest first, and sums the day', () => {
    const days = summarizeDays(logs);
    expect(days.map((d) => d.date)).toEqual(['2026-09-30', '2026-09-29']);
    expect(days[0].logs).toHaveLength(2);
    expect(days[0].sets).toBe(26);
    expect(days[0].seconds).toBe(6000);
    expect(days[0].bands).toEqual({ warmcool: 8, main: 16, accessory: 0, conditioning: 10 });
    expect(days[0].label).toBe('Strength + CrossFit');
  });

  it('keeps one colour per distinct tag', () => {
    const [day] = summarizeDays([log('2026-09-05', ['sport']), log('2026-09-05', ['sport'])]);
    expect(day.colors).toHaveLength(1);
  });
});

describe('sessionsLabel', () => {
  it('falls back to the activity type and capitalises unknown tags', () => {
    expect(sessionsLabel([{ ...log('2026-09-01', []), activity_type: 'padel' } as WorkoutLog])).toBe('Padel');
  });
});

describe('monotone', () => {
  it('passes through every point', () => {
    const f = monotone([1, 3, 9], [10, 0, 30]);
    expect(f(1)).toBe(10);
    expect(f(3)).toBeCloseTo(0);
    expect(f(9)).toBe(30);
  });

  it('never leaves the range of a segment, so a band never goes negative', () => {
    const f = monotone([1, 2, 8, 9], [20, 0, 0, 25]);
    for (let x = 1; x <= 9; x += 0.05) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(25 + 1e-9);
    }
    for (let x = 2; x <= 8; x += 0.1) expect(f(x)).toBeCloseTo(0);
  });

  it('holds the end values outside the domain', () => {
    const f = monotone([2, 4], [5, 7]);
    expect(f(0)).toBe(5);
    expect(f(10)).toBe(7);
  });
});
