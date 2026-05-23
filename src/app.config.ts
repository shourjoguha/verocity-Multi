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

export const RPE = { min: 5, max: 10, step: 0.5 } as const;

// Timer tunables (seconds).
export const TIMERS = {
  defaultRestSeconds: 120,
  autosaveSeconds: 15,
  restPresets: [60, 90, 120, 180, 300],
} as const;

// Activity tags with accent colors (HSL) — used sparingly as accent (SPEC §11).
export const ACTIVITY_TAGS = {
  strength: { label: 'Strength', color: 'hsl(8 90% 60%)' },
  hypertrophy: { label: 'Hypertrophy', color: 'hsl(280 60% 65%)' },
  conditioning: { label: 'Conditioning', color: 'hsl(38 92% 60%)' },
  endurance: { label: 'Endurance', color: 'hsl(150 50% 55%)' },
  skill: { label: 'Skill', color: 'hsl(200 70% 60%)' },
  recovery: { label: 'Recovery', color: 'hsl(210 9% 64%)' },
} as const;

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

export const appConfig = {
  units: UNITS,
  blocks: BLOCKS,
  sections: SECTIONS,
  sectionAliases: SECTION_ALIASES,
  metrics: METRICS,
  rpe: RPE,
  timers: TIMERS,
  activityTags: ACTIVITY_TAGS,
  movementFamilies: MOVEMENT_FAMILIES,
  touch: TOUCH,
  notations: NOTATIONS,
  e1rm: E1RM,
} as const;

export type MetricKey = keyof typeof METRICS;
export type SectionKey = (typeof SECTIONS)[number];
export type BlockKey = keyof typeof BLOCKS;
export type ActivityTagKey = keyof typeof ACTIVITY_TAGS;
