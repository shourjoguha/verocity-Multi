import { describe, expect, it } from 'vitest';
import { lastPerformance, plannedReps, repAdjustedWeight } from '@/lib/lastPerformance';
import type { LogSet, WorkoutLog } from '@/lib/types';

function set(weight: number, reps: number): LogSet {
  return {
    planned: null,
    actual: { weight, reps, completed: true, prefilled: false },
    notations: [],
  };
}

function log(movement: string, sets: LogSet[], id = 'l'): WorkoutLog {
  return {
    id,
    data: { sections: [{ key: 'accessory', groups: [{ id: 'g', kind: 'single', items: [{ id: 'i', movement, primaryMetric: 'weight', sets }] }] }] },
  } as unknown as WorkoutLog;
}

describe('lastPerformance', () => {
  it('returns the newest completed set, uncompleted and marked prefilled', () => {
    const got = lastPerformance([log('Leg Curl', [set(82.5, 12)]), log('Leg Curl', [set(70, 15)])], 'leg curl');
    expect(got).toMatchObject({ weight: 82.5, reps: 12, completed: false, prefilled: true });
  });

  it('returns null for a movement never logged with a weight', () => {
    expect(lastPerformance([log('Leg Curl', [set(82.5, 12)])], 'Ab Wheel Rollout')).toBeNull();
  });

  it('skips the logs it is told to, so a deload never seeds the next hard week', () => {
    const got = lastPerformance(
      [log('Leg Curl', [set(60, 12)], 'deload'), log('Leg Curl', [set(82.5, 12)], 'w4')],
      'leg curl',
      new Set(['deload']),
    );
    expect(got).toMatchObject({ weight: 82.5, reps: 12 });
  });
});

describe('repAdjustedWeight', () => {
  it('raises the load when the block cuts the rep target', () => {
    // 100kg x 10 → e1RM ~133kg; at 5 reps that is ~118.6kg, rounded down to 117.5.
    expect(repAdjustedWeight(100, 10, 5)).toBe(117.5);
  });

  it('lowers the load when the rep target goes up', () => {
    expect(repAdjustedWeight(100, 5, 10)).toBe(82.5);
  });

  it('declines when there is nothing defensible to say', () => {
    expect(repAdjustedWeight(100, 10, 10)).toBeNull(); // same target
    expect(repAdjustedWeight(100, 15, 5)).toBeNull(); // reference beyond Brzycki's range
    expect(repAdjustedWeight(100, 5, 20)).toBeNull(); // target beyond it
    expect(repAdjustedWeight(undefined, 10, 5)).toBeNull();
    expect(repAdjustedWeight(100, 10, null)).toBeNull();
  });
});

describe('plannedReps', () => {
  it('reads a bare rep target', () => {
    expect(plannedReps('15', 'weight')).toBe(15);
    expect(plannedReps('18', 'reps')).toBe(18);
  });

  it('reads through a set-count prefix and trailing notation', () => {
    expect(plannedReps('3x12 R7', 'weight')).toBe(12);
    expect(plannedReps('10/side', 'reps')).toBe(10);
    expect(plannedReps('10 (p) R7', 'reps')).toBe(10);
  });

  it('refuses time and distance labels, where the number is seconds or metres', () => {
    expect(plannedReps('360', 'time')).toBeNull();
    expect(plannedReps('40', 'distance')).toBeNull();
  });

  it('returns null with no prescription, so the caller falls back to last session', () => {
    expect(plannedReps(null, 'weight')).toBeNull();
    expect(plannedReps('', 'weight')).toBeNull();
    expect(plannedReps('AMRAP', 'weight')).toBeNull();
    expect(plannedReps('0', 'weight')).toBeNull();
  });

  // The regression this fix exists for: Leg Curl was programmed 12 → 15 → 18 and
  // logged 12, 12, 12, because the prefill carried last session's reps and the
  // target rendered at 9.6px beside it. The target must win.
  it('beats a stale prefill when the programmed reps rise', () => {
    const last = lastPerformance([log('Leg Curl', [set(82.5, 12)])], 'Leg Curl');
    expect(last?.reps).toBe(12);
    expect(plannedReps('18', 'weight') ?? last?.reps).toBe(18);
  });
});
