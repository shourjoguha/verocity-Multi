import { describe, expect, it } from 'vitest';
import { attributeSoreness, lagWindow, likelySources, soreRegions } from '@/lib/soreness';
import type { LogItem, VibeCheck, WorkoutLog } from '@/lib/types';

function item(movement: string, sets = 4): LogItem {
  return {
    id: movement,
    movement,
    primaryMetric: 'weight',
    sets: Array.from({ length: sets }, () => ({
      planned: null,
      notations: [],
      actual: { completed: true, prefilled: false, weight: 80, reps: 8 },
    })),
  } as unknown as LogItem;
}

function log(id: string, date: string, movements: string[], vibe?: VibeCheck): WorkoutLog {
  return {
    id,
    log_date: date,
    status: 'done',
    total_seconds: 3600,
    data: {
      sections: [{ key: 'main', groups: [{ id: 'g', kind: 'single', items: movements.map((m) => item(m)) }] }],
      ...(vibe ? { session: { vibe } } : {}),
    },
  } as unknown as WorkoutLog;
}

const sore = (s: VibeCheck['sore']): VibeCheck => ({ sleep: 3, energy: 3, soreness: 4, sore: s });

describe('soreRegions', () => {
  it('expands coarse areas and dedupes against specific regions', () => {
    expect(soreRegions(['lower', 'quads']).sort()).toEqual(['calves', 'glutes', 'hamstrings', 'quads']);
    expect(soreRegions(undefined)).toEqual([]);
  });
});

describe('lagWindow', () => {
  it('spans maxLagDays back to the day before', () => {
    expect(lagWindow('2026-09-10')).toEqual({ from: '2026-09-06', to: '2026-09-09' });
  });
});

describe('attributeSoreness', () => {
  const legs = log('legs', '2026-09-08', ['Back Squat', 'Romanian Deadlift']);
  const push = log('push', '2026-09-09', ['Bench Press', 'Overhead Press']);

  it('reaches past the session immediately before when that one trained other muscles', () => {
    const target = log('t', '2026-09-10', [], sore(['lower']));
    const [top] = attributeSoreness(target, [legs, push]);
    expect(top.log.id).toBe('legs');
    expect(top.daysBefore).toBe(2);
  });

  it('names the upper-body session for upper soreness', () => {
    const target = log('t', '2026-09-10', [], sore(['upper']));
    expect(attributeSoreness(target, [legs, push])[0].log.id).toBe('push');
  });

  it('attributes nothing without an area, and ignores same-day and out-of-window logs', () => {
    expect(attributeSoreness(log('t', '2026-09-10', [], sore(undefined)), [legs])).toEqual([]);
    const target = log('t', '2026-09-10', [], sore(['lower']));
    const sameDay = log('s', '2026-09-10', ['Back Squat']);
    const old = log('o', '2026-09-01', ['Back Squat']);
    expect(attributeSoreness(target, [sameDay, old])).toEqual([]);
  });

  it('weights a 2-day lag above a 1-day lag for identical work', () => {
    const d1 = log('d1', '2026-09-09', ['Back Squat']);
    const d2 = log('d2', '2026-09-08', ['Back Squat']);
    const ranked = attributeSoreness(log('t', '2026-09-10', [], sore(['quads'])), [d1, d2]);
    expect(ranked.map((c) => c.log.id)).toEqual(['d2', 'd1']);
    // 0.7 of the leader is under the 0.75 ambiguity bar, so only one is named.
    expect(likelySources(ranked)).toHaveLength(1);
  });
});
