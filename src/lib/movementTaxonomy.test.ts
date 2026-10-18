import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXACT,
  RULES,
  classifyMovement,
  isClassified,
  isPlaceholder,
  musclesFromRegions,
  normalizeMovementName,
  pm,
  regionsFromMuscles,
  splitCompound,
} from '@/lib/movementTaxonomy';
import { familyOf } from '@/lib/stats';
import {
  ACTIVITY_TYPES,
  BODY_LENSES,
  MUSCLES,
  MUSCLE_DEFAULT_SPLIT,
  MUSCLE_KEYS,
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  type MovementProfile,
  type MuscleWeights,
  type RegionWeights,
} from '@/app.config';

// The real production vocabulary, verbatim from the user's 46 logs. This list
// is the ratchet: every name here must classify, or the suite fails.
const VOCABULARY = [
  'Wall Balls',
  'Assault Bike',
  'Bike Ride',
  'Leg Curl',
  'Incline DB Bench',
  'Leg Extension',
  'Reverse Lunge',
  'Box Jump',
  'Hip Mobility Flow',
  'Pull-ups',
  'Back Squat',
  'Heel Elevated Back Squat',
  'Dead bug',
  'Hip Thrust Machine',
  'Iso-lateral Row',
  'Iso-Lateral Row',
  'Landmine Twist',
  'Ski-Erg Intervals',
  'Split-stance RDL',
  'Split-Stance RDL',
  'Calf Raises',
  'Couch Stretch',
  'DB Row',
  'Face Pulls',
  'Face Pull',
  'Front Squat',
  'Hanging knee raise',
  'KB Halos',
  'Landmine Press',
  'Pallof press',
  'Pallof Press',
  'Shoulder Prep',
  'Weighted Pull-up',
  'Zone 2 (row/bike/walk)',
  'Banded hip thrust',
  'Cycle',
  'Dips',
  'Farmer carry',
  'Farmer Carry',
  'Gorilla Rows',
  'Gorilla Row',
  'Hip Flow + KB Halos',
  'Hip mobility flow',
  'KB Swing',
  'Med-Ball Throw',
  'Nordic/Leg Curl',
  'Run',
  'Shoulder raise',
  'Side plank',
  'Sled drag',
  'Sled push',
  'Sled Push',
  'Standing Calf Raise',
  'Ab Wheel Roller',
  'Ab Wheel Rollout',
  'Abb routine 2',
  'Adductor work',
  'Band pull-apart',
  'Bulgarian Split Squat',
  'Cable Fly/Machine Press',
  'Cossack Squat',
  'KB Snatch',
  'machine crunches',
  'Machine Press',
  'Overhead Triceps',
  'Pigeon / Hip Stretch',
  'Pistol',
  'Rower Intervals',
  'Stairmaster',
  'Standing Barbell Military Press',
  'Trap Bar DL',
  'Weighted Dips',
  // Dataset-informed CrossFit/Hyrox additions.
  'Thruster',
  'Muscle-up',
  'Rope Climb',
  'V-Up',
  'Double-Under',
  'Single-Under',
  'Burpee',
  'Dumbbell-Facing Burpee',
  'Handstand Push-up',
  'Push-up',
  'Inverted Row',
  'Nordic Curl',
  // A curtsy squat, spelled as the real log spells it.
  'Kirsty squat',
  // Phase C2: the logged names the review CSV (docs/muscle-map-review.csv)
  // re-homed, plus four library movements that were unknown.
  'Toes-to-Bar',
  'Dumbbell Snatch',
  'Overhead Squat',
  'Kneeling landmine press',
  'Shoulder Stretch',
  'Tricep Pushdown',
  'Skull crusher',
  'Romanian Deadlift',
  'Single-leg RDL',
  'Deficit Trap Bar DL',
  'Devil Press',
  'Burpee Box Step-Over',
  'Pull-to-Stand',
];

// Names the lateral and court-sport rules were added for, plus the neighbours
// they must not capture. Fed to the shuffle test below, because every one of
// them is a longest-fragment contest against an older, shorter rule.
const LATERAL_AND_COURT = [
  'Padel',
  'Tennis',
  'Squash',
  'Pickleball',
  'Badminton',
  'Lateral Lunge',
  'Side Lunge',
  'Lateral Step-Up',
  'Curtsy Lunge',
  'Curtsey Squat',
  'Lateral Bound',
  'Skater Jump',
  'Skater Bound',
  'Copenhagen Plank',
  'Copenhagen Adduction',
  'Skater Squat',
  'Walking Lunge',
  'Tennis Elbow Curl',
];

// Mobility drills named "... Mobility" so one search finds them. Each is a
// longest-fragment contest against the generic 'mobility' / 'stretch' rule, so
// they join the shuffle test too.
const NAMED_MOBILITY = [
  'Shoulder Mobility Prep',
  'Shoulder mobility flow',
  'Shoulder CARs Mobility',
  'Wall Slides',
  'Band Pull-apart Mobility',
  'Thoracic Spine Mobility',
  'T-Spine Mobility',
  'Thoracic Rotation',
  'Open Book Mobility',
  'Cat-Cow Mobility',
  'Shin Box Mobility (90/90)',
  'Hip CARs Mobility',
  'Pigeon Mobility',
  'Couch Stretch Mobility',
  'Hip Flexor Stretch',
  'Ankle Mobility',
  'Hamstring Mobility',
  'Jefferson Curl Mobility',
  'Adductor Mobility',
  'Frog Stretch',
  'Deep Squat Mobility',
  'Tibialis Raise',
];

// Truncated at import — almost certainly "Weighted Pull-up" and "Deficit
// Deadlift". They cannot be resolved from the string, and must stay unknown
// rather than being bucketed somewhere plausible.
const UNCLASSIFIABLE = ['Wtd', 'Deficit'];

describe('normalizeMovementName', () => {
  it('collapses case and hyphen variants that appear in real logs', () => {
    expect(normalizeMovementName('Iso-Lateral Row')).toBe(normalizeMovementName('Iso-lateral Row'));
    expect(normalizeMovementName('Split-stance RDL')).toBe(
      normalizeMovementName('Split-Stance RDL'),
    );
    expect(normalizeMovementName('Sled push')).toBe(normalizeMovementName('Sled Push'));
    expect(normalizeMovementName('Pallof press')).toBe(normalizeMovementName('Pallof Press'));
    expect(normalizeMovementName('Farmer carry')).toBe(normalizeMovementName('Farmer Carry'));
    expect(normalizeMovementName('Hip Mobility Flow')).toBe(
      normalizeMovementName('Hip mobility flow'),
    );
  });

  it('collapses singular and plural', () => {
    expect(normalizeMovementName('Face Pulls')).toBe(normalizeMovementName('Face Pull'));
    expect(normalizeMovementName('Gorilla Rows')).toBe(normalizeMovementName('Gorilla Row'));
    expect(normalizeMovementName('Calf Raises')).toBe('calf raise');
    expect(normalizeMovementName('Pull-ups')).toBe('pull up');
    expect(normalizeMovementName('Dips')).toBe('dip');
    expect(normalizeMovementName('machine crunches')).toBe('machine crunch');
  });

  it('expands the abbreviations used in the logs', () => {
    expect(normalizeMovementName('Incline DB Bench')).toBe('incline dumbbell bench');
    expect(normalizeMovementName('KB Swing')).toBe('kettlebell swing');
    expect(normalizeMovementName('Trap Bar DL')).toBe('trap bar deadlift');
    expect(normalizeMovementName('Split-stance RDL')).toBe('split stance romanian deadlift');
  });

  it('drops bare trailing digits', () => {
    expect(normalizeMovementName('Abb routine 2')).toBe('ab routine');
  });

  it('folds the curtsy spellings onto one token', () => {
    expect(normalizeMovementName('Kirsty squat')).toBe('curtsy squat');
    expect(normalizeMovementName('Curtsey Lunges')).toBe('curtsy lunge');
  });

  // This is the familyOf bug, written as a test.
  it('strips parenthesised content so it cannot leak match fragments', () => {
    const n = normalizeMovementName('Zone 2 (row/bike/walk)');
    expect(n).toBe('zone');
    expect(n).not.toContain('row');
  });
});

