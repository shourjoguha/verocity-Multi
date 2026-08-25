import { describe, expect, it } from 'vitest';
import {
  EXACT,
  RULES,
  classifyMovement,
  normalizeMovementName,
  splitCompound,
} from '@/lib/movementTaxonomy';
import { familyOf } from '@/lib/stats';
import { MUSCLE_REGION_KEYS, PLANE_KEYS } from '@/app.config';

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
    expect(c.profile.regions.quads).toBeUndefined();
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
  // keep matching their box-jump/broad-jump anatomy by longest fragment.
  it('leaves the burpee combos on their existing plyometric classification', () => {
    for (const name of ['Burpee Box Jump-Over', 'Burpee Broad Jump']) {
      const c = classifyMovement(name);
      expect(c.matchedIds, name).toContain('jump-plyo');
      expect(c.profile.modality, name).toBe('plyometric');
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
    expect(c.profile.regions.quads).toBeCloseTo(0.65, 3);
    expect(c.profile.regions.glutes).toBeCloseTo(0.35, 3);
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
    const baseline = VOCABULARY.map((n) => JSON.stringify(classifyMovement(n).profile));
    const original = [...RULES];
    // Deterministic shuffle — no reliance on Math.random in a test.
    RULES.sort((a, b) => a.id.localeCompare(b.id));
    const shuffled = VOCABULARY.map((n) => JSON.stringify(classifyMovement(n).profile));
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

  it('does not let the push-up entry swallow the handstand push-up', () => {
    expect(bw('Handstand Push-up')).toBe(0.9);
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
