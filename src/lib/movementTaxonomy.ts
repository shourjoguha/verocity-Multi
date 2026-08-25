// Movement taxonomy: maps a free-text movement name to a region / modality /
// plane profile.
//
// WHY THIS EXISTS SEPARATELY FROM `familyOf` (lib/stats.ts):
// `MOVEMENT_FAMILIES` + `familyOf` is the Stats RPE-fingerprint roll-up. It
// matches by bare substring and is wrong on real data in ways nobody noticed —
// `familyOf('Med-Ball Throw') === 'pull'`, because "th-row" contains "row";
// same for 'Rower Intervals' and 'Zone 2 (row/bike/walk)'. Those answers are
// pinned by test on purpose: correcting them would change rendered Stats output
// for existing logs. This module is additive and is used by new surfaces only.
//
// Movements are referenced from plans and logs by BARE NAME STRING — there is
// no FK to the `movements` table — so classification keys off a normalised
// name, and unresolvable names stay `unknown` rather than being bucketed.
//
// This module is pure: no DOM, no storage, no Date, no queries. Overrides are
// passed in by the caller.

import {
  MOVEMENT_PLANES,
  MUSCLE_REGION_KEYS,
  ROM,
  type ModalityKey,
  type MovementProfile,
  type PlaneKey,
  type PlaneWeights,
  type RegionWeights,
  type RotaryRole,
} from '@/app.config';

export interface MovementRule {
  // Stable id, surfaced in `matchedIds` for a "why did it say that" affordance.
  id: string;
  // Normalised fragments. LONGEST MATCHED FRAGMENT WINS across the whole list,
  // so ordering is not load-bearing (proved by a shuffle test).
  match: string[];
  // Veto fragments — the rule is skipped if the atom contains any of them.
  not?: string[];
  profile: MovementProfile;
}

export type OverrideMap = Record<string, Partial<MovementProfile>>;

export type ClassificationSource = 'override' | 'exact' | 'rule' | 'partial' | 'unknown';

export interface Classification {
  raw: string;
  normalized: string;
  atoms: string[];
  unresolvedAtoms: string[];
  profile: MovementProfile;
  source: ClassificationSource;
  matchedIds: string[];
}

export const EMPTY_PROFILE: MovementProfile = {
  regions: {},
  modality: null,
  planes: {},
  rotary: null,
  systemic: false,
};

// ---- normalisation --------------------------------------------------------

// Token-level rewrites. Applied whole-token so `db` → `dumbbell` cannot fire
// inside another word.
const SPELLING_FIXES: Record<string, string> = {
  abb: 'ab',
  wtd: 'weighted',
  db: 'dumbbell',
  kb: 'kettlebell',
  bb: 'barbell',
  rdl: 'romanian deadlift',
  dl: 'deadlift',
  ohp: 'overhead press',
  bw: 'bodyweight',
};

// Crude de-pluralisation. It exists only to make the EXACT table
// plural-insensitive; rule matching is substring-based and already tolerant.
// The <3 guard keeps "ab" intact while still reducing "ups" → "up"
// ("Pull-ups" normalises through here).
function singularize(token: string): string {
  if (token.length < 3) return token;
  if (/(ss|us|is)$/.test(token)) return token;
  if (/(ches|shes)$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function normalizeMovementName(raw: string): string {
  const base = raw
    .toLowerCase()
    // Parenthesised content is dropped BEFORE anything else. Load-bearing:
    // "Zone 2 (row/bike/walk)" must not carry a "row" into matching — that is
    // precisely the bug that makes familyOf() call it a pull.
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-–—_]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ');

  const tokens = base
    .split(/\s+/)
    .filter(Boolean)
    // Drop bare numeric tokens: "abb routine 2" → "ab routine", "zone 2" → "zone".
    .filter((t) => !/^\d+$/.test(t))
    .map((t) => SPELLING_FIXES[t] ?? t)
    .map(singularize);

  return tokens.join(' ').trim();
}

// Split a compound name into atoms, on the RAW string.
//
// Stripping parenthesised content first is load-bearing: without it the `row`
// inside "Zone 2 (row/bike/walk)" misfires exactly as `familyOf` does today.
export function splitCompound(raw: string): string[] {
  const stripped = raw.replace(/\([^)]*\)/g, ' ');
  const parts = stripped
    .split(/\s*(?:\/|\+|&|,|\band\b)\s*/i)
    .map((s) => normalizeMovementName(s))
    .filter(Boolean);
  return parts.length > 0 ? parts : [normalizeMovementName(stripped)].filter(Boolean);
}

// ---- profile helpers ------------------------------------------------------

function p(
  regions: RegionWeights,
  modality: ModalityKey,
  plane: PlaneKey | PlaneWeights,
  opts: { rotary?: RotaryRole; systemic?: boolean; rom?: number; bwLoad?: number } = {},
): MovementProfile {
  return {
    regions,
    modality,
    planes: typeof plane === 'string' ? { [plane]: 1 } : plane,
    rotary: opts.rotary ?? null,
    systemic: opts.systemic ?? false,
    // Omitted rather than defaulted, so "not estimated" stays distinguishable
    // from "estimated at the reference length" in a stored override.
    ...(opts.rom != null ? { rom: opts.rom } : {}),
    // Bodyweight-borne fraction (see MovementProfile.bwLoad). Omitted → falls
    // back to VOLUME.bodyweightFraction in setVolume, never to zero.
    ...(opts.bwLoad != null ? { bwLoad: opts.bwLoad } : {}),
  };
}

