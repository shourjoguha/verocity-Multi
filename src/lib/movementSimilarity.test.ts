import { describe, expect, it } from 'vitest';
import { SIMILARITY } from '@/app.config';
import { classifyMovement } from '@/lib/movementTaxonomy';
import { compareMovements, isAcceptableSwap, regionCosine } from '@/lib/movementSimilarity';

// The calibration set. These are the measurements SIMILARITY.minRegionCosine
// was picked from, so they are the check that would catch a taxonomy edit
// moving a movement across the line — the threshold's justification is that
// nothing real sits between 0.43 and 0.95, and only a table like this can
// notice when that stops being true.
const MINOR: [string, string][] = [
  ['Pull-up', 'Lat Pulldown'],
  ['Dumbbell Bench Press', 'Barbell Bench Press'],
  ['Incline Bench Press', 'Bench Press'],
  ['Back Squat', 'Front Squat'],
  ['Back Squat', 'Leg Press'],
  ['Walking Lunge', 'Bulgarian Split Squat'],
  ['Bench Press', 'Push-up'],
  ['Pull-up', 'Chin-up'],
  ['Bicep Curl', 'Hammer Curl'],
  ['Tricep Pushdown', 'Skullcrusher'],
  ['Calf Raise', 'Seated Calf Raise'],
  ['Hip Thrust', 'Glute Bridge'],
  ['Farmer Carry', 'Suitcase Carry'],
];

const MAJOR: [string, string][] = [
  ['Bench Press', 'Overhead Press'],
  ['Back Squat', 'Romanian Deadlift'],
  ['Barbell Row', 'Med-Ball Throw'],
  // Isolation standing in for a compound. Both score ABOVE the cosine
  // threshold (0.899 and 0.929) and are rejected on shape instead — this pair
  // is the reason the isolation gate exists.
  ['Overhead Press', 'Lateral Raise'],
  ['Back Squat', 'Leg Extension'],
  // Same region profile, different modality.
  ['Hanging Leg Raise', 'Plank'],
];

describe('compareMovements', () => {
  it.each(MINOR)('%s → %s is a minor swap', (a, b) => {
    expect(compareMovements(a, b)).toBe('minor');
  });

  it.each(MAJOR)('%s → %s is a major swap', (a, b) => {
    expect(compareMovements(a, b)).toBe('major');
  });

  it('is symmetric', () => {
    for (const [a, b] of [...MINOR, ...MAJOR]) {
      expect(compareMovements(a, b)).toBe(compareMovements(b, a));
    }
  });

  it('calls a normalisation-equal pair the same movement, not a swap', () => {
    // The classifier's normaliser already folds these together, so adherence
    // must not report them as a substitution the athlete made.
    expect(compareMovements('Wtd Pull-up', 'Weighted Pull-up')).toBe('same');
    expect(compareMovements('Pull-ups', 'Pull-up')).toBe('same');
  });

  it('refuses to judge an unclassifiable name', () => {
    // No claim either way: an unverifiable substitution is not evidence of
    // adherence, and the caller treats this as a miss.
    expect(compareMovements('Bench Press', 'Zercher Widowmaker 9000')).toBe('unknown');
    expect(isAcceptableSwap('Bench Press', 'Zercher Widowmaker 9000')).toBe(false);
  });

  it('treats any conditioning as filling a conditioning slot', () => {
    // Region overlap is the wrong question for endurance: Run → Row Erg scores
    // 0.499 only because an erg pulls with the upper body. Run → Burpee passing
    // is intended, not an oversight.
    expect(compareMovements('Run', 'Row Erg')).toBe('minor');
    expect(compareMovements('Run', 'Bike')).toBe('minor');
    expect(compareMovements('Run', 'Burpee')).toBe('minor');
  });

  it('does not let conditioning stand in for lifting', () => {
    expect(compareMovements('Back Squat', 'Run')).toBe('major');
  });

  it('holds the measured gap the threshold sits in', () => {
    const score = (a: string, b: string) =>
      regionCosine(classifyMovement(a).profile.regions, classifyMovement(b).profile.regions);

    // Every non-endurance minor scores above the threshold...
    const minorScores = MINOR.filter(([a]) => classifyMovement(a).profile.modality !== 'endurance')
      .map(([a, b]) => score(a, b));
    expect(Math.min(...minorScores)).toBeGreaterThan(SIMILARITY.minRegionCosine);

    // ...and every major rejected ON COSINE (rather than on modality or shape)
    // scores well below it. The two isolation pairs are excluded here: they
    // score 0.899 and 0.929 and are rejected by the isolation gate, which is
    // the whole point of that gate.
    const cosineRejected: [string, string][] = [
      ['Bench Press', 'Overhead Press'],
      ['Back Squat', 'Romanian Deadlift'],
    ];
    expect(Math.max(...cosineRejected.map(([a, b]) => score(a, b)))).toBeLessThan(
      SIMILARITY.minRegionCosine,
    );
  });
});

describe('regionCosine', () => {
  it('is 1 for an identical shape and 0 for disjoint regions', () => {
    expect(regionCosine({ chest: 0.6, arms: 0.4 }, { chest: 0.6, arms: 0.4 })).toBeCloseTo(1);
    expect(regionCosine({ chest: 1 }, { quads: 1 })).toBe(0);
  });

  it('compares shape, not magnitude', () => {
    expect(regionCosine({ chest: 0.6, arms: 0.4 }, { chest: 0.3, arms: 0.2 })).toBeCloseTo(1);
  });

  it('is 0 against an empty profile rather than dividing by zero', () => {
    expect(regionCosine({ chest: 1 }, {})).toBe(0);
    expect(regionCosine({}, {})).toBe(0);
  });
});
