import { describe, expect, it } from 'vitest';
import { addSetWork, sessionWork, workBodyWeight, type WorkTotals } from '@/lib/work';
import { classifyMovement } from '@/lib/movementTaxonomy';
import { VOLUME, WORK, type SectionKey } from '@/app.config';
import type { LogItem, LogSet, UserStats, WorkoutLog } from '@/lib/types';

const BW = 86;

function set(actual: Partial<LogSet['actual']>, notations: string[] = []): LogSet {
  return {
    planned: null,
    notations,
    actual: { completed: true, prefilled: false, ...actual },
  };
}

function item(movement: string, primaryMetric: LogItem['primaryMetric'], sets: LogSet[]): LogItem {
  return { id: `i-${movement}`, movement, primaryMetric, sets };
}

function log(sections: { key: SectionKey; items: LogItem[] }[]): WorkoutLog {
  return {
    id: 'log-1',
    status: 'done',
    data: {
      sections: sections.map((s) => ({
        key: s.key,
        groups: [{ id: `g-${s.key}`, kind: 'single', items: s.items }],
      })),
    },
  } as unknown as WorkoutLog;
}

/** Work for one set of a named movement, through the real classifier. */
function work(movement: string, s: LogSet): WorkTotals {
  const totals: WorkTotals = { resistance: 0, cardio: 0 };
  const c = classifyMovement(movement);
  addSetWork(s, c.source === 'unknown' ? null : c.profile, BW, totals);
  return totals;
}

describe('workBodyWeight', () => {
  it('uses the stored bodyweight', () => {
    expect(workBodyWeight({ body_weight_kg: 86 } as UserStats)).toBe(86);
  });

  it('falls back coherently with the volume model when there is no row', () => {
    expect(workBodyWeight(null)).toBeCloseTo(VOLUME.unweightedRepKg / VOLUME.bodyweightFraction, 6);
  });

  it('rejects an implausible stored value rather than pricing work at zero', () => {
    expect(workBodyWeight({ body_weight_kg: 0 } as UserStats)).toBe(WORK.fallbackBodyWeightKg);
  });
});

describe('the resistance lane', () => {
  it('prices a bodyweight pull-up at bodyweight x range x reps', () => {
    // bwLoad 1.0, rom 0.6m — the reason the old tonnage figure read zero.
    expect(work('Pull-up', set({ reps: 10 })).resistance).toBeCloseTo(86 * 0.6 * 10, 4);
  });

  it('adds external weight on top of the borne share', () => {
    // A weighted pull-up can never price below the same movement unloaded.
    const plain = work('Pull-up', set({ reps: 5 })).resistance;
    const loaded = work('Pull-up', set({ reps: 5, weight: 20 })).resistance;
    expect(loaded).toBeCloseTo(plain + 20 * 0.6 * 5, 4);
    expect(loaded).toBeGreaterThan(plain);
  });

  it('treats a logged 0 as bodyweight, not as zero work', () => {
    expect(work('Pull-up', set({ reps: 5, weight: 0 })).resistance).toBeCloseTo(
      work('Pull-up', set({ reps: 5 })).resistance,
      4,
    );
  });

  it('separates a double-under from a squat by DISPLACEMENT, not by force', () => {
    // Both carry a large bodyweight share (0.65 vs 0.8), so force alone barely
    // tells them apart; the 0.05m rope clearance against a 0.55m squat is what
    // does, which is the whole reason `rom` is the second factor.
    const du = work('Double Under', set({ reps: 100 })).resistance;
    const squat = work('Back Squat', set({ reps: 100 })).resistance;
    expect(du).toBeCloseTo(86 * 0.65 * 0.05 * 100, 4);
    expect(squat / du).toBeGreaterThan(10);
  });

  it('doubles per-side work', () => {
    const one = work('Bulgarian Split Squat', set({ reps: 8 })).resistance;
    const both = work('Bulgarian Split Squat', set({ reps: 8 }, ['/side'])).resistance;
    expect(both).toBeCloseTo(one * 2, 4);
  });

  it('scales paused and tempo reps identically', () => {
    const plain = work('Back Squat', set({ reps: 5, weight: 100 })).resistance;
    const paused = work('Back Squat', set({ reps: 5, weight: 100 }, ['(p)'])).resistance;
    const tempo = work('Back Squat', set({ reps: 5, weight: 100 }, ['(t)'])).resistance;
    expect(paused).toBeCloseTo(plain * VOLUME.pauseFactor, 4);
    expect(tempo).toBeCloseTo(paused, 4);
  });

  it('ignores RPE — perceived effort is not work done', () => {
    const easy = work('Back Squat', set({ reps: 5, weight: 100, rpe: 6 })).resistance;
    const hard = work('Back Squat', set({ reps: 5, weight: 100, rpe: 10 })).resistance;
    expect(easy).toBeCloseTo(hard, 6);
  });

  it('scores nothing for a set that was not completed', () => {
    expect(work('Pull-up', set({ reps: 10, completed: false })).resistance).toBe(0);
  });

  it('prices an unmapped movement at the defaults rather than at zero', () => {
    const w = work('Wtd', set({ reps: 10 })).resistance;
    expect(w).toBeCloseTo(BW * VOLUME.bodyweightFraction * WORK.defaultRomM * 10, 4);
  });
});

