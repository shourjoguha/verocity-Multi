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
  opts: { rotary?: RotaryRole; systemic?: boolean; rom?: number } = {},
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

export const EXACT: Record<string, MovementProfile> = {
  // --- lower, knee-dominant
  // Bilateral squats are anterior-leg dominant. The front squat most of all:
  // the upright torso shifts demand off the hips and onto the quads, and the
  // rack position taxes the trunk more than a back squat does.
  'back squat': p(
    { quads: 0.6, posteriorChain: 0.28, core: 0.12 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'front squat': p(
    { quads: 0.7, posteriorChain: 0.1, core: 0.2 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'leg extension': p({ quads: 1 }, 'resistance', 'sagittal', { rom: ROM.kneeIsolation }),
  'leg press': p(
    { quads: 0.65, posteriorChain: 0.35 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  pistol: p(
    { quads: 0.6, posteriorChain: 0.3, core: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'reverse lunge': p(
    { quads: 0.5, posteriorChain: 0.4, core: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.lunge },
  ),
  'bulgarian split squat': p(
    { quads: 0.45, posteriorChain: 0.45, core: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.lunge },
  ),
  // Cossack: the loaded leg is deep-flexed quad work and the trailing leg is
  // adductor — and adductors fold into `quads` at this granularity, so it is
  // strongly anterior despite the lateral shape.
  'cossack squat': p(
    { quads: 0.75, posteriorChain: 0.15, core: 0.1 },
    'resistance',
    { frontal: 0.7, sagittal: 0.3 },
    { rom: ROM.squat },
  ),

  // --- lower, hip-dominant
  'leg curl': p({ posteriorChain: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  'nordic leg curl': p({ posteriorChain: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  nordic: p({ posteriorChain: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  'hip thrust machine': p(
    { posteriorChain: 1 },
    'resistance',
    'sagittal',
    { rom: ROM.hipIsolation },
  ),
  'banded hip thrust': p(
    { posteriorChain: 1 },
    'resistance',
    'sagittal',
    { rom: ROM.hipIsolation },
  ),
  'split stance romanian deadlift': p(
    { posteriorChain: 0.75, core: 0.15, quads: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.hinge },
  ),
  'trap bar deadlift': p(
    { posteriorChain: 0.5, quads: 0.35, back: 0.15 },
    'resistance',
    'sagittal',
    { rom: ROM.hinge },
  ),
  'kettlebell swing': p(
    { posteriorChain: 0.7, core: 0.2, shoulders: 0.1 },
    'plyometric',
    'sagittal',
    { systemic: true, rom: ROM.hinge },
  ),
  'kettlebell snatch': p(
    { posteriorChain: 0.4, shoulders: 0.3, core: 0.2, back: 0.1 },
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

  // --- carries / sled
  'farmer carry': p(
    { core: 0.35, arms: 0.25, shoulders: 0.2, posteriorChain: 0.2 },
    'isometric',
    'frontal',
    { systemic: true },
  ),
  'sled push': p(
    { quads: 0.5, posteriorChain: 0.25, calves: 0.15, chest: 0.1 },
    'resistance',
    'sagittal',
    { systemic: true },
  ),
  'sled drag': p(
    { quads: 0.45, posteriorChain: 0.3, calves: 0.15, core: 0.1 },
    'resistance',
    'sagittal',
    { systemic: true },
  ),

  // --- plyometric
  'box jump': p({ quads: 0.5, posteriorChain: 0.4, calves: 0.1 }, 'plyometric', 'sagittal', {
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
    { back: 0.4, quads: 0.3, posteriorChain: 0.2, arms: 0.1 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  'row erg interval': p(
    { back: 0.4, quads: 0.3, posteriorChain: 0.2, arms: 0.1 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  zone: p(
    { quads: 0.35, posteriorChain: 0.35, calves: 0.15, back: 0.15 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  run: p(
    { posteriorChain: 0.35, quads: 0.3, calves: 0.25, core: 0.1 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  cycle: p({ quads: 0.5, posteriorChain: 0.3, calves: 0.2 }, 'endurance', 'sagittal', {
    systemic: true,
  }),
  stairmaster: p({ quads: 0.4, posteriorChain: 0.35, calves: 0.25 }, 'endurance', 'sagittal', {
    systemic: true,
  }),

  // --- mobility / prep
  'hip mobility flow': p(
    { quads: 0.4, posteriorChain: 0.4, core: 0.2 },
    'mobility',
    { sagittal: 0.4, frontal: 0.3, transverse: 0.3 },
  ),
  'hip flow': p(
    { quads: 0.4, posteriorChain: 0.4, core: 0.2 },
    'mobility',
    { sagittal: 0.4, frontal: 0.3, transverse: 0.3 },
  ),
  'couch stretch': p({ quads: 1 }, 'mobility', 'sagittal'),
  'hip stretch': p({ quads: 0.5, posteriorChain: 0.5 }, 'mobility', 'sagittal'),
  pigeon: p({ posteriorChain: 0.6, quads: 0.4 }, 'mobility', { frontal: 0.5, transverse: 0.5 }),
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
    { quads: 0.35, shoulders: 0.35, posteriorChain: 0.15, core: 0.15 },
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
    { systemic: true },
  ),
  'single under': p(
    { calves: 0.55, quads: 0.25, core: 0.2 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  // Squat-thrust-jump-pushup: whole-body conditioning spanning legs, chest and
  // trunk. The dumbbell-facing variant loads the same pattern.
  burpee: p(
    { quads: 0.3, chest: 0.2, posteriorChain: 0.2, shoulders: 0.15, core: 0.15 },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  'dumbbell facing burpee': p(
    { quads: 0.3, chest: 0.2, posteriorChain: 0.2, shoulders: 0.15, core: 0.15 },
    'endurance',
    'sagittal',
    { systemic: true },
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

export const RULES: MovementRule[] = [
  {
    id: 'erg-endurance',
    match: ['ski erg', 'row erg', 'rower', 'erg', 'treadmill', 'stairmaster', 'elliptical'],
    profile: p({ back: 0.4, quads: 0.3, posteriorChain: 0.2, arms: 0.1 }, 'endurance', 'sagittal', {
      systemic: true,
    }),
  },
  {
    id: 'locomotion-endurance',
    match: ['jog', 'sprint', 'swim', 'bike', 'cycling', 'walk', 'hike', 'ruck'],
    profile: p(
      { posteriorChain: 0.35, quads: 0.3, calves: 0.25, core: 0.1 },
      'endurance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    id: 'jump-plyo',
    match: ['jump', 'hop', 'bound', 'throw', 'slam', 'clean', 'snatch', 'jerk'],
    profile: p({ quads: 0.4, posteriorChain: 0.35, core: 0.25 }, 'plyometric', 'sagittal', {
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
      { quads: 0.6, posteriorChain: 0.28, core: 0.12 },
      'resistance',
      'sagittal',
      { rom: ROM.squat },
    ),
  },
  {
    id: 'lunge-pattern',
    match: ['lunge', 'split squat', 'step up'],
    profile: p(
      { quads: 0.5, posteriorChain: 0.4, core: 0.1 },
      'resistance',
      'sagittal',
      { rom: ROM.lunge },
    ),
  },
  {
    id: 'hinge-pattern',
    match: ['deadlift', 'romanian deadlift', 'good morning', 'hip thrust', 'glute bridge', 'swing'],
    profile: p(
      { posteriorChain: 0.75, core: 0.15, back: 0.1 },
      'resistance',
      'sagittal',
      { rom: ROM.hinge },
    ),
  },
  {
    id: 'hamstring-isolation',
    match: ['leg curl', 'nordic', 'ham curl'],
    profile: p({ posteriorChain: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
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
      { core: 0.35, arms: 0.25, shoulders: 0.2, posteriorChain: 0.2 },
      'isometric',
      'frontal',
      { systemic: true },
    ),
  },
  {
    id: 'sled',
    match: ['sled'],
    profile: p(
      { quads: 0.5, posteriorChain: 0.25, calves: 0.15, core: 0.1 },
      'resistance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    id: 'mobility',
    match: ['stretch', 'mobility', 'flow', 'halo', 'prep', 'foam roll', 'pigeon', 'yoga'],
    profile: p({ core: 0.34, quads: 0.33, posteriorChain: 0.33 }, 'mobility', {
      sagittal: 0.4,
      frontal: 0.3,
      transverse: 0.3,
    }),
  },
];

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

  let profile: MovementProfile = {
    regions: normalizeWeights(regionAcc),
    modality,
    planes: normalizeWeights(planeAcc),
    rotary,
    systemic,
    ...(rom != null ? { rom } : {}),
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
