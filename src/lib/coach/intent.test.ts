import { describe, expect, it } from 'vitest';
import {
  DENSE_REST_SECONDS,
  UNLOGGED_REST_SECONDS,
  classifyIntent,
  countIntent,
  emptyMix,
  mixShares,
  regionOverlap,
  restGap,
} from '@/lib/coach/intent';
import { LOAD, TIMERS } from '@/app.config';
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

const verdict = (it: LogItem, g: LogGroup, setIndex = 0) =>
  classifyIntent({ item: it, group: g, setIndex, restBoundarySeconds: BOUNDARY });

/** `n` completed sets of `reps`, each with rest-after `rest` when given. */
const sets = (n: number, reps = 5, rest?: number): LogSet[] =>
  Array.from({ length: n }, () => set({ weight: 20, reps, ...(rest != null ? { rest } : {}) }));

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
    expect(regionOverlap(squat, lunge)).toBeGreaterThan(0.5);
  });
});

describe('restGap — a superset alternates its sets', () => {
  const W = (reps: number) => reps * LOAD.repSeconds;
  const opts = { unloggedRestSeconds: 0 };
  const ov = regionOverlap(
    classifyMovement('Pull-Up').profile.regions,
    classifyMovement('Weighted Dips').profile.regions,
  );

  it('counts the partner set and its rest, discounted only where muscles are shared', () => {
    // pull-up 1, rest 60, dips 1 (8 reps), rest 90, pull-up 2.
    const pu = item('Pull-Up', { sets: sets(2, 5), restSeconds: 60 });
    const dp = item('Weighted Dips', { sets: sets(2, 8), restSeconds: 90 });
    const g = group('superset', [pu, dp]);
    const full = 60 + W(8) + 90;
    expect(restGap(g, 0, 0, opts).seconds).toBe(Math.round(full - ov * (60 + W(8))));
  });

  it('5 pull-ups against 4 dips: pull-up 5 follows dip 4, dip 4 is the last', () => {
    const pu = item('Pull-Up', { sets: sets(5), restSeconds: 60 });
    const dp = item('Weighted Dips', { sets: sets(4, 8), restSeconds: 90 });
    const g = group('superset', [pu, dp]);
    // Gap pull-up 4 -> 5 still has dip 4 (and its 90s) in it.
    expect(restGap(g, 0, 3, opts).seconds).toBeGreaterThan(60 + 90 - ov * (60 + W(8)) - 1);
    expect(restGap(g, 0, 3, opts).seconds).toBe(restGap(g, 0, 0, opts).seconds);
    // Dip 4 is the last dip: it reads the gap that led into it (dip 3 -> 4),
    // which has pull-up 4 in it.
    expect(restGap(g, 1, 3, opts).seconds).toBe(restGap(g, 1, 2, opts).seconds);
    expect(restGap(g, 1, 2, opts).seconds).toBeGreaterThan(90);
  });

  it('5 pull-ups against 6 dips: dip 5 -> 6 had no pull-up between, so only its own rest', () => {
    const pu = item('Pull-Up', { sets: sets(5), restSeconds: 60 });
    const dp = item('Weighted Dips', { sets: sets(6, 8), restSeconds: 90 });
    const g = group('superset', [pu, dp]);
    expect(restGap(g, 1, 4, opts).seconds).toBe(90);
    expect(restGap(g, 1, 3, opts).seconds).toBeGreaterThan(90);
  });

  it('reads a per-set rest as the rest AFTER that set', () => {
    const pu = item('Pull-Up', { sets: [...sets(1, 5, 180), ...sets(1)], restSeconds: 60 });
    expect(restGap(group('single', [pu]), 0, 0, opts).seconds).toBe(180);
  });

  it('follows the movement order: reordering changes whose rest sits where', () => {
    const pu = item('Pull-Up', { sets: sets(2), restSeconds: 60 });
    const dp = item('Weighted Dips', { sets: sets(2, 8), restSeconds: 90 });
    const a = restGap(group('superset', [pu, dp]), 0, 0, opts).seconds;
    const b = restGap(group('superset', [dp, pu]), 1, 0, opts).seconds;
    // Same rests either way round; what moves is which partner set falls in
    // the gap (k vs k+1), and with equal set counts the total is the same.
    expect(a).toBe(b);
  });

  it('ignores a partner set that was not completed', () => {
    const pu = item('Pull-Up', { sets: sets(2), restSeconds: 60 });
    const dp = item('Weighted Dips', { sets: [set({ weight: 20, reps: 8, completed: false }), ...sets(1, 8)], restSeconds: 90 });
    expect(restGap(group('superset', [pu, dp]), 0, 0, opts).seconds).toBe(60);
  });
});

