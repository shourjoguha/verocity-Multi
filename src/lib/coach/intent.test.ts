import { describe, expect, it } from 'vitest';
import {
  DENSE_REST_SECONDS,
  RELATED_OVERLAP,
  classifyIntent,
  emptyMix,
  mixShares,
  regionOverlap,
} from '@/lib/coach/intent';
import { TRAINING } from '@/lib/coach/knowledge';
import { isLoadedSet, meaningfulRegionShare } from '@/lib/bodyLoad';
import { classifyMovement } from '@/lib/movementTaxonomy';
import type { LogGroup, LogItem, LogSet } from '@/lib/types';

const BOUNDARY = TRAINING.strengthRest.value[0];

const set = (over: Partial<LogSet['actual']> = {}): LogSet =>
  ({
    planned: null,
    notations: [],
    actual: { completed: true, prefilled: false, ...over },
  }) as LogSet;

const item = (movement: string, over: Partial<LogItem> = {}): LogItem =>
  ({
    id: movement,
    movement,
    primaryMetric: 'weight',
    sets: [set({ weight: 60, reps: 8 })],
    ...over,
  }) as LogItem;

const group = (kind: LogGroup['kind'], items: LogItem[], restSeconds?: number): LogGroup =>
  ({ id: 'g', kind, items, restSeconds }) as LogGroup;

const verdict = (it: LogItem, g: LogGroup) =>
  classifyIntent({ item: it, group: g, restBoundarySeconds: BOUNDARY });

describe('regionOverlap', () => {
  it('is 1 for a movement against itself', () => {
    const r = classifyMovement('Back Squat').profile.regions;
    expect(regionOverlap(r, r)).toBe(1);
  });

  it('is 0 for a push against a pull', () => {
    const bench = classifyMovement('Bench Press').profile.regions;
    const curl = classifyMovement('Leg Curl').profile.regions;
    expect(regionOverlap(bench, curl)).toBe(0);
  });

  it('is high for two movements that train the same legs', () => {
    const squat = classifyMovement('Back Squat').profile.regions;
    const lunge = classifyMovement('Reverse Lunge').profile.regions;
    expect(regionOverlap(squat, lunge)).toBeGreaterThan(RELATED_OVERLAP);
  });
});

describe('classifyIntent', () => {
  it('reads long rest on a lone movement as strength', () => {
    const squat = item('Back Squat', { restSeconds: BOUNDARY });
    expect(verdict(squat, group('single', [squat])).intent).toBe('strength');
  });

  it('keeps it strength when the superset partner is unrelated', () => {
    // The corpus's own caveat: Galpin "explicitly allows the rest to be filled
    // by supersetting an unrelated muscle group — resting is not the same as
    // standing still." A flat "superset means not-strength" rule is wrong.
    const squat = item('Back Squat', { restSeconds: BOUNDARY });
    const press = item('Bench Press');
    expect(verdict(squat, group('superset', [squat, press])).intent).toBe('strength');
  });

  it('demotes it when the partner fatigues the same muscles', () => {
    const squat = item('Back Squat', { restSeconds: BOUNDARY });
    const lunge = item('Reverse Lunge');
    const v = verdict(squat, group('superset', [squat, lunge]));
    expect(v.partnerOverlap).toBeGreaterThanOrEqual(RELATED_OVERLAP);
    expect(v.intent).toBe('hypertrophy');
  });

  it('reads short rest against a related partner as loaded conditioning', () => {
    const squat = item('Back Squat', { restSeconds: DENSE_REST_SECONDS });
    const lunge = item('Reverse Lunge');
    expect(verdict(squat, group('superset', [squat, lunge])).intent).toBe('conditioning');
  });

  it('reads the middle as hypertrophy', () => {
    const squat = item('Back Squat', { restSeconds: BOUNDARY - 30 });
    expect(verdict(squat, group('single', [squat])).intent).toBe('hypertrophy');
  });

  it('falls back to the group rest when the item has none', () => {
    const squat = item('Back Squat');
    expect(verdict(squat, group('single', [squat], BOUNDARY)).intent).toBe('strength');
  });

  it('says unspecified rather than guessing when no rest was prescribed', () => {
    // Unspecified loaded items look statistically like the short-rest band, but
    // that is a correlation over a few dozen items. Treating an absent value as
    // a measured one is the mistake the RPE prefill already taught this
    // codebase.
    const squat = item('Back Squat');
    const v = verdict(squat, group('single', [squat]));
    expect(v.intent).toBe('unspecified');
    expect(v.restSeconds).toBeNull();
  });

  it('takes the most related partner in a circuit, not the first', () => {
    const squat = item('Back Squat', { restSeconds: BOUNDARY });
    const press = item('Bench Press');
    const lunge = item('Reverse Lunge');
    expect(verdict(squat, group('circuit', [squat, press, lunge])).intent).toBe('hypertrophy');
  });

  it('grounds its boundary in the pack rather than inventing one', () => {
    // 120s arrives from both directions: strengthRest's floor and
    // hypertrophyRest's ceiling are the same number.
    expect(TRAINING.strengthRest.value[0]).toBe(TRAINING.hypertrophyRest.value);
    expect(DENSE_REST_SECONDS).toBeLessThan(TRAINING.hypertrophyRest.value);
  });
});

