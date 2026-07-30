// Domain configuration — single source of truth (SPEC §9).
// No hardcoded domain constants in components; read from here.

// kg-only for v1 (ROADMAP decision 4); config-driven for a future toggle.
export const UNITS = {
  weight: 'kg',
} as const;

// Training blocks (mesocycle phase markers) with token colors (HSL).
export const BLOCKS = {
  accumulation: { label: 'Accumulation', color: 'hsl(210 9% 64%)' },
  intensification: { label: 'Intensification', color: 'hsl(38 92% 60%)' },
  realization: { label: 'Realization', color: 'hsl(8 90% 60%)' },
  deload: { label: 'Deload', color: 'hsl(150 30% 55%)' },
} as const;

// Logger sections in canonical order.
export const SECTIONS = [
  'warmup',
  'primary',
  'secondary',
  'accessory',
  'conditioning',
  'cooldown',
] as const;

// Section name aliases → canonical section (parser normalization).
export const SECTION_ALIASES: Record<string, (typeof SECTIONS)[number]> = {
  'warm up': 'warmup',
  'warm-up': 'warmup',
  activation: 'warmup',
  main: 'primary',
  'main lift': 'primary',
  assistance: 'accessory',
  accessories: 'accessory',
  metcon: 'conditioning',
  cardio: 'conditioning',
  finisher: 'conditioning',
  'cool down': 'cooldown',
  mobility: 'cooldown',
};

// Per-set metrics.
export const METRICS = {
  weight: { label: 'Weight', unit: UNITS.weight, step: 2.5 },
  reps: { label: 'Reps', unit: '', step: 1 },
  time: { label: 'Time', unit: 's', step: 5 },
  distance: { label: 'Distance', unit: 'm', step: 10 },
  rpe: { label: 'RPE', unit: '', step: 0.5 },
} as const;

export const RPE = { min: 5, max: 10, step: 0.5, default: 7 } as const;

// Timer tunables (seconds).
export const TIMERS = {
  defaultRestSeconds: 120,
  autosaveSeconds: 15,
  restPresets: [0, 30, 60, 90, 120, 180, 300],
} as const;

// Subroutines: free-text blocks (title + description + optional link) that sit
// among movements in a section. The description cap is shared by the editing
// UI (maxLength) and the plan validator.
export const SUBROUTINE = { maxDescriptionChars: 300 } as const;

// Activity tags with accent colors — used to shade activities across the app
// (progress ribbon, stats heatmap). Five categories, fixed brand hexes.
export const ACTIVITY_TAGS = {
  strength: { label: 'Strength', color: '#084A24' },
  recovery: { label: 'Recovery', color: '#FF8F5C' },
  endurance: { label: 'Endurance', color: '#77612A' },
  mobility: { label: 'Mobility', color: '#1DBD8E' },
  sport: { label: 'Sport', color: '#004C94' },
} as const;

// Quick-pick activity types for the lightweight non-strength ActivityLogger.
export const ACTIVITY_TYPES = ['Run', 'Walk', 'Cycle', 'Row', 'Swim', 'Hike', 'Yoga', 'Mobility'] as const;

// Garmin activity-type → ActivityTagKey. Garmin emits lowercase type codes
// (e.g. "running", "lap_swimming", "strength_training"); these project onto our
// five activity tags so synced sessions colour correctly across the app. The
// normalizer lowercases the incoming type and also falls back to keyword matching
// for codes not listed here (see src/lib/garmin/normalize.ts), defaulting to
// GARMIN_DEFAULT_TAG when nothing matches.
export const GARMIN_ACTIVITY_TAG_MAP: Record<string, ActivityTagKey> = {
  running: 'endurance',
  treadmill_running: 'endurance',
  trail_running: 'endurance',
  track_running: 'endurance',
  indoor_running: 'endurance',
  cycling: 'endurance',
  road_biking: 'endurance',
  mountain_biking: 'endurance',
  gravel_cycling: 'endurance',
  indoor_cycling: 'endurance',
  virtual_ride: 'endurance',
  swimming: 'endurance',
  lap_swimming: 'endurance',
  open_water_swimming: 'endurance',
  rowing: 'endurance',
  indoor_rowing: 'endurance',
  elliptical: 'endurance',
  cardio: 'endurance',
  indoor_cardio: 'endurance',
  walking: 'endurance',
  hiking: 'endurance',
  strength_training: 'strength',
  indoor_climbing: 'strength',
  bouldering: 'strength',
  yoga: 'mobility',
  pilates: 'mobility',
  stretching: 'mobility',
  mobility: 'mobility',
  breathwork: 'recovery',
  meditation: 'recovery',
  hiit: 'sport',
  soccer: 'sport',
  basketball: 'sport',
  tennis: 'sport',
  pickleball: 'sport',
};

