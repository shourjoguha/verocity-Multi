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
  MUSCLES,
  MUSCLE_DEFAULT_SPLIT,
  MUSCLE_REGION_KEYS,
  ROM,
  type ModalityKey,
  type MovementProfile,
  type MuscleKey,
  type MuscleWeights,
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

/**
 * A stored per-user correction (movements.taxonomy). Every key optional; it may
 * carry `regions` (the shape stored today) or `muscles` (the new one), and is
 * resolved against the matched profile by `applyOverride` at READ time, so no
 * migration is needed and the change is reversible. `muscleSource` is never
 * stored: it is a fact about where the muscles came from, computed on read.
 */
export type TaxonomyOverride = Partial<Omit<MovementProfile, 'muscleSource'>>;

export type OverrideMap = Record<string, TaxonomyOverride>;

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
  muscles: {},
  muscleSource: 'split',
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
  // "Kirsty squat" is how a curtsy squat is spelled in the real logs, and
  // "curtsey" is the other dictionary spelling. Both fold onto one token so
  // rule:curtsy-lunge covers them — as a squat they read bilateral and sagittal.
  kirsty: 'curtsy',
  curtsey: 'curtsy',
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

// Names an athlete logs as an item that are not a movement: "Rest" filling the
// seconds left on an AMRAP clock after the last full round. Not unknown — there
// is nothing to map — so the body map leaves them out entirely rather than
// listing them as unmapped and spending session minutes on them. Exact
// normalised names only; this is not a fallback bucket.
const PLACEHOLDERS = new Set(['rest']);