describe('the cardio lane', () => {
  it('prices a run as bodyweight carried, discounted for horizontal travel', () => {
    expect(work('Run', set({ distance: 1000 })).cardio).toBeCloseTo(86 * 0.65 * 1000 * 0.1, 4);
  });

  it('makes a sled metre worth several running metres', () => {
    const sled = work('Sled Push', set({ distance: 50, weight: 150 })).cardio;
    const run = work('Run', set({ distance: 50 })).cardio;
    expect(sled / run).toBeGreaterThan(4);
  });

  it('counts the load on a carry', () => {
    const loaded = work('Farmer Carry', set({ distance: 200, weight: 48 })).cardio;
    const empty = work('Farmer Carry', set({ distance: 200 })).cardio;
    expect(loaded).toBeCloseTo(empty + 48 * 200 * 0.1, 4);
  });

  it('gives an erg a real force term despite bearing none of the athlete', () => {
    // bwLoad 0 is correct and would price a maximal 2km row at nothing; the
    // forceFactor override is the entire reason that field exists.
    expect(work('Ski Erg Intervals', set({ distance: 1000 })).cardio).toBeCloseTo(
      86 * 0.3 * 1000 * 0.1,
      4,
    );
    expect(work('Row Erg Intervals', set({ distance: 1000 })).cardio).toBeCloseTo(
      86 * 0.45 * 1000 * 0.1,
      4,
    );
  });

  it('converts calories to distance, per machine', () => {
    const cals = work('Row Erg Intervals', set({ calories: 20 })).cardio;
    const metres = work('Row Erg Intervals', set({ distance: 20 * 15 })).cardio;
    expect(cals).toBeCloseTo(metres, 4);
    // Ski buys less distance per calorie than row.
    expect(work('Ski Erg Intervals', set({ calories: 20 })).cardio).toBeLessThan(
      work('Ski Erg Intervals', set({ distance: 20 * 15 })).cardio,
    );
  });

  it('routes every bike name to cycling, not to the running profile', () => {
    // The regression: `bike` and `cycling` sat in rule:locomotion-endurance,
    // which IS the running profile, so a ride was priced per metre almost like
    // a run over distances four to six times longer. A 40km ride read 172,000
    // kg·m against a 10km run's 55,900.
    for (const name of ['Bike', 'Cycling', 'Bike Ride', 'Road Cycling']) {
      expect(work(name, set({ distance: 1000 })).cardio).toBeCloseTo(86 * 0.4 * 1000 * 0.05, 4);
    }
  });

  it('prices a cycled metre at about a third of a run metre', () => {
    const ratio =
      work('Bike', set({ distance: 1000 })).cardio / work('Run', set({ distance: 1000 })).cardio;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.4);
  });

  it('treats an air bike as a rower, not as a bicycle', () => {
    // Arms and legs against a fan, scored in calories. Its work per calorie
    // must land just above the rower's, where a road bike's per METRE lands far
    // below. The longer name fragment is what beats the `bike` rule.
    const perCal = (m: string) => work(m, set({ calories: 1 })).cardio;
    for (const name of ['Assault Bike', 'Echo Bike', 'Air Bike', 'Fan Bike']) {
      expect(perCal(name)).toBeGreaterThan(perCal('Row Erg Intervals'));
      expect(perCal(name)).toBeLessThan(perCal('Row Erg Intervals') * 1.25);
    }
    expect(perCal('Assault Bike')).toBeGreaterThan(perCal('Bike') * 0.9);
  });

  it('prefers a measured distance over a converted calorie count', () => {
    const both = work('Row Erg Intervals', set({ distance: 500, calories: 99 })).cardio;
    expect(both).toBeCloseTo(work('Row Erg Intervals', set({ distance: 500 })).cardio, 4);
  });
});

describe('time', () => {
  it('scores no work in either lane', () => {
    // A minute says nothing about how much was moved. Isometrics keep their
    // minutes on the body map instead.
    expect(work('Plank', set({ time: 120 }))).toEqual({ resistance: 0, cardio: 0 });
    expect(work('Run', set({ time: 1800 }))).toEqual({ resistance: 0, cardio: 0 });
  });
});

describe('sessionWork', () => {
  it('keeps the two lanes separate', () => {
    const w = sessionWork(
      log([
        { key: 'primary', items: [item('Pull-up', 'reps', [set({ reps: 10 })])] },
        { key: 'conditioning', items: [item('Run', 'distance', [set({ distance: 1000 })])] },
      ]),
      BW,
    );
    expect(w.resistance).toBeCloseTo(86 * 0.6 * 10, 4);
    expect(w.cardio).toBeCloseTo(86 * 0.65 * 1000 * 0.1, 4);
  });

  it('scores a bodyweight-and-erg session that tonnage read as zero', () => {
    // The Hyrox case: nothing here has a weight field, and `sessionVolume`
    // returns exactly 0 for all of it.
    const w = sessionWork(
      log([
        {
          key: 'conditioning',
          items: [
            item('Pull-up', 'reps', [set({ reps: 30 })]),
            item('Dips', 'reps', [set({ reps: 30 })]),
            item('Ski Erg Intervals', 'cal', [set({ calories: 60 })]),
            item('Run', 'distance', [set({ distance: 4000 })]),
          ],
        },
      ]),
      BW,
    );
    expect(w.resistance).toBeGreaterThan(2000);
    expect(w.cardio).toBeGreaterThan(20000);
  });
});