describe('splitCompound', () => {
  it('splits slash and plus compounds into atoms', () => {
    expect(splitCompound('Cable Fly/Machine Press')).toEqual(['cable fly', 'machine press']);
    expect(splitCompound('Nordic/Leg Curl')).toEqual(['nordic', 'leg curl']);
    expect(splitCompound('Pigeon / Hip Stretch')).toEqual(['pigeon', 'hip stretch']);
    expect(splitCompound('Hip Flow + KB Halos')).toEqual(['hip flow', 'kettlebell halo']);
  });

  it('does not split on a slash inside parentheses', () => {
    expect(splitCompound('Zone 2 (row/bike/walk)')).toEqual(['zone']);
  });
});

describe('coverage of the production vocabulary', () => {
  it.each(VOCABULARY)('classifies %s', (name) => {
    const c = classifyMovement(name);
    expect(c.source).not.toBe('unknown');
    expect(c.unresolvedAtoms).toEqual([]);
    expect(Object.keys(c.profile.regions).length).toBeGreaterThan(0);
    expect(c.profile.modality).not.toBeNull();
  });

  it.each(VOCABULARY)('gives %s normalised region and plane weights', (name) => {
    const { regions, planes } = classifyMovement(name).profile;
    const regionSum = Object.values(regions).reduce((a, b) => a + b, 0);
    const planeSum = Object.values(planes).reduce((a, b) => a + b, 0);
    expect(regionSum).toBeCloseTo(1, 3);
    expect(planeSum).toBeCloseTo(1, 3);
    for (const k of Object.keys(regions)) expect(MUSCLE_REGION_KEYS).toContain(k);
    for (const k of Object.keys(planes)) expect(PLANE_KEYS).toContain(k);
  });

  // The "never silently bucketed" guarantee.
  it.each(UNCLASSIFIABLE)('leaves %s unknown rather than guessing', (name) => {
    const c = classifyMovement(name);
    expect(c.source).toBe('unknown');
    expect(c.profile.regions).toEqual({});
    expect(c.profile.modality).toBeNull();
  });

  it('keys every EXACT entry by its own normalised form', () => {
    for (const key of Object.keys(EXACT)) {
      expect(normalizeMovementName(key)).toBe(key);
    }
  });
});

describe('the misfires this taxonomy exists to avoid', () => {
  it('separates rowing-the-machine from rowing-the-barbell', () => {
    expect(classifyMovement('Rower Intervals').profile.modality).toBe('endurance');
    expect(classifyMovement('Gorilla Row').profile.modality).toBe('resistance');
  });

  it('does not read "throw" as "row"', () => {
    expect(classifyMovement('Med-Ball Throw').profile.modality).toBe('plyometric');
    expect(classifyMovement('Med-Ball Throw').profile.regions.back ?? 0).toBeLessThan(0.5);
  });

  it('treats Zone 2 as systemic endurance, not a pull', () => {
    const c = classifyMovement('Zone 2 (row/bike/walk)');
    expect(c.profile.modality).toBe('endurance');
    expect(c.profile.systemic).toBe(true);
  });

  it('reads Bulgarian Split Squat as a unilateral pattern, not a back squat', () => {
    const c = classifyMovement('Bulgarian Split Squat');
    expect(c.matchedIds[0]).toBe('exact:bulgarian split squat');
    // More posterior-chain bias than a bilateral back squat.
    const posterior = (r: typeof c.profile.regions) =>
      (r.hamstrings ?? 0) + (r.glutes ?? 0);
    const bss = posterior(c.profile.regions);
    const back = posterior(classifyMovement('Back Squat').profile.regions);
    expect(bss).toBeGreaterThan(back);
  });

  it('reads Ski-Erg as upper-body endurance, not a leg movement', () => {
    const c = classifyMovement('Ski-Erg Intervals');
    expect(c.profile.modality).toBe('endurance');
    expect(c.profile.regions.back).toBeGreaterThan(0);
    // The reviewed muscles give it a small hip-hinge share (quads 0 -> 0.04 in
    // docs/muscle-map-review.csv, row 'ski erg interval'): still not a leg movement.
    expect(c.profile.regions.quads ?? 0).toBeLessThan(0.1);
  });

  it('classifies Box Jump as plyometric', () => {
    expect(classifyMovement('Box Jump').profile.modality).toBe('plyometric');
  });
});

// Dataset-informed additions. These are the anatomies to review by eye — the
// green tick only proves they resolve and normalise, not that they are right.
describe('CrossFit/Hyrox movements added from the exercise dataset', () => {
  const dominant = (name: string) => {
    const regions = classifyMovement(name).profile.regions;
    return Object.entries(regions).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0];
  };

  it('maps Thruster to legs + shoulders (was unknown)', () => {
    const c = classifyMovement('Thruster');
    expect(c.source).toBe('exact');
    expect(c.profile.regions.quads).toBeGreaterThan(0);
    expect(c.profile.regions.shoulders).toBeGreaterThan(0);
    expect(c.profile.systemic).toBe(true);
  });

  it('maps Muscle-up and Rope Climb to a back/arms pull', () => {
    expect(dominant('Muscle-up')).toBe('back');
    expect(dominant('Rope Climb')).toBe('back');
    expect(classifyMovement('Muscle-up').profile.regions.arms).toBeGreaterThan(0);
  });

  it('maps V-Up to the trunk', () => {
    expect(classifyMovement('V-Up').profile.regions.core).toBeCloseTo(1, 3);
  });

  it('maps jump-rope work to calf-dominant endurance', () => {
    for (const name of ['Double-Under', 'Single-Under']) {
      const c = classifyMovement(name);
      expect(dominant(name), name).toBe('calves');
      expect(c.profile.modality, name).toBe('endurance');
    }
  });

  it('maps Burpee to systemic conditioning', () => {
    const c = classifyMovement('Burpee');
    expect(c.profile.modality).toBe('endurance');
    expect(c.profile.systemic).toBe(true);
  });

  // The correction: a handstand push-up is a vertical press, not a chest press.
  it('reads Handstand Push-up as a shoulder press, not chest', () => {
    const c = classifyMovement('Handstand Push-up');
    expect(c.source).toBe('exact');
    expect(dominant('Handstand Push-up')).toBe('shoulders');
    expect(c.profile.regions.chest ?? 0).toBe(0);
  });

  // Guard: the EXACT burpee entry must NOT swallow the burpee combos, which
  // now go to rule:burpee (conditioning, with the floor push) instead of the
  // jump rule they used to fall to by longest fragment (review CSV, rule:burpee).
  it('sends the burpee combos to the burpee rule, not the jump rule', () => {
    for (const name of ['Burpee Box Jump-Over', 'Burpee Broad Jump']) {
      const c = classifyMovement(name);
      expect(c.matchedIds, name).toEqual(['burpee']);
      expect(c.profile.modality, name).toBe('endurance');
    }
  });
});

