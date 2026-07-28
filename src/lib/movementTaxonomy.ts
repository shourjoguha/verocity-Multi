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
  opts: { rotary?: RotaryRole; systemic?: boolean } = {},
): MovementProfile {
  return {
    regions,
    modality,
    planes: typeof plane === 'string' ? { [plane]: 1 } : plane,
    rotary: opts.rotary ?? null,
    systemic: opts.systemic ?? false,
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
  'back squat': p({ quads: 0.5, posteriorChain: 0.35, core: 0.15 }, 'resistance', 'sagittal'),
  'front squat': p({ quads: 0.55, posteriorChain: 0.25, core: 0.2 }, 'resistance', 'sagittal'),
  'leg extension': p({ quads: 1 }, 'resistance', 'sagittal'),
  'leg press': p({ quads: 0.65, posteriorChain: 0.35 }, 'resistance', 'sagittal'),
  pistol: p({ quads: 0.6, posteriorChain: 0.3, core: 0.1 }, 'resistance', 'sagittal'),
  'reverse lunge': p({ quads: 0.5, posteriorChain: 0.4, core: 0.1 }, 'resistance', 'sagittal'),
  'bulgarian split squat': p(
    { quads: 0.45, posteriorChain: 0.45, core: 0.1 },
    'resistance',
    'sagittal',
  ),
  'cossack squat': p(
    { quads: 0.6, posteriorChain: 0.25, core: 0.15 },
    'resistance',
    { frontal: 0.7, sagittal: 0.3 },
  ),

  // --- lower, hip-dominant
  'leg curl': p({ posteriorChain: 1 }, 'resistance', 'sagittal'),
  'nordic leg curl': p({ posteriorChain: 1 }, 'resistance', 'sagittal'),
  nordic: p({ posteriorChain: 1 }, 'resistance', 'sagittal'),
  'hip thrust machine': p({ posteriorChain: 1 }, 'resistance', 'sagittal'),
  'banded hip thrust': p({ posteriorChain: 1 }, 'resistance', 'sagittal'),
  'split stance romanian deadlift': p(
    { posteriorChain: 0.75, core: 0.15, quads: 0.1 },
    'resistance',
    'sagittal',
  ),
  'trap bar deadlift': p({ posteriorChain: 0.5, quads: 0.35, back: 0.15 }, 'resistance', 'sagittal'),
  'kettlebell swing': p(
    { posteriorChain: 0.7, core: 0.2, shoulders: 0.1 },
    'plyometric',
    'sagittal',
    { systemic: true },
  ),
  'kettlebell snatch': p(
    { posteriorChain: 0.4, shoulders: 0.3, core: 0.2, back: 0.1 },
    'plyometric',
    'sagittal',
    { systemic: true },
  ),

  // --- calves
  'calf raise': p({ calves: 1 }, 'resistance', 'sagittal'),
  'standing calf raise': p({ calves: 1 }, 'resistance', 'sagittal'),

  // --- push
  'incline dumbbell bench': p(PUSH_HORIZONTAL, 'resistance', 'sagittal'),
  'machine press': p(PUSH_HORIZONTAL, 'resistance', 'sagittal'),
  'cable fly': p({ chest: 0.85, shoulders: 0.15 }, 'resistance', 'transverse'),
  'bench press': p(PUSH_HORIZONTAL, 'resistance', 'sagittal'),
  dip: p(DIP, 'resistance', 'sagittal'),
  'weighted dip': p(DIP, 'resistance', 'sagittal'),
  'landmine press': p({ shoulders: 0.6, chest: 0.25, arms: 0.15 }, 'resistance', 'sagittal'),
  'standing barbell military press': p(
    { shoulders: 0.6, arms: 0.25, core: 0.15 },
    'resistance',
    'sagittal',
  ),
  'overhead press': p({ shoulders: 0.6, arms: 0.25, core: 0.15 }, 'resistance', 'sagittal'),
  'shoulder raise': p({ shoulders: 1 }, 'resistance', 'frontal'),
  'overhead tricep': p({ arms: 1 }, 'resistance', 'sagittal'),

  // --- pull
  'pull up': p(VERTICAL_PULL, 'resistance', 'frontal'),
  'weighted pull up': p(VERTICAL_PULL, 'resistance', 'frontal'),
  'chin up': p({ back: 0.6, arms: 0.4 }, 'resistance', 'frontal'),
  'dumbbell row': p(ROW, 'resistance', 'sagittal'),
  'iso lateral row': p(ROW, 'resistance', 'sagittal'),
  'gorilla row': p(ROW, 'resistance', 'sagittal'),
  'face pull': p({ back: 0.6, shoulders: 0.4 }, 'resistance', 'transverse'),
  'band pull apart': p({ back: 0.6, shoulders: 0.4 }, 'resistance', 'transverse'),

  // --- trunk
  'dead bug': p({ core: 1 }, 'isometric', 'sagittal', { rotary: 'antiRotational' }),
  'side plank': p({ core: 1 }, 'isometric', 'frontal'),
  plank: p({ core: 1 }, 'isometric', 'sagittal'),
  'pallof press': p({ core: 1 }, 'isometric', 'transverse', { rotary: 'antiRotational' }),
  'landmine twist': p({ core: 0.7, shoulders: 0.2, back: 0.1 }, 'resistance', 'transverse', {
    rotary: 'rotational',
  }),
  'hanging knee raise': p({ core: 1 }, 'resistance', 'sagittal'),
  'ab wheel roller': p({ core: 1 }, 'resistance', 'sagittal'),
  'ab wheel rollout': p({ core: 1 }, 'resistance', 'sagittal'),
  'machine crunch': p({ core: 1 }, 'resistance', 'sagittal'),
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
    systemic: true,
  }),
  'med ball throw': p(
    { core: 0.4, chest: 0.25, shoulders: 0.25, back: 0.1 },
    'plyometric',
    'transverse',
    { rotary: 'rotational', systemic: true },
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
      systemic: true,
    }),
  },
  {
    id: 'squat-pattern',
    match: ['squat', 'leg press', 'step up', 'lunge', 'split squat'],
    profile: p({ quads: 0.5, posteriorChain: 0.35, core: 0.15 }, 'resistance', 'sagittal'),
  },
  {
    id: 'hinge-pattern',
    match: ['deadlift', 'romanian deadlift', 'good morning', 'hip thrust', 'glute bridge', 'swing'],
    profile: p({ posteriorChain: 0.75, core: 0.15, back: 0.1 }, 'resistance', 'sagittal'),
  },
  {
    id: 'hamstring-isolation',
    match: ['leg curl', 'nordic', 'ham curl'],
    profile: p({ posteriorChain: 1 }, 'resistance', 'sagittal'),
  },
  {
    id: 'quad-isolation',
    match: ['leg extension', 'knee extension'],
    profile: p({ quads: 1 }, 'resistance', 'sagittal'),
  },
  {
    id: 'calf',
    match: ['calf raise', 'calf'],
    profile: p({ calves: 1 }, 'resistance', 'sagittal'),
  },
  {
    id: 'horizontal-push',
    match: ['bench', 'chest press', 'push up', 'machine press', 'fly'],
    profile: p(PUSH_HORIZONTAL, 'resistance', 'sagittal'),
  },
  {
    id: 'dip',
    match: ['dip'],
    profile: p(DIP, 'resistance', 'sagittal'),
  },
  {
    id: 'vertical-push',
    match: ['overhead press', 'military press', 'shoulder press', 'push press', 'landmine press'],
    profile: p({ shoulders: 0.6, arms: 0.25, core: 0.15 }, 'resistance', 'sagittal'),
  },
  {
    id: 'delt-isolation',
    match: ['lateral raise', 'shoulder raise', 'front raise', 'rear delt'],
    profile: p({ shoulders: 1 }, 'resistance', 'frontal'),
  },
  {
    id: 'vertical-pull',
    match: ['pull up', 'chin up', 'lat pulldown', 'pulldown'],
    profile: p(VERTICAL_PULL, 'resistance', 'frontal'),
  },
  {
    id: 'horizontal-pull',
    // 'row' is safe here only because splitCompound strips parentheticals and
    // 'rower'/'row erg' win on fragment length. 'throw' is vetoed explicitly.
    match: ['row', 'seal row', 'inverted row'],
    not: ['throw', 'rower', 'erg'],
    profile: p(ROW, 'resistance', 'sagittal'),
  },
  {
    id: 'upper-back-prehab',
    match: ['face pull', 'pull apart', 'reverse fly'],
    profile: p({ back: 0.6, shoulders: 0.4 }, 'resistance', 'transverse'),
  },
  {
    id: 'arm-isolation',
    match: ['curl', 'tricep', 'bicep', 'pushdown', 'skullcrusher'],
    not: ['leg curl', 'ham curl', 'nordic'],
    profile: p({ arms: 1 }, 'resistance', 'sagittal'),
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
    profile: p({ core: 1 }, 'resistance', 'sagittal'),
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
  }

  const firstModality = matched.find((m) => m.profile.modality)?.profile.modality ?? null;
  const topVote = Object.entries(modalityVotes).sort((a, b) => b[1] - a[1])[0];
  const modality: ModalityKey | null = topVote
    ? // On a tie, prefer the first atom's modality over alphabetical accident.
      (modalityVotes[firstModality as string] === topVote[1]
        ? (firstModality as ModalityKey)
        : (topVote[0] as ModalityKey))
    : null;

  let profile: MovementProfile = {
    regions: normalizeWeights(regionAcc),
    modality,
    planes: normalizeWeights(planeAcc),
    rotary,
    systemic,
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
