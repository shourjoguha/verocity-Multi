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

// Scaled training volume (`setVolume` in lib/bodyLoad.ts), the currency of the
// radar's strength and power axes. Volume is `load × repEquivalents` adjusted by
// what the logger actually recorded about the set.
//
// Time and distance convert into rep-equivalents through LOAD.repSeconds and
// LOAD.metersPerMinute — the same constants `setMinutes` uses — so a plank, a
// carry and a set of squats stay commensurable the way they already do on the
// body map.
export const VOLUME = {
  // Kg-equivalent for one unweighted rep (box jump, push-up, plank second).
  // A UNIT CONVERSION, not a norm: it says nothing about any person, and because
  // every axis is scored against the user's own history its absolute value
  // cancels out. It only sets how weighted and unweighted work trade off.
  // There is no bodyweight field on `profiles` to do this properly.
  unweightedRepKg: 40,
  // A paused rep is more time under tension than a touch-and-go one.
  pauseFactor: 1.2,
  // Per point of RPE above/below RPE.default. Near-failure work is a larger
  // stimulus at equal tonnage. Sets with no logged RPE score 1.0 — absence must
  // never be a penalty, or the axis rewards the habit of logging RPE rather
  // than the training.
  rpePerPoint: 0.05,
  rpeFactorRange: [0.85, 1.2] as [number, number],
  // Strength weights each set by load relative to that movement's own best e1RM.
  // `refIntensity` is the fraction of 1RM that scores 1.0; without this, pure
  // tonnage would make a peaking block read as a strength *drop* (5×10 @ 60kg
  // beats 5×3 @ 140kg on volume alone).
  refIntensity: 0.7,
  intensityFactorRange: [0.6, 1.5] as [number, number],
  // Power favours low-rep sets: real explosive work is 3–6 reps, and plain
  // volume would let 20 sloppy box jumps outrank 6 sharp ones.
  explosiveRefReps: 5,
  explosiveFactorRange: [0.4, 1.5] as [number, number],
} as const;

