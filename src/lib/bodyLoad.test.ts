import { describe, expect, it } from 'vitest';
import {
  regionIntensities,
  setMinutes,
  setVolume,
  summarizeBodyLoad,
  summarizeTrainingVolume,
} from '@/lib/bodyLoad';
import { classifyMovement } from '@/lib/movementTaxonomy';
import { LOAD, RPE, VOLUME, type SectionKey } from '@/app.config';
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

describe('setVolume', () => {
  const notated = (actual: Partial<LogSet['actual']>, notations: string[]): LogSet => ({
    ...set(actual),
    notations,
  });
  const plain = set({ weight: 100, reps: 5 });

  it('is load × reps for a plain weighted set', () => {
    expect(setVolume(plain)).toBeCloseTo(500, 5);
  });

  // The scalar that recovers work the app was silently discarding: reps are
  // logged PER SIDE and nothing else in the codebase doubles them.
  it('doubles a /side set', () => {
    expect(setVolume(notated({ weight: 100, reps: 5 }, ['/side']))).toBeCloseTo(1000, 5);
  });

  it('raises a paused set', () => {
    const paused = setVolume(notated({ weight: 100, reps: 5 }, ['(p)']));
    expect(paused).toBeGreaterThan(setVolume(plain));
    expect(paused).toBeCloseTo(500 * VOLUME.pauseFactor, 5);
  });

  it('stacks /side and (p)', () => {
    expect(setVolume(notated({ weight: 100, reps: 5 }, ['/side', '(p)']))).toBeCloseTo(
      500 * 2 * VOLUME.pauseFactor,
      5,
    );
  });

  it('ignores notations it does not price', () => {
    expect(setVolume(notated({ weight: 100, reps: 5 }, ['(t)', '→']))).toBeCloseTo(500, 5);
  });

  it('scales with RPE either side of the default', () => {
    const hard = setVolume(set({ weight: 100, reps: 5, rpe: 10 }));
    const easy = setVolume(set({ weight: 100, reps: 5, rpe: 5 }));
    expect(hard).toBeGreaterThan(setVolume(plain));
    expect(easy).toBeLessThan(setVolume(plain));
  });

  // Load-bearing: RPE is optional in the logger, so its absence must never cost
  // anything, or the metric rewards the habit of logging RPE over the training.
  it('treats a missing RPE as neutral, not a penalty', () => {
    expect(setVolume(plain)).toBeCloseTo(setVolume(set({ weight: 100, reps: 5, rpe: RPE.default })), 5);
  });

  it('converts time and distance into the same currency as reps', () => {
    // A 30s plank is 10 rep-equivalents at LOAD.repSeconds = 3.
    expect(setVolume(set({ time: 30 }))).toBeCloseTo(setVolume(set({ reps: 30 / LOAD.repSeconds })), 5);
    const distanceReps = (600 / LOAD.metersPerMinute) * 60 / LOAD.repSeconds;
    expect(setVolume(set({ distance: 600 }))).toBeCloseTo(setVolume(set({ reps: distanceReps })), 5);
  });

  it('prices unweighted work through the conversion constant', () => {
    expect(setVolume(set({ reps: 10 }))).toBeCloseTo(VOLUME.unweightedRepKg * 10, 5);
  });

  it('counts an incomplete set as zero', () => {
    expect(setVolume(set({ weight: 100, reps: 5, completed: false }))).toBe(0);
  });

  it('produces a finite number for a set carrying nothing at all', () => {
    const bare = setVolume(set({}));
    expect(Number.isFinite(bare)).toBe(true);
    expect(bare).toBeGreaterThan(0);
  });
});

describe('summarizeTrainingVolume', () => {
  const squats = (weight: number, reps: number, count: number) =>
    item('Back Squat', 'weight', Array.from({ length: count }, () => set({ weight, reps })));

  it('splits volume by modality', () => {
    const v = summarizeTrainingVolume([
      log([
        { key: 'primary', items: [squats(100, 5, 3)] },
        { key: 'accessory', items: [item('Box Jump', 'reps', [set({ reps: 5 })])] },
      ]),
    ]);
    expect(v.modalityVolume.resistance).toBeGreaterThan(0);
    expect(v.modalityVolume.plyometric).toBeGreaterThan(0);
  });

  const bests = new Map([['Back Squat', 160]]);
  const resistanceOf = (weight: number, reps: number, count: number, b = bests) =>
    summarizeTrainingVolume([log([{ key: 'primary', items: [squats(weight, reps, count)] }])], {}, b)
      .modalityVolume.resistance;

  it('ranks the heavier session higher at equal tonnage', () => {
    // 140×3×5 and 60×7×5 are both 2100kg of tonnage. Only relative intensity
    // separates them, which is the whole reason the e1RM weighting is kept.
    expect(resistanceOf(140, 3, 5)).toBeGreaterThan(resistanceOf(60, 7, 5));
  });

  // Volume-based strength inherently favours volume: a hypertrophy block moves
  // far more total load than a peaking block, and no sane intensity weighting
  // makes 5×3 equal 5×10. What the weighting must do is stop a peaking block
  // reading as a COLLAPSE — it narrows the gap, it does not close it.
  it('narrows the gap a peaking block would suffer on raw tonnage', () => {
    const weighted = resistanceOf(140, 3, 5) / resistanceOf(112, 10, 5);
    const unweighted = resistanceOf(140, 3, 5, new Map()) / resistanceOf(112, 10, 5, new Map());
    expect(weighted).toBeGreaterThan(unweighted);
  });

  it('rewards explosive plyometric sets over junk reps', () => {
    const jumps = (reps: number, count: number) =>
      log([
        {
          key: 'accessory',
          items: [item('Box Jump', 'reps', Array.from({ length: count }, () => set({ reps })))],
        },
      ]);
    // Same 36 total reps, different quality.
    const sharp = summarizeTrainingVolume([jumps(3, 12)]).modalityVolume.plyometric;
    const junk = summarizeTrainingVolume([jumps(18, 2)]).modalityVolume.plyometric;
    expect(sharp).toBeGreaterThan(junk);
  });

  it('reads density from prescribed rest', () => {
    const withRest = (restSeconds: number) =>
      log([
        {
          key: 'primary',
          items: [{ ...squats(100, 5, 4), restSeconds }],
        },
      ]);
    expect(summarizeTrainingVolume([withRest(60)]).density).toBeGreaterThan(
      summarizeTrainingVolume([withRest(180)]).density,
    );
  });

  it('reads density from the clock when rest was never set', () => {
    const elapsed = (total_seconds: number) =>
      log([{ key: 'primary', items: [squats(100, 10, 6)] }], { total_seconds });
    // The same work crammed into less wall-clock time is denser.
    expect(summarizeTrainingVolume([elapsed(600)]).density).toBeGreaterThan(
      summarizeTrainingVolume([elapsed(3600)]).density,
    );
  });

  it('reports zero density rather than NaN with no resistance work', () => {
    const v = summarizeTrainingVolume([
      log([{ key: 'cooldown', items: [item('Couch Stretch', 'time', [set({ time: 60 })])] }]),
    ]);
    expect(v.density).toBe(0);
    expect(v.resistanceMinutes).toBe(0);
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