describe('classifyIntent', () => {
  it('reads long rest on a lone movement as strength', () => {
    const squat = item('Back Squat', { restSeconds: BOUNDARY });
    expect(verdict(squat, group('single', [squat])).intent).toBe('strength');
  });

  it('never reads a push/pull superset with real rests as conditioning', () => {
    // The bug that removed the cutoff: Pull-Up and Dips overlap by exactly the
    // old 0.3 line, so 60s on the pull-up read as loaded conditioning — for a
    // pairing whose real spacing between pull-ups was 60 + a dip set + 60.
    // That spacing now lands at ~119s effective: hypertrophy, on the line.
    const pu = item('Pull-Up', { sets: sets(5), restSeconds: 60 });
    const dp = item('Weighted Dips', { sets: sets(4, 8), restSeconds: 60 });
    expect(verdict(pu, group('superset', [pu, dp])).intent).toBe('hypertrophy');
    // 90s each way is strength spacing.
    const pu90 = item('Pull-Up', { sets: sets(5), restSeconds: 90 });
    const dp90 = item('Weighted Dips', { sets: sets(4, 8), restSeconds: 90 });
    expect(verdict(pu90, group('superset', [pu90, dp90])).intent).toBe('strength');
  });

  it('keeps it strength when the partner is unrelated (filled rest)', () => {
    const squat = item('Back Squat', { sets: sets(3), restSeconds: 90 });
    const press = item('Bench Press', { sets: sets(3, 8), restSeconds: 60 });
    expect(verdict(squat, group('superset', [squat, press])).intent).toBe('strength');
  });

  it('a same-muscle partner buys less rest than an unrelated one, with no cutoff', () => {
    const squat = (r: number) => item('Back Squat', { sets: sets(3), restSeconds: r });
    const lunge = item('Reverse Lunge', { sets: sets(3, 8), restSeconds: 60 });
    const press = item('Bench Press', { sets: sets(3, 8), restSeconds: 60 });
    const sq = squat(60);
    const related = verdict(sq, group('superset', [sq, lunge])).restSeconds;
    const unrelated = verdict(sq, group('superset', [sq, press])).restSeconds;
    expect(related).toBeLessThan(unrelated);
  });

  it('reads near-zero rest inside a superset as loaded conditioning', () => {
    const squat = item('Back Squat', { sets: sets(3), restSeconds: 0 });
    const lunge = item('Reverse Lunge', { sets: sets(3, 8), restSeconds: 0 });
    const v = verdict(squat, group('superset', [squat, lunge]));
    expect(v.restSeconds).toBeLessThanOrEqual(DENSE_REST_SECONDS);
    expect(v.intent).toBe('conditioning');
  });

  it('never calls a lone movement conditioning, however short its rest', () => {
    const squat = item('Back Squat', { sets: sets(3), restSeconds: 0 });
    expect(verdict(squat, group('single', [squat])).intent).toBe('hypertrophy');
  });

  it('reads the middle as hypertrophy', () => {
    const squat = item('Back Squat', { restSeconds: BOUNDARY - 30 });
    expect(verdict(squat, group('single', [squat])).intent).toBe('hypertrophy');
  });

  it('falls back to the group rest when the item has none', () => {
    const squat = item('Back Squat');
    expect(verdict(squat, group('single', [squat], BOUNDARY)).intent).toBe('strength');
  });

  it('assumes a short rest when the picker was never touched, and says so', () => {
    const squat = item('Back Squat');
    const v = verdict(squat, group('single', [squat]));
    expect(v.restAssumed).toBe(true);
    expect(v.restSeconds).toBe(UNLOGGED_REST_SECONDS);
    expect(v.intent).toBe('hypertrophy');
  });

  it('marks the verdict assumed when only the partner rest was untouched', () => {
    const pu = item('Pull-Up', { sets: sets(2), restSeconds: 60 });
    const dp = item('Weighted Dips', { sets: sets(2, 8) });
    expect(verdict(pu, group('superset', [pu, dp])).restAssumed).toBe(true);
  });

  it('never calls an unlogged set strength work', () => {
    // The trap this constant exists to avoid: TIMERS.defaultRestSeconds is 120
    // and belongs to the on-screen countdown, not to what was rested. Reaching
    // for it here would put every untouched item exactly on the strength
    // boundary and classify most of a real log as strength.
    expect(TIMERS.defaultRestSeconds).toBeGreaterThanOrEqual(BOUNDARY);
    expect(UNLOGGED_REST_SECONDS).toBeLessThan(BOUNDARY);
    const squat = item('Back Squat');
    expect(verdict(squat, group('single', [squat])).intent).not.toBe('strength');
  });

  it('treats a picked 0s as a real choice, not an absent one', () => {
    const squat = item('Back Squat', { restSeconds: 0 });
    const v = verdict(squat, group('single', [squat]));
    expect(v.restAssumed).toBe(false);
    expect(v.restSeconds).toBe(0);
  });

  it('marks a logged rest as not assumed', () => {
    const squat = item('Back Squat', { restSeconds: BOUNDARY });
    expect(verdict(squat, group('single', [squat])).restAssumed).toBe(false);
  });

  it('grounds its boundary in the pack rather than inventing one', () => {
    // 120s arrives from both directions: strengthRest's floor and
    // hypertrophyRest's ceiling are the same number.
    expect(TRAINING.strengthRest.value[0]).toBe(TRAINING.hypertrophyRest.value);
    expect(DENSE_REST_SECONDS).toBeLessThan(TRAINING.hypertrophyRest.value);
  });
});