// Endurance blends aerobic work, dense strength work and heart-rate spread
// (lib/aspects.ts). Dense strength work is conditioning by any reasonable
// reading, and hr_max − hr_avg is the interval signature that separates a
// threshold session from steady state at the same average HR.
export const ENDURANCE = {
  // Rest below this reads as conditioning-style density.
  denseRestSeconds: 90,
  // How much a fully dense minute of resistance work counts against an aerobic
  // minute. Raising this turns endurance into a strength proxy — the single
  // most consequential constant here.
  densityWeight: 0.6,
  // Multiplier on the HR-spread term when the session logged a conditioning
  // block, where a wide spread is most clearly interval work.
  conditioningBoost: 1.5,
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

// Fitness-profile radar axes (Stats spider chart). All six derive from logged
// data (lib/aspects.ts); a recent check-in overrides any of them. There is no
// `auto` flag any more — power and mobility used to carry `auto: false` and so
// only moved when the user opened the check-in, which is exactly the staleness
// the taxonomy-driven derivation removed.
// `unit` labels the RAW metric (AspectMetrics in lib/types.ts), which the chart
// prints verbatim on any axis it cannot yet score. An unlabelled 112 is
// meaningless; "112 kg" is a real measurement the user can act on.
export const FITNESS_ASPECTS = [
  { key: 'strength', label: 'Strength', unit: 'load/wk' },
  { key: 'endurance', label: 'Endurance', unit: 'min/wk' },
  { key: 'power', label: 'Power', unit: 'load/wk' },
  { key: 'mobility', label: 'Mobility', unit: 'min/wk' },
  { key: 'consistency', label: 'Consistency', unit: 'days/wk' },
  { key: 'recovery', label: 'Recovery', unit: 'index' },
] as const;

export const ASPECT_SCALE = { min: 1, max: 10 } as const;

// Selectable measurement windows. This is the responsiveness control: one
// session is ~1/25th of a 60-day window and ~1/12th of a 28-day one, so the
// short window is what makes a single workout visibly move the shape. The
// *displayed* value has always rolled daily — what felt unresponsive was the
// window length, not how often anything recomputed.
//
// Each length keeps its OWN baseline series (aspect_snapshots.window_days).
// Scoring a 28-day reading against a distribution of 60-day readings would
// silently skew every axis.
export const ASPECT_WINDOWS = [
  { key: 'recent', days: 28, label: 'Recent' },
  { key: 'trend', days: 60, label: 'Trend' },
] as const;

// Default window, and the basis of the Stats log fetch: it spans this window
// plus the block before it, which also covers every shorter window in
// ASPECT_WINDOWS for free. Never hardcode the number in a component — the legend
// dates and the query bounds must move together.
export const ASPECT_WINDOW_DAYS = 60;

// How far back the radar reads its baseline, in WEEKLY snapshots
// (aspect_snapshots). Scores are RELATIVE: an axis is placed against the
// distribution of your own past values for that same metric, so the midpoint
// means "typical for you" and the polygon can always move.
//
// Weekly, not monthly: the rolling metric barely moves day to day, so weekly
// captures effectively all of its variation — and it means a real baseline
// arrives after ~4 weeks instead of ~4 months, which is what let the invented
// reference values be deleted outright rather than merely deprecated.
export const ASPECT_BASELINE_WEEKS = 52;

// How many weeks a cold start reconstructs in one pass. Smaller than
// ASPECT_BASELINE_WEEKS on purpose: reading a year of snapshots is ~52 tiny
// rows, but *building* one needs the logs underneath it, and each week drags
// another window of LogDocument JSONB into the fetch. A quarter clears
// ASPECT_MIN_BASELINE immediately and the span thickens a week at a time.
export const ASPECT_BACKFILL_WEEKS = 12;

// Below this many baseline samples there is nothing to be relative TO, so the
// axis is reported UNSCORED and the chart shows its raw measurement instead.
// There is deliberately no absolute fallback: inventing a reference value and
// calling the midpoint "typical for you" was a claim the data could not support.
export const ASPECT_MIN_BASELINE = 4;

// Above ASPECT_MIN_BASELINE but below this, an axis is scored yet the baseline
// is thin — reported as low confidence and drawn with a hollow vertex, so it
// cannot be read with the same authority as a settled one.
//
// MUST stay comfortably above ASPECT_BACKFILL_WEEKS. Set equal to it, every
// successful backfill lands exactly on "settled" and the hollow state becomes
// unreachable — the distinction renders as dead code, which a probe across four
// baseline depths caught returning `hollow 0` every time. Half a year of weekly
// samples is the point at which a median is worth trusting without a caveat.
export const ASPECT_GOOD_BASELINE = 26;

// A check-in speaks for itself while it is fresh. Past this many days before the
// window end, the derived score takes back over rather than letting a months-old
// self-rating masquerade as current.
export const ASPECT_OVERRIDE_DAYS = 21;

// Which definition of computeAspectMetrics is current. Stored on every snapshot
// so a row written under an older definition can never enter a baseline: the
// median of two different definitions of "strength" describes neither, and the
// chart gives no sign that it happened.
//
// BUMP THIS whenever computeAspectMetrics changes what a metric means, and add a
// migration deleting rows below the new value (0019 is the template).
//   1 — e1RM-based strength, plyometric minutes for power, aerobic-only endurance
//   2 — scaled training volume for strength/power, three-component endurance
export const ASPECT_METRICS_VERSION = 2;

// Softness of the logistic that maps a robust z-score onto ASPECT_SCALE: ±1.5
// lands roughly ±2.2 points. The logistic is asymptotic, so scores approach 1
// and 10 without ever pinning to them.
export const ASPECT_SOFTNESS = { z: 1.5 } as const;

// Heart-rate model for the endurance axis. `maxFallback` stands in for an
// observed hr_max when a user has never logged one — there is no age field, so
// 220−age is not available. `defaultIntensity` is what an aerobic session with
// no hr_avg is assumed to have been worth.
export const HR = { maxFallback: 190, defaultIntensity: 0.65 } as const;

// Acute:chronic workload ratio, the training-stress term in the recovery axis.
// Ratios inside the sweet spot cost nothing; the penalty ramps in above it and
// is fully applied `penaltySpan` beyond. Standard sports-science bounds.
export const ACWR = { acuteDays: 7, chronicDays: 28, sweetMax: 1.3, penaltySpan: 0.7 } as const;

// The vibe check is optional, so recovery needs a prior for sessions that carry
// no rating. 0.5 is deliberately neutral: assuming the best would make recovery
// collapse the day a user starts rating honestly.
export const RECOVERY = { neutralVibe: 0.5 } as const;

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
export type AspectWindowKey = (typeof ASPECT_WINDOWS)[number]['key'];
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