// Bilateral squatting is anterior-leg work. Pinned because the naive reading —
// "a squat is a leg exercise, split it evenly" — is exactly what drifts back in.
describe('squat patterns are anterior-leg dominant', () => {
  it.each(['Back Squat', 'Front Squat', 'Cossack Squat'])(
    '%s puts quads well ahead of the posterior chain',
    (name) => {
      const { regions } = classifyMovement(name).profile;
      const posterior = (regions.hamstrings ?? 0) + (regions.glutes ?? 0);
      expect(regions.quads ?? 0).toBeGreaterThan(0.55);
      // Quads strictly dominant over the combined hamstring + glute share. The
      // heel-elevated front/back squat sits at 0.65/0.35, so the old "2×" pin no
      // longer holds — "clearly ahead", not "evenly split", is the real invariant.
      expect(regions.quads ?? 0).toBeGreaterThan(posterior);
    },
  );

  it('makes the front squat the most quad-dominant of the three', () => {
    const q = (n: string) => classifyMovement(n).profile.regions.quads ?? 0;
    expect(q('Front Squat')).toBeGreaterThan(q('Back Squat'));
  });

  it('reads the heel-elevated back squat as quad-dominant like the front squat', () => {
    const c = classifyMovement('Heel Elevated Back Squat');
    expect(c.source).toBe('exact');
    // Reviewed muscles (docs/muscle-map-review.csv): quads 0.70, gluteMax 0.15,
    // abs 0.10, obliques 0.05 -- no hamstring share.
    expect(c.profile.regions.quads).toBeCloseTo(0.7, 3);
    expect(c.profile.regions.glutes).toBeCloseTo(0.15, 3);
    expect(c.profile.regions.core).toBeCloseTo(0.15, 3);
    expect(c.profile.regions.hamstrings ?? 0).toBe(0);
  });

  it('keeps unilateral patterns more posterior than bilateral squats', () => {
    const pc = (n: string) => {
      const r = classifyMovement(n).profile.regions;
      return (r.hamstrings ?? 0) + (r.glutes ?? 0);
    };
    expect(pc('Bulgarian Split Squat')).toBeGreaterThan(pc('Back Squat'));
    expect(pc('Reverse Lunge')).toBeGreaterThan(pc('Back Squat'));
    // 'split squat' (11 chars) must beat 'squat' (5) on fragment length —
    // this is the order-independence guarantee doing real work.
    expect(classifyMovement('Hatfield Split Squat').matchedIds[0]).toBe('lunge-pattern');
  });
});

describe('plane and rotary axis', () => {
  it('distinguishes producing torque from resisting it', () => {
    const pallof = classifyMovement('Pallof Press').profile;
    const twist = classifyMovement('Landmine Twist').profile;
    expect(pallof.planes.transverse).toBeCloseTo(1, 3);
    expect(pallof.rotary).toBe('antiRotational');
    expect(twist.planes.transverse).toBeCloseTo(1, 3);
    expect(twist.rotary).toBe('rotational');
  });

  it('reads Side plank as frontal with no rotary role', () => {
    const c = classifyMovement('Side plank').profile;
    expect(c.planes.frontal).toBeCloseTo(1, 3);
    expect(c.rotary).toBeNull();
  });

  it('reads Cossack Squat as frontal-dominant', () => {
    const { planes } = classifyMovement('Cossack Squat').profile;
    expect(planes.frontal ?? 0).toBeGreaterThan(planes.sagittal ?? 0);
  });

  it('keeps Dead bug anti-rotational', () => {
    expect(classifyMovement('Dead bug').profile.rotary).toBe('antiRotational');
  });
});

// Court sports used to be unknown. What the entry is FOR is the plane: a match
// is mostly side-to-side footwork and rotation, and padel logged as 'Run' filed
// every minute of it as sagittal running.
describe('court and racket sports', () => {
  const COURT = ['Padel', 'Tennis', 'Squash', 'Pickleball', 'Badminton'];

  it('classifies Padel as systemic and not sagittal-only', () => {
    const c = classifyMovement('Padel');
    expect(isClassified(c)).toBe(true);
    expect(c.profile.systemic).toBe(true);
    expect(c.profile.planes.sagittal ?? 0).toBeLessThan(1);
    expect(c.matchedIds).not.toContain('exact:run');
  });

  it.each(COURT)('classifies %s as systemic endurance', (name) => {
    const c = classifyMovement(name);
    expect(c.matchedIds).toEqual(['racket-sport']);
    expect(c.profile.modality).toBe('endurance');
    expect(c.profile.systemic).toBe(true);
  });

  it.each(COURT)('weights %s toward the frontal and transverse planes', (name) => {
    const { planes } = classifyMovement(name).profile;
    const sagittal = planes.sagittal ?? 0;
    expect(planes.frontal ?? 0).toBeGreaterThan(sagittal);
    expect(planes.transverse ?? 0).toBeGreaterThan(sagittal);
  });

  it('spreads a match across legs, trunk and the hitting shoulder', () => {
    const { regions } = classifyMovement('Padel').profile;
    for (const r of ['quads', 'glutes', 'calves', 'core', 'shoulders'] as const) {
      expect(regions[r] ?? 0, r).toBeGreaterThan(0);
    }
  });

  it('catches a court sport named with a qualifier', () => {
    expect(classifyMovement('Padel Match').matchedIds).toEqual(['racket-sport']);
    expect(classifyMovement('Tennis (doubles)').matchedIds).toEqual(['racket-sport']);
  });

  // 'tennis' outlengthens every other fragment in these names, so without the
  // veto each would become an hour of court footwork.
  it('does not claim table tennis, a tennis ball, or tennis elbow', () => {
    expect(classifyMovement('Table Tennis').source).toBe('unknown');
    expect(classifyMovement('Tennis Ball Squeeze').source).toBe('unknown');
    expect(classifyMovement('Tennis Elbow Curl').matchedIds).toEqual(['arm-isolation']);
  });
});

// ActivityLogger writes the chosen quick-pick VERBATIM as the log's movement
// name, so this list is classifier input. An option that resolves to nothing is
// a way to log training the body map and the coach cannot see.
describe('ActivityLogger quick-picks', () => {
  it.each([...ACTIVITY_TYPES])('classifies %s', (name) => {
    expect(isClassified(classifyMovement(name))).toBe(true);
  });

  // Log Activity is the NON-strength logger, so no quick-pick may land in the
  // strength lens. 'Row' did: a rowing session was filed as barbell rows.
  it.each([...ACTIVITY_TYPES])('keeps %s out of the strength lens', (name) => {
    const { modality } = classifyMovement(name).profile;
    expect(BODY_LENSES.strength.modalities).not.toContain(modality);
  });

  // Tennis was added as a quick-pick so it stops being logged as 'Run'; it has
  // to land on exactly the court-sport profile Padel does, not a sibling.
  it('reads the Tennis quick-pick exactly as Padel', () => {
    expect(ACTIVITY_TYPES).toContain('Tennis');
    expect(classifyMovement('Tennis').matchedIds).toEqual(['racket-sport']);
    expect(classifyMovement('Tennis').profile).toEqual(classifyMovement('Padel').profile);
  });

  it('reads the Row quick-pick as systemic rowing conditioning', () => {
    const c = classifyMovement('Row');
    expect(c.matchedIds).toEqual(['exact:row']);
    expect(c.profile.modality).toBe('endurance');
    expect(c.profile.systemic).toBe(true);
  });
});

// A bare 'Row' is the rowing machine here — the shared library seeds it as a
// distance movement and the Hyrox sessions prescribe it in calories — while a
// strength row is always qualified. EXACT matches the whole name, so only the
// bare name moves.
describe("a bare 'Row' is the erg", () => {
  // Every estimate, not just the anatomy: the entry exists so a Log Activity
  // row prices like any other, and a missing forceFactor priced it at zero.
  it('classifies and prices Row exactly as Rower Intervals', () => {
    expect(classifyMovement('Row').profile).toEqual(classifyMovement('Rower Intervals').profile);
  });

  it.each([
    'Barbell Row',
    'DB Row',
    'Gorilla Row',
    'Iso-Lateral Row',
    'Landmine Row',
    'Seated Cable Row',
    'Bent-Over Row',
    'Ring Row',
  ])('leaves %s a resistance row', (name) => {
    const { profile } = classifyMovement(name);
    expect(profile.modality).toBe('resistance');
    expect(profile.regions.back ?? 0).toBeGreaterThan(0.5);
  });
});