describe('mixShares', () => {
  it('reports shares over the sets that said, and carries the rest separately', () => {
    const m = { ...emptyMix(), strength: 3, hypertrophy: 6, conditioning: 1, unspecified: 40 };
    const out = mixShares(m);
    expect(out.specified).toBe(10);
    expect(out.shares.hypertrophy).toBe(0.6);
    expect(out.unspecified).toBe(40);
  });

  it('does not divide by zero when nothing stated a rest', () => {
    const out = mixShares({ ...emptyMix(), unspecified: 9 });
    expect(out.specified).toBe(0);
    expect(out.shares.strength).toBe(0);
  });
});

describe('isLoadedSet — what counts toward hard-set volume', () => {
  const carry = classifyMovement('Farmer Carry').profile;
  const squat = classifyMovement('Back Squat').profile;
  const walk = classifyMovement('Walk').profile;
  const pullup = classifyMovement('Pull-ups').profile;

  it('counts a loaded carry, whatever its modality says', () => {
    // A carry classifies as endurance for the body map and the radar, which is
    // correct and unchanged. It is still weight moved by muscle.
    expect(carry.modality).not.toBe('resistance');
    expect(isLoadedSet(set({ weight: 32, reps: 1 }), carry)).toBe(true);
  });

  it('counts bodyweight work that was counted in reps', () => {
    expect(isLoadedSet(set({ reps: 10 }), pullup)).toBe(true);
  });

  it('does not count a walk logged as time or distance', () => {
    expect(isLoadedSet(set({ distance: 2000 }), walk)).toBe(false);
  });

  it('does not count an incomplete set', () => {
    expect(isLoadedSet(set({ completed: false, weight: 100, reps: 5 }), squat)).toBe(false);
  });
});

describe('meaningfulRegionShare', () => {
  const cut = (m: string) => meaningfulRegionShare(classifyMovement(m).profile.regions);
  const counted = (m: string) => {
    const r = classifyMovement(m).profile.regions;
    const c = meaningfulRegionShare(r);
    return Object.entries(r).filter(([, w]) => (w as number) >= c).map(([k]) => k).sort();
  };

  it('counts a squat for its glutes', () => {
    // The case that killed the first, flat, 0.2 threshold: Back Squat carries
    // `glutes 0.18`, so a squat counted for quads alone.
    expect(counted('Back Squat')).toEqual(['glutes', 'quads']);
  });

  it('counts a sled push for its calves', () => {
    // Sled Push is `calves 0.15`. Under a flat 0.2, 26 sets of sled added
    // nothing at all to calves.
    expect(counted('Sled Push')).toContain('calves');
  });

  it('does not enrol every muscle a movement brushes', () => {
    // Back Squat's core (0.12) and hamstrings (0.10) stay out: a squat is not a
    // hamstring exercise, and a cutoff that counted them would be no cutoff.
    expect(counted('Back Squat')).not.toContain('hamstrings');
  });

  it('does not penalise a movement that spreads wide', () => {
    // A carry's biggest region is only 0.35. A flat floor would lose almost all
    // of it — the relative cutoff keeps what the movement actually trains.
    expect(counted('Farmer Carry').length).toBeGreaterThan(2);
    expect(cut('Farmer Carry')).toBeLessThan(cut('Back Squat'));
  });

  it('keeps the fractional shares summing to one, which is why the bug existed', () => {
    const squat = classifyMovement('Back Squat').profile.regions;
    const total = Object.values(squat).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});