describe('mixShares', () => {
  it('reports shares over every loaded set, with the assumed part beside it', () => {
    const m = { strength: 3, hypertrophy: 6, conditioning: 1, assumed: 7 };
    const out = mixShares(m);
    expect(out.total).toBe(10);
    expect(out.shares.hypertrophy).toBe(0.6);
    // Assumed is NOT removed from the denominator — it overlaps the three.
    expect(out.assumed).toBe(7);
    expect(out.assumedShare).toBe(0.7);
  });

  it('does not divide by zero on an empty mix', () => {
    const out = mixShares(emptyMix());
    expect(out.total).toBe(0);
    expect(out.shares.strength).toBe(0);
    expect(out.assumedShare).toBe(0);
  });
});

describe('countIntent', () => {
  it('counts the verdict and tallies the assumption separately', () => {
    const mix = emptyMix();
    const squat = item('Back Squat');
    countIntent(mix, verdict(squat, group('single', [squat])), 3);
    expect(mix.hypertrophy).toBe(3);
    expect(mix.assumed).toBe(3);
  });

  it('leaves the assumption tally alone for a logged rest', () => {
    const mix = emptyMix();
    const squat = item('Back Squat', { restSeconds: BOUNDARY });
    countIntent(mix, verdict(squat, group('single', [squat])), 2);
    expect(mix.strength).toBe(2);
    expect(mix.assumed).toBe(0);
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