// Lateral patterns fell to their sagittal family by longest fragment — 'lunge',
// 'bound', 'jump', 'squat', 'plank' — and inherited its plane with its anatomy.
// The lateral rules keep the family's anatomy and correct the plane.
describe('lateral patterns carry frontal-plane weight', () => {
  const planesOf = (name: string) => classifyMovement(name).profile.planes;
  const regionsOf = (name: string) => classifyMovement(name).profile.regions;

  it('reads Lateral Lunge as frontal-dominant, not pure sagittal', () => {
    const planes = planesOf('Lateral Lunge');
    expect(planes.sagittal ?? 0).toBeLessThan(1);
    expect(planes.frontal ?? 0).toBeGreaterThan(planes.sagittal ?? 0);
  });

  it.each(['Lateral Lunge', 'Side Lunge', 'Lateral Step-Up'])(
    'routes %s past the shorter lunge fragments',
    (name) => {
      expect(classifyMovement(name).matchedIds).toEqual(['lateral-lunge']);
    },
  );

  it.each(['Lateral Bound', 'Lateral Jump', 'Lateral Hop', 'Skater Jump', 'Skater Bound', 'Skater Hop'])(
    'reads %s as a frontal-dominant plyometric',
    (name) => {
      const c = classifyMovement(name);
      expect(c.matchedIds).toEqual(['lateral-plyo']);
      expect(c.profile.modality).toBe('plyometric');
      expect(c.profile.systemic).toBe(true);
      expect(c.profile.planes.frontal ?? 0).toBeGreaterThan(c.profile.planes.sagittal ?? 0);
    },
  );

  it.each(['Kirsty squat', 'Curtsy Squat', 'Curtsy Lunge', 'Curtsey Lunge'])(
    'reads %s as a crossover lunge, not a bilateral squat',
    (name) => {
      const c = classifyMovement(name);
      expect(c.matchedIds).toEqual(['curtsy-lunge']);
      expect(c.profile.planes.frontal ?? 0).toBeGreaterThan(0);
      expect(c.profile.planes.transverse ?? 0).toBeGreaterThan(0);
      expect(c.profile.planes.sagittal ?? 0).toBeLessThan(0.5);
    },
  );

  it('gives the curtsy squat a unilateral posterior share', () => {
    const pc = (n: string) => (regionsOf(n).hamstrings ?? 0) + (regionsOf(n).glutes ?? 0);
    expect(pc('Kirsty squat')).toBeGreaterThan(pc('Back Squat'));
  });

  it.each(['Copenhagen Plank', 'Copenhagen Adduction'])('reads %s as frontal adductor work', (name) => {
    const c = classifyMovement(name);
    expect(c.matchedIds).toEqual(['copenhagen']);
    expect(c.profile.planes.frontal).toBeCloseTo(1, 3);
    // Adductors fold into `quads` at this granularity, as in 'adductor work'.
    expect(c.profile.regions.quads ?? 0).toBeGreaterThan(0);
    expect(c.profile.regions.core ?? 0).toBeGreaterThan(0);
  });

  // Muscle-authored regions are sums of different addends, so equal-by-design
  // regions agree to floating point rather than bit-for-bit.
  const expectRegionsClose = (a: RegionWeights, b: RegionWeights) => {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      expect(a[k as keyof RegionWeights] ?? 0, k).toBeCloseTo(b[k as keyof RegionWeights] ?? 0, 9);
    }
  };

  it('keeps each lateral variant on its family anatomy — only the plane moved', () => {
    expectRegionsClose(regionsOf('Lateral Lunge'), regionsOf('Walking Lunge'));
    expectRegionsClose(regionsOf('Kirsty squat'), regionsOf('Walking Lunge'));
    // Skater Jump is no longer region-for-region Box Jump: the review gave
    // rule:lateral-plyo adductors and gluteMed (hamstrings 0.20 -> 0.10, core
    // 0 -> 0.05, glutes 0.20 -> 0.24, calves 0.10 -> 0.13). Still quad-led.
    const top = (r: RegionWeights) => Object.entries(r).sort((a, b) => b[1]! - a[1]!)[0]?.[0];
    expect(top(regionsOf('Skater Jump'))).toBe('quads');
    expect(top(regionsOf('Box Jump'))).toBe('quads');
  });

  // The neighbours the new fragments must NOT capture.
  it('leaves the sagittal and upper-body namesakes where they were', () => {
    // A single-leg squat, not a jump — the reason 'skater' alone is no fragment.
    expect(classifyMovement('Skater Squat').matchedIds).toEqual(['squat-pattern']);
    expect(classifyMovement('Walking Lunge').matchedIds).toEqual(['lunge-pattern']);
    expect(classifyMovement('Step-Up').matchedIds).toEqual(['lunge-pattern']);
    // Lateral raise left delt-isolation for rule:side-raise (review CSV).
    expect(classifyMovement('Lateral Raise').matchedIds).toEqual(['side-raise']);
    expect(classifyMovement('Iso-Lateral Row').matchedIds).toEqual(['exact:iso lateral row']);
    expect(classifyMovement('Side Plank').matchedIds).toEqual(['exact:side plank']);
    expect(planesOf('Reverse Lunge')).toEqual({ sagittal: 1 });
    expect(planesOf('Box Jump')).toEqual({ sagittal: 1 });
  });
});

// The generic mobility rule is hip-and-leg shaped, so a shoulder or spine drill
// named "... Mobility" landed on quads and glutes. The named rules put each
// drill on the joint it targets.
describe('named mobility drills land on their joint', () => {
  const top = (name: string) =>
    Object.entries(classifyMovement(name).profile.regions).sort((a, b) => b[1]! - a[1]!)[0]?.[0];

  it.each(NAMED_MOBILITY.filter((n) => n !== 'Tibialis Raise'))('reads %s as mobility, not a lift', (name) => {
    const c = classifyMovement(name);
    expect(c.profile.modality).toBe('mobility');
    expect(c.matchedIds).not.toEqual(['mobility']);
  });

  it.each([
    ['Shoulder Mobility Prep', 'shoulders'],
    ['Shoulder mobility flow', 'shoulders'],
    ['Shoulder CARs Mobility', 'shoulders'],
    ['Band Pull-apart Mobility', 'back'],
    ['Thoracic Spine Mobility', 'back'],
    ['T-Spine Mobility', 'back'],
    ['Cat-Cow Mobility', 'back'],
    ['Shin Box Mobility (90/90)', 'glutes'],
    ['Pigeon Mobility', 'glutes'],
    // Hip flexors (0.55) now lead quads (0.45): region core, per rule:hip-flexor-mobility.
    ['Couch Stretch Mobility', 'core'],
    ['Ankle Mobility', 'calves'],
    ['Hamstring Mobility', 'hamstrings'],
    ['Jefferson Curl Mobility', 'hamstrings'],
    ['Adductor Mobility', 'quads'],
  ])('puts %s on %s', (name, region) => {
    expect(top(name)).toBe(region);
  });

  it('keeps the exact names and the bare prehab lift where they were', () => {
    expect(classifyMovement('Couch Stretch').matchedIds).toEqual(['exact:couch stretch']);
    expect(classifyMovement('Hip Mobility Flow').matchedIds).toEqual(['exact:hip mobility flow']);
    expect(classifyMovement('Shoulder Prep').matchedIds).toEqual(['exact:shoulder prep']);
    expect(classifyMovement('Band pull-apart').matchedIds).toEqual(['exact:band pull apart']);
    expect(classifyMovement('Face Pull').profile.modality).toBe('resistance');
    expect(classifyMovement('Yoga').matchedIds).toEqual(['mobility']);
  });

  // The neighbours the new fragments must NOT capture.
  it('leaves loaded namesakes on their lifting rules', () => {
    expect(classifyMovement('Landmine Twist').matchedIds).toEqual(['exact:landmine twist']);
    expect(classifyMovement('Russian Twist').matchedIds).toEqual(['rotation']);
    expect(classifyMovement('Goblet Squat').profile.modality).toBe('resistance');
    expect(classifyMovement('Bicep Curl').matchedIds).toEqual(['arm-isolation']);
    expect(classifyMovement('Standing Calf Raise').profile.modality).toBe('resistance');
  });

  it('reads Tibialis Raise as lower-leg resistance work', () => {
    const c = classifyMovement('Tibialis Raise');
    expect(c.matchedIds).toEqual(['tibialis']);
    expect(c.profile.modality).toBe('resistance');
    expect(c.profile.regions).toEqual({ calves: 1 });
  });
});

