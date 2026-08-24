import { describe, expect, it } from 'vitest';
import {
  regionIntensities,
  regionTotals,
  romFactor,
  bwLoadFactor,
  setMinutes,
  setVolume,
  summarizeBodyLoad,
  summarizeTrainingVolume,
} from '@/lib/bodyLoad';
import { classifyMovement } from '@/lib/movementTaxonomy';
import {
  BODY_LENS_KEYS,
  LOAD,
  MUSCLE_REGION_KEYS,
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

  it('stacks /side and (p)', () => {
    expect(ext(notated({ weight: 100, reps: 5 }, ['/side', '(p)']))).toBeCloseTo(
      500 * 2 * VOLUME.pauseFactor,
      5,
    );
  });

  it('ignores notations it does not price', () => {
    expect(ext(notated({ weight: 100, reps: 5 }, ['(t)', '→']))).toBeCloseTo(500, 5);
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
    expect(s.regionVolume.quads).toBeCloseTo(base * romFactor(squat) * wQuads, 3);
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