export function isPlaceholder(raw: string): boolean {
  return PLACEHOLDERS.has(normalizeMovementName(raw));
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

// ---- muscles <-> regions --------------------------------------------------

const isMuscleKey = (k: string): k is MuscleKey =>
  Object.prototype.hasOwnProperty.call(MUSCLES, k);

/**
 * Region weights from muscle weights: each muscle summed into its one parent.
 * This is the ONLY way an authored profile gets its regions (ground rule 1:
 * derived, never authored). Unknown keys — possible in a stored override, which
 * is untrusted jsonb — are skipped rather than invented a parent.
 */
export function regionsFromMuscles(m: MuscleWeights): RegionWeights {
  const out: RegionWeights = {};
  for (const [k, v] of Object.entries(m)) {
    if (!isMuscleKey(k) || typeof v !== 'number') continue;
    const r = MUSCLES[k].region;
    out[r] = (out[r] ?? 0) + v;
  }
  return out;
}

/**
 * Muscle weights from region weights through MUSCLE_DEFAULT_SPLIT. The inverse
 * of regionsFromMuscles for any region the split covers, to floating point.
 * A region with no split entry (only reachable through a corrupt override)
 * contributes nothing.
 */
export function musclesFromRegions(r: RegionWeights): MuscleWeights {
  const out: MuscleWeights = {};
  for (const [region, w] of Object.entries(r)) {
    const split = Object.prototype.hasOwnProperty.call(MUSCLE_DEFAULT_SPLIT, region)
      ? MUSCLE_DEFAULT_SPLIT[region as keyof typeof MUSCLE_DEFAULT_SPLIT]
      : undefined;
    if (!split || typeof w !== 'number') continue;
    for (const [m, share] of Object.entries(split) as [MuscleKey, number][]) {
      out[m] = (out[m] ?? 0) + w * share;
    }
  }
  return out;
}

/**
 * Resolve a stored override against the profile it corrects. Shallow merge, as
 * before, with one rule for the two weight maps so they can never disagree:
 *   - `muscles` present → they win; regions are derived from them; `authored`.
 *   - `regions` only    → regions as stored; muscles via the default split;
 *                         `split` (estimated).
 *   - neither           → the base profile's muscles, regions and source.
 */
export function applyOverride(base: MovementProfile, ov: TaxonomyOverride): MovementProfile {
  const merged: MovementProfile = { ...base, ...ov, muscleSource: base.muscleSource };
  if (ov.muscles != null) {
    const muscles: MuscleWeights = {};
    for (const [k, v] of Object.entries(ov.muscles)) {
      if (isMuscleKey(k) && typeof v === 'number') muscles[k] = v;
    }
    return { ...merged, muscles, regions: regionsFromMuscles(muscles), muscleSource: 'authored' };
  }
  if (ov.regions != null) {
    return { ...merged, muscles: musclesFromRegions(ov.regions), muscleSource: 'split' };
  }
  return { ...merged, muscles: base.muscles, regions: base.regions };
}

// ---- profile helpers ------------------------------------------------------

type ProfileOpts = { rotary?: RotaryRole; systemic?: boolean; rom?: number; bwLoad?: number };

// Muscle-level authoring (ground rule 2: author once, at muscle level). Regions
// are derived by summing each muscle into its parent. Every EXACT entry and rule
// is authored this way.
export function pm(
  muscles: MuscleWeights,
  modality: ModalityKey,
  plane: PlaneKey | PlaneWeights,
  opts: ProfileOpts = {},
): MovementProfile {
  return makeProfile(regionsFromMuscles(muscles), muscles, 'authored', modality, plane, opts);
}

function makeProfile(
  regions: RegionWeights,
  muscles: MuscleWeights,
  muscleSource: MovementProfile['muscleSource'],
  modality: ModalityKey,
  plane: PlaneKey | PlaneWeights,
  opts: ProfileOpts,
): MovementProfile {
  return {
    regions,
    muscles,
    muscleSource,
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

const RAW_EXACT: Record<string, MovementProfile> = {
  // --- lower, knee-dominant
  // Bilateral squats are anterior-leg dominant. A heel-elevated front or back
  // squat most of all: the raised heels drive the knees forward and shift the
  // hip-extension load off the posterior chain and onto the quads, so those two
  // carry no hamstring share.
  'back squat': pm(
    { quads: 0.5, gluteMax: 0.18, adductors: 0.1, hamstrings: 0.1, abs: 0.07, obliques: 0.05 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'front squat': pm(
    { quads: 0.65, abs: 0.15, gluteMax: 0.15, forearms: 0.05 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  // The heel-elevated back squat the athlete performs most often — quad-dominant
  // like the front squat. The `(v)` variant marker is a PER-SET notation the
  // name-based classifier never sees, so this is reachable only by naming the
  // variant explicitly; a marker-driven path would be a separate mechanism.
  'heel elevated back squat': pm(
    { quads: 0.7, gluteMax: 0.15, abs: 0.1, obliques: 0.05 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'leg extension': pm({ quads: 1 }, 'resistance', 'sagittal', { rom: ROM.kneeIsolation }),
  'leg press': pm(
    { quads: 0.58, gluteMax: 0.23, hamstrings: 0.12, adductors: 0.07 },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  pistol: pm(
    {
      quads: 0.55, gluteMax: 0.14, hamstrings: 0.1, gluteMed: 0.06, abs: 0.05, adductors: 0.05,
      hipFlexors: 0.05,
    },
    'resistance',
    'sagittal',
    { rom: ROM.squat },
  ),
  'reverse lunge': pm(
    {
      quads: 0.44, gluteMax: 0.19, hamstrings: 0.16, adductors: 0.06, abs: 0.05, gluteMed: 0.05,
      obliques: 0.05,
    },
    'resistance',
    'sagittal',
    { rom: ROM.lunge },
  ),
  'bulgarian split squat': pm(
    {
      quads: 0.4, gluteMax: 0.21, hamstrings: 0.18, gluteMed: 0.06, abs: 0.05, adductors: 0.05,
      obliques: 0.05,
    },
    'resistance',
    'sagittal',
    { rom: ROM.lunge },
  ),
  // Cossack: the loaded leg is deep-flexed quad work and the trailing leg is
  // adductor — and adductors fold into `quads` at this granularity, so it is
  // strongly anterior despite the lateral shape.
  'cossack squat': pm(
    {
      quads: 0.38, adductors: 0.3, gluteMax: 0.1, gluteMed: 0.1, hamstrings: 0.05, obliques: 0.04,
      abs: 0.03,
    },
    'resistance',
    { frontal: 0.7, sagittal: 0.3 },
    { rom: ROM.squat },
  ),

  // --- lower, hip-dominant
  'leg curl': pm({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  'nordic leg curl': pm({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  nordic: pm({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  // The everyday spelling. Without it "Nordic Curl" normalises to an atom that is
  // in neither EXACT key and falls to rule:hamstring-isolation -- which is there
  // for MACHINE leg curls (bwLoad 0) and would price a nordic at zero.
  'nordic curl': pm({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  'hip thrust machine': pm(
    { gluteMax: 0.7, hamstrings: 0.2, gluteMed: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.hipIsolation },
  ),
  'banded hip thrust': pm(
    { gluteMax: 0.62, hamstrings: 0.2, gluteMed: 0.18 },
    'resistance',
    'sagittal',
    { rom: ROM.hipIsolation },
  ),
  'split stance romanian deadlift': pm(
    {
      hamstrings: 0.45, gluteMax: 0.22, lowerBack: 0.1, gluteMed: 0.08, adductors: 0.05,
      obliques: 0.05, quads: 0.05,
    },
    'resistance',
    'sagittal',
    { rom: ROM.hinge },
  ),
  'trap bar deadlift': pm(
    {
      quads: 0.3, gluteMax: 0.27, hamstrings: 0.22, lowerBack: 0.1, adductors: 0.05, forearms: 0.03,
      traps: 0.03,
    },
    'resistance',
    'sagittal',
    { rom: ROM.hinge },
  ),
  'kettlebell swing': pm(
    {
      gluteMax: 0.38, hamstrings: 0.2, lowerBack: 0.12, abs: 0.1, forearms: 0.08, frontDelts: 0.07,
      obliques: 0.05,
    },
    'plyometric',
    'sagittal',
    { systemic: true, rom: ROM.hinge },
  ),
  'kettlebell snatch': pm(
    {
      gluteMax: 0.24, hamstrings: 0.16, frontDelts: 0.12, abs: 0.08, sideDelts: 0.08,
      lowerBack: 0.07, obliques: 0.07, rearDelts: 0.06, forearms: 0.05, traps: 0.04,
      upperBack: 0.03,
    },
    'plyometric',
    'sagittal',
    { systemic: true, rom: ROM.jump },
  ),

  // --- calves
  'calf raise': pm({ calves: 1 }, 'resistance', 'sagittal', { rom: ROM.calf }),
  'standing calf raise': pm({ calves: 1 }, 'resistance', 'sagittal', { rom: ROM.calf }),

  // --- push
  'incline dumbbell bench': pm(
    { pecs: 0.58, frontDelts: 0.27, triceps: 0.15 },
    'resistance',
    'sagittal',
    { rom: ROM.pushHorizontal },
  ),
  'machine press': pm({ pecs: 0.6, frontDelts: 0.25, triceps: 0.15 }, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  'cable fly': pm(
    { pecs: 0.85, frontDelts: 0.15 },
    'resistance',
    'transverse',
    { rom: ROM.pushHorizontal },
  ),
  'bench press': pm({ pecs: 0.6, frontDelts: 0.25, triceps: 0.15 }, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  // Its own entry, not left to the horizontal-push RULE: that rule exists for
  // bench/machine/fly, which bear none of the athlete, while a push-up carries
  // ~65% of them. Same anatomy, opposite bwLoad -- so the rule cannot serve both.
  'push up': pm({ pecs: 0.6, frontDelts: 0.25, triceps: 0.15 }, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  dip: pm({ pecs: 0.45, triceps: 0.35, frontDelts: 0.2 }, 'resistance', 'sagittal', { rom: ROM.dip }),
  'weighted dip': pm({ pecs: 0.45, triceps: 0.35, frontDelts: 0.2 }, 'resistance', 'sagittal', { rom: ROM.dip }),
  'landmine press': pm(
    { frontDelts: 0.5, pecs: 0.25, triceps: 0.15, sideDelts: 0.1 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),
  'standing barbell military press': pm(
    { frontDelts: 0.42, triceps: 0.25, sideDelts: 0.18, abs: 0.09, obliques: 0.06 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),
  'overhead press': pm(
    { frontDelts: 0.42, triceps: 0.25, sideDelts: 0.18, abs: 0.09, obliques: 0.06 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),
  'shoulder raise': pm({ frontDelts: 0.5, sideDelts: 0.5 }, 'resistance', 'frontal', { rom: ROM.deltIsolation }),
  'overhead tricep': pm({ triceps: 1 }, 'resistance', 'sagittal', { rom: ROM.armIsolation }),

  // --- pull
  'pull up': pm({ lats: 0.48, biceps: 0.2, upperBack: 0.15, forearms: 0.1, traps: 0.07 }, 'resistance', 'frontal', { rom: ROM.pullVertical }),
  'weighted pull up': pm({ lats: 0.48, biceps: 0.2, upperBack: 0.15, forearms: 0.1, traps: 0.07 }, 'resistance', 'frontal', { rom: ROM.pullVertical }),
  'chin up': pm({ lats: 0.42, biceps: 0.3, upperBack: 0.12, forearms: 0.1, traps: 0.06 }, 'resistance', 'frontal', { rom: ROM.pullVertical }),
  'dumbbell row': pm({ lats: 0.32, upperBack: 0.26, biceps: 0.2, traps: 0.12, forearms: 0.1 }, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  'iso lateral row': pm({ lats: 0.32, upperBack: 0.26, biceps: 0.2, traps: 0.12, forearms: 0.1 }, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  'gorilla row': pm({ lats: 0.32, upperBack: 0.26, biceps: 0.2, traps: 0.12, forearms: 0.1 }, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  // As with 'push up': the horizontal-pull RULE covers bent and machine rows,
  // which bear none of the athlete; an inverted row hangs off their own mass.
  'inverted row': pm({ lats: 0.32, upperBack: 0.26, biceps: 0.2, traps: 0.12, forearms: 0.1 }, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  'face pull': pm({ upperBack: 0.45, rearDelts: 0.4, traps: 0.15 }, 'resistance', 'transverse', { rom: ROM.prehab }),
  'band pull apart': pm(
    { upperBack: 0.43, rearDelts: 0.42, traps: 0.15 },
    'resistance',
    'transverse',
    { rom: ROM.prehab },
  ),

  // --- trunk
  'dead bug': pm({ abs: 0.7, hipFlexors: 0.15, obliques: 0.15 }, 'isometric', 'sagittal', { rotary: 'antiRotational' }),
  'side plank': pm({ obliques: 0.65, abs: 0.25, gluteMed: 0.1 }, 'isometric', 'frontal'),
  plank: pm({ abs: 0.65, obliques: 0.25, hipFlexors: 0.1 }, 'isometric', 'sagittal'),
  'pallof press': pm({ obliques: 0.65, abs: 0.35 }, 'isometric', 'transverse', { rotary: 'antiRotational' }),
  'landmine twist': pm({
                         obliques: 0.5, abs: 0.2, frontDelts: 0.15, lats: 0.05, lowerBack: 0.05,
                         sideDelts: 0.05,
                       }, 'resistance', 'transverse', {
    rotary: 'rotational',
  }),
  'hanging knee raise': pm({ hipFlexors: 0.45, abs: 0.37, forearms: 0.1, obliques: 0.08 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  'ab wheel roller': pm({ abs: 0.85, obliques: 0.1, hipFlexors: 0.05 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  'ab wheel rollout': pm({ abs: 0.85, obliques: 0.1, hipFlexors: 0.05 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  'machine crunch': pm({ abs: 0.85, obliques: 0.15 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  'ab routine': pm({ abs: 0.5, obliques: 0.35, hipFlexors: 0.15 }, 'resistance', 'sagittal'),

  // A front squat into an overhead throw. Logged in reps, so the work model
  // reads its `rom` as the ball's whole path, not the squat alone.
  'wall ball': pm(
    {
      quads: 0.36, frontDelts: 0.17, gluteMax: 0.15, abs: 0.1, triceps: 0.1, sideDelts: 0.08,
      adductors: 0.04,
    },
    'resistance',
    'sagittal',
    { systemic: true, rom: ROM.wallBall },
  ),

  // --- carries / sled
  'farmer carry': pm(
    {
      obliques: 0.35, forearms: 0.25, gluteMed: 0.12, traps: 0.12, abs: 0.06, gluteMax: 0.05,
      lowerBack: 0.05,
    },
    'endurance',
    'frontal',
    { systemic: true },
  ),
  'sled push': pm(
    { quads: 0.45, calves: 0.15, gluteMax: 0.13, hamstrings: 0.12, pecs: 0.1, adductors: 0.05 },
    'resistance',
    'sagittal',
    { systemic: true },
  ),
  'sled drag': pm(
    {
      quads: 0.4, calves: 0.15, gluteMax: 0.15, hamstrings: 0.15, abs: 0.05, adductors: 0.05,
      obliques: 0.05,
    },
    'resistance',
    'sagittal',
    { systemic: true },
  ),

  // --- plyometric
  'box jump': pm({ quads: 0.45, gluteMax: 0.2, calves: 0.15, hamstrings: 0.12, hipFlexors: 0.08 }, 'plyometric', 'sagittal', { systemic: true, rom: ROM.jump }),
  'med ball throw': pm(
    {
      obliques: 0.25, abs: 0.15, frontDelts: 0.15, lats: 0.12, pecs: 0.1, triceps: 0.1,
      gluteMax: 0.08, quads: 0.05,
    },
    'plyometric',
    'transverse',
    { rotary: 'rotational', systemic: true, rom: ROM.jump },
  ),

  // --- endurance
  'ski erg interval': pm({
                           lats: 0.3, abs: 0.15, triceps: 0.15, gluteMax: 0.08, hamstrings: 0.05,
                           hipFlexors: 0.05, obliques: 0.05, pecs: 0.05, upperBack: 0.05,
                           quads: 0.04, forearms: 0.03,
                         }, 'endurance', 'sagittal', {
    systemic: true,
  }),
  'rower interval': pm(
    {
      quads: 0.3, gluteMax: 0.15, hamstrings: 0.12, lats: 0.09, abs: 0.08, lowerBack: 0.08,
      upperBack: 0.05, biceps: 0.04, obliques: 0.04, calves: 0.03, forearms: 0.02,
    },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  'row erg interval': pm(
    {
      quads: 0.3, gluteMax: 0.15, hamstrings: 0.12, lats: 0.09, abs: 0.08, lowerBack: 0.08,
      upperBack: 0.05, biceps: 0.04, obliques: 0.04, calves: 0.03, forearms: 0.02,
    },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  // A bare "Row" is the erg in this app, not a barbell row. The shared library
  // seeds it as a distance/time movement (0024_seed_hyrox.sql), the seeded Hyrox
  // sessions prescribe it in calories and metres, and Log Activity writes it
  // for a rowing session. The athlete's strength rows are always qualified —
  // Iso-Lateral, Gorilla, Landmine — and EXACT matches the whole atom only, so
  // every qualified name still reaches rule:horizontal-pull. That rule used to
  // take this one too: 30 minutes of rowing read as back/arms lifting, and with
  // its bwLoad of 0 and no forceFactor, priced at zero work.
  row: pm(
    {
      quads: 0.3, gluteMax: 0.15, hamstrings: 0.12, lats: 0.09, abs: 0.08, lowerBack: 0.08,
      upperBack: 0.05, biceps: 0.04, obliques: 0.04, calves: 0.03, forearms: 0.02,
    },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  zone: pm(
    {
      quads: 0.35, gluteMax: 0.19, hamstrings: 0.16, calves: 0.15, lats: 0.08, upperBack: 0.04,
      lowerBack: 0.03,
    },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  run: pm(
    {
      quads: 0.27, calves: 0.22, hamstrings: 0.17, gluteMax: 0.13, hipFlexors: 0.06, gluteMed: 0.05,
      adductors: 0.03, tibialis: 0.03, abs: 0.02, obliques: 0.02,
    },
    'endurance',
    'sagittal',
    { systemic: true },
  ),
  cycle: pm({ quads: 0.5, gluteMax: 0.18, calves: 0.17, hamstrings: 0.12, tibialis: 0.03 }, 'endurance', 'sagittal', {
    systemic: true,
  }),
  stairmaster: pm({
                    quads: 0.37, calves: 0.22, gluteMax: 0.2, hamstrings: 0.12, adductors: 0.03,
                    gluteMed: 0.03, tibialis: 0.03,
                  }, 'endurance', 'sagittal', {
    systemic: true,
  }),

  // --- mobility / prep
  'hip mobility flow': pm(
    {
      quads: 0.25, hamstrings: 0.16, adductors: 0.15, hipFlexors: 0.15, gluteMax: 0.14,
      gluteMed: 0.1, obliques: 0.05,
    },
    'mobility',
    { sagittal: 0.4, frontal: 0.3, transverse: 0.3 },
  ),
  'hip flow': pm(
    {
      quads: 0.25, hamstrings: 0.16, adductors: 0.15, hipFlexors: 0.15, gluteMax: 0.14,
      gluteMed: 0.1, obliques: 0.05,
    },
    'mobility',
    { sagittal: 0.4, frontal: 0.3, transverse: 0.3 },
  ),
  'couch stretch': pm({ hipFlexors: 0.55, quads: 0.45 }, 'mobility', 'sagittal'),
  'hip stretch': pm({ hipFlexors: 0.3, gluteMax: 0.25, hamstrings: 0.25, adductors: 0.2 }, 'mobility', 'sagittal'),
  pigeon: pm({ gluteMax: 0.3, hipFlexors: 0.25, hamstrings: 0.18, quads: 0.15, gluteMed: 0.12 }, 'mobility', { frontal: 0.5, transverse: 0.5 }),
  'kettlebell halo': pm({
                          frontDelts: 0.22, abs: 0.2, obliques: 0.2, sideDelts: 0.2,
                          rearDelts: 0.18,
                        }, 'mobility', 'transverse'),
  halo: pm({ frontDelts: 0.22, abs: 0.2, obliques: 0.2, sideDelts: 0.2, rearDelts: 0.18 }, 'mobility', 'transverse'),
  'shoulder prep': pm({ frontDelts: 0.4, sideDelts: 0.35, rearDelts: 0.25 }, 'mobility', {
    frontal: 0.4,
    transverse: 0.4,
    sagittal: 0.2,
  }),
  'adductor work': pm({ adductors: 1 }, 'mobility', 'frontal'),

  // --- CrossFit / Hyrox movements the rules leave unknown. Added deliberately,
  // one anatomy at a time, after cross-checking each primary mover against an
  // independent exercise dataset (ExerciseDB / Gym Visual). EXACT rather than
  // rules so they touch only these names and never the burpee/box-jump combos,
  // which keep their existing classification by longest-fragment.
  //
  // Front squat into an overhead press: anterior legs and shoulders lead, with
  // the trunk bracing the rack-to-lockout path. Full-body, so systemic.
  thruster: pm(
    {
      quads: 0.32, frontDelts: 0.24, sideDelts: 0.11, abs: 0.1, gluteMax: 0.09, hamstrings: 0.06,
      obliques: 0.05, adductors: 0.03,
    },
    'resistance',
    'sagittal',
    { systemic: true, rom: ROM.squat },
  ),
  // A vertical pull that finishes as a dip — back and arms lead, the plane
  // starts frontal (pull) and turns sagittal (press over the bar).
  'muscle up': pm(
    {
      lats: 0.35, pecs: 0.15, triceps: 0.13, biceps: 0.12, frontDelts: 0.1, forearms: 0.05,
      traps: 0.05, upperBack: 0.05,
    },
    'resistance',
    { frontal: 0.6, sagittal: 0.4 },
    { systemic: true, rom: ROM.pullVertical },
  ),
  // Bodyweight vertical pull carried by grip; legs assist but back/arms move it.
  'rope climb': pm(
    { lats: 0.4, biceps: 0.22, forearms: 0.18, upperBack: 0.1, abs: 0.05, hipFlexors: 0.05 },
    'resistance',
    'frontal',
    { systemic: true, rom: ROM.pullVertical },
  ),
  // Dynamic trunk flexion, same shape as the hanging knee raise / ab wheel.
  'v up': pm({ abs: 0.55, hipFlexors: 0.35, obliques: 0.1 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  // Jump-rope conditioning: calf/ankle dominant, sustained — endurance, systemic.
  'double under': pm(
    { calves: 0.5, quads: 0.25, abs: 0.1, hipFlexors: 0.05, obliques: 0.05, tibialis: 0.05 },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.skip },
  ),
  'single under': pm(
    { calves: 0.5, quads: 0.25, abs: 0.1, hipFlexors: 0.05, obliques: 0.05, tibialis: 0.05 },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.skip },
  ),
  // Squat-thrust-jump-pushup: whole-body conditioning spanning legs, chest and
  // trunk. The dumbbell-facing variant loads the same pattern.
  burpee: pm(
    {
      quads: 0.25, pecs: 0.22, calves: 0.1, frontDelts: 0.1, gluteMax: 0.1, triceps: 0.08,
      abs: 0.07, hamstrings: 0.05, hipFlexors: 0.03,
    },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.burpee },
  ),
  'dumbbell facing burpee': pm(
    {
      quads: 0.25, pecs: 0.22, calves: 0.1, frontDelts: 0.1, gluteMax: 0.1, triceps: 0.08,
      abs: 0.07, hamstrings: 0.05, hipFlexors: 0.03,
    },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.burpee },
  ),

  // Correction: a handstand push-up is a VERTICAL press (shoulders + triceps),
  // but "push up" is a fragment of the horizontal-push rule, which was filing it
  // under chest. EXACT beats RULES, so this pins the right anatomy. Not systemic
  // — it's a strict strength movement, not conditioning.
  'handstand push up': pm(
    { frontDelts: 0.4, triceps: 0.3, sideDelts: 0.15, abs: 0.1, obliques: 0.05 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),

  // Dumbbell burpee into a double-dumbbell swing to overhead. Loaded, so resistance like
  // thruster; plane and ROM copied from burpee.
  'devil press': pm(
    {
      gluteMax: 0.17, frontDelts: 0.12, pecs: 0.12, hamstrings: 0.11, quads: 0.1, abs: 0.07,
      triceps: 0.07, traps: 0.06, lowerBack: 0.05, lats: 0.04, obliques: 0.04, sideDelts: 0.03,
      forearms: 0.02,
    },
    'resistance',
    'sagittal',
    { systemic: true, rom: ROM.burpee },
  ),
  // Chest off the ground, glutes and quads for the step-over. Conditioning, so endurance like
  // burpee.
  'burpee box step over': pm(
    {
      quads: 0.28, gluteMax: 0.18, pecs: 0.18, frontDelts: 0.08, abs: 0.06, calves: 0.06,
      hamstrings: 0.06, triceps: 0.06, adductors: 0.02, hipFlexors: 0.02,
    },
    'endurance',
    'sagittal',
    { systemic: true, rom: ROM.burpee },
  ),
  // Rope-climb scaling: lying, hand over hand to standing. Plane and ROM copied from rope
  // climb.
  'pull to stand': pm(
    { lats: 0.45, biceps: 0.22, forearms: 0.18, upperBack: 0.1, abs: 0.05 },
    'resistance',
    'frontal',
    { systemic: true, rom: ROM.pullVertical },
  ),
  // RDL plus gluteMed and obliques for single-leg balance.
  'single leg romanian deadlift': pm(
    {
      hamstrings: 0.42, gluteMax: 0.22, gluteMed: 0.1, lowerBack: 0.1, obliques: 0.05,
      adductors: 0.04, forearms: 0.03, abs: 0.02, calves: 0.02,
    },
    'resistance',
    'sagittal',
    { rom: ROM.hinge },
  ),
  // Same as overhead press; reachable before only through a saved override.
  'kettlebell press': pm(
    { frontDelts: 0.42, triceps: 0.25, sideDelts: 0.18, abs: 0.09, obliques: 0.06 },
    'resistance',
    'sagittal',
    { rom: ROM.pushVertical },
  ),
  // Owner-reviewed muscles: kneeling takes the legs out, so obliques share the brace. An EXACT
  // so it stops falling to rule:landmine-press.
  'kneeling landmine press': pm(
    { frontDelts: 0.4, pecs: 0.2, obliques: 0.2, triceps: 0.12, sideDelts: 0.08 },
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
    match: ['rower', 'row erg', 'erg'],
    profile: pm({
                  quads: 0.3, gluteMax: 0.15, hamstrings: 0.12, lats: 0.09, abs: 0.08,
                  lowerBack: 0.08, upperBack: 0.05, biceps: 0.04, obliques: 0.04, calves: 0.03,
                  forearms: 0.02,
                }, 'endurance', 'sagittal', {
      systemic: true,
    }),
  },
  {
    id: 'locomotion-endurance',
    // `bike` and `cycling` USED to live here, which made every ride resolve to
    // the running profile — the same bwLoad and the same cost per metre, over
    // distances four to six times longer. They have their own rules below.
    match: ['jog', 'sprint', 'swim', 'walk', 'hike', 'ruck', 'stairmaster'],
    profile: pm(
      {
        quads: 0.27, calves: 0.22, hamstrings: 0.17, gluteMax: 0.13, hipFlexors: 0.06,
        gluteMed: 0.05, adductors: 0.03, tibialis: 0.03, abs: 0.02, obliques: 0.02,
      },
      'endurance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    // "Easy Run", "Zone 2 Run" (→ "zone run"), "Running": only the bare "Run"
    // was EXACT. Matching is substring-based, so a bare 'run' fragment would
    // swallow trunk/brunch/prune; ' run' (leading space) needs a word before it.
    // Same muscles as `run`; the `not` list vetoes running-named non-running.
    id: 'run-named',
    match: ['running', ' run', 'treadmill run'],
    not: ['lunge', 'squat', 'man', 'jack', 'knee', 'step', 'drill', 'start', ' up'],
    profile: pm(
      {
        quads: 0.27, calves: 0.22, hamstrings: 0.17, gluteMax: 0.13, hipFlexors: 0.06,
        gluteMed: 0.05, adductors: 0.03, tibialis: 0.03, abs: 0.02, obliques: 0.02,
      },
      'endurance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    // Treadmill and elliptical keep the old erg-endurance estimates (bwLoad 0, the
    // erg force and calorie factors) when the review moved them to locomotion,
    // which would have priced them at bwLoad 0.5. Same muscles as locomotion.
    id: 'machine-locomotion',
    match: ['treadmill', 'elliptical'],
    profile: pm(
      {
        quads: 0.27, calves: 0.22, hamstrings: 0.17, gluteMax: 0.13, hipFlexors: 0.06,
        gluteMed: 0.05, adductors: 0.03, tibialis: 0.03, abs: 0.02, obliques: 0.02,
      },
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
    profile: pm({ quads: 0.5, gluteMax: 0.18, calves: 0.17, hamstrings: 0.12, tibialis: 0.03 }, 'endurance', 'sagittal', {
      systemic: true,
    }),
  },
  {
    // An air bike is not a bicycle. It drives arms and legs against a fan, it is
    // scored in calories rather than distance, and its work per calorie sits
    // just above a rower's — where a road bike's sits far below.
    id: 'air-bike',
    match: ['assault bike', 'air bike', 'echo bike', 'fan bike'],
    profile: pm(
      {
        quads: 0.3, lats: 0.12, gluteMax: 0.1, hamstrings: 0.1, biceps: 0.08, triceps: 0.08,
        upperBack: 0.08, abs: 0.05, obliques: 0.05, forearms: 0.04,
      },
      'endurance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    // Court and racket sports. `endurance` because a match is sustained heart
    // rate broken into short bursts — conditioning, the cardio lens — and there
    // is no `sport` modality to put it in. Planes are the point of the entry:
    // footwork is mostly side-to-side shuffles and crossover steps (frontal),
    // nearly every stroke is a trunk rotation (transverse), and straight-line
    // sprints are the minority. Padel used to be logged as 'Run', which read it
    // as 100% sagittal. Legs carry most of it — split-step landings and braking
    // into shots (quads), lateral push-offs (glutes), a game played on the balls
    // of the feet (calves) — and the hitting arm serves and smashes overhead.
    // No bwLoad estimate: absence falls back to VOLUME.bodyweightFraction, which
    // is already the value `run` carries.
    id: 'racket-sport',
    match: ['padel', 'tennis', 'squash', 'pickleball', 'badminton', 'racquetball'],
    // A different sport, a ball used as a tool, and an injury used as a name.
    not: ['table tennis', 'tennis ball', 'tennis elbow'],
    profile: pm(
      {
        quads: 0.2, calves: 0.15, gluteMax: 0.1, hamstrings: 0.1, obliques: 0.1, abs: 0.05,
        adductors: 0.05, forearms: 0.05, frontDelts: 0.05, gluteMed: 0.05, rearDelts: 0.04,
        sideDelts: 0.03, triceps: 0.03,
      },
      'endurance',
      { frontal: 0.4, transverse: 0.35, sagittal: 0.25 },
      { systemic: true },
    ),
  },
  {
    id: 'jump-plyo',
    match: ['jump', 'hop', 'bound'],
    profile: pm({ quads: 0.45, gluteMax: 0.2, calves: 0.15, hamstrings: 0.12, hipFlexors: 0.08 }, 'plyometric', 'sagittal', {
      systemic: true, rom: ROM.jump },
  ),
  },
  {
    // Bounding sideways off one leg. Box Jump's anatomy rather than jump-plyo's:
    // that rule is a mixed bucket that also holds throws and cleans, and every
    // name here projects the athlete's own body, as a box jump does.
    // 'skater' is NOT a fragment on its own — a Skater Squat is a single-leg
    // squat, and 'skater' would outlength 'squat' and turn it into a jump.
    id: 'lateral-plyo',
    match: ['lateral bound', 'lateral jump', 'lateral hop', 'skater jump', 'skater bound', 'skater hop'],
    profile: pm({
                  quads: 0.38, gluteMax: 0.14, calves: 0.13, adductors: 0.1, gluteMed: 0.1,
                  hamstrings: 0.1, obliques: 0.05,
                }, 'plyometric', { frontal: 0.7, sagittal: 0.3 }, { systemic: true, rom: ROM.jump }),
  },
  {
    id: 'squat-pattern',
    // Bilateral squatting only — anterior-leg dominant. Unilateral/step
    // patterns are a separate rule below with a more posterior split, and
    // longest-fragment-wins routes 'split squat' there without any ordering.
    match: ['squat', 'leg press'],
    profile: pm(
      { quads: 0.5, gluteMax: 0.18, adductors: 0.1, hamstrings: 0.1, abs: 0.07, obliques: 0.05 },
      'resistance',
      'sagittal',
      { rom: ROM.squat },
    ),
  },
  {
    id: 'lunge-pattern',
    match: ['lunge', 'split squat', 'step up'],
    profile: pm({
                  quads: 0.44, gluteMax: 0.19, hamstrings: 0.16, adductors: 0.06, abs: 0.05,
                  gluteMed: 0.05, obliques: 0.05,
                }, 'resistance', 'sagittal', { rom: ROM.lunge }),
  },
  {
    // A lunge stepped out to the side. Same anatomy as the lunge family, and the
    // same plane split as the Cossack squat, its deeper cousin: the body travels
    // sideways while the working hip and knee still bend forward to take it.
    // Every fragment outlengthens 'lunge' / 'step up', so no ordering is needed.
    id: 'lateral-lunge',
    match: ['lateral lunge', 'side lunge', 'lateral step up'],
    profile: pm({
                  quads: 0.3, adductors: 0.2, hamstrings: 0.16, gluteMax: 0.14, gluteMed: 0.1,
                  abs: 0.05, obliques: 0.05,
                }, 'resistance', { frontal: 0.7, sagittal: 0.3 }, { rom: ROM.lunge }),
  },
  {
    // The rear leg crosses BEHIND the front one. The descent is still a lunge —
    // sagittal is the largest single share — but crossing the midline adducts
    // the hip (frontal) and the pelvis turns to follow it (transverse). Unilateral,
    // so lunge anatomy: filed as a bilateral squat, "Kirsty squat" lost both its
    // posterior share and everything it did off the sagittal plane.
    id: 'curtsy-lunge',
    match: ['curtsy lunge', 'curtsy squat'],
    profile: pm(
      {
        quads: 0.42, hamstrings: 0.16, gluteMax: 0.14, gluteMed: 0.1, adductors: 0.08, abs: 0.05,
        obliques: 0.05,
      },
      'resistance',
      { sagittal: 0.4, frontal: 0.3, transverse: 0.3 },
      { rom: ROM.lunge },
    ),
  },
  {
    id: 'hinge-pattern',
    match: ['good morning'],
    profile: pm(
      { hamstrings: 0.41, gluteMax: 0.3, lowerBack: 0.1, abs: 0.08, obliques: 0.07, gluteMed: 0.04 },
      'resistance',
      'sagittal',
      { rom: ROM.hinge },
    ),
  },
  {
    id: 'hamstring-isolation',
    match: ['leg curl', 'nordic', 'ham curl', 'hamstring curl'],
    profile: pm({ hamstrings: 1 }, 'resistance', 'sagittal', { rom: ROM.hipIsolation }),
  },
  {
    id: 'quad-isolation',
    match: ['leg extension', 'knee extension'],
    profile: pm({ quads: 1 }, 'resistance', 'sagittal', { rom: ROM.kneeIsolation }),
  },
  {
    id: 'calf',
    match: ['calf raise', 'calf'],
    profile: pm({ calves: 1 }, 'resistance', 'sagittal', { rom: ROM.calf }),
  },
  {
    id: 'horizontal-push',
    match: ['bench', 'chest press', 'machine press', 'fly'],
    profile: pm({ pecs: 0.6, frontDelts: 0.25, triceps: 0.15 }, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  },
  // Every push-up VARIANT (med-ball, deficit, decline, banded...) bears the
  // athlete, exactly like the EXACT 'push up'. It used to be a fragment of
  // horizontal-push above, which prices bench/machine at bwLoad 0 -- so only the
  // literal name "Push-up" carried bodyweight and "Med-Ball Push-up" scored zero
  // work. Same anatomy, so the split is the bwLoad, not the regions.
  {
    id: 'push-up',
    match: ['push up'],
    profile: pm({ pecs: 0.6, frontDelts: 0.25, triceps: 0.15 }, 'resistance', 'sagittal', { rom: ROM.pushHorizontal }),
  },
  {
    id: 'dip',
    match: ['dip'],
    profile: pm({ pecs: 0.45, triceps: 0.35, frontDelts: 0.2 }, 'resistance', 'sagittal', { rom: ROM.dip }),
  },
  {
    id: 'vertical-push',
    match: ['overhead press', 'military press', 'shoulder press', 'push press'],
    profile: pm(
      { frontDelts: 0.42, triceps: 0.25, sideDelts: 0.18, abs: 0.09, obliques: 0.06 },
      'resistance',
      'sagittal',
      { rom: ROM.pushVertical },
    ),
  },
  {
    id: 'delt-isolation',
    match: ['shoulder raise'],
    profile: pm({ frontDelts: 0.5, sideDelts: 0.5 }, 'resistance', 'frontal', { rom: ROM.deltIsolation }),
  },
  {
    id: 'vertical-pull',
    match: ['pull up', 'chin up', 'lat pulldown', 'pulldown'],
    profile: pm({ lats: 0.48, biceps: 0.2, upperBack: 0.15, forearms: 0.1, traps: 0.07 }, 'resistance', 'frontal', { rom: ROM.pullVertical }),
  },
  {
    id: 'horizontal-pull',
    // 'row' is safe here only because splitCompound strips parentheticals and
    // 'rower'/'row erg' win on fragment length. 'throw' is vetoed explicitly.
    match: ['row', 'seal row', 'inverted row'],
    not: ['throw', 'rower', 'erg'],
    profile: pm({ lats: 0.32, upperBack: 0.26, biceps: 0.2, traps: 0.12, forearms: 0.1 }, 'resistance', 'sagittal', { rom: ROM.pullHorizontal }),
  },
  {
    id: 'upper-back-prehab',
    match: ['face pull', 'pull apart', 'reverse fly'],
    profile: pm({ upperBack: 0.45, rearDelts: 0.4, traps: 0.15 }, 'resistance', 'transverse', { rom: ROM.prehab }),
  },
  {
    id: 'arm-isolation',
    // Both spellings. 'skullcrusher' alone missed the everyday two-word form,
    // which is what a real log actually contained — and an unmapped movement is
    // not a small loss: it leaves the sets out of every region count AND drags
    // `coverage` down, which is the gate hypertrophyVolumeShort refuses to
    // speak below.
    match: ['curl', 'bicep'],
    not: ['leg curl', 'ham curl', 'nordic'],
    profile: pm({ biceps: 0.85, forearms: 0.15 }, 'resistance', 'sagittal', { rom: ROM.armIsolation }),
  },
  {
    id: 'anti-rotation',
    match: ['pallof', 'anti rotation', 'anti rotational'],
    profile: pm({ obliques: 0.65, abs: 0.35 }, 'isometric', 'transverse', { rotary: 'antiRotational' }),
  },
  {
    id: 'rotation',
    match: ['twist', 'russian twist', 'wood chop', 'chop', 'rotation'],
    profile: pm({ obliques: 0.55, abs: 0.25, frontDelts: 0.1, rearDelts: 0.05, sideDelts: 0.05 }, 'resistance', 'transverse', { rotary: 'rotational' }),
  },
  {
    id: 'core-isometric',
    match: ['plank', 'hollow hold', 'dead bug', 'bird dog'],
    profile: pm({ abs: 0.6, obliques: 0.25, hipFlexors: 0.15 }, 'isometric', 'sagittal'),
  },
  {
    // A side plank held up by the top leg's adductors — which fold into `quads`
    // at this granularity, as in 'adductor work' and the Cossack squat — while
    // the trunk resists side-bending. Frontal on both counts. The dynamic
    // version raises and lowers from the same position and the names are used
    // interchangeably, so both land here. 'copenhagen' outlengthens 'plank'.
    id: 'copenhagen',
    match: ['copenhagen'],
    profile: pm({ adductors: 0.6, obliques: 0.4 }, 'isometric', 'frontal'),
  },
  {
    id: 'core-dynamic',
    match: ['crunch', 'ab routine'],
    profile: pm({ abs: 0.8, obliques: 0.2 }, 'resistance', 'sagittal', { rom: ROM.coreDynamic }),
  },
  {
    id: 'carry',
    match: ['carry', 'farmer'],
    profile: pm(
      {
        obliques: 0.35, forearms: 0.25, gluteMed: 0.12, traps: 0.12, abs: 0.06, gluteMax: 0.05,
        lowerBack: 0.05,
      },
      'endurance',
      'frontal',
      { systemic: true },
    ),
  },
  {
    id: 'sled',
    match: ['sled'],
    profile: pm(
      {
        quads: 0.45, calves: 0.15, gluteMax: 0.13, hamstrings: 0.12, abs: 0.05, adductors: 0.05,
        obliques: 0.05,
      },
      'resistance',
      'sagittal',
      { systemic: true },
    ),
  },
  // Named mobility drills. The athlete names mobility items "... Mobility" so a
  // single search finds them, and the generic rule below would then file every
  // one of them under its hip-and-leg profile — "Shoulder mobility flow" read
  // as quads and glutes. Each rule here carries the joint it targets. Every
  // fragment outlengthens 'mobility' (8) and 'stretch' (7); a bare name that
  // would tie or lose to them ('shin box', 'cat cow') gets a "... mobility" twin
  // so no ordering is needed.
  {
    id: 'shoulder-mobility',
    match: ['shoulder mobility', 'shoulder car', 'wall slide', 'shoulder dislocate', 'shoulder stretch'],
    profile: pm({ frontDelts: 0.25, rearDelts: 0.25, sideDelts: 0.2, upperBack: 0.2, lats: 0.1 }, 'mobility', { frontal: 0.4, transverse: 0.4, sagittal: 0.2 }),
  },
  {
    // Band pull-aparts done as warm-up prep. Bare, they stay upper-back-prehab
    // resistance, which is how the logs already hold them.
    id: 'scapular-mobility',
    match: ['pull apart mobility', 'scap mobility', 'scapular mobility'],
    profile: pm({ upperBack: 0.4, rearDelts: 0.3, traps: 0.2, sideDelts: 0.1 }, 'mobility', 'transverse'),
  },
  {
    // Upper-back rotation and segmental flexion/extension. 'thoracic rotation'
    // outlengthens rule:rotation's 'rotation', which would otherwise price an
    // open book as loaded core work.
    id: 'thoracic-mobility',
    match: [
      'thoracic mobility', 'thoracic spine', 'thoracic rotation', 'spine mobility',
      'open book', 'thread the needle', 'cat cow', 'cat cow mobility',
    ],
    profile: pm({
                  upperBack: 0.3, obliques: 0.2, abs: 0.1, frontDelts: 0.1, lats: 0.1,
                  lowerBack: 0.1, rearDelts: 0.1,
                }, 'mobility', { transverse: 0.5, sagittal: 0.5 }),
  },
  {
    // Hip rotation: the 90/90 (written "Shin Box", because the numbers are
    // stripped by normalisation), hip CARs, pigeon. Adductors fold into `quads`.
    id: 'hip-rotation-mobility',
    match: [
      'shin box', 'shin box mobility', 'hip car', 'hip car mobility', 'pigeon mobility',
      'hip rotation mobility', 'hip internal rotation', 'hip external rotation',
    ],
    profile: pm({
                  gluteMed: 0.25, adductors: 0.2, gluteMax: 0.2, hamstrings: 0.2, hipFlexors: 0.1,
                  quads: 0.05,
                }, 'mobility', { transverse: 0.6, frontal: 0.4 }),
  },
  {
    // Hip-flexor length — rectus femoris folds into `quads`, as in 'couch stretch'.
    id: 'hip-flexor-mobility',
    match: ['couch stretch', 'hip flexor'],
    profile: pm({ hipFlexors: 0.55, quads: 0.45 }, 'mobility', 'sagittal'),
  },
  {
    id: 'ankle-mobility',
    match: ['ankle mobility', 'ankle rock', 'knee to wall'],
    profile: pm({ calves: 0.85, tibialis: 0.15 }, 'mobility', 'sagittal'),
  },
  {
    // 'jefferson curl' outlengthens rule:arm-isolation's 'curl', which read a
    // loaded spinal-flexion drill as a biceps curl.
    id: 'hamstring-mobility',
    match: ['hamstring mobility', 'hamstring floss', 'jefferson curl'],
    profile: pm({ hamstrings: 0.6, lowerBack: 0.4 }, 'mobility', 'sagittal'),
  },
  {
    id: 'adductor-mobility',
    match: ['adductor mobility', 'adductor rock', 'frog stretch', 'frog mobility'],
    profile: pm({ adductors: 1 }, 'mobility', 'frontal'),
  },
  {
    // A held deep squat is a position, not a set: 'squat hold' outlengthens
    // rule:squat-pattern's 'squat'.
    id: 'squat-mobility',
    match: ['squat mobility', 'deep squat hold'],
    profile: pm({
                  gluteMax: 0.2, quads: 0.2, adductors: 0.15, calves: 0.15, hamstrings: 0.15,
                  gluteMed: 0.1, tibialis: 0.05,
                }, 'mobility', 'sagittal'),
  },
  {
    // Tibialis anterior folds into `calves`, the only lower-leg region.
    id: 'tibialis',
    match: ['tibialis', 'tib raise', 'tib bar'],
    profile: pm({ tibialis: 1 }, 'resistance', 'sagittal', { rom: ROM.calf }),
  },
  {
    id: 'mobility',
    match: ['stretch', 'mobility', 'flow', 'halo', 'prep', 'foam roll', 'pigeon', 'yoga', 'leg swing', 'hip swing'],
    profile: pm({
                  quads: 0.25, hamstrings: 0.15, abs: 0.14, gluteMax: 0.12, hipFlexors: 0.1,
                  obliques: 0.1, adductors: 0.08, gluteMed: 0.06,
                }, 'mobility', {
      sagittal: 0.4,
      frontal: 0.3,
      transverse: 0.3,
    }),
  },
  {
    // SkiErg split out of erg-endurance (Q4): lats/triceps/abs-led with a hip-hinge share.
    // Plane, systemic and work
    // factors follow the EXACT ski erg interval.
    id: 'ski-erg',
    match: ['ski erg', 'skierg'],
    profile: pm(
      {
        lats: 0.3, abs: 0.15, triceps: 0.15, gluteMax: 0.08, hamstrings: 0.05, hipFlexors: 0.05,
        obliques: 0.05, pecs: 0.05, upperBack: 0.05, quads: 0.04, forearms: 0.03,
      },
      'endurance',
      'sagittal',
      { systemic: true },
    ),
  },
  {
    // Split out of jump-plyo; the med ball throw profile. No bare 'med ball' fragment, or Med-
    // Ball Push-up would be captured.
    id: 'throw-slam',
    match: ['throw', 'slam', 'chest pass', 'toss'],
    profile: pm(
      {
        obliques: 0.25, abs: 0.15, frontDelts: 0.15, lats: 0.12, pecs: 0.1, triceps: 0.1,
        gluteMax: 0.08, quads: 0.05,
      },
      'plyometric',
      'sagittal',
      { systemic: true, rom: ROM.jump },
    ),
  },
  {
    // Split out of jump-plyo. 'squat clean' outlengthens rule:squat-pattern's 'squat'.
    id: 'olympic-clean',
    match: ['clean', 'squat clean'],
    profile: pm(
      {
        gluteMax: 0.24, hamstrings: 0.18, quads: 0.18, traps: 0.12, lowerBack: 0.1, abs: 0.05,
        forearms: 0.04, upperBack: 0.04, calves: 0.03, adductors: 0.02,
      },
      'plyometric',
      'sagittal',
      { systemic: true, rom: ROM.jump },
    ),
  },
  {
    // Split out of jump-plyo: the clean plus delts and upper back for the overhead catch.
    // 'squat snatch' outlengthens 'squat'.
    id: 'olympic-snatch',
    match: ['snatch', 'squat snatch'],
    profile: pm(
      {
        gluteMax: 0.2, hamstrings: 0.15, quads: 0.15, traps: 0.1, lowerBack: 0.08, upperBack: 0.08,
        frontDelts: 0.06, abs: 0.04, sideDelts: 0.04, forearms: 0.03, triceps: 0.03,
        adductors: 0.02, rearDelts: 0.02,
      },
      'plyometric',
      'sagittal',
      { systemic: true, rom: ROM.jump },
    ),
  },
  {
    // Split out of jump-plyo (Q5): quad-led dip-drive plus front delts and triceps.
    id: 'jerk',
    match: ['jerk', 'push jerk', 'split jerk'],
    profile: pm(
      {
        quads: 0.3, frontDelts: 0.18, triceps: 0.15, gluteMax: 0.12, sideDelts: 0.07, abs: 0.06,
        traps: 0.05, calves: 0.04, adductors: 0.03,
      },
      'plyometric',
      'sagittal',
      { systemic: true, rom: ROM.jump },
    ),
  },
  {
    // Split out of squat-pattern: the overhead hold adds shoulders and upper back. 'overhead
    // squat' outlengthens 'squat'.
    id: 'overhead-squat',
    match: ['overhead squat'],
    profile: pm(
      {
        quads: 0.42, gluteMax: 0.15, abs: 0.07, frontDelts: 0.06, hamstrings: 0.06, upperBack: 0.06,
        adductors: 0.05, obliques: 0.05, sideDelts: 0.04, traps: 0.04,
      },
      'resistance',
      'sagittal',
      { rom: ROM.squat },
    ),
  },
  {
    // Split out of push-up so Pike Push-up reads shoulder-led. Plane, ROM and
    // bwLoad follow the EXACT handstand push up.
    id: 'handstand-push-up',
    match: ['handstand push up', 'pike push up'],
    profile: pm(
      { frontDelts: 0.4, triceps: 0.3, sideDelts: 0.15, abs: 0.1, obliques: 0.05 },
      'resistance',
      'sagittal',
      { rom: ROM.pushVertical },
    ),
  },
  {
    // Split out of hinge-pattern: glutes lead hamstrings, with erectors and quads. 'romanian
    // deadlift' and its siblings outlength it.
    id: 'deadlift',
    // 'suitcase deadlift' outlengths suitcase-carry's 'suitcase'; the two tied at 8 chars.
    match: ['deadlift', 'suitcase deadlift'],
    profile: pm(
      {
        gluteMax: 0.28, hamstrings: 0.22, lowerBack: 0.15, quads: 0.15, adductors: 0.05,
        forearms: 0.05, traps: 0.05, abs: 0.03, upperBack: 0.02,
      },
      'resistance',
      'sagittal',
      { rom: ROM.hinge },
    ),
  },
  {
    // Split out of hinge-pattern: hamstrings lead glutes.
    id: 'romanian-deadlift',
    match: ['romanian deadlift', 'stiff leg deadlift', 'single leg deadlift'],
    profile: pm(
      {
        hamstrings: 0.45, gluteMax: 0.25, lowerBack: 0.12, abs: 0.05, adductors: 0.05,
        forearms: 0.05, gluteMed: 0.03,
      },
      'resistance',
      'sagittal',
      { rom: ROM.hinge },
    ),
  },
  {
    // Split out of hinge-pattern; the kettlebell swing profile, plyometric like it.
    id: 'swing',
    match: ['swing'],
    // Leg and hip swings are dynamic mobility drills, not loaded hinges.
    not: ['leg swing', 'hip swing'],
    profile: pm(
      {
        gluteMax: 0.38, hamstrings: 0.2, lowerBack: 0.12, abs: 0.1, forearms: 0.08,
        frontDelts: 0.07, obliques: 0.05,
      },
      'plyometric',
      'sagittal',
      { systemic: true, rom: ROM.hinge },
    ),
  },
  {
    // Split out of vertical-push so variants read like the landmine press entry, with a chest
    // share.
    id: 'landmine-press',
    match: ['landmine press'],
    profile: pm(
      { frontDelts: 0.5, pecs: 0.25, triceps: 0.15, sideDelts: 0.1 },
      'resistance',
      'sagittal',
      { rom: ROM.pushVertical },
    ),
  },
  {
    // Split out of delt-isolation.
    id: 'front-raise',
    match: ['front raise'],
    profile: pm(
      { frontDelts: 0.9, sideDelts: 0.1 },
      'resistance',
      'frontal',
      { rom: ROM.deltIsolation },
    ),
  },
  {
    // Split out of delt-isolation.
    id: 'side-raise',
    match: ['lateral raise', 'side raise', 'lateral delt'],
    profile: pm(
      { sideDelts: 0.9, frontDelts: 0.1 },
      'resistance',
      'frontal',
      { rom: ROM.deltIsolation },
    ),
  },
  {
    // Split out of delt-isolation: rear delts with some upper back.
    id: 'rear-delt',
    match: ['rear delt'],
    profile: pm(
      { rearDelts: 0.85, upperBack: 0.15 },
      'resistance',
      'frontal',
      { rom: ROM.deltIsolation },
    ),
  },
  {
    // Split out of arm-isolation so triceps work does not expand to biceps and forearms.
    id: 'triceps-isolation',
    match: ['tricep', 'pushdown', 'skullcrusher', 'skull crusher'],
    profile: pm(
      { triceps: 1 },
      'resistance',
      'sagittal',
      { rom: ROM.armIsolation },
    ),
  },
  {
    // Split out of core-dynamic: ab wheel and rollout are abs.
    id: 'ab-rollout',
    match: ['ab wheel', 'rollout'],
    profile: pm(
      { abs: 0.85, obliques: 0.1, hipFlexors: 0.05 },
      'resistance',
      'sagittal',
      { rom: ROM.coreDynamic },
    ),
  },
  {
    // Split out of core-dynamic: hip flexors and abs, forearms for the hang.
    id: 'hanging-raise',
    match: ['hanging knee raise', 'hanging leg raise', 'toe to bar', 'knee to elbow'],
    profile: pm(
      { hipFlexors: 0.45, abs: 0.37, forearms: 0.1, obliques: 0.08 },
      'resistance',
      'sagittal',
      { rom: ROM.coreDynamic },
    ),
  },
  {
    // Split out of core-dynamic: floor and bench raises, no hang, so no forearms.
    id: 'leg-raise',
    match: ['knee raise', 'leg raise'],
    profile: pm(
      { hipFlexors: 0.5, abs: 0.42, obliques: 0.08 },
      'resistance',
      'sagittal',
      { rom: ROM.coreDynamic },
    ),
  },
  {
    // Split out of core-dynamic: part hip flexor, part abs.
    id: 'sit-up',
    match: ['sit up'],
    profile: pm(
      { abs: 0.55, hipFlexors: 0.35, obliques: 0.1 },
      'resistance',
      'sagittal',
      { rom: ROM.coreDynamic },
    ),
  },
  {
    // Split out of carry: a one-sided carry shifts to obliques.
    id: 'suitcase-carry',
    match: ['suitcase carry', 'suitcase'],
    profile: pm(
      {
        obliques: 0.35, forearms: 0.25, gluteMed: 0.12, traps: 0.12, abs: 0.06, gluteMax: 0.05,
        lowerBack: 0.05,
      },
      'endurance',
      'frontal',
      { systemic: true },
    ),
  },
  {
    // Split out of jump-plyo so burpee variants keep the floor push. Plane, ROM and
    // bwLoad follow the EXACT burpee.
    id: 'burpee',
    match: ['burpee'],
    profile: pm(
      {
        quads: 0.28, pecs: 0.18, gluteMax: 0.14, calves: 0.12, frontDelts: 0.08, hamstrings: 0.06,
        triceps: 0.06, abs: 0.05, hipFlexors: 0.03,
      },
      'endurance',
      'sagittal',
      { systemic: true, rom: ROM.burpee },
    ),
  },
  {
    // Split out of hinge-pattern: every hip thrust variation is glute-led, matching the Hip
    // Thrust Machine entry. Glute bridge included as the floor version.
    id: 'hip-thrust',
    match: ['hip thrust', 'glute bridge', 'single leg hip thrust', 'single leg glute bridge'],
    profile: pm(
      { gluteMax: 0.7, hamstrings: 0.2, gluteMed: 0.1 },
      'resistance',
      'sagittal',
      { rom: ROM.hinge },
    ),
  },
];

// ---- reviewed bodyweight load ------------------------------------------------
//
// `bwLoad` is the fraction of the athlete's own bodyweight a movement makes them
// lift, which `setVolume` ADDS to any external weight so that weighted is always
// >= bodyweight for the same movement. Kept as ONE table rather than an argument
// on 100+ `pm()` calls because these are ESTIMATES that were reviewed as a set:
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
  'pull to stand'                     : 1.0,
  'weighted pull up'                  : 1.0,
  'dip'                               : 0.9,
  'handstand push up'                 : 0.9,
  'rule:dip'                          : 0.9,
  'weighted dip'                      : 0.9,
  'box jump'                          : 0.85,
  'pistol'                            : 0.85,
  'rule:lateral-plyo'                 : 0.85,
  'standing calf raise'               : 0.85,
  'back squat'                        : 0.8,
  'farmer carry'                      : 0.8,
  'front squat'                       : 0.8,
  'rule:carry'                        : 0.8,
  'rule:suitcase-carry'               : 0.8,
  'rule:hinge-pattern'                : 0.8,
  'rule:hip-thrust'                   : 0.8,
  'rule:swing'                        : 0.4, // as 'kettlebell swing'
  'rule:romanian-deadlift'            : 0.8,
  'single leg romanian deadlift'      : 0.8,
  'rule:deadlift'                     : 0.8,
  'rule:sled'                         : 0.8,
  'rule:squat-pattern'                : 0.8,
  'rule:overhead-squat'               : 0.8,
  'sled drag'                         : 0.8,
  'sled push'                         : 0.8,
  'stairmaster'                       : 0.8,
  'thruster'                          : 0.8,
  'trap bar deadlift'                 : 0.8,
  'bulgarian split squat'             : 0.75,
  'cossack squat'                     : 0.75,
  'reverse lunge'                     : 0.75,
  'rule:curtsy-lunge'                 : 0.75,
  'rule:lateral-lunge'                : 0.75,
  'rule:lunge-pattern'                : 0.75,
  'burpee'                            : 0.65,
  'burpee box step over'              : 0.65,
  'devil press'                       : 0.65,
  'wall ball'                         : 0.8,
  'double under'                      : 0.65,
  'dumbbell facing burpee'            : 0.65,
  'nordic'                            : 0.65,
  'nordic leg curl'                   : 0.65,
  'nordic curl'                       : 0.65,
  'push up'                           : 0.65,
  'rule:push-up'                      : 0.65,
  'rule:handstand-push-up'            : 0.9,
  'run'                               : 0.65,
  'rule:run-named'                    : 0.65,
  'single under'                      : 0.65,
  'zone'                              : 0.65,
  'inverted row'                      : 0.6,
  'ab wheel roller'                   : 0.5,
  'ab wheel rollout'                  : 0.5,
  'calf raise'                        : 0.5,
  'rule:calf'                         : 0.5,
  'rule:locomotion-endurance'         : 0.5,
  'rule:copenhagen'                   : 0.45,
  'side plank'                        : 0.45,
  'kettlebell snatch'                 : 0.4,
  'kettlebell swing'                  : 0.4,
  'plank'                             : 0.4,
  'rule:core-isometric'               : 0.4,
  'ab routine'                        : 0.3,
  'dead bug'                          : 0.3,
  'hanging knee raise'                : 0.3,
  'rule:core-dynamic'                 : 0.3,
  'rule:sit-up'                       : 0.3,
  'rule:leg-raise'                    : 0.3,
  'rule:hanging-raise'                : 0.3,
  'rule:ab-rollout'                   : 0.5, // as 'ab wheel rollout'
  'rule:jump-plyo'                    : 0.3,
  'rule:burpee'                       : 0.65,
  'rule:jerk'                         : 0.3,
  'rule:olympic-snatch'               : 0.3,
  'rule:olympic-clean'                : 0.3,
  'rule:throw-slam'                   : 0.3,
  'v up'                              : 0.3,
  'pallof press'                      : 0.2,
  'rule:anti-rotation'                : 0.2,
  'rule:rotation'                     : 0.2,
  'rule:tibialis'                     : 0.1,
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
  'kneeling landmine press'           : 0.0,
  'landmine twist'                    : 0.0,
  'leg curl'                          : 0.0,
  'leg extension'                     : 0.0,
  'leg press'                         : 0.0,
  'machine crunch'                    : 0.0,
  'machine press'                     : 0.0,
  'med ball throw'                    : 0.0,
  'overhead press'                    : 0.0,
  'kettlebell press'                  : 0.0,
  'overhead tricep'                   : 0.0,
  'row'                               : 0.0,
  'row erg interval'                  : 0.0,
  'rower interval'                    : 0.0,
  'rule:arm-isolation'                : 0.0,
  'rule:triceps-isolation'            : 0.0,
  'rule:delt-isolation'               : 0.0,
  'rule:rear-delt'                    : 0.0,
  'rule:side-raise'                   : 0.0,
  'rule:front-raise'                  : 0.0,
  'rule:erg-endurance'                : 0.0,
  'rule:machine-locomotion'           : 0.0,
  'rule:ski-erg'                      : 0.0,
  'rule:hamstring-isolation'          : 0.0,
  'rule:horizontal-pull'              : 0.0,
  'rule:horizontal-push'              : 0.0,
  'rule:quad-isolation'               : 0.0,
  'rule:upper-back-prehab'            : 0.0,
  'rule:vertical-pull'                : 0.0,
  'rule:vertical-push'                : 0.0,
  'rule:landmine-press'               : 0.0,
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
  'row'                               : 0.45,
  'ski erg interval'                  : 0.3,
  'cycle'                             : 0.4,
  'rule:cycling'                      : 0.4,
  // Arms and legs against a fan, so more of the athlete is driving than on a
  // bicycle. Set just above the rower's 0.45, per the same reading.
  'rule:air-bike'                     : 0.5,
  'rule:erg-endurance'                : 0.4,
  'rule:machine-locomotion'           : 0.4,
  'rule:ski-erg'                      : 0.3,
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
  'rule:run-named'                    : 0.1,
  'zone'                              : 0.1,
  'farmer carry'                      : 0.1,
  'rule:carry'                        : 0.1,
  'rule:suitcase-carry'               : 0.1,
  'rule:locomotion-endurance'         : 0.1,
  'row erg interval'                  : 0.1,
  'rower interval'                    : 0.1,
  'row'                               : 0.1,
  'ski erg interval'                  : 0.1,
  'rule:erg-endurance'                : 0.1,
  'rule:machine-locomotion'           : 0.1,
  'rule:ski-erg'                      : 0.1,
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
  'row'                               : 15,
  // A calorie is a calorie. The erg's calorie count is the machine's own energy
  // estimate, so the smaller working mass is already in it; the old 12 priced
  // a ski calorie at about half a rowed one (31 vs 57 kg.m) and discounted it
  // twice. 22.5 makes forceFactor x calMetres match the rower (0.3 x 22.5 =
  // 0.45 x 15), so the two price a calorie the same at any bodyweight.
  'ski erg interval'                  : 22.5,
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
  'rule:machine-locomotion'           : 15,
  'rule:ski-erg'                      : 22.5,
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
        profile: applyOverride(hit?.profile ?? EMPTY_PROFILE, atomOverride),
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
        profile: applyOverride(EMPTY_PROFILE, wholeOverride),
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
  const muscleAcc: Record<string, number> = {};
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
    // Muscles merge exactly as regions do (sum, then one renormalisation), so
    // the merged muscles still sum per parent to the merged regions.
    for (const [k, v] of Object.entries(m.profile.muscles)) {
      muscleAcc[k] = (muscleAcc[k] ?? 0) + (v as number);
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
    muscles: normalizeWeights(muscleAcc),
    // A compound is `authored` only when every atom is: one estimated half
    // makes the merged muscles partly estimated.
    muscleSource: matched.every((m) => m.profile.muscleSource === 'authored') ? 'authored' : 'split',
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
    profile = applyOverride(profile, wholeOverride);
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