// Tag used when a Garmin activity type is neither mapped nor keyword-matched.
export const GARMIN_DEFAULT_TAG: ActivityTagKey = 'sport';

// Movement families for stats roll-up.
export const MOVEMENT_FAMILIES = {
  squat: ['back squat', 'front squat', 'goblet squat', 'box squat'],
  hinge: ['deadlift', 'romanian deadlift', 'rdl', 'good morning', 'hip thrust'],
  press: ['bench press', 'overhead press', 'incline press', 'push press'],
  pull: ['pull-up', 'chin-up', 'row', 'lat pulldown'],
  lunge: ['lunge', 'split squat', 'step-up'],
  carry: ['farmer carry', 'suitcase carry'],
} as const;

// ---- Movement taxonomy (region / modality / plane) ------------------------
// Deliberately SEPARATE from MOVEMENT_FAMILIES above. That map is the Stats
// RPE-fingerprint roll-up, it is matched by substring in lib/stats.ts, and it
// carries known misfires on real data ("Med-Ball Throw" → pull, because
// "th-row" contains "row"). Those misfires are pinned by test on purpose:
// correcting them would change rendered Stats output for existing logs. The
// taxonomy below is the additive replacement for NEW surfaces only.
// Matching rules live in lib/movementTaxonomy.ts — same split as
// GARMIN_ACTIVITY_TAG_MAP (config) vs lib/garmin/normalize.ts (matcher).

// Eight coarse regions. Deliberately not muscle-level: much of the logged
// vocabulary is whole-region or full-body work, and a finer grain would force
// guesses (Gorilla Row vs Face Pull vs Band pull-apart all land in `back`).
export const MUSCLE_REGIONS = {
  chest: { label: 'Chest', short: 'Chest' },
  back: { label: 'Back', short: 'Back' },
  shoulders: { label: 'Shoulders', short: 'Delts' },
  arms: { label: 'Arms', short: 'Arms' },
  core: { label: 'Trunk', short: 'Core' },
  posteriorChain: { label: 'Posterior chain', short: 'P-Chain' },
  quads: { label: 'Quads', short: 'Quads' },
  calves: { label: 'Calves', short: 'Calves' },
} as const;

// How the work was performed. `mobility` and `isometric` are separate from
// `resistance` because ~9 logged entries are pure prep/stretch work and would
// otherwise inflate resistance and skew the load metric; and because Pallof
// Press (the canonical anti-rotation movement) filed under "mobility" would
// bury the rotary axis.
export const MOVEMENT_MODALITIES = {
  resistance: { label: 'Resistance' },
  endurance: { label: 'Endurance' },
  plyometric: { label: 'Plyometric' },
  isometric: { label: 'Isometric' },
  mobility: { label: 'Mobility' },
} as const;

// Anatomical planes. Rotation is NOT a fourth plane — see ROTARY_ROLES.
export const MOVEMENT_PLANES = {
  sagittal: { label: 'Sagittal' },
  frontal: { label: 'Frontal' },
  transverse: { label: 'Transverse' },
} as const;

// Rotary role is orthogonal to plane, not a member of it. Landmine Twist
// (produces transverse torque) and Pallof Press (resists it) are BOTH
// transverse-plane; collapsing the five into one enum would make them mutually
// exclusive with "transverse" and destroy the distinction.
export const ROTARY_ROLES = {
  rotational: { label: 'Rotational' },
  antiRotational: { label: 'Anti-rotational' },
} as const;

// Working-minutes model (lib/bodyLoad.ts). Tonnage is deliberately not the
// primary currency: weight × reps is zero for Ski-Erg, Box Jump and Side Plank.
export const LOAD = {
  repSeconds: 3,
  metersPerMinute: 150,
  fallbackSetMinutes: 0.5,
} as const;

