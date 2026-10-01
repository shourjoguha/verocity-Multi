import { describe, expect, it } from 'vitest';
import {
  attributeSoreness,
  explainSoreness,
  hoursToDays,
  lagWindow,
  likelySources,
  soreRegions,
} from '@/lib/soreness';
import { SORENESS } from '@/app.config';
import { READINESS } from '@/lib/coach/knowledge';
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
  it('expands coarse areas and dedupes against specific ones', () => {
    expect(soreRegions(['lower', 'quads']).sort()).toEqual(['calves', 'glutes', 'hamstrings', 'quads']);
    expect(soreRegions(['upperBack'])).toEqual(['back']);
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

  it('splits the back: low back points at the hinge day, up back at the row day', () => {
    const hinge = log('hinge', '2026-09-08', ['Romanian Deadlift', 'Good Morning']);
    const rows = log('rows', '2026-09-08', ['Barbell Row', 'Pull-up']);
    const at = (s: VibeCheck['sore']) => attributeSoreness(log('t', '2026-09-10', [], sore(s)), [hinge, rows])[0].log.id;
    expect(at(['lowerBack'])).toBe('hinge');
    expect(at(['upperBack'])).toBe('rows');
  });

  it('attributes nothing without an area, and ignores same-day and out-of-window logs', () => {
    expect(attributeSoreness(log('t', '2026-09-10', [], sore(undefined)), [legs])).toEqual([]);
    const target = log('t', '2026-09-10', [], sore(['lower']));
    const sameDay = log('s', '2026-09-10', ['Back Squat']);
    const old = log('o', '2026-09-01', ['Back Squat']);
    expect(attributeSoreness(target, [sameDay, old])).toEqual([]);
  });

  it('weighs the two days of the cited peak window the same', () => {
    const d1 = log('d1', '2026-09-09', ['Back Squat']);
    const d2 = log('d2', '2026-09-08', ['Back Squat']);
    const d3 = log('d3', '2026-09-07', ['Back Squat']);
    const ranked = attributeSoreness(log('t', '2026-09-10', [], sore(['quads'])), [d1, d2, d3]);
    expect(ranked[0].score).toBeCloseTo(ranked[1].score);
    // The uncited tail ranks below, and at half the leader is still named.
    expect(ranked[2].log.id).toBe('d3');
    expect(likelySources(ranked).map((c) => c.log.id)).toContain('d3');
  });

  it('names the movements that carried the load', () => {
    const target = log('t', '2026-09-10', [], sore(['lower']));
    expect(attributeSoreness(target, [legs])[0].movements.map((m) => m.movement)).toEqual([
      'Back Squat',
      'Romanian Deadlift',
    ]);
  });
});

describe('the cited window', () => {
  it('maps Galpin\'s 24-48h to one and two calendar days, weighted equally', () => {
    const days = hoursToDays(READINESS.domsPeak.value);
    expect(days).toEqual([1, 2]);
    // The session page's weights must not drift from the claim the coach cites.
    for (const d of days) expect(SORENESS.lagWeights[d]).toBe(1);
    for (const [d, w] of Object.entries(SORENESS.lagWeights)) {
      if (!days.includes(Number(d))) expect(w).toBeLessThan(1);
    }
  });
});

describe('explainSoreness — the athlete\'s two cases', () => {
  // Front squats + ab work two days back, sled push the day before, soreness
  // reported at the start of the next session.
  const twoBack = log('fs', '2026-09-08', ['Front Squat', 'Landmine Twist', 'Ab Wheel Rollout']);
  const oneBack = log('sled', '2026-09-09', ['Sled Push']);
  const report = log('t', '2026-09-10', [], sore(['quads', 'core']));
  const [quads, core] = explainSoreness(report, [twoBack, oneBack], hoursToDays(READINESS.domsPeak.value));

  it('quads: both sessions loaded them, so both are named', () => {
    expect(quads.peak.map((c) => c.log.id).sort()).toEqual(['fs', 'sled']);
  });

  it('core: only the session two days back loaded it; the sled day is the quiet one', () => {
    expect(core.peak.map((c) => c.log.id)).toEqual(['fs']);
    expect(core.peak[0].movements.map((m) => m.movement)).toEqual(['Ab Wheel Rollout', 'Landmine Twist']);
    expect(core.quietInPeak.map((l) => l.id)).toEqual(['sled']);
  });

  it('falls back to a tail match only when nothing in the peak window loaded it', () => {
    const old = log('old', '2026-09-07', ['Back Squat']);
    const [only] = explainSoreness(log('t', '2026-09-10', [], sore(['quads'])), [old], [1, 2]);
    expect(only.peak).toEqual([]);
    expect(only.tail?.log.id).toBe('old');
  });
});
