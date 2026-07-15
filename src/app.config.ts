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
  restPresets: [0, 60, 90, 120, 180, 300],
} as const;

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

export const appConfig = {
  units: UNITS,
  blocks: BLOCKS,
  sections: SECTIONS,
  sectionAliases: SECTION_ALIASES,
  metrics: METRICS,
  rpe: RPE,
  timers: TIMERS,
  activityTags: ACTIVITY_TAGS,
  activityTypes: ACTIVITY_TYPES,
  garminActivityTagMap: GARMIN_ACTIVITY_TAG_MAP,
  garminDefaultTag: GARMIN_DEFAULT_TAG,
  movementFamilies: MOVEMENT_FAMILIES,
  touch: TOUCH,
  notations: NOTATIONS,
  e1rm: E1RM,
} as const;

export type MetricKey = keyof typeof METRICS;
export type SectionKey = (typeof SECTIONS)[number];
export type BlockKey = keyof typeof BLOCKS;
export type ActivityTagKey = keyof typeof ACTIVITY_TAGS;
export type AspectKey = (typeof FITNESS_ASPECTS)[number]['key'];