// Mobile-PWA touch model tunables (SPEC §9 cross-cutting).
export const TOUCH = {
  longPressMs: 450,
  minTargetPx: 44,
  minInputPx: 16,
  scrubSensitivity: 0.5,
  hapticsEnabled: true,
} as const;

// Notation glossary.
export const NOTATIONS = {
  '(p)': 'paused rep',
  '(t)': 'tempo',
  '+5%': 'add 5% to last',
  '/side': 'per side',
  '→': 'then / superset into',
} as const;

// e1RM estimate uses Brzycki (see src/lib/e1rm.ts).
export const E1RM = { formula: 'brzycki' } as const;

// Fitness-profile radar axes (Stats spider chart). `auto` axes receive a
// computed suggestion in the check-in (hybrid model, see lib/aspects.ts); every
// axis stays user-adjustable. Scores are on ASPECT_SCALE.
export const FITNESS_ASPECTS = [
  { key: 'strength', label: 'Strength', auto: true },
  { key: 'endurance', label: 'Endurance', auto: true },
  { key: 'power', label: 'Power', auto: false },
  { key: 'mobility', label: 'Mobility', auto: false },
  { key: 'consistency', label: 'Consistency', auto: true },
  { key: 'recovery', label: 'Recovery', auto: true },
] as const;

export const ASPECT_SCALE = { min: 1, max: 10 } as const;

// Rolling window for the derived radar axes (lib/aspects.ts). The chart plots
// this window against the block immediately before it, so Stats fetches 2× this
// many days. Never hardcode the number in a component — the legend dates and the
// query bounds must move together.
export const ASPECT_WINDOW_DAYS = 60;

export const appConfig = {
  units: UNITS,
  blocks: BLOCKS,
  sections: SECTIONS,
  sectionAliases: SECTION_ALIASES,
  metrics: METRICS,
  rpe: RPE,
  timers: TIMERS,
  subroutine: SUBROUTINE,
  activityTags: ACTIVITY_TAGS,
  activityTypes: ACTIVITY_TYPES,
  garminActivityTagMap: GARMIN_ACTIVITY_TAG_MAP,
  garminDefaultTag: GARMIN_DEFAULT_TAG,
  movementFamilies: MOVEMENT_FAMILIES,
  muscleRegions: MUSCLE_REGIONS,
  movementModalities: MOVEMENT_MODALITIES,
  movementPlanes: MOVEMENT_PLANES,
  rotaryRoles: ROTARY_ROLES,
  load: LOAD,
  touch: TOUCH,
  notations: NOTATIONS,
  e1rm: E1RM,
} as const;

export type MetricKey = keyof typeof METRICS;
export type SectionKey = (typeof SECTIONS)[number];
export type BlockKey = keyof typeof BLOCKS;
export type ActivityTagKey = keyof typeof ACTIVITY_TAGS;
export type AspectKey = (typeof FITNESS_ASPECTS)[number]['key'];
export type RegionKey = keyof typeof MUSCLE_REGIONS;
export type ModalityKey = keyof typeof MOVEMENT_MODALITIES;
export type PlaneKey = keyof typeof MOVEMENT_PLANES;
export type RotaryRole = keyof typeof ROTARY_ROLES;

export const MUSCLE_REGION_KEYS = Object.keys(MUSCLE_REGIONS) as RegionKey[];
export const MODALITY_KEYS = Object.keys(MOVEMENT_MODALITIES) as ModalityKey[];
export const PLANE_KEYS = Object.keys(MOVEMENT_PLANES) as PlaneKey[];

// Normalised weight maps. Values are ≥0 and sum to 1, so a set's load
// distributes across regions rather than double-counting.
export type RegionWeights = Partial<Record<RegionKey, number>>;
export type PlaneWeights = Partial<Record<PlaneKey, number>>;

export interface MovementProfile {
  regions: RegionWeights;
  modality: ModalityKey | null;
  planes: PlaneWeights;
  rotary: RotaryRole | null;
  // Whole-organism demand. Additive to the region weights, never a substitute:
  // Run is systemic AND posteriorChain/quads/calves.
  systemic: boolean;
}
