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
  'Leg Curl',
  'Incline DB Bench',
  'Leg Extension',
  'Reverse Lunge',
  'Box Jump',
  'Hip Mobility Flow',
  'Pull-ups',
  'Back Squat',
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
    const bss = c.profile.regions.posteriorChain ?? 0;
    const back = classifyMovement('Back Squat').profile.regions.posteriorChain ?? 0;
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

// Bilateral squatting is anterior-leg work. Pinned because the naive reading —
// "a squat is a leg exercise, split it evenly" — is exactly what drifts back in.
describe('squat patterns are anterior-leg dominant', () => {
  it.each(['Back Squat', 'Front Squat', 'Cossack Squat'])(
    '%s puts quads well ahead of the posterior chain',
    (name) => {
      const { regions } = classifyMovement(name).profile;
      expect(regions.quads ?? 0).toBeGreaterThan(0.55);
      expect(regions.quads ?? 0).toBeGreaterThan(2 * (regions.posteriorChain ?? 0));
    },
  );

  it('makes the front squat the most quad-dominant of the three', () => {
    const q = (n: string) => classifyMovement(n).profile.regions.quads ?? 0;
    expect(q('Front Squat')).toBeGreaterThan(q('Back Squat'));
  });

  it('keeps unilateral patterns more posterior than bilateral squats', () => {
    const pc = (n: string) => classifyMovement(n).profile.regions.posteriorChain ?? 0;
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
    expect(classifyMovement('Nordic/Leg Curl').profile.regions.posteriorChain).toBeCloseTo(1, 3);
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
