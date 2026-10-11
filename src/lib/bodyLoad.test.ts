import { describe, expect, it } from 'vitest';
import {
  isLoadedSet,
  meaningfulMuscleShare,
  meaningfulRegionShare,
  MUSCLE_SHARE_FLOOR,
  muscleIntensities,
  muscleTotals,
  regionIntensities,
  regionTotals,
  romFactor,
  bwLoadFactor,
  setMinutes,
  setVolume,
  summarizeBodyLoad,
  summarizeTrainingVolume,
} from '@/lib/bodyLoad';
import { classifyMovement, pm, type OverrideMap } from '@/lib/movementTaxonomy';
import {
  BODY_LENS_KEYS,
  LOAD,
  MODALITY_KEYS,
  MUSCLE_KEYS,
  MUSCLE_REGION_KEYS,
  MUSCLES,
  type MuscleKey,
  type RegionKey,
  ROM,
  RPE,
  VOLUME,
  type SectionKey,
} from '@/app.config';
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
  // Load is ADDITIVE now (bodyweight share + external weight), so a bare
  // setVolume call also prices the athlete. These tests are about the notation
  // and RPE MULTIPLIERS, so they pin bwLoad at 0 to isolate the external half.
  // The additive behaviour itself is covered in its own block below.
  const ext = (st: LogSet) => setVolume(st, VOLUME.unweightedRepKg, 1, 0);

  it('is load × reps for a plain weighted set', () => {
    expect(ext(plain)).toBeCloseTo(500, 5);
  });

  // The scalar that recovers work the app was silently discarding: reps are
  // logged PER SIDE and nothing else in the codebase doubles them.
  it('doubles a /side set', () => {
    expect(ext(notated({ weight: 100, reps: 5 }, ['/side']))).toBeCloseTo(1000, 5);
  });

  it('raises a paused set', () => {
    const paused = ext(notated({ weight: 100, reps: 5 }, ['(p)']));
    expect(paused).toBeGreaterThan(ext(plain));
    expect(paused).toBeCloseTo(500 * VOLUME.pauseFactor, 5);
  });

  it('raises a tempo set, and the bare p / t older logs carry, the same as (p)', () => {
    const paused = ext(notated({ weight: 100, reps: 5 }, ['(p)']));
    expect(ext(notated({ weight: 100, reps: 5 }, ['(t)']))).toBeCloseTo(paused, 5);
    expect(ext(notated({ weight: 100, reps: 5 }, ['p']))).toBeCloseTo(paused, 5);
    expect(ext(notated({ weight: 100, reps: 5 }, ['t', '/side']))).toBeCloseTo(paused * 2, 5);
  });

  it('stacks /side and (p)', () => {
    expect(ext(notated({ weight: 100, reps: 5 }, ['/side', '(p)']))).toBeCloseTo(
      500 * 2 * VOLUME.pauseFactor,
      5,
    );
  });

  it('ignores notations it does not price', () => {
    // (t) used to be one of these; it is priced like (p) now (work.ts always did).
    expect(ext(notated({ weight: 100, reps: 5 }, ['(v)', '→', '+5%']))).toBeCloseTo(500, 5);
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

// Recovers how many minutes one movement was allocated, by dividing a region
// total back through that movement's taxonomy weight. Valid only where the
// fixture gives the region a single contributor — which is why each caller
// names the region rather than letting this pick one.
function minutesVia(
  s: ReturnType<typeof summarizeBodyLoad>,
  movement: string,
  region: keyof ReturnType<typeof summarizeBodyLoad>['regionMinutes'],
): number {
  const w = (classifyMovement(movement).profile.regions as Record<string, number>)[region];
  return s.regionMinutes[region] / w;
}

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
    // Ski-Erg logged real time, so its conditioning block claims exactly that:
    // 10 minutes; back is lats 0.30 + upperBack 0.05 = 0.35 (docs/muscle-map-review.csv,
    // row 'ski erg interval', back 0.50 -> 0.35).
    expect(s.modalityMinutes.endurance).toBeCloseTo(10, 3);
    expect(s.regionMinutes.back).toBeCloseTo(10 * 0.35, 3);
    // ...and contributes nothing to the resistance-only tonnage readout.
    expect(s.resistanceTonnage.back).toBe(0);
  });

  it('distributes a movement across its regions by weight', () => {
    // One movement, one hour: the whole clock is the squat's, so each region
    // gets exactly its taxonomy share of 60 minutes. Read the weights from the
    // taxonomy rather than restating them — this test is about the distribution
    // mechanics, not about what a squat works, and hardcoding the split makes
    // every weight tune look like a broken test.
    const s = summarizeBodyLoad([
      log([{ key: 'primary', items: [item('Back Squat', 'weight', [set({ weight: 100, reps: 5 })])] }], {
        total_seconds: 3600,
      }),
    ]);
    const regions = classifyMovement('Back Squat').profile.regions as Record<string, number>;
    for (const [region, weight] of Object.entries(regions)) {
      expect(s.regionMinutes[region as keyof typeof s.regionMinutes]).toBeCloseTo(60 * weight, 3);
    }
  });

  it('routes an unclassifiable movement to unmapped and to no region', () => {
    const s = summarizeBodyLoad([mixed]);
    expect(s.unmapped.map((u) => u.name)).toEqual(['Wtd']);
    expect(s.unmapped[0].sessions).toBe(1);
    const regionTotal = Object.values(s.regionMinutes).reduce((a, b) => a + b, 0);
    expect(regionTotal).toBeCloseTo(s.totalMinutes - s.unmapped[0].minutes, 3);
  });

  it('reports coverage as the classified share of minutes', () => {
    const s = summarizeBodyLoad([mixed]);
    const wtd = s.unmapped[0].minutes;
    expect(s.coverage).toBeCloseTo((s.totalMinutes - wtd) / s.totalMinutes, 5);
    expect(s.coverage).toBeLessThan(1);
  });

  it('tracks systemic minutes separately from regions', () => {
    // Ski-Erg is systemic and logged 10 real minutes; the curl is neither, and
    // takes the other 50. Systemic minutes therefore read exactly the erg.
    const s = summarizeBodyLoad([
      log(
        [
          { key: 'conditioning', items: [item('Ski-Erg Intervals', 'time', [set({ time: 600 })])] },
          { key: 'accessory', items: [item('Bicep Curl', 'weight', [set({ weight: 20, reps: 10 })])] },
        ],
        { total_seconds: 3600 },
      ),
    ]);
    expect(s.systemicMinutes).toBeCloseTo(10, 3);
  });

  // ---- session-clock allocation -------------------------------------------

  it('spends the whole session clock, not the time under tension', () => {
    const s = summarizeBodyLoad([{ ...mixed, total_seconds: 3600 } as WorkoutLog]);
    expect(s.totalMinutes).toBeCloseTo(60, 3);
    // Modality totals are a share of CLASSIFIED time, as they always were —
    // 'Wtd' has no regions and so no modality — but nothing else leaks: the
    // classified and unmapped halves account for the whole clock.
    const byModality = MODALITY_KEYS.reduce((a, k) => a + s.modalityMinutes[k], 0);
    const unmappedTotal = s.unmapped.reduce((a, u) => a + u.minutes, 0);
    expect(byModality + unmappedTotal).toBeCloseTo(60, 3);
  });

  it('leaves the remainder with resistance rather than endurance', () => {
    const s = summarizeBodyLoad([{ ...mixed, total_seconds: 3600, tags: ['strength'] } as WorkoutLog]);
    // The conditioning block logged 10 real minutes and claims exactly those.
    expect(s.modalityMinutes.endurance).toBeCloseTo(10, 3);
    // Everything else is the lift. Under the old currency this session read as
    // 71% endurance off 10 minutes of skiing against 4 minutes of squats.
    expect(s.modalityMinutes.resistance).toBeGreaterThan(s.modalityMinutes.endurance * 3);
  });

  it('gives a compound movement more of the remainder than an isolation one', () => {
    const s = summarizeBodyLoad([
      log(
        [
          {
            key: 'primary',
            items: [
              item('Back Squat', 'weight', [set({ weight: 100, reps: 5 })]),
              item('Bicep Curl', 'weight', [set({ weight: 20, reps: 5 })]),
            ],
          },
        ],
        { total_seconds: 3600 },
      ),
    ]);
    // quads come only from the squat, arms only from the curl.
    expect(minutesVia(s, 'Back Squat', 'quads')).toBeGreaterThan(
      minutesVia(s, 'Bicep Curl', 'arms'),
    );
  });

  it('sends a cooldown to mobility at 30s a set when it logged no time', () => {
    const s = summarizeBodyLoad([
      log(
        [
          { key: 'primary', items: [item('Back Squat', 'weight', [set({ weight: 100, reps: 5 })])] },
          {
            key: 'cooldown',
            items: [item('Hamstring Stretch', 'reps', [set({ reps: 10 }), set({ reps: 10 })])],
          },
        ],
        { total_seconds: 3600 },
      ),
    ]);
    expect(s.modalityMinutes.mobility).toBeCloseTo(1, 3);
    expect(s.modalityMinutes.resistance).toBeCloseTo(59, 3);
  });

  it('lets the classifier outrank the session tag', () => {
    // Tagged mobility, but every movement is resistance work. The tag is a
    // tiebreak, never an override — real logs carry exactly this mismatch.
    const s = summarizeBodyLoad([
      log(
        [{ key: 'accessory', items: [item('Dips', 'reps', [set({ reps: 10 })])] }],
        { total_seconds: 1800, tags: ['mobility'] },
      ),
    ]);
    expect(s.modalityMinutes.resistance).toBeCloseTo(30, 3);
    expect(s.modalityMinutes.mobility).toBe(0);
  });

  it('falls back to working minutes when the clock is not a measurement', () => {
    // 13 completed sets against a 0-second timer is a real session with the
    // timer off, not an abandoned one. It must not vanish.
    const s = summarizeBodyLoad([{ ...mixed, total_seconds: 0 } as WorkoutLog]);
    expect(s.totalMinutes).toBeGreaterThan(0);
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

describe('bodyweight pricing', () => {
  // v6: load ADDS instead of replacing, so a heavier athlete does more work on
  // the same bar — but only on a movement that actually carries them. A bench
  // (bwLoad 0) is still immune; a squat is not, and should not be.
  it('leaves loaded work alone only when the movement bears none of the athlete', () => {
    const loaded = set({ weight: 100, reps: 5 });
    expect(setVolume(loaded, 80, 1, 0)).toBe(setVolume(loaded, VOLUME.unweightedRepKg, 1, 0));
    expect(setVolume(loaded, 80, 1, 0.8)).toBeGreaterThan(setVolume(loaded, 40, 1, 0.8));
  });

  // The bug v6 exists to fix: under the old `weight ?? unweightedKg` an 86kg
  // lifter's bodyweight squat priced at 55.9 and the same squat with 20kg on the
  // bar priced at 20, so adding weight made the set score LESS.
  it('never prices a loaded set below the same movement unloaded', () => {
    const bw = set({ reps: 5 });
    const light = set({ weight: 20, reps: 5 });
    const heavy = set({ weight: 100, reps: 5 });
    const price = (st: LogSet) => setVolume(st, 55.9, 1, 0.8);
    expect(price(light)).toBeGreaterThan(price(bw));
    expect(price(heavy)).toBeGreaterThan(price(light));
  });

  // voice.ts writes weight 0 for "bodyweight"; `?? ` treated that as zero work.
  it('treats a weight of 0 as bodyweight, not as no work', () => {
    expect(setVolume(set({ weight: 0, reps: 5 }), 55.9, 1, 0.8)).toBeCloseTo(
      setVolume(set({ reps: 5 }), 55.9, 1, 0.8),
      5,
    );
  });

  // A movement with no estimate must land exactly where it did before v6, or the
  // change silently reprices every unmapped movement in the vocabulary.
  it('prices an unestimated movement exactly as it did before', () => {
    expect(setVolume(set({ reps: 10 }), 52)).toBeCloseTo(520, 5);
  });

  it('prices unloaded reps at whatever the caller passes', () => {
    expect(setVolume(set({ reps: 10 }), 52)).toBeCloseTo(520, 5);
  });

  it('scales an unloaded set with the lifter, not with a constant', () => {
    const pushups = set({ reps: 20 });
    expect(setVolume(pushups, 71.5)).toBeCloseTo(setVolume(pushups, 35.75) * 2, 5);
  });

  it('carries the price through summarizeTrainingVolume', () => {
    const jumps = log([{ key: 'primary', items: [item('Box Jump', 'reps', [set({ reps: 5 })])] }]);
    const flat = summarizeTrainingVolume([jumps]).modalityVolume.plyometric;
    const heavy = summarizeTrainingVolume([jumps], {}, new Map(), { unweightedKg: 80 })
      .modalityVolume.plyometric;
    expect(heavy).toBeCloseTo(flat * (80 / VOLUME.unweightedRepKg), 5);
  });

  it('carries the price through summarizeBodyLoad to the regions', () => {
    const jumps = log([{ key: 'primary', items: [item('Box Jump', 'reps', [set({ reps: 5 })])] }]);
    const flat = summarizeBodyLoad([jumps]).regionVolume.quads;
    const heavy = summarizeBodyLoad([jumps], {}, { unweightedKg: 80 }).regionVolume.quads;
    expect(flat).toBeGreaterThan(0);
    expect(heavy).toBeCloseTo(flat * (80 / VOLUME.unweightedRepKg), 5);
  });

  it('does not move minutes — the two currencies are independent', () => {
    const jumps = log([{ key: 'primary', items: [item('Box Jump', 'reps', [set({ reps: 5 })])] }]);
    expect(summarizeBodyLoad([jumps], {}, { unweightedKg: 80 }).regionMinutes.quads).toBeCloseTo(
      summarizeBodyLoad([jumps]).regionMinutes.quads,
      5,
    );
  });
});

describe('regionVolume', () => {
  const mixed = log([
    {
      key: 'primary',
      items: [item('Back Squat', 'weight', [set({ weight: 100, reps: 5 })])],
    },
    {
      key: 'conditioning',
      items: [item('Ski-Erg Intervals', 'time', [set({ time: 300 })])],
    },
    { key: 'accessory', items: [item('Wtd', 'reps', [set({ reps: 8, weight: 10 })])] },
  ]);

  it('distributes on the same profile weights as minutes', () => {
    const s = summarizeBodyLoad([mixed]);
    const squat = classifyMovement('Back Squat').profile;
    const wQuads = squat.regions.quads ?? 0;
    // Read ROM *and* bwLoad off the taxonomy rather than restating them: this
    // test is about the distribution mechanics, not the estimates. Since v6 the
    // base is no longer a bare 100 x 5 = 500 — a squat carries the athlete too.
    const base = setVolume(
      set({ weight: 100, reps: 5 }),
      VOLUME.unweightedRepKg,
      1,
      bwLoadFactor(squat),
    );
    // The Ski-Erg block now reaches quads too (0.04, row 'ski erg interval'), so
    // its share is added: read it from a log of the erg block alone.
    const ergOnly = summarizeBodyLoad([
      log([{ key: 'conditioning', items: [item('Ski-Erg Intervals', 'time', [set({ time: 300 })])] }]),
    ]);
    expect(ergOnly.regionVolume.quads).toBeCloseTo(160, 3);
    expect(s.regionVolume.quads).toBeCloseTo(
      base * romFactor(squat) * wQuads + ergOnly.regionVolume.quads,
      3,
    );
  });

  it('is non-zero for the erg work that reads as zero tonnage', () => {
    // This is the whole reason volume can be a body-map currency at all:
    // resistanceTonnage cannot see a Ski-Erg, and regionVolume can.
    const s = summarizeBodyLoad([mixed]);
    expect(s.resistanceTonnage.back).toBe(0);
    expect(s.regionVolume.back).toBeGreaterThan(0);
  });

  it('excludes unmapped work from every region, exactly as minutes does', () => {
    const s = summarizeBodyLoad([mixed]);
    expect(s.unmapped.map((u) => u.name)).toEqual(['Wtd']);
    // Region weights sum to 1 per movement, so classified volume lands in full:
    // squat 100×5 = 500 at its ROM factor, plus the Ski-Erg's 300s at
    // LOAD.repSeconds priced through the unweighted constant — the erg carries
    // no ROM estimate, so it scores the neutral 1.0. The unmapped 10×8 lands
    // nowhere.
    const squatProfile = classifyMovement('Back Squat').profile;
    const squat =
      setVolume(set({ weight: 100, reps: 5 }), VOLUME.unweightedRepKg, 1, bwLoadFactor(squatProfile)) *
      romFactor(squatProfile);
    const skiErg = (300 / LOAD.repSeconds) * VOLUME.unweightedRepKg;
    expect(romFactor(classifyMovement('Ski-Erg Intervals').profile)).toBe(1);
    const total = Object.values(s.regionVolume).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(squat + skiErg, 3);
  });

  it('is all zeroes with no work rather than NaN', () => {
    const s = summarizeBodyLoad([]);
    expect(Object.values(s.regionVolume).every((v) => v === 0)).toBe(true);
    const i = regionIntensities(s, 'volume');
    expect(Object.values(i).every((v) => v === 0)).toBe(true);
  });

  it('normalises the heat map against the busiest region in the chosen currency', () => {
    const s = summarizeBodyLoad([mixed]);
    const byVolume = regionIntensities(s, 'volume');
    expect(Math.max(...Object.values(byVolume))).toBe(1);
    // The two currencies can disagree about which region leads — that is the
    // point of offering both. Assert only that each is self-consistent.
    expect(Math.max(...Object.values(regionIntensities(s, 'minutes')))).toBe(1);
  });
});

describe('romFactor', () => {
  it('is 1.0 for a movement with no estimate — absence is never a penalty', () => {
    expect(romFactor(undefined)).toBe(1);
    expect(romFactor(null)).toBe(1);
    expect(romFactor({})).toBe(1);
  });

  it('is 1.0 for an isometric, which displaces nothing', () => {
    // The reason this metric is a RATIO and not kg·m. A Side Plank has load and
    // duration and zero displacement; true work would price it at nothing,
    // which is the same hole that stopped tonnage being a currency.
    for (const name of ['Side Plank', 'Plank', 'Pallof Press', 'Dead bug']) {
      expect(romFactor(classifyMovement(name).profile)).toBe(1);
    }
    expect(setVolume(set({ time: 60 }), VOLUME.unweightedRepKg, 1)).toBeGreaterThan(0);
  });

  it('ranks a squat above the reference and a calf raise well below it', () => {
    const squat = romFactor(classifyMovement('Back Squat').profile);
    const calf = romFactor(classifyMovement('Standing Calf Raise').profile);
    const bench = romFactor(classifyMovement('Bench Press').profile);
    expect(squat).toBeGreaterThan(1);
    expect(calf).toBeLessThan(0.5);
    expect(bench).toBeCloseTo(ROM.pushHorizontal / ROM.referenceM, 5);
    expect(squat).toBeGreaterThan(calf * 3);
  });

  it('separates two movements that were identical on tonnage alone', () => {
    // The whole point. Same load, same reps, different path length.
    const squat = classifyMovement('Back Squat').profile;
    const calf = classifyMovement('Standing Calf Raise').profile;
    const s = set({ weight: 100, reps: 10 });
    expect(setVolume(s)).toBe(setVolume(s)); // identical without ROM
    expect(setVolume(s, VOLUME.unweightedRepKg, romFactor(squat))).toBeGreaterThan(
      setVolume(s, VOLUME.unweightedRepKg, romFactor(calf)) * 3,
    );
  });

  it('rejects a nonsense estimate rather than zeroing the movement', () => {
    for (const rom of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(romFactor({ rom })).toBe(1);
    }
  });

  it('averages a compound rather than summing it', () => {
    // "Hip Flow + KB Halos" is two atoms. Summing would make a compound score
    // higher than either half for the same work.
    const c = classifyMovement('Back Squat + Bench Press').profile;
    const squat = classifyMovement('Back Squat').profile.rom!;
    const bench = classifyMovement('Bench Press').profile.rom!;
    expect(c.rom).toBeCloseTo((squat + bench) / 2, 5);
    expect(c.rom!).toBeLessThan(squat + bench);
  });

  it('skips atoms with no estimate instead of counting them as zero', () => {
    // One unestimated half of a compound must not drag the other half down.
    const c = classifyMovement('Back Squat + Plank').profile;
    expect(c.rom).toBeCloseTo(classifyMovement('Back Squat').profile.rom!, 5);
  });
});

describe('body lenses', () => {
  // Minutes and scaled volume are meaningful within a lens and misleading across
  // one: `setVolume` converts duration into rep-equivalents, so an hour of
  // cycling outweighs an entire squat session in a currency that claims to
  // measure load. These pin the split that makes the number mean one thing.
  const squats = item('Back Squat', 'weight', [set({ weight: 100, reps: 5 })]);
  const run = item('Run', 'time', [set({ time: 3600 })]);
  const stretch = item('Couch Stretch', 'time', [set({ time: 120 })]);
  const plank = item('Plank', 'time', [set({ time: 60 })]);
  const mixed = log([
    { key: 'primary', items: [squats] },
    { key: 'conditioning', items: [run] },
    { key: 'cooldown', items: [stretch] },
    { key: 'accessory', items: [plank] },
  ]);

  it('keeps loaded work out of the cardio lens and cardio out of strength', () => {
    const s = summarizeBodyLoad([mixed]);
    // The squat loads quads; the run does not appear there under `strength`
    // beyond the squat's own contribution, and vice versa for the cardio lens.
    expect(s.byLens.strength.volume.quads).toBeGreaterThan(0);
    expect(s.byLens.cardio.volume.quads).toBeGreaterThan(0);
    const strengthOnly = summarizeBodyLoad([log([{ key: 'primary', items: [squats] }])]);
    expect(s.byLens.strength.volume.quads).toBeCloseTo(strengthOnly.byLens.strength.volume.quads, 5);
  });

  it('files a plank as strength, not cardio — it is loaded core work', () => {
    const s = summarizeBodyLoad([log([{ key: 'accessory', items: [plank] }])]);
    expect(s.byLens.strength.minutes.core).toBeGreaterThan(0);
    expect(s.byLens.cardio.minutes.core).toBe(0);
  });

  // Stretching keeps its own lens rather than vanishing: a collapsed default
  // with no expansion is a removed feature.
  it('keeps mobility visible in its own lens', () => {
    const s = summarizeBodyLoad([log([{ key: 'cooldown', items: [stretch] }])]);
    expect(s.byLens.mobility.minutes.quads).toBeGreaterThan(0);
    expect(s.byLens.strength.minutes.quads).toBe(0);
  });

  it('adds up: every lens together is the all-modality total', () => {
    const s = summarizeBodyLoad([mixed]);
    for (const currency of ['minutes', 'volume'] as const) {
      const all = regionTotals(s, currency);
      for (const region of MUSCLE_REGION_KEYS) {
        const summed = BODY_LENS_KEYS.reduce((a, k) => a + regionTotals(s, currency, k)[region], 0);
        expect(summed).toBeCloseTo(all[region], 5);
      }
    }
  });

  // THE REGRESSION GUARD. `aspects.ts` and `coach/signals.ts` read this same
  // summary. Lenses were ADDED rather than filtered in precisely so the radar
  // and the coach could not move; if this drifts, they moved.
  it('leaves the all-modality totals exactly as they were', () => {
    const s = summarizeBodyLoad([mixed]);
    const viaLens = regionTotals(s, 'volume');
    expect(viaLens).toEqual(s.regionVolume);
    expect(regionTotals(s, 'minutes')).toEqual(s.regionMinutes);
    // and the fields the radar/coach actually read are untouched by lensing
    expect(s.totalMinutes).toBeGreaterThan(0);
    expect(s.modalityMinutes.endurance).toBeGreaterThan(0);
  });

  it('normalises the heat map within the chosen lens, not across all work', () => {
    const s = summarizeBodyLoad([mixed]);
    const strength = regionIntensities(s, 'volume', 'strength');
    expect(Math.max(...Object.values(strength))).toBeCloseTo(1, 5);
  });
});

// PREP_SECTIONS: warm-up and cooldown keep their minutes (time spent is time
// spent) but carry no volume, sets or tonnage.
describe('warm-up and cooldown carry no load', () => {
  const squats = item('Back Squat', 'weight', [set({ weight: 100, reps: 5 }), set({ weight: 100, reps: 5 })]);
  const goblet = item('Goblet Squat', 'weight', [set({ weight: 16, reps: 10 })]);
  const main = log([{ key: 'primary', items: [squats] }], { total_seconds: 1800 });
  const withPrep = log(
    [
      { key: 'warmup', items: [goblet] },
      { key: 'primary', items: [squats] },
      { key: 'cooldown', items: [goblet] },
    ],
    { total_seconds: 1800 },
  );

  it('leaves volume, hard sets and tonnage unchanged by a warm-up', () => {
    const a = summarizeBodyLoad([main]);
    const b = summarizeBodyLoad([withPrep]);
    expect(b.regionVolume).toEqual(a.regionVolume);
    expect(b.hardSetsByRegion).toEqual(a.hardSetsByRegion);
    expect(b.resistanceSets).toEqual(a.resistanceSets);
    expect(b.resistanceTonnage).toEqual(a.resistanceTonnage);
  });

  it('still spends the clock on the warm-up', () => {
    const b = summarizeBodyLoad([withPrep]);
    expect(b.totalMinutes).toBeCloseTo(30, 5);
  });

  it('leaves training volume unchanged by a warm-up', () => {
    expect(summarizeTrainingVolume([withPrep]).modalityVolume).toEqual(
      summarizeTrainingVolume([main]).modalityVolume,
    );
  });

  it('counts a cooldown-only session in full', () => {
    const yoga = log([{ key: 'cooldown', items: [goblet] }], { total_seconds: 1800 });
    const s = summarizeBodyLoad([yoga]);
    expect(Object.values(s.regionVolume).some((v) => v > 0)).toBe(true);
  });
});

describe('per-muscle twins', () => {
  // Realistic, multi-session: prep on both ends, a squat, a carry (endurance by
  // modality, loaded by set), a slash compound, a bodyweight pull-up and an erg.
  const week = [
    log(
      [
        { key: 'warmup', items: [item('Band Pull-Apart', 'reps', [set({ reps: 15 }), set({ reps: 15 })])] },
        {
          key: 'primary',
          items: [
            item('Back Squat', 'weight', [
              set({ weight: 100, reps: 5 }),
              set({ weight: 100, reps: 5 }),
              set({ weight: 100, reps: 5, completed: false }),
            ]),
          ],
        },
        {
          key: 'secondary',
          items: [
            item('Cable Fly/Machine Press', 'weight', [set({ weight: 30, reps: 12 }), set({ weight: 30, reps: 10 })]),
            item('Pull-up', 'reps', [set({ reps: 8 }), set({ reps: 6 })]),
          ],
        },
        {
          key: 'conditioning',
          items: [item('Farmer Carry', 'distance', [set({ weight: 32, distance: 40 }), set({ weight: 32, distance: 40 })])],
        },
        { key: 'cooldown', items: [item('Pigeon / Hip Stretch', 'time', [set({ time: 120 })])] },
      ],
      { id: 'a', total_seconds: 3600, tags: ['strength'] },
    ),
    log(
      [
        { key: 'warmup', items: [item('Goblet Squat', 'weight', [set({ weight: 16, reps: 10 })])] },
        { key: 'primary', items: [item('Ski Erg Interval', 'time', [set({ time: 240 }), set({ time: 240 })])] },
        { key: 'secondary', items: [item('Back Squat', 'weight', [set({ weight: 80, reps: 8 })])] },
      ],
      { id: 'b', total_seconds: 1500 },
    ),
  ];

  const childrenOf = (r: RegionKey) => MUSCLE_KEYS.filter((m) => MUSCLES[m].region === r);
  const rollUp = (rec: Record<MuscleKey, number>, r: RegionKey) =>
    childrenOf(r).reduce((a, m) => a + rec[m], 0);

  it('the fixture exercises what it claims to', () => {
    const s = summarizeBodyLoad(week);
    expect(s.unmapped).toEqual([]);
    expect(classifyMovement('Cable Fly/Machine Press').atoms).toHaveLength(2);
    expect(classifyMovement('Farmer Carry').profile.modality).toBe('endurance');
    expect(s.hardSetsByRegion.arms).toBeGreaterThan(0);
  });

  it('rolls up over each region to the region numbers', () => {
    const s = summarizeBodyLoad(week);
    for (const r of MUSCLE_REGION_KEYS) {
      expect(Math.abs(rollUp(s.muscleMinutes, r) - s.regionMinutes[r])).toBeLessThan(1e-9);
      expect(Math.abs(rollUp(s.muscleVolume, r) - s.regionVolume[r])).toBeLessThan(1e-9);
      expect(Math.abs(rollUp(s.resistanceSetsByMuscle, r) - s.resistanceSets[r])).toBeLessThan(1e-9);
      for (const lens of BODY_LENS_KEYS) {
        expect(Math.abs(rollUp(s.byLensMuscle[lens].minutes, r) - s.byLens[lens].minutes[r])).toBeLessThan(1e-9);
        expect(Math.abs(rollUp(s.byLensMuscle[lens].volume, r) - s.byLens[lens].volume[r])).toBeLessThan(1e-9);
      }
    }
  });

  it('fractional sets sum to one per completed resistance set, like resistanceSets', () => {
    const s = summarizeBodyLoad(week);
    const total = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);
    expect(total(s.resistanceSetsByMuscle)).toBeCloseTo(total(s.resistanceSets), 9);
  });

  it('prep sections carry minutes but no muscle volume or sets', () => {
    const prepOnly = log(
      [{ key: 'warmup', items: [item('Goblet Squat', 'weight', [set({ weight: 16, reps: 10 })])] },
       { key: 'primary', items: [item('Back Squat', 'weight', [set({ weight: 100, reps: 5 })])] }],
      { total_seconds: 1200 },
    );
    const mainOnly = log([{ key: 'primary', items: [item('Back Squat', 'weight', [set({ weight: 100, reps: 5 })])] }], {
      total_seconds: 1200,
    });
    const a = summarizeBodyLoad([mainOnly]);
    const b = summarizeBodyLoad([prepOnly]);
    expect(b.muscleVolume).toEqual(a.muscleVolume);
    expect(b.hardSetsByMuscle).toEqual(a.hardSetsByMuscle);
    expect(b.resistanceSetsByMuscle).toEqual(a.resistanceSetsByMuscle);
  });

  it('counts a squat as a WHOLE set for each muscle above the cutoff', () => {
    const squat = log([{ key: 'primary', items: [item('Back Squat', 'weight', [
      set({ weight: 100, reps: 5 }), set({ weight: 100, reps: 5 }), set({ weight: 100, reps: 5 }),
    ])] }]);
    const s = summarizeBodyLoad([squat]);
    const muscles = classifyMovement('Back Squat').profile.muscles;
    const cutoff = meaningfulMuscleShare(muscles);
    const above = (Object.keys(muscles) as MuscleKey[]).filter((m) => (muscles[m] ?? 0) >= cutoff).sort();
    expect(above).toEqual(['gluteMax', 'quads']);
    for (const m of MUSCLE_KEYS) expect(s.hardSetsByMuscle[m]).toBe(above.includes(m) ? 3 : 0);
  });

  it('cutoff worked examples match the comment on MUSCLE_SHARE_FLOOR', () => {
    const squat = classifyMovement('Back Squat').profile;
    // Top muscle is now quads 0.50 (row 'back squat'), so 0.25 x 0.5.
    expect(meaningfulMuscleShare(squat.muscles)).toBeCloseTo(0.125, 9);
    expect(meaningfulRegionShare(squat.regions)).toBeCloseTo(0.15, 9);

    const carry = classifyMovement('Farmer Carry').profile;
    // Row 'farmer carry': obliques 0.35 now leads, so the ratio (0.0875) beats the floor.
    expect(meaningfulMuscleShare(carry.muscles)).toBeCloseTo(0.25 * 0.35, 9);
    expect(0.25 * 0.35).toBeGreaterThan(MUSCLE_SHARE_FLOOR);
    const counted = (Object.keys(carry.muscles) as MuscleKey[])
      .filter((m) => (carry.muscles[m] ?? 0) >= meaningfulMuscleShare(carry.muscles))
      .sort();
    expect(counted).toEqual(
      ['forearms', 'gluteMed', 'obliques', 'traps'],
    );
  });

  it('counts a loaded carry toward muscle hard sets though it is not resistance', () => {
    const s = summarizeBodyLoad([
      log([{ key: 'conditioning', items: [item('Farmer Carry', 'distance', [set({ weight: 32, distance: 40 })])] }]),
    ]);
    // Row 'farmer carry': forearms 0.25 and gluteMed 0.12 both clear the 0.0875
    // cutoff; abs (0.06) and gluteMax (0.05) do not.
    expect(s.hardSetsByMuscle.forearms).toBe(1);
    expect(s.hardSetsByMuscle.gluteMed).toBe(1);
    expect(s.hardSetsByMuscle.abs).toBe(0);
    expect(Object.values(s.resistanceSetsByMuscle).every((v) => v === 0)).toBe(true);
  });

  // Phase C2 authored every built-in, so the estimated case is made with region-only
  // overrides, which expand through the default split and come back `split`.
  const FIXTURE_NAMES = [
    'band pull apart', 'back squat', 'cable fly', 'machine press', 'pull up', 'farmer carry',
    'pigeon', 'hip stretch', 'goblet squat', 'ski erg interval',
  ];

  it('coverage is 1 for the built-in profiles, which are all authored', () => {
    const s = summarizeBodyLoad(week);
    expect(s.muscleCoverage).toEqual({ minutes: 1, volume: 1, resistanceSets: 1, hardSets: 1, work: 1 });
  });

  it('coverage is 0 when every profile is split', () => {
    const split: OverrideMap = {};
    for (const name of FIXTURE_NAMES) split[name] = { regions: classifyMovement(name).profile.regions };
    for (const name of FIXTURE_NAMES) {
      expect(classifyMovement(name, { overrides: split }).profile.muscleSource).toBe('split');
    }
    const s = summarizeBodyLoad(week, split);
    expect(s.muscleCoverage).toEqual({ minutes: 0, volume: 0, resistanceSets: 0, hardSets: 0, work: 0 });
    expect(Object.values(s.muscleAuthored.minutes).every((v) => v === 0)).toBe(true);
  });

  it('coverage is 1 when every profile is authored', () => {
    // Re-author every movement in the fixture at muscle level via pm().
    // Start from the all-split overrides so the muscle overrides are what flips them.
    const authored: OverrideMap = {};
    for (const name of FIXTURE_NAMES) {
      const base = classifyMovement(name).profile;
      expect(
        classifyMovement(name, { overrides: { [name]: { regions: base.regions } } }).profile.muscleSource,
      ).toBe('split');
      authored[name] = { muscles: pm(base.muscles, base.modality ?? 'resistance', base.planes).muscles };
    }
    for (const name of Object.keys(authored)) {
      expect(classifyMovement(name, { overrides: authored }).profile.muscleSource).toBe('authored');
    }
    const s = summarizeBodyLoad(week, authored);
    expect(s.muscleCoverage).toEqual({ minutes: 1, volume: 1, resistanceSets: 1, hardSets: 1, work: 1 });
    expect(s.muscleAuthored.minutes).toEqual(s.muscleMinutes);
    expect(s.muscleAuthored.hardSets).toEqual(s.hardSetsByMuscle);
  });

  it('coverage is 0 for an empty window', () => {
    expect(summarizeBodyLoad([]).muscleCoverage.minutes).toBe(0);
  });

  it('muscleTotals and muscleIntensities mirror the region helpers', () => {
    const s = summarizeBodyLoad(week);
    expect(muscleTotals(s, 'minutes')).toBe(s.muscleMinutes);
    expect(muscleTotals(s, 'volume', 'strength')).toBe(s.byLensMuscle.strength.volume);
    const i = muscleIntensities(s, 'minutes');
    expect(Math.max(...Object.values(i))).toBeCloseTo(1, 9);
    expect(Object.values(i).every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Object.values(muscleIntensities(summarizeBodyLoad([]))).every((v) => v === 0)).toBe(true);
  });

  describe('work — loaded working sets split by share', () => {
    const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    // A hand-authored squat at the owner's worked example: 50 / 30 / 20.
    const squat: OverrideMap = {
      'back squat': { muscles: { quads: 0.5, gluteMax: 0.3, abs: 0.2 } },
    };
    const tenSquats = item(
      'Back Squat',
      'weight',
      Array.from({ length: 10 }, () => set({ weight: 100, reps: 5 })),
    );

    it('ten squat sets at 50/30/20 are quads 5, glutes 3, core 2', () => {
      const s = summarizeBodyLoad([log([{ key: 'primary', items: [tenSquats] }], { total_seconds: 3600 })], squat);
      expect(s.regionWork.quads).toBeCloseTo(5, 9);
      expect(s.regionWork.glutes).toBeCloseTo(3, 9);
      expect(s.regionWork.core).toBeCloseTo(2, 9);
      expect(s.muscleWork.quads).toBeCloseTo(5, 9);
      expect(s.muscleWork.gluteMax).toBeCloseTo(3, 9);
      expect(s.muscleWork.abs).toBeCloseTo(2, 9);
      expect(total(s.regionWork)).toBeCloseTo(10, 9);
      expect(total(s.muscleWork)).toBeCloseTo(10, 9);
    });

    it('counts a loaded carry, which resistanceSets does not', () => {
      const s = summarizeBodyLoad([
        log([{ key: 'conditioning', items: [item('Farmer Carry', 'distance', [set({ weight: 32, distance: 40 })])] }]),
      ]);
      expect(total(s.regionWork)).toBeCloseTo(1, 9);
      expect(total(s.muscleWork)).toBeCloseTo(1, 9);
      expect(total(s.resistanceSets)).toBe(0);
    });

    it('follows isLoadedSet: bodyweight reps count, an unloaded timed hold and an incomplete set do not', () => {
      const s = summarizeBodyLoad([
        log(
          [
            {
              key: 'primary',
              items: [
                item('Pull-up', 'reps', [set({ reps: 8 }), set({ reps: 6, completed: false })]),
                item('Plank', 'time', [set({ time: 60 })]),
              ],
            },
          ],
          { total_seconds: 1800 },
        ),
      ]);
      expect(total(s.regionWork)).toBeCloseTo(1, 9);
      expect(s.regionWork.core).toBe(0);
    });

    it('excludes warm-up and cooldown sets', () => {
      const s = summarizeBodyLoad([
        log([
          { key: 'warmup', items: [item('Goblet Squat', 'weight', [set({ weight: 16, reps: 10 })])] },
          { key: 'primary', items: [item('Pull-up', 'reps', [set({ reps: 8 })])] },
          { key: 'cooldown', items: [item('Goblet Squat', 'weight', [set({ weight: 16, reps: 10 })])] },
        ]),
      ]);
      // Only the pull-up. (A session with NOTHING outside prep counts in full
      // — see workingSections — so the working section is what makes this a
      // test of the exclusion.)
      expect(total(s.regionWork)).toBeCloseTo(1, 9);
      expect(total(s.muscleWork)).toBeCloseTo(1, 9);
      expect(s.regionWork.quads).toBe(0);
    });

    it('a run contributes no work, only minutes', () => {
      const s = summarizeBodyLoad([
        log([{ key: 'conditioning', items: [item('Run', 'time', [set({ time: 1800, distance: 5000 })])] }]),
      ]);
      expect(total(s.regionMinutes)).toBeGreaterThan(0);
      expect(total(s.regionWork)).toBe(0);
    });

    it('sums to the loaded working-set count, and per-lens work sums to the all-lens total', () => {
      const s = summarizeBodyLoad(week);
      let loaded = 0;
      for (const l of week) {
        for (const section of l.data.sections) {
          if (section.key === 'warmup' || section.key === 'cooldown') continue;
          for (const g of section.groups) {
            for (const it of g.items) {
              const profile = classifyMovement(it.movement).profile;
              loaded += it.sets.filter((st) => isLoadedSet(st, profile)).length;
            }
          }
        }
      }
      expect(loaded).toBeGreaterThan(0);
      expect(total(s.regionWork)).toBeCloseTo(loaded, 9);
      expect(total(s.muscleWork)).toBeCloseTo(loaded, 9);
      for (const r of MUSCLE_REGION_KEYS) {
        const byLens = BODY_LENS_KEYS.reduce((a, lens) => a + s.byLens[lens].work[r], 0);
        expect(byLens).toBeCloseTo(s.regionWork[r], 9);
      }
      for (const m of MUSCLE_KEYS) {
        const byLens = BODY_LENS_KEYS.reduce((a, lens) => a + s.byLensMuscle[lens].work[m], 0);
        expect(byLens).toBeCloseTo(s.muscleWork[m], 9);
      }
    });

    it('regionTotals / muscleTotals / *Intensities read work', () => {
      const s = summarizeBodyLoad(week);
      expect(regionTotals(s, 'work')).toBe(s.regionWork);
      expect(regionTotals(s, 'work', 'strength')).toBe(s.byLens.strength.work);
      expect(muscleTotals(s, 'work')).toBe(s.muscleWork);
      expect(muscleTotals(s, 'work', 'strength')).toBe(s.byLensMuscle.strength.work);
      expect(Math.max(...Object.values(regionIntensities(s, 'work')))).toBeCloseTo(1, 9);
      expect(Math.max(...Object.values(muscleIntensities(s, 'work')))).toBeCloseTo(1, 9);
      // Minutes still reads minutes.
      expect(regionTotals(s, 'minutes')).toBe(s.regionMinutes);
    });
  });
});