describe('compounds', () => {
  it('merges both halves of a slash compound', () => {
    const c = classifyMovement('Cable Fly/Machine Press');
    expect(c.atoms).toHaveLength(2);
    expect(c.unresolvedAtoms).toEqual([]);
    expect(c.profile.regions.chest ?? 0).toBeGreaterThan(0.5);
  });

  it('collapses Nordic/Leg Curl onto one region', () => {
    expect(classifyMovement('Nordic/Leg Curl').profile.regions.hamstrings).toBeCloseTo(1, 3);
  });

  it('reads Hip Flow + KB Halos as mobility', () => {
    const c = classifyMovement('Hip Flow + KB Halos');
    expect(c.atoms).toHaveLength(2);
    expect(c.profile.modality).toBe('mobility');
  });

  it('reports a partial match when only one half resolves', () => {
    const c = classifyMovement('Deficit/Back Squat');
    expect(c.source).toBe('partial');
    expect(c.unresolvedAtoms).toContain('deficit');
    expect(c.profile.regions.quads ?? 0).toBeGreaterThan(0);
  });
});

describe('rule matching is order-independent', () => {
  it('gives identical results with the rule array shuffled', () => {
    const names = [...VOCABULARY, ...LATERAL_AND_COURT, ...NAMED_MOBILITY];
    const baseline = names.map((n) => JSON.stringify(classifyMovement(n).profile));
    const original = [...RULES];
    // Deterministic shuffle — no reliance on Math.random in a test.
    RULES.sort((a, b) => a.id.localeCompare(b.id));
    const shuffled = names.map((n) => JSON.stringify(classifyMovement(n).profile));
    RULES.length = 0;
    RULES.push(...original);
    expect(shuffled).toEqual(baseline);
  });
});

describe('overrides', () => {
  it('resolves a name that is otherwise unclassifiable', () => {
    const c = classifyMovement('Wtd', {
      overrides: {
        weighted: {
          regions: { back: 0.7, arms: 0.3 },
          modality: 'resistance',
          planes: { frontal: 1 },
        },
      },
    });
    expect(c.source).toBe('override');
    expect(c.profile.regions.back).toBeCloseTo(0.7, 3);
    expect(c.profile.modality).toBe('resistance');
  });

  it('merges partially, keeping rule-derived regions when only modality is set', () => {
    const c = classifyMovement('Back Squat', {
      overrides: { 'back squat': { modality: 'plyometric' } },
    });
    expect(c.profile.modality).toBe('plyometric');
    // Whatever the squat's quad weight currently is, the override must not
    // have disturbed it — that is the point of the partial merge.
    expect(c.profile.regions.quads).toBeCloseTo(
      classifyMovement('Back Squat').profile.regions.quads ?? 0,
      3,
    );
  });
});

// Pinned BECAUSE THEY ARE WRONG. familyOf drives the Stats RPE fingerprint and
// the Top-families cards; "fixing" these changes rendered output for the
// existing 46 logs, which would make the taxonomy work non-additive. If you
// want them fixed, that is a separate, deliberate change to Stats.
describe('familyOf is unchanged by the taxonomy work', () => {
  it('still returns its existing answers, misfires included', () => {
    expect(familyOf('Rower Intervals')).toBe('pull');
    expect(familyOf('Med-Ball Throw')).toBe('pull');
    expect(familyOf('Zone 2 (row/bike/walk)')).toBe('pull');
    // The taxonomy reads a bare 'Row' as the erg; Stats still calls it a pull.
    expect(familyOf('Row')).toBe('pull');
    expect(familyOf('Back Squat')).toBe('squat');
    expect(familyOf('Bulgarian Split Squat')).toBe('lunge');
  });
});

describe('bodyweight load (bwLoad)', () => {
  // These numbers are ESTIMATES reviewed as a set (docs/bwload-review.csv) and
  // no check can tell whether one is anatomically right — this block only pins
  // what was agreed, so a later edit has to be deliberate. `setVolume` ADDS
  // bwLoad x bodyweight to the external weight, so these decide how a bodyweight
  // set is priced against a loaded one.
  const bw = (name: string) => classifyMovement(name).profile.bwLoad;

  it('lifts the whole athlete on a strict vertical pull', () => {
    expect(bw('Pull-ups')).toBe(1);
    expect(bw('Chin-up')).toBe(1);
    expect(bw('Muscle-up')).toBe(1);
  });

  it('bears none of the athlete when they are supported by a bench or machine', () => {
    expect(bw('Bench Press')).toBe(0);
    expect(bw('Leg Press')).toBe(0);
    expect(bw('Dumbbell Row')).toBe(0);
    expect(bw('Bicep Curl')).toBe(0);
  });

  // The specific name and the generic RULE that covers its family must agree, or
  // the value turns on how the user happened to type it. These four pairs were
  // each a real split before review.
  it('agrees between an exact name and the rule that catches its variants', () => {
    expect(bw('Trap Bar Deadlift')).toBe(bw('Deadlift'));
    expect(bw('Farmer Carry')).toBe(bw('Suitcase Carry'));
    expect(bw('Sled Push')).toBe(bw('Sled Drag'));
    expect(bw('Nordic Curl')).toBe(bw('Nordic Leg Curl'));
  });

  // Three names that a RULE would price at the wrong end of the scale, because
  // the rule exists for the supported version of the same anatomy.
  it('separates the bodyweight variant from its machine namesake', () => {
    expect(bw('Push-up')).toBe(0.65);
    expect(bw('Bench Press')).toBe(0);
    expect(bw('Inverted Row')).toBe(0.6);
    expect(bw('Nordic Curl')).toBe(0.65);
    expect(bw('Leg Curl')).toBe(0);
  });

  // Every push-up variant bears the athlete. "Med-Ball Push-up" used to fall to
  // the bench/machine rule and score zero work on Stats.
  it('prices a push-up variant like the push-up, not like the bench', () => {
    expect(bw('Med-Ball Push-up')).toBe(bw('Push-up'));
    expect(bw('Deficit Push-up')).toBe(bw('Push-up'));
    expect(bw('Incline Bench Press')).toBe(0);
    expect(bw('Chest Press')).toBe(0);
  });

  it('does not let the push-up entry swallow the handstand push-up', () => {
    expect(bw('Handstand Push-up')).toBe(0.9);
  });

  // A lateral rule moves the plane, not how much of the athlete is lifted, so
  // each takes the price of the anatomy it borrows. The bounds take Box Jump's
  // and not jump-plyo's 0.3: that rule is a mixed bucket that also holds
  // throws, and every lateral bound projects the athlete's whole body.
  it('prices a lateral variant like the family whose anatomy it shares', () => {
    expect(bw('Lateral Lunge')).toBe(bw('Walking Lunge'));
    expect(bw('Kirsty squat')).toBe(bw('Walking Lunge'));
    expect(bw('Skater Jump')).toBe(bw('Box Jump'));
    expect(bw('Copenhagen Plank')).toBe(bw('Side Plank'));
  });

  // The `cycling` rule must not swallow the air bikes, which are a different
  // machine priced against a rower rather than a bicycle. Longest matched
  // fragment does the work — 'assault bike' beats 'bike' — so this holds
  // whatever order the rules sit in.
  it('does not let the cycling rule swallow the air bikes', () => {
    for (const name of ['Assault Bike', 'Echo Bike', 'Air Bike', 'Fan Bike']) {
      expect(classifyMovement(name).matchedIds).toEqual(['air-bike']);
    }
    for (const name of ['Bike', 'Cycling', 'Bike Ride', 'Road Cycling']) {
      expect(classifyMovement(name).matchedIds).toEqual(['cycling']);
    }
  });

  // A ride used to resolve to the RUNNING profile, because `bike` and `cycling`
  // sat in rule:locomotion-endurance. That rule keeps the names that really are
  // locomotion on your own legs.
  it('keeps cycling out of the locomotion rule', () => {
    expect(classifyMovement('Jog').matchedIds).toEqual(['locomotion-endurance']);
    expect(classifyMovement('Ruck').matchedIds).toEqual(['locomotion-endurance']);
  });

  // Absence is NOT zero: an unestimated movement falls back to the global
  // bodyweightFraction in setVolume, so mobility must stay undefined rather than
  // being priced at nothing.
  it('leaves an unestimated movement undefined rather than zero', () => {
    expect(bw('Couch Stretch')).toBeUndefined();
    expect(bw('Wtd')).toBeUndefined();
  });

  // Mirrors the ROM rule: an atom with no estimate is skipped, never counted as
  // zero, or one unestimated half of a compound would halve the other.
  it('averages a compound over the atoms that carry an estimate', () => {
    expect(bw('Pull-up + Dip')).toBeCloseTo(0.95, 5);
  });
});