// ---- the exact table ------------------------------------------------------
//
// Every classifiable name in the production vocabulary, keyed by its NORMALISED
// form, so the real data is deterministic and reviewable in one place rather
// than emergent from rule interactions.
//
// Two production names are deliberately absent because they cannot be resolved
// from the string: "Wtd" (→ 'weighted') and "Deficit" (→ 'deficit'), which are
// almost certainly truncated "Weighted Pull-up" and "Deficit Deadlift". They
// resolve to `unknown` and surface in the unmapped list. NOTE: no rule fragment
// may be a bare 'weighted', or it would swallow the real weighted entries.

const PUSH_HORIZONTAL: RegionWeights = { chest: 0.6, shoulders: 0.25, arms: 0.15 };
const DIP: RegionWeights = { chest: 0.45, arms: 0.35, shoulders: 0.2 };
const ROW: RegionWeights = { back: 0.7, arms: 0.3 };
const VERTICAL_PULL: RegionWeights = { back: 0.7, arms: 0.3 };

const RAW_EXACT: Record<string, MovementProfile> = {
  // --- lower, knee-dominant
  // Bilateral squats are anterior-leg dominant. A heel-elevated front or back
  // squat most of all: the raised heels drive the knees forward and shift the
  // hip-extension load off the posterior chain and onto the quads, so those two
  // carry the flat 0.65 quad / 0.35 glute ratio with no hamstring share.
  'back squat': p(
    { quads: 0.6, hamstrings: 0.098, glutes: 0.182, core: 0.12 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'front squat': p(
    { quads: 0.65, glutes: 0.35 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  // The heel-elevated back squat the athlete performs most often — quad-dominant
  // like the front squat. The `(v)` variant marker is a PER-SET notation the
  // name-based classifier never sees, so this is reachable only by naming the
  // variant explicitly; a marker-driven path would be a separate mechanism.
  'heel elevated back squat': p(
    { quads: 0.65, glutes: 0.35 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'leg extension': p({ quads: 1 }, 'resistance', 'sagittal', { rom: ROM.kneeIsolation }),
  'leg press': p(
    { quads: 0.65, hamstrings: 0.1225, glutes: 0.2275 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  pistol: p(
    { quads: 0.6, hamstrings: 0.105, glutes: 0.195, core: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'reverse lunge': p(
    { quads: 0.5, hamstrings: 0.16, glutes: 0.24, core: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.lunge },
  ),
  'bulgarian split squat': p(
    { quads: 0.45, hamstrings: 0.18, glutes: 0.27, core: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.lunge },
  ),
  // Cossack: the loaded leg is deep-flexed quad work and the trailing leg is
  // adductor — and adductors fold into `quads` at this granularity, so it is
  // strongly anterior despite the lateral shape.
  'cossack squat': p(
    { quads: 0.75, hamstrings: 0.0525, glutes: 0.0975, core: 0.1 },
    'resistance',
    { frontal: 0.7, sagittal: 0.3 },
    { rom: ROM.squat },
  ),

  // --- lower, hip-dominant
  'leg curl': p({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  'nordic leg curl': p({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  nordic: p({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  // The everyday spelling. Without it "Nordic Curl" normalises to an atom that is
  // in neither EXACT key and falls to rule:hamstring-isolation -- which is there
  // for MACHINE leg curls (bwLoad 0) and would price a nordic at zero.
  'nordic curl': p({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  'hip thrust machine': p(
    { hamstrings: 0.2, glutes: 0.8 },
    'resistance',
    'sagittal',
    { rom: ROM.hipIsolation },
  ),
  'banded hip thrust': p(
    { hamstrings: 0.2, glutes: 0.8 },
    'resistance',
    'sagittal',
    { rom: ROM.hipIsolation },
  ),
  'split stance romanian deadlift': p(
    { hamstrings: 0.45, glutes: 0.3, core: 0.15, quads: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.hinge },
  ),
  'trap bar deadlift': p(
    { hamstrings: 0.225, glutes: 0.275, quads: 0.35, back: 0.15 },
    'resistance',
    'sagittal',
    { rom: ROM.hinge },
  ),
  'kettlebell swing': p(
    { hamstrings: 0.315, glutes: 0.385, core: 0.2, shoulders: 0.1 },
    'plyometric',
    'sagittal',
    { systemic: true, rom: ROM.hinge },
  ),
  'kettlebell snatch': p(
    { hamstrings: 0.18, glutes: 0.22, shoulders: 0.3, core: 0.2, back: 0.1 },
    'plyometric',
    'sagittal',
    { systemic: true, rom: ROM.jump },
  ),

  // --- calves
  'calf raise': p({ calves: 1 }, 'resistance', 'sagittal', { rom: ROM.calf }),
  'standing calf raise': p({ calves: 1 }, 'resistance', 'sagittal', { rom: ROM.calf }),

  // --- push
  'incline dumbbell bench': p(
    PUSH_HORIZONTAL,
    'resistance',
    'sagittal',
    { rom: ROM.pushHorizontal },
  ),
  'machine press': p(PUSH_HORIZONTAL, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  'cable fly': p(
    { chest: 0.85, shoulders: 0.15 },
    'resistance',
    'transverse',
    { rom: ROM.pushHorizontal },
  ),
  'bench press': p(PUSH_HORIZONTAL, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  // Its own entry, not left to the horizontal-push RULE: that rule exists for
  // bench/machine/fly, which bear none of the athlete, while a push-up carries
  // ~65% of them. Same anatomy, opposite bwLoad -- so the rule cannot serve both.
  'push up': p(PUSH_HORIZONTAL, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  dip: p(DIP, 'resistance', 'sagittal', { rom: ROM.dip }),
  'weighted dip': p(DIP, 'resistance', 'sagittal', { rom: ROM.dip }),
  'landmine press': p(
    { shoulders: 0.6, chest: 0.25, arms: 0.15 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),
  'standing barbell military press': p(
    { shoulders: 0.6, arms: 0.25, core: 0.15 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),
  'overhead press': p(
    { shoulders: 0.6, arms: 0.25, core: 0.15 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),
  'shoulder raise': p({ shoulders: 1 }, 'resistance', 'frontal', { rom: ROM.deltIsolation }),
  'overhead tricep': p({ arms: 1 }, 'resistance', 'sagittal', { rom: ROM.armIsolation }),

  // --- pull
  'pull up': p(VERTICAL_PULL, 'resistance', 'frontal', { rom: ROM.pullVertical }),
  'weighted pull up': p(VERTICAL_PULL, 'resistance', 'frontal', { rom: ROM.pullVertical }),
  'chin up': p({ back: 0.6, arms: 0.4 }, 'resistance', 'frontal', { rom: ROM.pullVertical }),
  'dumbbell row': p(ROW, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  'iso lateral row': p(ROW, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  'gorilla row': p(ROW, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  // As with 'push up': the horizontal-pull RULE covers bent and machine rows,
  // which bear none of the athlete; an inverted row hangs off their own mass.
  'inverted row': p(ROW, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  'face pull': p({ back: 0.6, shoulders: 0.4 }, 'resistance', 'transverse', { rom: ROM.prehab }),
  'band pull apart': p(
    { back: 0.6, shoulders: 0.4 },
    'resistance',
    'transverse',
    { rom: ROM.prehab },
  ),

  // --- trunk
  'dead bug': p({ core: 1 }, 'isometric', 'sagittal', { rotary: 'antiRotational' }),
  'side plank': p({ core: 1 }, 'isometric', 'frontal'),
  plank: p({ core: 1 }, 'isometric', 'sagittal'),
  'pallof press': p({ core: 1 }, 'isometric', 'transverse', { rotary: 'antiRotational' }),
  'landmine twist': p({ core: 0.7, shoulders: 0.2, back: 0.1 }, 'resistance', 'transverse', {
    rotary: 'rotational',
  }),
  'hanging knee raise': p({ core: 1 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  'ab wheel roller': p({ core: 1 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  'ab wheel rollout': p({ core: 1 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  'machine crunch': p({ core: 1 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  'ab routine': p({ core: 1 }, 'resistance', 'sagittal'),

  // A front squat into an overhead throw. Logged in reps, so the work model
  // reads its `rom` as the ball's whole path, not the squat alone.
  'wall ball': p(
    { quads: 0.4, glutes: 0.15, shoulders: 0.25, core: 0.1, arms: 0.1 },
    'resistance',
    'sagittal',
    { systemic: true, rom: ROM.wallBall },
  ),

  // --- carries / sled
  'farmer carry': p(
    { core: 0.35, arms: 0.25, shoulders: 0.2, hamstrings: 0.08, glutes: 0.12 },
    'endurance',
    'frontal',
    { systemic: true },
  ),
  'sled push': p(
    { quads: 0.5, hamstrings: 0.125, glutes: 0.125, calves: 0.15, chest: 0.1 },
    'resistance',
    'sagittal',
    { systemic: true },
  ),
  'sled drag': p(
    { quads: 0.45, hamstrings: 0.15, glutes: 0.15, calves: 0.15, core: 0.1 },
    'resistance',
    'sagittal',
    { systemic: true },
  ),

  // --- plyometric
  'box jump': p({ quads: 0.5, hamstrings: 0.2, glutes: 0.2, calves: 0.1 }, 'plyometric', 'sagittal', {
    systemic: true, rom: ROM.jump },
  ),
  'med ball throw': p(
    { core: 0.4, chest: 0.25, shoulders: 0.25, back: 0.1 },
    'plyometric',
    'transverse',
    { rotary: 'rotational', systemic: true, rom: ROM.jump },
  ),

  // --- endurance
  'ski erg interval': p({ back: 0.5, arms: 0.3, core: 0.2 }, 'endurance', 'sagittal', {
    systemic: true,
  }),
  'rower interval': p(
    { back: 0.4, quads: 0.3, hamstrings: 0.09, glutes: 0.11, arms: 0.1 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  'row erg interval': p(
    { back: 0.4, quads: 0.3, hamstrings: 0.09, glutes: 0.11, arms: 0.1 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  zone: p(
    { quads: 0.35, hamstrings: 0.1575, glutes: 0.1925, calves: 0.15, back: 0.15 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  run: p(
    { hamstrings: 0.175, glutes: 0.175, quads: 0.3, calves: 0.25, core: 0.1 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  cycle: p({ quads: 0.5, hamstrings: 0.12, glutes: 0.18, calves: 0.2 }, 'endurance', 'sagittal', {
    systemic: true,
  }),
  stairmaster: p({ quads: 0.4, hamstrings: 0.1225, glutes: 0.2275, calves: 0.25 }, 'endurance', 'sagittal', {
    systemic: true,
  }),

  // --- mobility / prep
  'hip mobility flow': p(
    { quads: 0.4, hamstrings: 0.16, glutes: 0.24, core: 0.2 },
    'mobility',
    { sagittal: 0.4, frontal: 0.3, transverse: 0.3 },
  ),
  'hip flow': p(
    { quads: 0.4, hamstrings: 0.16, glutes: 0.24, core: 0.2 },
    'mobility',
    { sagittal: 0.4, frontal: 0.3, transverse: 0.3 },
  ),
  'couch stretch': p({ quads: 1 }, 'mobility', 'sagittal'),
  'hip stretch': p({ quads: 0.5, hamstrings: 0.25, glutes: 0.25 }, 'mobility', 'sagittal'),
  pigeon: p({ hamstrings: 0.18, glutes: 0.42, quads: 0.4 }, 'mobility', { frontal: 0.5, transverse: 0.5 }),
  'kettlebell halo': p({ shoulders: 0.6, core: 0.4 }, 'mobility', 'transverse'),
  halo: p({ shoulders: 0.6, core: 0.4 }, 'mobility', 'transverse'),
  'shoulder prep': p({ shoulders: 1 }, 'mobility', {
    frontal: 0.4,
    transverse: 0.4,
    sagittal: 0.2,
  }),
  'adductor work': p({ quads: 1 }, 'mobility', 'frontal'),

  // --- CrossFit / Hyrox movements the rules leave unknown. Added deliberately,
  // one anatomy at a time, after cross-checking each primary mover against an
  // independent exercise dataset (ExerciseDB / Gym Visual). EXACT rather than
  // rules so they touch only these names and never the burpee/box-jump combos,
  // which keep their existing classification by longest-fragment.
  //
  // Front squat into an overhead press: anterior legs and shoulders lead, with
  // the trunk bracing the rack-to-lockout path. Full-body, so systemic.
  thruster: p(
    { quads: 0.35, shoulders: 0.35, hamstrings: 0.06, glutes: 0.09, core: 0.15 },
    'resistance',
    'sagittal',
    { systemic: true, rom: ROM.squat },
  ),
  // A vertical pull that finishes as a dip — back and arms lead, the plane
  // starts frontal (pull) and turns sagittal (press over the bar).
  'muscle up': p(
    { back: 0.45, arms: 0.3, chest: 0.15, shoulders: 0.1 },
    'resistance',
    { frontal: 0.6, sagittal: 0.4 },
    { systemic: true, rom: ROM.pullVertical },
  ),
  // Bodyweight vertical pull carried by grip; legs assist but back/arms move it.
  'rope climb': p(
    { back: 0.5, arms: 0.4, core: 0.1 },
    'resistance',
    'frontal',
    { systemic: true, rom: ROM.pullVertical },
  ),
  // Dynamic trunk flexion, same shape as the hanging knee raise / ab wheel.
  'v up': p({ core: 1 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  // Jump-rope conditioning: calf/ankle dominant, sustained — endurance, systemic.
  'double under': p(
    { calves: 0.55, quads: 0.25, core: 0.2 },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.skip },
  ),
  'single under': p(
    { calves: 0.55, quads: 0.25, core: 0.2 },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.skip },
  ),
  // Squat-thrust-jump-pushup: whole-body conditioning spanning legs, chest and
  // trunk. The dumbbell-facing variant loads the same pattern.
  burpee: p(
    { quads: 0.3, chest: 0.2, hamstrings: 0.1, glutes: 0.1, shoulders: 0.15, core: 0.15 },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.burpee },
  ),
  'dumbbell facing burpee': p(
    { quads: 0.3, chest: 0.2, hamstrings: 0.1, glutes: 0.1, shoulders: 0.15, core: 0.15 },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.burpee },
  ),

  // Correction: a handstand push-up is a VERTICAL press (shoulders + triceps),
  // but "push up" is a fragment of the horizontal-push rule, which was filing it
  // under chest. EXACT beats RULES, so this pins the right anatomy. Not systemic
  // — it's a strict strength movement, not conditioning.
  'handstand push up': p(
    { shoulders: 0.55, arms: 0.3, core: 0.15 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),
};

// ---- the rule list --------------------------------------------------------
//
// Fallbacks for names not in EXACT (i.e. anything logged after this shipped).
// LONGEST MATCHED FRAGMENT WINS, so ordering here is NOT load-bearing.

const RAW_RULES: MovementRule[] = [
  {
    id: 'erg-endurance',
    match: ['ski erg', 'row erg', 'rower', 'erg', 'treadmill', 'stairmaster', 'elliptical'],
    profile: p({ back: 0.4, quads: 0.3, hamstrings: 0.09, glutes: 0.11, arms: 0.1 }, 'endurance', 'sagittal', {
      systemic: true,
    }),
  },
  {
    id: 'locomotion-endurance',
    // `bike` and `cycling` USED to live here, which made every ride resolve to
    // the running profile — the same bwLoad and the same cost per metre, over
    // distances four to six times longer. They have their own rules below.
    match: ['jog', 'sprint', 'swim', 'walk', 'hike', 'ruck'],
    profile: p(
      { hamstrings: 0.175, glutes: 0.175, quads: 0.3, calves: 0.25, core: 0.1 },
      'endurance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    // Road and stationary cycling. The `cycle` EXACT entry has always carried
    // the right estimates and was unreachable: nobody logs the word "Cycle".
    id: 'cycling',
    match: ['bike', 'cycling'],
    not: ['assault', 'air bike', 'echo', 'fan bike'],
    profile: p({ quads: 0.5, hamstrings: 0.12, glutes: 0.18, calves: 0.2 }, 'endurance', 'sagittal', {
      systemic: true,
    }),
  },
  {
    // An air bike is not a bicycle. It drives arms and legs against a fan, it is
    // scored in calories rather than distance, and its work per calorie sits
    // just above a rower's — where a road bike's sits far below.
    id: 'air-bike',
    match: ['assault bike', 'air bike', 'echo bike', 'fan bike'],
    profile: p(
      { quads: 0.3, back: 0.2, arms: 0.2, hamstrings: 0.1, glutes: 0.1, core: 0.1 },
      'endurance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    id: 'jump-plyo',
    match: ['jump', 'hop', 'bound', 'throw', 'slam', 'clean', 'snatch', 'jerk'],
    profile: p({ quads: 0.4, hamstrings: 0.175, glutes: 0.175, core: 0.25 }, 'plyometric', 'sagittal', {
      systemic: true, rom: ROM.jump },
  ),
  },
  {
    id: 'squat-pattern',
    // Bilateral squatting only — anterior-leg dominant. Unilateral/step
    // patterns are a separate rule below with a more posterior split, and
    // longest-fragment-wins routes 'split squat' there without any ordering.
    match: ['squat', 'leg press'],
    profile: p(
      { quads: 0.6, hamstrings: 0.098, glutes: 0.182, core: 0.12 },
      'resistance',
      'sagittal',
      { rom: ROM.squat },
    ),
  },
  {
    id: 'lunge-pattern',
    match: ['lunge', 'split squat', 'step up'],
    profile: p(
      { quads: 0.5, hamstrings: 0.16, glutes: 0.24, core: 0.1 },
      'resistance',
      'sagittal',
      { rom: ROM.lunge },
    ),
  },
  {
    id: 'hinge-pattern',
    match: ['deadlift', 'romanian deadlift', 'good morning', 'hip thrust', 'glute bridge', 'swing'],
    profile: p(
      { hamstrings: 0.4125, glutes: 0.3375, core: 0.15, back: 0.1 },
      'resistance',
      'sagittal',
      { rom: ROM.hinge },
    ),
  },
  {
    id: 'hamstring-isolation',
    match: ['leg curl', 'nordic', 'ham curl'],
    profile: p({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  },
  {
    id: 'quad-isolation',
    match: ['leg extension', 'knee extension'],
    profile: p({ quads: 1 }, 'resistance', 'sagittal', { rom: ROM.kneeIsolation }),
  },
  {
    id: 'calf',
    match: ['calf raise', 'calf'],
    profile: p({ calves: 1 }, 'resistance', 'sagittal', { rom: ROM.calf }),
  },
  {
    id: 'horizontal-push',
    match: ['bench', 'chest press', 'push up', 'machine press', 'fly'],
    profile: p(PUSH_HORIZONTAL, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  },
  {
    id: 'dip',
    match: ['dip'],
    profile: p(DIP, 'resistance', 'sagittal', { rom: ROM.dip }),
  },
  {
    id: 'vertical-push',
    match: ['overhead press', 'military press', 'shoulder press', 'push press', 'landmine press'],
    profile: p(
      { shoulders: 0.6, arms: 0.25, core: 0.15 },
      'resistance',
      'sagittal',
      { rom: ROM.pushVertical },
    ),
  },
  {
    id: 'delt-isolation',
    match: ['lateral raise', 'shoulder raise', 'front raise', 'rear delt'],
    profile: p({ shoulders: 1 }, 'resistance', 'frontal', { rom: ROM.deltIsolation }),
  },
  {
    id: 'vertical-pull',
    match: ['pull up', 'chin up', 'lat pulldown', 'pulldown'],
    profile: p(VERTICAL_PULL, 'resistance', 'frontal', { rom: ROM.pullVertical }),
  },
  {
    id: 'horizontal-pull',
    // 'row' is safe here only because splitCompound strips parentheticals and
    // 'rower'/'row erg' win on fragment length. 'throw' is vetoed explicitly.
    match: ['row', 'seal row', 'inverted row'],
    not: ['throw', 'rower', 'erg'],
    profile: p(ROW, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  },
  {
    id: 'upper-back-prehab',
    match: ['face pull', 'pull apart', 'reverse fly'],
    profile: p({ back: 0.6, shoulders: 0.4 }, 'resistance', 'transverse', { rom: ROM.prehab }),
  },
  {
    id: 'arm-isolation',
    match: ['curl', 'tricep', 'bicep', 'pushdown', 'skullcrusher'],
    not: ['leg curl', 'ham curl', 'nordic'],
    profile: p({ arms: 1 }, 'resistance', 'sagittal', { rom: ROM.armIsolation }),
  },
  {
    id: 'anti-rotation',
    match: ['pallof', 'anti rotation', 'anti rotational'],
    profile: p({ core: 1 }, 'isometric', 'transverse', { rotary: 'antiRotational' }),
  },
  {
    id: 'rotation',
    match: ['twist', 'russian twist', 'wood chop', 'chop', 'rotation'],
    profile: p({ core: 0.8, shoulders: 0.2 }, 'resistance', 'transverse', { rotary: 'rotational' }),
  },
  {
    id: 'core-isometric',
    match: ['plank', 'hollow hold', 'dead bug', 'bird dog'],
    profile: p({ core: 1 }, 'isometric', 'sagittal'),
  },
  {
    id: 'core-dynamic',
    match: ['crunch', 'sit up', 'knee raise', 'leg raise', 'ab wheel', 'rollout', 'ab routine'],
    profile: p({ core: 1 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  },
  {
    id: 'carry',
    match: ['carry', 'farmer', 'suitcase carry'],
    profile: p(
      { core: 0.35, arms: 0.25, shoulders: 0.2, hamstrings: 0.08, glutes: 0.12 },
      'endurance',
      'frontal',
      { systemic: true },
    ),
  },
  {
    id: 'sled',
    match: ['sled'],
    profile: p(
      { quads: 0.5, hamstrings: 0.125, glutes: 0.125, calves: 0.15, core: 0.1 },
      'resistance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    id: 'mobility',
    match: ['stretch', 'mobility', 'flow', 'halo', 'prep', 'foam roll', 'pigeon', 'yoga'],
    profile: p({ core: 0.34, quads: 0.33, hamstrings: 0.1485, glutes: 0.1815 }, 'mobility', {
      sagittal: 0.4,
      frontal: 0.3,
      transverse: 0.3,
    }),
  },
];

// ---- reviewed bodyweight load ------------------------------------------------
//
// `bwLoad` is the fraction of the athlete's own bodyweight a movement makes them
// lift, which `setVolume` ADDS to any external weight so that weighted is always
// >= bodyweight for the same movement. Kept as ONE table rather than an argument
// on 100+ `p()` calls because these are ESTIMATES that were reviewed as a set:
// docs/bwload-review.csv is the round-tripped record, and this block is meant to
// be diffed against it. Keys are the normalised EXACT name, or `rule:<id>`.
//
// An absent key means "not estimated" and falls back to VOLUME.bodyweightFraction
// in setVolume -- never to zero. 0 is a CLAIM (a bench bears none of you); blank
// is the absence of one. Do not collapse the two.
const BW_LOAD: Record<string, number> = {
  'chin up'                           : 1.0,
  'muscle up'                         : 1.0,
  'pull up'                           : 1.0,
  'rope climb'                        : 1.0,
  'weighted pull up'                  : 1.0,
  'dip'                               : 0.9,
  'handstand push up'                 : 0.9,
  'rule:dip'                          : 0.9,
  'weighted dip'                      : 0.9,
  'box jump'                          : 0.85,
  'pistol'                            : 0.85,
  'standing calf raise'               : 0.85,
  'back squat'                        : 0.8,
  'farmer carry'                      : 0.8,
  'front squat'                       : 0.8,
  'rule:carry'                        : 0.8,
  'rule:hinge-pattern'                : 0.8,
  'rule:sled'                         : 0.8,
  'rule:squat-pattern'                : 0.8,
  'sled drag'                         : 0.8,
  'sled push'                         : 0.8,
  'stairmaster'                       : 0.8,
  'thruster'                          : 0.8,
  'trap bar deadlift'                 : 0.8,
  'bulgarian split squat'             : 0.75,
  'cossack squat'                     : 0.75,
  'reverse lunge'                     : 0.75,
  'rule:lunge-pattern'                : 0.75,
  'burpee'                            : 0.65,
  'wall ball'                         : 0.8,
  'double under'                      : 0.65,
  'dumbbell facing burpee'            : 0.65,
  'nordic'                            : 0.65,
  'nordic leg curl'                   : 0.65,
  'nordic curl'                       : 0.65,
  'push up'                           : 0.65,
  'run'                               : 0.65,
  'single under'                      : 0.65,
  'zone'                              : 0.65,
  'inverted row'                      : 0.6,
  'ab wheel roller'                   : 0.5,
  'ab wheel rollout'                  : 0.5,
  'calf raise'                        : 0.5,
  'rule:calf'                         : 0.5,
  'rule:locomotion-endurance'         : 0.5,
  'side plank'                        : 0.45,
  'kettlebell snatch'                 : 0.4,
  'kettlebell swing'                  : 0.4,
  'plank'                             : 0.4,
  'rule:core-isometric'               : 0.4,
  'ab routine'                        : 0.3,
  'dead bug'                          : 0.3,
  'hanging knee raise'                : 0.3,
  'rule:core-dynamic'                 : 0.3,
  'rule:jump-plyo'                    : 0.3,
  'v up'                              : 0.3,
  'pallof press'                      : 0.2,
  'rule:anti-rotation'                : 0.2,
  'rule:rotation'                     : 0.2,
  'band pull apart'                   : 0.0,
  'banded hip thrust'                 : 0.0,
  'bench press'                       : 0.0,
  'cable fly'                         : 0.0,
  'cycle'                             : 0.0,
  'dumbbell row'                      : 0.0,
  'face pull'                         : 0.0,
  'gorilla row'                       : 0.0,
  'hip thrust machine'                : 0.0,
  'incline dumbbell bench'            : 0.0,
  'iso lateral row'                   : 0.0,
  'landmine press'                    : 0.0,
  'landmine twist'                    : 0.0,
  'leg curl'                          : 0.0,
  'leg extension'                     : 0.0,
  'leg press'                         : 0.0,
  'machine crunch'                    : 0.0,
  'machine press'                     : 0.0,
  'med ball throw'                    : 0.0,
  'overhead press'                    : 0.0,
  'overhead tricep'                   : 0.0,
  'row erg interval'                  : 0.0,
  'rower interval'                    : 0.0,
  'rule:arm-isolation'                : 0.0,
  'rule:delt-isolation'               : 0.0,
  'rule:erg-endurance'                : 0.0,
  'rule:hamstring-isolation'          : 0.0,
  'rule:horizontal-pull'              : 0.0,
  'rule:horizontal-push'              : 0.0,
  'rule:quad-isolation'               : 0.0,
  'rule:upper-back-prehab'            : 0.0,
  'rule:vertical-pull'                : 0.0,
  'rule:vertical-push'                : 0.0,
  'shoulder raise'                    : 0.0,
  'ski erg interval'                  : 0.0,
  'split stance romanian deadlift'    : 0.8,
  'standing barbell military press'   : 0.0,
};

// ---- work-model estimates ----------------------------------------------------
//
// The three tables below serve lib/work.ts, which prices WORK as force x
// displacement. Kept beside BW_LOAD and in the same shape -- one flat table of
// reviewed estimates keyed by normalised EXACT name or `rule:<id>` -- because
// they are the same kind of claim and are meant to be diffed as a set.

// Force generated as a fraction of bodyweight, where that differs from the
// fraction LIFTED (see MovementProfile.forceFactor). ONLY the machines: an erg
// bears none of you, so its bwLoad is a correct 0, and a work model reading
// that as the force term would price a maximal 2km row at nothing.
const FORCE_FACTOR: Record<string, number> = {
  'row erg interval'                  : 0.45,
  'rower interval'                    : 0.45,
  'ski erg interval'                  : 0.3,
  'cycle'                             : 0.4,
  'rule:cycling'                      : 0.4,
  // Arms and legs against a fan, so more of the athlete is driving than on a
  // bicycle. Set just above the rower's 0.45, per the same reading.
  'rule:air-bike'                     : 0.5,
  'rule:erg-endurance'                : 0.4,
};

// How many vertical metres one horizontal metre of this movement costs
// (MovementProfile.horizFactor). Absent -> WORK.defaultHorizFactor (0.1).
//
// The sled entries are the reason this is per-movement rather than global:
// friction eats a large share of the load, so 50m of sled push is real work
// against ~half its weight, where 50m of running is not.
const HORIZ_FACTOR: Record<string, number> = {
  'sled push'                         : 0.5,
  'sled drag'                         : 0.5,
  'rule:sled'                         : 0.5,
  // Stairs climb rather than travel -- the displacement really is mostly
  // vertical, so a stairmaster metre costs far more than a running one.
  'stairmaster'                       : 0.5,
  'run'                               : 0.1,
  'zone'                              : 0.1,
  'farmer carry'                      : 0.1,
  'rule:carry'                        : 0.1,
  'rule:locomotion-endurance'         : 0.1,
  'row erg interval'                  : 0.1,
  'rower interval'                    : 0.1,
  'ski erg interval'                  : 0.1,
  'rule:erg-endurance'                : 0.1,
  // An air bike is priced as a rower, not as a bicycle — see rule:air-bike.
  'rule:air-bike'                     : 0.1,
  // A bike converts effort into distance far more efficiently than legs do:
  // running 12km/h costs ~0.083 kcal/m, cycling 30km/h ~0.027, so a cycled
  // metre is worth about a third of a run metre. Anchored on metabolic cost
  // per metre rather than mechanical work, which would say a tenth — the
  // metabolic reading is the one under which a session's DURATION means
  // something, and it independently leaves the ergs where they already are.
  'cycle'                             : 0.05,
  'rule:cycling'                      : 0.05,
};

// Equivalent metres per calorie, for erg work prescribed in calories
// (MovementProfile.calMetres). Absent -> WORK.defaultCalMetres (15), the
// rowing ballpark the others are calibrated against.
const CAL_METRES: Record<string, number> = {
  'row erg interval'                  : 15,
  'rower interval'                    : 15,
  // Smaller working muscle mass per stroke, so a calorie buys less distance.
  'ski erg interval'                  : 12,
  // A calorie is a calorie: this is set so a cycled calorie prices near a rowed
  // one, which the lower horizFactor would otherwise undercut. A bike simply
  // covers more ground per calorie.
  'cycle'                             : 35,
  'rule:cycling'                      : 35,
  // The unit air bikes are actually scored in, and the reason this movement is
  // split out at all. 43kg x 15m x 0.1 = 64.5 kg.m per calorie, against the
  // rower's 58.1 — "equal to a rower or slightly higher".
  'rule:air-bike'                     : 15,
  'stairmaster'                       : 10,
  'rule:erg-endurance'                : 15,
};

const withEstimates = (key: string, profile: MovementProfile): MovementProfile => ({
  ...profile,
  ...(BW_LOAD[key] != null ? { bwLoad: BW_LOAD[key] } : {}),
  ...(FORCE_FACTOR[key] != null ? { forceFactor: FORCE_FACTOR[key] } : {}),
  ...(HORIZ_FACTOR[key] != null ? { horizFactor: HORIZ_FACTOR[key] } : {}),
  ...(CAL_METRES[key] != null ? { calMetres: CAL_METRES[key] } : {}),
});

export const EXACT: Record<string, MovementProfile> = Object.fromEntries(
  Object.entries(RAW_EXACT).map(([name, profile]) => [name, withEstimates(name, profile)]),
);

export const RULES: MovementRule[] = RAW_RULES.map((rule) => ({
  ...rule,
  profile: withEstimates('rule:' + rule.id, rule.profile),
}));

// ---- matching -------------------------------------------------------------

interface AtomMatch {
  profile: MovementProfile;
  source: 'exact' | 'rule';
  id: string;
}

function matchAtom(atom: string): AtomMatch | null {
  const exact = EXACT[atom];
  if (exact) return { profile: exact, source: 'exact', id: `exact:${atom}` };

  let best: { rule: MovementRule; len: number } | null = null;
  for (const rule of RULES) {
    if (rule.not?.some((veto) => atom.includes(veto))) continue;
    for (const fragment of rule.match) {
      if (!atom.includes(fragment)) continue;
      if (!best || fragment.length > best.len) best = { rule, len: fragment.length };
    }
  }
  return best ? { profile: best.rule.profile, source: 'rule', id: best.rule.id } : null;
}

function normalizeWeights<K extends string>(acc: Partial<Record<K, number>>): Partial<Record<K, number>> {
  const total = Object.values(acc).reduce((a: number, b) => a + (b as number), 0);
  if (total <= 0) return {};
  const out: Partial<Record<K, number>> = {};
  for (const [k, v] of Object.entries(acc) as [K, number][]) {
    out[k] = v / total;
  }
  return out;
}

const SOURCE_RANK: Record<string, number> = { rule: 1, exact: 2, override: 3 };

export interface ClassifyContext {
  overrides?: OverrideMap;
}

export function classifyMovement(raw: string, ctx: ClassifyContext = {}): Classification {
  const overrides = ctx.overrides ?? {};
  const normalized = normalizeMovementName(raw);
  const atoms = splitCompound(raw);

  const matched: AtomMatch[] = [];
  const unresolvedAtoms: string[] = [];
  let sawOverride = false;

  // A whole-name override wins outright, even when the name is unclassifiable —
  // this is how "Wtd" gets corrected.
  const wholeOverride = overrides[normalized];

  for (const atom of atoms) {
    const hit = matchAtom(atom);
    const atomOverride = overrides[atom];
    if (atomOverride) {
      sawOverride = true;
      matched.push({
        profile: { ...(hit?.profile ?? EMPTY_PROFILE), ...atomOverride },
        source: 'exact',
        id: `override:${atom}`,
      });
      continue;
    }
    if (hit) matched.push(hit);
    else unresolvedAtoms.push(atom);
  }

  if (matched.length === 0) {
    if (wholeOverride) {
      return {
        raw,
        normalized,
        atoms,
        unresolvedAtoms: [],
        profile: { ...EMPTY_PROFILE, ...wholeOverride },
        source: 'override',
        matchedIds: [`override:${normalized}`],
      };
    }
    return {
      raw,
      normalized,
      atoms,
      unresolvedAtoms,
      profile: EMPTY_PROFILE,
      source: 'unknown',
      matchedIds: [],
    };
  }

  // Combine atoms: equal contribution, then renormalise.
  const regionAcc: Record<string, number> = {};
  const planeAcc: Record<string, number> = {};
  const modalityVotes: Record<string, number> = {};
  let systemic = false;
  let rotary: RotaryRole | null = null;
  const romParts: number[] = [];
  const bwParts: number[] = [];
  const forceParts: number[] = [];
  const horizParts: number[] = [];
  const calParts: number[] = [];

  for (const m of matched) {
    for (const [k, v] of Object.entries(m.profile.regions)) {
      regionAcc[k] = (regionAcc[k] ?? 0) + (v as number);
    }
    for (const [k, v] of Object.entries(m.profile.planes)) {
      planeAcc[k] = (planeAcc[k] ?? 0) + (v as number);
    }
    if (m.profile.modality) {
      modalityVotes[m.profile.modality] = (modalityVotes[m.profile.modality] ?? 0) + 1;
    }
    systemic = systemic || m.profile.systemic;
    if (!rotary && m.profile.rotary) rotary = m.profile.rotary;
    if (m.profile.rom != null) romParts.push(m.profile.rom);
    if (m.profile.bwLoad != null) bwParts.push(m.profile.bwLoad);
    if (m.profile.forceFactor != null) forceParts.push(m.profile.forceFactor);
    if (m.profile.horizFactor != null) horizParts.push(m.profile.horizFactor);
    if (m.profile.calMetres != null) calParts.push(m.profile.calMetres);
  }

  const firstModality = matched.find((m) => m.profile.modality)?.profile.modality ?? null;
  const topVote = Object.entries(modalityVotes).sort((a, b) => b[1] - a[1])[0];
  const modality: ModalityKey | null = topVote
    ? // On a tie, prefer the first atom's modality over alphabetical accident.
      (modalityVotes[firstModality as string] === topVote[1]
        ? (firstModality as ModalityKey)
        : (topVote[0] as ModalityKey))
    : null;

  // Compound ROM is the MEAN of the atoms that carry one, not the sum: the
  // splitter fires on `/ + & ,` which covers alternatives ("row/bike/walk") as
  // often as true combinations, and averaging is what regions and planes
  // already do. Atoms with no estimate are skipped rather than counted as
  // zero — one unestimated half of a compound must not halve the other.
  const rom = romParts.length > 0 ? romParts.reduce((a, b) => a + b, 0) / romParts.length : null;

  // Compound bwLoad is the MEAN of the atoms that carry one, for the same reason
  // ROM is: an atom with no estimate is skipped, never counted as zero, or one
  // unestimated half of "Pull-up + Dip" would halve the other. Carrying it here
  // at all is the point -- this merge rebuilds the profile field by field, so a
  // property that is not named here is silently dropped no matter what the EXACT
  // table says (docs/LESSONS.md: "the logger records more than the metrics read").
  const bwLoad = bwParts.length > 0 ? bwParts.reduce((a, b) => a + b, 0) / bwParts.length : null;

  // The work-model estimates merge on the same rule, and for the same reason
  // the comment above gives: a property this merge does not name is silently
  // dropped no matter what EXACT says.
  const meanOrNull = (xs: number[]) =>
    xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const forceFactor = meanOrNull(forceParts);
  const horizFactor = meanOrNull(horizParts);
  const calMetres = meanOrNull(calParts);

  let profile: MovementProfile = {
    regions: normalizeWeights(regionAcc),
    modality,
    planes: normalizeWeights(planeAcc),
    rotary,
    systemic,
    ...(rom != null ? { rom } : {}),
    ...(bwLoad != null ? { bwLoad } : {}),
    ...(forceFactor != null ? { forceFactor } : {}),
    ...(horizFactor != null ? { horizFactor } : {}),
    ...(calMetres != null ? { calMetres } : {}),
  };

  let source: ClassificationSource;
  if (unresolvedAtoms.length > 0) {
    source = 'partial';
  } else {
    const rank = Math.max(...matched.map((m) => SOURCE_RANK[m.source] ?? 0));
    source = rank >= 2 ? 'exact' : 'rule';
  }

  if (wholeOverride) {
    profile = { ...profile, ...wholeOverride };
    source = 'override';
    sawOverride = true;
  } else if (sawOverride) {
    source = 'override';
  }

  return {
    raw,
    normalized,
    atoms,
    unresolvedAtoms,
    profile,
    source,
    matchedIds: matched.map((m) => m.id),
  };
}

// Convenience for callers that only need to know whether a name resolved.
export function isClassified(c: Classification): boolean {
  return c.source !== 'unknown' && Object.keys(c.profile.regions).length > 0;
}

// Exported for the geometry lockstep test in bodyRegions.test.ts.
export const TAXONOMY_KEYS = {
  regions: MUSCLE_REGION_KEYS,
  planes: Object.keys(MOVEMENT_PLANES) as PlaneKey[],
};
