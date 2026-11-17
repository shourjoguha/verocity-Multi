import { describe, expect, it } from 'vitest';
import {
  classifyIntent,
  countIntent,
  loggedRestAfter,
  emptyMix,
  mixShares,
  regionOverlap,
  restGap,
} from '@/lib/coach/intent';
import { setClockSeconds } from '@/lib/setTime';
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

const REP_FLOOR = TRAINING.hypertrophyReps.value[0];

const STRENGTH_MAX = TRAINING.strengthReps.value;

const verdict = (it: LogItem, g: LogGroup, setIndex = 0, sectionKey = 'primary') =>
  classifyIntent({
    item: it,
    group: g,
    setIndex,
    sectionKey,
    restBoundarySeconds: BOUNDARY,
    strengthRepMax: STRENGTH_MAX,
    hypertrophyRepFloor: REP_FLOOR,
  });

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
  // A dip set's clock cost (setup + work), priced like every other set.
  const W = (reps: number) => setClockSeconds(set({ weight: 20, reps }), classifyMovement('Weighted Dips').profile);
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
  // The owner's rules (2026-11-17), in order: conditioning block; 5 reps or
  // fewer; 6-7 reps on total rest; 8+ reps; reps alone when rest is missing.
  const six = (over: Partial<LogItem> = {}) => item('Back Squat', { sets: sets(3, 6), ...over });

  it('reads 5 reps or fewer as strength whatever the rest, single or superset', () => {
    const sq = item('Back Squat', { sets: sets(3, STRENGTH_MAX), restSeconds: 0 });
    const v = verdict(sq, group('single', [sq]));
    expect(v.intent).toBe('strength');
    expect(v.restAssumed).toBe(false);
    const bench = item('Bench Press', { sets: sets(3, 3) });
    const row = item('Barbell Row', { sets: sets(3, 8) });
    expect(verdict(bench, group('superset', [bench, row])).intent).toBe('strength');
  });

  it('reads 8+ reps as hypertrophy however long the rest', () => {
    const sq = item('Back Squat', { sets: sets(3, REP_FLOOR), restSeconds: 300 });
    expect(verdict(sq, group('single', [sq])).intent).toBe('hypertrophy');
  });

  it('6-7 reps: strength at the rest boundary, hypertrophy under it', () => {
    const long = six({ restSeconds: BOUNDARY });
    expect(verdict(long, group('single', [long])).intent).toBe('strength');
    const short = six({ restSeconds: BOUNDARY - 30 });
    expect(verdict(short, group('single', [short])).intent).toBe('hypertrophy');
  });

  it('a superset adds the partner set and its rest to the total', () => {
    // 60s after the bench, a row set, 60s after the row: each alone is under
    // the boundary, the total for the bench is over it.
    const bench = item('Bench Press', { sets: sets(3, 6), restSeconds: 60 });
    const row = item('Barbell Row', { sets: sets(3, 8), restSeconds: 60 });
    const v = verdict(bench, group('superset', [bench, row]));
    expect(v.restSeconds).toBeGreaterThanOrEqual(BOUNDARY);
    expect(v.intent).toBe('strength');
  });

  it('a superset with only an end-of-round rest counts the partner set and that rest', () => {
    const bench = item('Bench Press', { sets: sets(3, 6) });
    const row = item('Barbell Row', { sets: sets(3, 8) });
    const v = verdict(bench, group('superset', [bench, row], BOUNDARY));
    expect(v.restAssumed).toBe(false);
    expect(v.intent).toBe('strength');
  });

  it('reads loaded work in a conditioning block as conditioning, even at low reps', () => {
    // An EMOM or AMRAP has no rest tag by design — that is not missing data.
    const pu = item('Pull-Up', { sets: sets(5, 3) });
    const dp = item('Weighted Dips', { sets: sets(5, 8) });
    const v = verdict(pu, group('circuit', [pu, dp]), 0, 'conditioning');
    expect(v.intent).toBe('conditioning');
    expect(v.restAssumed).toBe(false);
  });

  it('reads an unlogged 6-7 rep set on its reps alone, and says so', () => {
    const sq = six();
    const v = verdict(sq, group('single', [sq]));
    expect(v.intent).toBe('strength');
    expect(v.restAssumed).toBe(true);
  });

  it('treats a picked 0s as a real choice, not an absent one', () => {
    const sq = six({ restSeconds: 0 });
    const v = verdict(sq, group('single', [sq]));
    expect(v.restAssumed).toBe(false);
    expect(v.restSeconds).toBe(0);
    expect(v.intent).toBe('hypertrophy');
  });

  it('grounds every boundary in the pack rather than inventing one', () => {
    expect(TRAINING.strengthRest.value[0]).toBe(TRAINING.hypertrophyRest.value);
    expect(STRENGTH_MAX).toBe(5);
    expect(REP_FLOOR).toBe(8);
  });
});

describe('loggedRestAfter — a superset rests at the end of the round', () => {
  it('puts the group rest after the last movement only', () => {
    const pu = item('Pull-Up', { sets: sets(2) });
    const dp = item('Weighted Dips', { sets: sets(2, 8) });
    const g = group('superset', [pu, dp], 90);
    expect(loggedRestAfter(pu, g, 0)).toBe(0);
    expect(loggedRestAfter(dp, g, 0)).toBe(90);
  });

  it('honours a movement that carries its own tag', () => {
    const pu = item('Pull-Up', { sets: sets(2), restSeconds: 45 });
    const dp = item('Weighted Dips', { sets: sets(2, 8) });
    expect(loggedRestAfter(pu, group('superset', [pu, dp], 90), 0)).toBe(45);
  });

  it('is null when nothing in the group was tagged', () => {
    const pu = item('Pull-Up', { sets: sets(2) });
    const dp = item('Weighted Dips', { sets: sets(2, 8) });
    expect(loggedRestAfter(pu, group('superset', [pu, dp]), 0)).toBeNull();
  });
});

describe('mixShares', () => {
  it('reports shares over every loaded set, with the assumed part beside it', () => {
    const m = { strength: 3, hypertrophy: 6, conditioning: 1, seconds: { strength: 0, hypertrophy: 0, conditioning: 0 }, assumed: 7 };
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
    const squat = item('Back Squat', { sets: sets(1, 6) });
    countIntent(mix, verdict(squat, group('single', [squat])), 3);
    expect(mix.strength).toBe(3);
    expect(mix.assumed).toBe(3);
  });

  it('leaves the assumption tally alone for a logged rest', () => {
    const mix = emptyMix();
    const squat = item('Back Squat', { sets: sets(1, 5), restSeconds: BOUNDARY });
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