// ---- muscles (docs/MUSCLE_MAP_PLAN.md, Phase C1) ---------------------------

const sumOf = (w: Record<string, number | undefined>) =>
  Object.values(w).reduce((a: number, b) => a + (b ?? 0), 0);

// Derived regions equal the profile's regions key-for-key within 1e-9 — the
// tolerance is tight on purpose: p() keeps region weights as authored and the
// split must round-trip them, not merely approximate them.
function expectRegionsConsistent(profile: MovementProfile) {
  const derived = regionsFromMuscles(profile.muscles);
  const keys = new Set([...Object.keys(derived), ...Object.keys(profile.regions)]);
  for (const k of keys) {
    const want = profile.regions[k as keyof RegionWeights] ?? 0;
    const got = derived[k as keyof RegionWeights] ?? 0;
    expect(Math.abs(got - want), k).toBeLessThan(1e-9);
  }
}

describe('the muscle vocabulary', () => {
  it('has exactly the 21 muscles of decision D1', () => {
    expect(MUSCLE_KEYS).toHaveLength(21);
  });

  it('gives every muscle a parent region that exists', () => {
    for (const m of MUSCLE_KEYS) {
      expect(MUSCLE_REGION_KEYS, m).toContain(MUSCLES[m].region);
    }
  });

  it('gives every region at least one muscle', () => {
    for (const r of MUSCLE_REGION_KEYS) {
      expect(MUSCLE_KEYS.some((m) => MUSCLES[m].region === r), r).toBe(true);
    }
  });

  it('has a default split for every region, summing to 1 over its own children only', () => {
    expect(Object.keys(MUSCLE_DEFAULT_SPLIT).sort()).toEqual(Object.keys(MUSCLE_REGIONS).sort());
    for (const r of MUSCLE_REGION_KEYS) {
      const split = MUSCLE_DEFAULT_SPLIT[r];
      expect(sumOf(split), r).toBeCloseTo(1, 12);
      for (const m of Object.keys(split)) {
        expect(MUSCLES[m as keyof typeof MUSCLES]?.region, `${r}.${m}`).toBe(r);
      }
    }
  });
});

// Phase C2 moved every entry to muscle-level authoring. An entry with no row in
// docs/muscle-map-review.csv would be named here and stay `split`; there are none.
const SPLIT_EXCEPTIONS: string[] = [];

describe('every profile carries muscles consistent with its regions', () => {
  const entries: [string, MovementProfile][] = [
    ...Object.entries(EXACT),
    ...RULES.map((r): [string, MovementProfile] => ['rule:' + r.id, r.profile]),
  ];

  it.each(entries)('%s', (_id, profile) => {
    expect(sumOf(profile.muscles)).toBeCloseTo(1, 3);
    expectRegionsConsistent(profile);
    if (SPLIT_EXCEPTIONS.includes(_id)) expect(profile.muscleSource).toBe('split');
    else expect(profile.muscleSource).toBe('authored');
  });

  it('expands a region weight through the default split', () => {
    expect(musclesFromRegions({ glutes: 0.5, chest: 0.5 })).toEqual({
      gluteMax: 0.4,
      gluteMed: 0.1,
      pecs: 0.5,
    });
  });

  it('pm() derives regions by summing muscles into their parents', () => {
    const muscles: MuscleWeights = { quads: 0.65, gluteMax: 0.15, abs: 0.15, forearms: 0.05 };
    const prof = pm(muscles, 'resistance', 'sagittal');
    expect(prof.muscleSource).toBe('authored');
    expect(prof.muscles).toEqual(muscles);
    expect(prof.regions).toEqual({ quads: 0.65, glutes: 0.15, core: 0.15, arms: 0.05 });
  });

  it('keeps consistent muscles through a compound merge', () => {
    for (const name of ['Hip Flow + KB Halos', 'Cable Fly/Machine Press', 'Deficit/Back Squat']) {
      const c = classifyMovement(name);
      expect(sumOf(c.profile.muscles), name).toBeCloseTo(1, 9);
      expectRegionsConsistent(c.profile);
    }
  });
});

describe('overrides at muscle level', () => {
  it('expands a region-only override through the default split', () => {
    const c = classifyMovement('Wtd', {
      overrides: { weighted: { regions: { back: 0.7, arms: 0.3 }, modality: 'resistance' } },
    });
    expect(c.profile.regions).toEqual({ back: 0.7, arms: 0.3 });
    expect(c.profile.muscles).toEqual(musclesFromRegions({ back: 0.7, arms: 0.3 }));
    expect(c.profile.muscleSource).toBe('split');
    expectRegionsConsistent(c.profile);
  });

  it('derives regions from a muscle override, which wins over stored regions', () => {
    const c = classifyMovement('Back Squat', {
      overrides: {
        'back squat': {
          muscles: { quads: 0.6, gluteMax: 0.3, adductors: 0.1 },
          regions: { chest: 1 },
        },
      },
    });
    expect(c.source).toBe('override');
    expect(c.profile.muscleSource).toBe('authored');
    expect(c.profile.regions.quads).toBeCloseTo(0.7, 12);
    expect(c.profile.regions.glutes).toBeCloseTo(0.3, 12);
    expect(c.profile.regions.chest).toBeUndefined();
  });

  it('keeps the matched muscles when the override sets neither weight map', () => {
    const c = classifyMovement('Back Squat', {
      overrides: { 'back squat': { modality: 'plyometric' } },
    });
    expect(c.profile.muscles).toEqual(classifyMovement('Back Squat').profile.muscles);
    expectRegionsConsistent(c.profile);
  });

  it('applies a per-atom override inside a compound consistently', () => {
    const c = classifyMovement('Hip Flow + KB Halos', {
      overrides: { 'kettlebell halo': { muscles: { sideDelts: 0.5, traps: 0.5 } } },
    });
    expect(c.source).toBe('override');
    expectRegionsConsistent(c.profile);
    // Both atoms are authored now (Phase C2), and so is a muscle override.
    expect(c.profile.muscleSource).toBe('authored');
  });

  it('marks a compound estimated when one atom carries only a region override', () => {
    // Every built-in is authored after C2, so the estimated half has to come
    // from a region-only override, which expands through the default split.
    const c = classifyMovement('Hip Flow + KB Halos', {
      overrides: { 'kettlebell halo': { regions: { shoulders: 1 } } },
    });
    expect(c.source).toBe('override');
    expectRegionsConsistent(c.profile);
    expect(c.profile.muscleSource).toBe('split');
  });

  it('drops unknown muscle ids from a stored override rather than inventing a parent', () => {
    const c = classifyMovement('Wtd', {
      overrides: { weighted: { muscles: { lats: 1, notAMuscle: 2 } as MuscleWeights } },
    });
    expect(c.profile.muscles).toEqual({ lats: 1 });
    expect(c.profile.regions).toEqual({ back: 1 });
  });
});

