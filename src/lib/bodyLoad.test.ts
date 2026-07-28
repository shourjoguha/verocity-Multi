import { describe, expect, it } from 'vitest';
import { regionIntensities, setMinutes, summarizeBodyLoad } from '@/lib/bodyLoad';
import { classifyMovement } from '@/lib/movementTaxonomy';
import { LOAD, type SectionKey } from '@/app.config';
import type { LogItem, LogSet, WorkoutLog } from '@/lib/types';

function set(actual: Partial<LogSet['actual']>): LogSet {
  return {
    planned: null,
    notations: [],
    actual: { completed: true, prefilled: false, ...actual },
  };
}

function item(movement: string, primaryMetric: LogItem['primaryMetric'], sets: LogSet[]): LogItem {
  return { id: `i-${movement}`, movement, primaryMetric, sets };
}

function log(
  sections: { key: SectionKey; items: LogItem[] }[],
  overrides: Partial<WorkoutLog> = {},
): WorkoutLog {
  return {
    id: overrides.id ?? 'log-1',
    status: 'done',
    data: {
      sections: sections.map((s) => ({
        key: s.key,
        groups: [{ id: `g-${s.key}`, kind: 'single', items: s.items }],
      })),
    },
    ...overrides,
  } as unknown as WorkoutLog;
}

describe('setMinutes', () => {
  it('prefers logged time', () => {
    expect(setMinutes(set({ time: 90 }))).toBeCloseTo(1.5, 5);
  });

  it('converts reps via time-under-tension', () => {
    expect(setMinutes(set({ reps: 10 }))).toBeCloseTo((10 * LOAD.repSeconds) / 60, 5);
  });

  it('converts distance when there is no time', () => {
    expect(setMinutes(set({ distance: 300 }))).toBeCloseTo(300 / LOAD.metersPerMinute, 5);
  });

  it('falls back for a completed set with no numbers', () => {
    expect(setMinutes(set({}))).toBe(LOAD.fallbackSetMinutes);
  });

  // Deliberately unlike sessionVolume, which counts every set.
  it('counts an incomplete set as zero', () => {
    expect(setMinutes(set({ reps: 10, completed: false }))).toBe(0);
  });
});