// ---- Phase C2: the reviewed CSV is the source of truth ----------------------

// Minimal quoted-CSV reader: the file is fully quoted, with "" for a literal
// quote and newlines possible inside a field. No dependency.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

const REVIEW = parseCsv(readFileSync('docs/muscle-map-review.csv', 'utf8'));

const csvMuscles = (r: Record<string, string>): MuscleWeights =>
  Object.fromEntries(
    (r.your_muscles || r.proposed_muscles)
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => {
        const [k, v] = t.split(':');
        return [k, Number(v)];
      }),
  ) as MuscleWeights;

describe('the review CSV is transcribed exactly (golden)', () => {
  const entryFor = (r: Record<string, string>): MovementProfile | undefined => {
    if (r.source === 'RULE' || r.source === 'NEW_RULE') {
      return RULES.find((x) => 'rule:' + x.id === r.key)?.profile;
    }
    if (r.source === 'EXACT' || r.source === 'NEW_EXACT') return EXACT[r.key];
    // An INVENTORY row with owner muscles became an EXACT keyed by its name.
    if (r.source === 'INVENTORY' && r.your_muscles) return EXACT[normalizeMovementName(r.key)];
    return undefined;
  };
  const rows = REVIEW.filter(
    (r) =>
      ['EXACT', 'RULE', 'NEW_RULE', 'NEW_EXACT'].includes(r.source) ||
      (r.source === 'INVENTORY' && r.your_muscles),
  );

  it('reads the CSV', () => {
    expect(rows.length).toBeGreaterThan(100);
  });

  it.each(rows.map((r) => [r.key, r] as const))('%s', (_key, r) => {
    const profile = entryFor(r);
    expect(profile, 'entry exists').toBeDefined();
    const want = csvMuscles(r);
    for (const k of new Set([...Object.keys(want), ...Object.keys(profile!.muscles)])) {
      expect(profile!.muscles[k as keyof MuscleWeights] ?? 0, k).toBeCloseTo(
        want[k as keyof MuscleWeights] ?? 0,
        2,
      );
    }
    const wantRegions = regionsFromMuscles(want);
    for (const k of new Set([...Object.keys(wantRegions), ...Object.keys(profile!.regions)])) {
      expect(Math.abs((profile!.regions[k as keyof RegionWeights] ?? 0) - (wantRegions[k as keyof RegionWeights] ?? 0)), k).toBeLessThan(0.005);
    }
    if (r.modality) expect(profile!.modality).toBe(r.modality);
    expect(profile!.muscleSource).toBe('authored');
  });

  it('carries the CSV match and not fragments for every rule', () => {
    // Treadmill and elliptical are in the CSV's locomotion match, but sit in
    // rule:machine-locomotion so they keep bwLoad 0 (tested below).
    const MOVED: Record<string, string[]> = { 'rule:locomotion-endurance': ['treadmill', 'elliptical'] };
    for (const r of REVIEW.filter((x) => x.source === 'RULE' || x.source === 'NEW_RULE')) {
      const rule = RULES.find((x) => 'rule:' + x.id === r.key)!;
      const moved = MOVED[r.key] ?? [];
      expect(rule.match, r.key).toEqual(r.match.split('|').filter((f) => !moved.includes(f)));
      expect(rule.not ?? [], r.key).toEqual(r.not ? r.not.split('|') : []);
    }
  });
});