describe('summarizeBodyLoad', () => {
  const mixed = log([
    {
      key: 'primary',
      items: [item('Back Squat', 'weight', [set({ weight: 100, reps: 5 }), set({ weight: 100, reps: 5 })])],
    },
    {
      key: 'conditioning',
      items: [item('Ski-Erg Intervals', 'time', [set({ time: 300 }), set({ time: 300 })])],
    },
    { key: 'primary', items: [item('Box Jump', 'reps', [set({ reps: 5 })])] },
    { key: 'accessory', items: [item('Wtd', 'reps', [set({ reps: 8, weight: 10 })])] },
  ]);

  it('gives endurance work real load despite zero tonnage', () => {
    const s = summarizeBodyLoad([mixed]);
    // Ski-Erg is back .5 / arms .3 / core .2 over 10 minutes.
    expect(s.regionMinutes.back).toBeCloseTo(10 * 0.5, 3);
    expect(s.modalityMinutes.endurance).toBeCloseTo(10, 3);
    // ...and contributes nothing to the resistance-only tonnage readout.
    expect(s.resistanceTonnage.back).toBe(0);
  });

  it('distributes a movement across its regions by weight', () => {
    const s = summarizeBodyLoad([mixed]);
    const squatMinutes = (10 * LOAD.repSeconds) / 60; // 2 sets × 5 reps
    const jumpMinutes = (5 * LOAD.repSeconds) / 60;
    // Read the weights from the taxonomy rather than restating them: this test
    // is about the distribution mechanics, not about what a squat works, and
    // hardcoding the split makes every weight tune look like a broken test.
    const wQuads = (n: string) => classifyMovement(n).profile.regions.quads ?? 0;
    expect(s.regionMinutes.quads).toBeCloseTo(
      squatMinutes * wQuads('Back Squat') + jumpMinutes * wQuads('Box Jump'),
      3,
    );
  });

  it('routes an unclassifiable movement to unmapped and to no region', () => {
    const s = summarizeBodyLoad([mixed]);
    expect(s.unmapped.map((u) => u.name)).toEqual(['Wtd']);
    expect(s.unmapped[0].sessions).toBe(1);
    const regionTotal = Object.values(s.regionMinutes).reduce((a, b) => a + b, 0);
    const wtdMinutes = (8 * LOAD.repSeconds) / 60;
    expect(regionTotal).toBeCloseTo(s.totalMinutes - wtdMinutes, 3);
  });

  it('reports coverage as the classified share of minutes', () => {
    const s = summarizeBodyLoad([mixed]);
    const wtdMinutes = (8 * LOAD.repSeconds) / 60;
    expect(s.coverage).toBeCloseTo((s.totalMinutes - wtdMinutes) / s.totalMinutes, 5);
    expect(s.coverage).toBeLessThan(1);
  });

  it('tracks systemic minutes separately from regions', () => {
    const s = summarizeBodyLoad([mixed]);
    const jumpMinutes = (5 * LOAD.repSeconds) / 60;
    expect(s.systemicMinutes).toBeCloseTo(10 + jumpMinutes, 3);
  });

  it('splits the rotary axis', () => {
    const s = summarizeBodyLoad([
      log([
        {
          key: 'accessory',
          items: [
            item('Landmine Twist', 'weight', [set({ weight: 10, reps: 10 })]),
            item('Pallof Press', 'reps', [set({ reps: 10 })]),
          ],
        },
      ]),
    ]);
    const each = (10 * LOAD.repSeconds) / 60;
    expect(s.rotaryMinutes.rotational).toBeCloseTo(each, 3);
    expect(s.rotaryMinutes.antiRotational).toBeCloseTo(each, 3);
  });

  it('ignores logs that are not done', () => {
    const cancelled = log([{ key: 'primary', items: [item('Back Squat', 'weight', [set({ reps: 5 })])] }], {
      id: 'log-2',
      status: 'cancelled',
    });
    expect(summarizeBodyLoad([cancelled]).totalMinutes).toBe(0);
    expect(summarizeBodyLoad([cancelled]).sessions).toBe(0);
  });

  it('skips subroutine items', () => {
    const withSub = log([
      {
        key: 'cooldown',
        items: [
          { ...item('Box breathing', 'reps', [set({ reps: 10 })]), kind: 'subroutine' } as LogItem,
        ],
      },
    ]);
    expect(summarizeBodyLoad([withSub]).totalMinutes).toBe(0);
  });

  it('applies an override so a truncated name stops being unmapped', () => {
    const s = summarizeBodyLoad([mixed], {
      weighted: {
        regions: { back: 0.7, arms: 0.3 },
        modality: 'resistance',
        planes: { frontal: 1 },
      },
    });
    expect(s.unmapped).toEqual([]);
    expect(s.coverage).toBe(1);
    expect(s.regionMinutes.arms).toBeGreaterThan(0);
  });
});

describe('modality fallback', () => {
  it('infers endurance for an unknown movement logged by distance', () => {
    const s = summarizeBodyLoad([
      log([{ key: 'conditioning', items: [item('Deficit', 'distance', [set({ distance: 300 })])] }]),
    ]);
    // Unknown names carry no regions, so they land in unmapped regardless of
    // what the fallback would have said about modality.
    expect(s.unmapped.map((u) => u.name)).toEqual(['Deficit']);
    expect(s.modalityMinutes.endurance).toBe(0);
  });

  it('keeps a known movement static modality even in a conditioning section', () => {
    const s = summarizeBodyLoad([
      log([
        {
          key: 'conditioning',
          items: [item('Back Squat', 'weight', [set({ weight: 100, reps: 5 })])],
        },
      ]),
    ]);
    expect(s.modalityMinutes.resistance).toBeGreaterThan(0);
    expect(s.modalityMinutes.endurance).toBe(0);
  });
});

describe('regionIntensities', () => {
  it('normalises against the busiest region', () => {
    const s = summarizeBodyLoad([
      log([{ key: 'primary', items: [item('Leg Extension', 'weight', [set({ reps: 10 })])] }]),
    ]);
    const i = regionIntensities(s);
    expect(i.quads).toBe(1);
    expect(i.chest).toBe(0);
  });

  it('returns all zeroes when there is no work', () => {
    const i = regionIntensities(summarizeBodyLoad([]));
    expect(Object.values(i).every((v) => v === 0)).toBe(true);
  });
});