// "must match / must not match" names from the CSV rationale, for every new rule
// and every rule whose fragments changed. A name that is an EXACT entry is
// asserted as `exact:<key>` in the comment, not here.
describe('rules split or changed by the review catch what their rationale says', () => {
  const CASES: [id: string, match: string[], notMatch: string[]][] = [
    ['erg-endurance', ['Row Erg', 'Concept2 Rower'], ['Ski Erg', 'Treadmill', 'Bike Erg']],
    [
      'locomotion-endurance',
      ['Walk', 'Incline walk', 'Reverse incline walk'],
      ['Zone 2 (row/bike/walk)', 'Treadmill', 'Elliptical'],
    ],
    ['machine-locomotion', ['Treadmill', 'Elliptical'], ['Walk', 'Ski Erg']],
    ['ski-erg', ['Ski Erg'], ['Rower Intervals', 'Row']],
    [
      'jump-plyo',
      ['Broad Jump', 'Tuck Jump', 'Single-leg Hop'],
      ['Med-Ball Throw', 'Clean', 'Push Jerk', 'Lateral Bound', 'Jumping Pull-up', 'Burpee Box Jump-Over', 'Jump Squat'],
    ],
    ['throw-slam', ['Ball Slam', 'Chest Pass'], ['Med-Ball Push-up', 'Row']],
    [
      'olympic-clean',
      ['Clean', 'Power Clean', 'Squat Clean', 'Dumbbell Hang Power Clean', 'Clean and Jerk'],
      ['Front Squat', 'Thruster'],
    ],
    [
      'olympic-snatch',
      ['Power Snatch', 'Hang Power Snatch', 'Low-Hang Squat Snatch', 'Dumbbell Hang Snatch', 'Dumbbell Snatch'],
      ['KB Snatch', 'Overhead Squat'],
    ],
    ['jerk', ['Push Jerk', 'Split Jerk', 'Clean and Jerk'], ['Push Press']],
    ['overhead-squat', ['Overhead Squat'], ['Back Squat', 'Air Squat']],
    [
      'squat-pattern',
      ['Air Squat'],
      ['Overhead Squat', 'Squat Clean', 'Low-Hang Squat Snatch', 'Deep Squat Mobility'],
    ],
    ['handstand-push-up', ['Pike Push-up', 'Wall Handstand Push-up'], ['Push-up', 'Knee Push-up']],
    [
      'push-up',
      ['Knee Push-up', 'Hand-Release Push-up', 'Med-Ball Push-up', 'Walkout to Push-up'],
      ['Pike Push-up', 'Handstand Push-up'],
    ],
    ['deadlift', ['Deadlift', 'Deficit Trap Bar DL', 'Sumo Deadlift', 'Suitcase Deadlift'], ['Romanian Deadlift', 'Single-leg RDL', 'Stiff-Leg Deadlift']],
    ['romanian-deadlift', ['Romanian Deadlift', 'Stiff-Leg Deadlift', 'DB RDL'], ['Deadlift', 'Trap Bar DL']],
    ['swing', ['Russian Kettlebell Swing', 'Dumbbell Swing'], ['KB swing', 'Leg Swing', 'Hip Swing']],
    ['mobility', ['Leg Swing', 'Hip Swing'], ['Russian Kettlebell Swing']],
    ['hamstring-isolation', ['Hamstring Curl', 'Seated Hamstring Curl'], ['Bicep Curl']],
    [
      'hinge-pattern',
      ['Good Morning'],
      ['Glute Bridge', 'Deadlift', 'Romanian Deadlift', 'KB swing', 'Hip Thrust Machine'],
    ],
    // 'Banded Hip Thrust' is an EXACT entry, so it never reaches the rule.
    [
      'hip-thrust',
      ['Hip Thrust', 'Single-leg Hip Thrust', 'Glute Bridge'],
      ['Hip Thrust Machine', 'Romanian Deadlift', 'Good Morning'],
    ],
    ['landmine-press', ['Half-kneeling Landmine Press'], ['Landmine Twist', 'Landmine Row']],
    [
      'vertical-push',
      ['Push Press', 'Shoulder Press', 'Dumbbell Push Press'],
      ['Half-kneeling Landmine Press', 'Push Jerk'],
    ],
    ['front-raise', ['Front Raise', 'Plate Front Raise'], ['Lateral Raise', 'Shoulder raise']],
    ['side-raise', ['Lateral Raise', 'Side Raise', 'Cable Lateral Raise'], ['Lateral Lunge', 'Front Raise']],
    ['rear-delt', ['Rear Delt Raise', 'Rear Delt Fly'], ['Reverse Fly', 'Face Pull']],
    [
      'delt-isolation',
      ['Dumbbell Shoulder Raise'],
      ['Lateral Raise', 'Front Raise', 'Rear Delt Fly'],
    ],
    ['upper-back-prehab', ['Reverse Fly'], ['Rear Delt Raise']],
    ['triceps-isolation', ['Tricep Pushdown', 'Skull crusher', 'Tricep Extension'], ['Bicep Curl', 'Overhead Triceps']],
    ['arm-isolation', ['Bicep Curl', 'Hammer Curl'], ['Leg Curl', 'Nordic', 'Tricep Pushdown']],
    ['ab-rollout', ['Ab Wheel', 'Barbell Rollout'], ['Crunch']],
    ['hanging-raise', ['Toes-to-Bar', 'Hanging Leg Raise', 'Knees-to-Elbows'], ['Lying Leg Raise']],
    ['leg-raise', ['Lying Leg Raise', "Captain's Chair Knee Raise"], ['Hanging Leg Raise', 'Toes-to-Bar']],
    ['sit-up', ['Sit-up', 'GHD Sit-up'], ['V-Up', 'Crunch']],
    ['core-dynamic', ['Crunch', 'Cable Crunch'], ['Ab Wheel Rollout', 'Hanging Leg Raise', 'Sit-up']],
    ['suitcase-carry', ['Suitcase Carry', 'Single-arm Suitcase Carry'], ['Farmer carry', 'Suitcase Deadlift']],
    ['carry', ['Dumbbell Farmers Carry'], ['Suitcase Carry']],
    [
      'burpee',
      ['Burpee Box Jump-Over', 'Burpee Broad Jump', 'Bar-Facing Burpee'],
      ['Burpee', 'Burpee Box Step-Over', 'Box Jump'],
    ],
    [
      'shoulder-mobility',
      ['Shoulder Mobility Prep', 'Shoulder Stretch', 'Wall Slides'],
      ['Shoulder Prep', 'Band Pull-apart Mobility'],
    ],
    ['mobility', ['Yoga', 'Dynamic Flow', 'General Stretch on Mat', "World's greatest stretch"], ['Shoulder Stretch']],
  ];

  const flat = CASES.flatMap(([id, yes, no]) => [
    ...yes.map((n) => [id, n, true] as const),
    ...no.map((n) => [id, n, false] as const),
  ]);

  it.each(flat)('%s: %s -> %s', (id, name, shouldMatch) => {
    const ids = classifyMovement(name).matchedIds;
    if (shouldMatch) expect(ids).toContain(id);
    else expect(ids).not.toContain(id);
  });

  it('keeps the reviewed exact names on their entries, not their sibling rules', () => {
    expect(classifyMovement('Kneeling landmine press').matchedIds).toEqual(['exact:kneeling landmine press']);
    expect(classifyMovement('Single-leg RDL').matchedIds).toEqual(['exact:single leg romanian deadlift']);
    expect(classifyMovement('Banded Hip Thrust').matchedIds).toEqual(['exact:banded hip thrust']);
    expect(classifyMovement('Devil Press').matchedIds).toEqual(['exact:devil press']);
    expect(classifyMovement('Burpee Box Step-Over').matchedIds).toEqual(['exact:burpee box step over']);
    expect(classifyMovement('Pull-to-Stand').matchedIds).toEqual(['exact:pull to stand']);
    expect(classifyMovement('Kettlebell Press').matchedIds).toEqual(['exact:kettlebell press']);
  });
});

describe('machine locomotion keeps the erg-style estimates', () => {
  it('has the locomotion muscles but the old erg-endurance options', () => {
    const machine = classifyMovement('Treadmill').profile;
    const walk = classifyMovement('Walk').profile;
    expect(machine.muscles).toEqual(walk.muscles);
    expect(machine.bwLoad).toBe(0);
    expect(walk.bwLoad).toBe(0.5);
    expect(machine.forceFactor).toBe(0.4);
    expect(machine.calMetres).toBe(15);
    expect(classifyMovement('Elliptical').profile).toEqual(machine);
  });
});

describe('split rules and new entries price like the entry they were copied from', () => {
  const est = (n: string) => {
    const p = classifyMovement(n).profile;
    return [p.bwLoad, p.forceFactor, p.horizFactor, p.calMetres, p.rom];
  };
  it('rule:ski-erg = ski erg interval', () => {
    expect(est('Ski Erg')).toEqual(est('Ski-Erg Intervals'));
  });
  it('rule:burpee = burpee', () => {
    expect(est('Bar-Facing Burpee')).toEqual(est('Burpee'));
  });
  it('rule:handstand-push-up = handstand push up', () => {
    expect(est('Pike Push-up')).toEqual(est('Handstand Push-up'));
  });
  it.each([
    ['Devil Press', 'Burpee'],
    ['Burpee Box Step-Over', 'Burpee'],
    ['Pull-to-Stand', 'Rope Climb'],
    ['Single-leg RDL', 'Romanian Deadlift'],
    ['Kettlebell Press', 'Overhead Press'],
    ['Kneeling landmine press', 'Landmine Press'],
  ])('%s carries the bwLoad of %s', (a, b) => {
    expect(classifyMovement(a).profile.bwLoad).toBe(classifyMovement(b).profile.bwLoad);
    expect(classifyMovement(a).profile.bwLoad).toBeDefined();
  });
});

describe('named runs classify exactly like a bare Run', () => {
  const run = classifyMovement('Run').profile;
  it.each(['Treadmill Run', 'Easy Run', 'Zone 2 Run', 'Running', 'Trail Running', 'Group Run'])(
    '%s has the profile of Run',
    (name) => {
      const c = classifyMovement(name);
      expect(c.source).not.toBe('unknown');
      expect(c.profile).toEqual(run);
    },
  );
  it.each([
    'Run-up',
    "Runner's Lunge",
    'Running Man',
    'Running Lunge',
    'Run Through Drill',
    'Trunk Rotation',
    'Brunch Club',
    'Prune Squat',
    'Brick',
  ])('%s is not read as a run', (name) => {
    expect(classifyMovement(name).profile).not.toEqual(run);
  });
});

describe('isPlaceholder', () => {
  it('matches the exact name only, so a movement containing it still classifies', () => {
    expect(['Rest', ' rest ', 'REST'].every(isPlaceholder)).toBe(true);
    expect(['Rest-Pause Curl', 'Rest Day Walk', 'Back Squat'].some(isPlaceholder)).toBe(false);
  });
});
