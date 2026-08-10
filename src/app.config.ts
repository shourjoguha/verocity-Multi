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
  // Calories — the scoring unit for erg/row/ski/stairmaster-style zone 2
  // machines when a workout prescribes "calorie X" rather than a distance.
  cal: { label: 'Calories', unit: 'cal', step: 5 },
  rpe: { label: 'RPE', unit: '', step: 0.5 },
} as const;

export const RPE = { min: 5, max: 10, step: 0.5, default: 7 } as const;

// Timer tunables (seconds).
export const TIMERS = {
  defaultRestSeconds: 120,
  autosaveSeconds: 15,
  restPresets: [0, 30, 60, 90, 120, 180, 300],
  // Wall-clock cap on a live session. A workout left running is auto-ended
  // here so a stale session never racks up a 9-hour duration, and Home stops
  // offering to resume one past it. The user can edit the time later.
  maxWorkoutSeconds: 2 * 60 * 60,
} as const;

// Subroutines: free-text blocks (title + description + optional link) that sit
// among movements in a section. The description cap is shared by the editing
// UI (maxLength) and the plan validator.
export const SUBROUTINE = { maxDescriptionChars: 300 } as const;

// ---------------------------------------------------------------------------
// Owner stats (`user_stats`, edited on /app/settings).
//
// Only two of these fields reach a metric: `body_weight_kg` prices unweighted
// work through VOLUME.bodyweightFraction, and `birth_year` supplies the HR
// ceiling when no hr_max has ever been observed. Height, gender and body type
// are STORED AND READ BY NOTHING — see the note on BODY_TYPES.
// ---------------------------------------------------------------------------

export const GENDERS = {
  female: { label: 'Female' },
  male: { label: 'Male' },
  other: { label: 'Other' },
  unspecified: { label: 'Prefer not to say' },
} as const;

// Body-shape vocabulary, per gender because the conventional shape names differ.
// Captured because it was asked for, and deliberately wired to NOTHING: somatotype
// has no defensible role in load estimation, and routing it into the radar would
// bury a guess inside a number that reads as measured. If it ever earns a
// consumer, that is a separate change with its own ASPECT_METRICS_VERSION bump.
export const BODY_TYPES = {
  female: [
    { key: 'hourglass', label: 'Hourglass' },
    { key: 'pear', label: 'Pear' },
    { key: 'apple', label: 'Apple' },
    { key: 'rectangle', label: 'Rectangle' },
    { key: 'invertedTriangle', label: 'Inverted triangle' },
  ],
  male: [
    { key: 'rectangle', label: 'Rectangle' },
    { key: 'triangle', label: 'Triangle' },
    { key: 'invertedTriangle', label: 'Inverted triangle' },
    { key: 'oval', label: 'Oval' },
    { key: 'trapezoid', label: 'Trapezoid' },
  ],
  other: [
    { key: 'ectomorph', label: 'Ectomorph' },
    { key: 'mesomorph', label: 'Mesomorph' },
    { key: 'endomorph', label: 'Endomorph' },
  ],
  unspecified: [
    { key: 'ectomorph', label: 'Ectomorph' },
    { key: 'mesomorph', label: 'Mesomorph' },
    { key: 'endomorph', label: 'Endomorph' },
  ],
} as const;

// ---------------------------------------------------------------------------
// Training preferences (`user_stats`, migration 0030).
//
// Unlike BODY_TYPES below, these all have a consumer: every one is rendered
// into the ATHLETE PROFILE block of the plan-authoring prompt
// (`buildPlanAiPrompt`, src/lib/planTemplate.ts) and matched against the rules
// in src/lib/planRubric.ts. Absence is meaningful — a field with no value
// becomes a question the AI asks the athlete before it writes anything.
// ---------------------------------------------------------------------------

// Suggested goals. NOT a closed set: GoalsEditor lets the athlete add free text,
// which stores a uuid id with their own label. So `label` is what downstream
// reads — see the note on Goal in lib/types.ts.
export const GOALS = {
  strength: { label: 'Strength' },
  hypertrophy: { label: 'Hypertrophy' },
  endurance: { label: 'Endurance' },
  mobility: { label: 'Mobility' },
  skill: { label: 'Skill work' },
} as const;

// Default rank + weighting, used when an athlete has never saved goals. Order
// is the rank, so this is an array and not a map.
export const GOAL_DEFAULTS = [
  { id: 'strength', weight: 70 },
  { id: 'hypertrophy', weight: 50 },
  { id: 'endurance', weight: 40 },
  { id: 'mobility', weight: 30 },
  { id: 'skill', weight: 20 },
] as const;

export const GOAL_WEIGHT = { min: 0, max: 100, step: 5, default: 40 } as const;

// Training age. `blurb` is the helper text under the Settings select AND the
// gloss sent to the AI, so the athlete and the model are told the same thing.
export const EXPERIENCE_LEVELS = {
  beginner: { label: 'Beginner', blurb: 'Under a year of consistent lifting' },
  intermediate: { label: 'Intermediate', blurb: 'One to three years, familiar with the main lifts' },
  advanced: { label: 'Advanced', blurb: 'Three years or more, training around known weak points' },
} as const;

// What the athlete can actually train with. Drives the substitution ladders in
// planRubric.ts, so the vocabulary here must stay in step with the equipment
// words those rules use.
export const EQUIPMENT = [
  { key: 'barbell', label: 'Barbell' },
  { key: 'rack', label: 'Squat rack' },
  { key: 'bench', label: 'Bench' },
  { key: 'dumbbells', label: 'Dumbbells' },
  { key: 'kettlebells', label: 'Kettlebells' },
  { key: 'machines', label: 'Machines' },
  { key: 'cables', label: 'Cables' },
  { key: 'pullupBar', label: 'Pull-up bar' },
  { key: 'bands', label: 'Resistance bands' },
  { key: 'rower', label: 'Rower' },
  { key: 'bike', label: 'Bike' },
  { key: 'treadmill', label: 'Treadmill' },
  { key: 'sled', label: 'Sled' },
] as const;

// Training disciplines the athlete identifies with. Unlike EQUIPMENT this does
// not drive substitution rules — it biases suggestions and is rendered into the
// ATHLETE PROFILE block of buildPlanAiPrompt. Open-ended in spirit but a fixed
// vocabulary here so the onboarding chips and Settings editor stay in step; add
// an option by editing this list, not a migration (there is no check
// constraint, same call goals/experience/equipment made).
export const DISCIPLINES = [
  { key: 'weightlifting', label: 'Weightlifting' },
  { key: 'powerlifting', label: 'Powerlifting' },
  { key: 'bodybuilding', label: 'Bodybuilding' },
  { key: 'calisthenics', label: 'Calisthenics' },
  { key: 'crossfit', label: 'CrossFit' },
  { key: 'hyrox', label: 'Hyrox' },
  { key: 'endurance', label: 'Endurance / Running' },
  { key: 'mobility', label: 'Mobility & Recovery' },
] as const;

// Plan length bounds. 6 is the shortest span a block structure can express
// (accumulation / intensification / deload); 12 is where the rubric's block
// tables stop. The prompt asks the athlete to confirm a length inside this.
export const PLAN_LENGTH = { minWeeks: 6, maxWeeks: 12, defaultWeeks: 8 } as const;

// Bounds for the Settings form. Wide enough to be a typo guard, not a judgement.
export const STATS_LIMITS = {
  weightKg: { min: 25, max: 300 },
  heightCm: { min: 100, max: 250 },
  birthYear: { min: 1920, max: 2020 },
  maxInjuries: 20,
  injuryLabelChars: 80,
  daysPerWeek: { min: 1, max: 7 },
  maxGoals: 12,
  goalLabelChars: 40,
} as const;

// 220 − age, the standard estimate. Only ever a FALLBACK: an hr_max the user has
// actually hit beats a formula, so this sits below `observedHrMax` in the chain
// (see lib/aspects.ts).
export const HR_MAX_FROM_AGE = { base: 220 } as const;

// Activity tags with accent colors — used to shade activities across the app
// (progress ribbon, stats heatmap). Five categories, fixed brand hexes.
export const ACTIVITY_TAGS = {
  strength: { label: 'Strength', color: '#084A24' },
  recovery: { label: 'Recovery', color: '#FF8F5C' },
  endurance: { label: 'Endurance', color: '#77612A' },
  mobility: { label: 'Mobility', color: '#1DBD8E' },
  sport: { label: 'Sport', color: '#004C94' },
  hyrox: { label: 'Hyrox', color: '#4B2E83' },
  crossfit: { label: 'CrossFit', color: '#B23A2E' },
} as const;

// Quick-pick activity types for the lightweight non-strength ActivityLogger.
export const ACTIVITY_TYPES = ['Run', 'Walk', 'Cycle', 'Row', 'Swim', 'Hike', 'Yoga', 'Mobility'] as const;

// ----------------------------------------------------------------
// Meals
// ----------------------------------------------------------------
// Three INDEPENDENT axes, deliberately not one list. "Takeaway" is a source,
// not a kind — a takeaway can also be a snack — and collapsing them would make
// "how often do I eat out?" unanswerable without also answering "how often do I
// snack?".
//
// No check constraints back these (see 0032_meal_logs.sql). Adding an option is
// a config edit; the read boundary in getMealLogs guards the column.

export const MEAL_SIZES = {
  light: { label: 'Light' },
  medium: { label: 'Medium' },
  heavy: { label: 'Heavy' },
} as const;

export const MEAL_KINDS = {
  snack: { label: 'Snack' },
  meal: { label: 'Meal' },
} as const;

export const MEAL_SOURCES = {
  home: { label: 'Home' },
  out: { label: 'Out' },
  takeaway: { label: 'Takeaway' },
} as const;

// Suggested tags. Ordered because the chip row's reading order is the point.
// Carries NO colour, unlike ACTIVITY_TAGS: activity tone is charted so its
// hexes carry information. Selected tags use the teal accent per the spec,
// which is a token (--color-teal), not a per-tag hue.
export const MEAL_TAGS = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'veg', label: 'Veg' },
  { key: 'sweet', label: 'Sweet' },
  { key: 'coffee', label: 'Coffee' },
] as const;

// Repeat-meal shortcuts are DERIVED from the distinct custom tags of recent
// meals (newest first) — no second table. This seed is what a brand-new user
// sees before they have saved anything, and it disappears from the front of the
// rail naturally once real custom tags exist. Union, not replacement: if the
// user has also used 'post-workout', it appears once.
export const MEAL_REPEAT_SEED = ['post-workout'] as const;

// How many repeat shortcuts the chip rail shows before it stops. The rail
// scrolls, so this is about signal, not width.
export const MEAL_REPEAT_LIMIT = 6;

// Hunger before / after. Must stay in step with the check constraints in
// 0032_meal_logs.sql — widening this without a migration writes rejected rows.
export const MEAL_SCALE = { min: 1, max: 5 } as const;

// Draft defaults, per the product spec. Unlike most of this app, a meal draft
// arrives PREFILLED: the whole point is that a common meal is one tap plus
// Save.
export const MEAL_DEFAULTS = {
  size: 'medium',
  kind: 'meal',
  source: 'home',
  hungerBefore: 4,
  hungerAfter: 1,
} as const;

// Photo handling. maxEdgePx/quality put a 4000px phone photo at roughly 150KB.
// maxBytes is the ceiling for the fallback path where the browser cannot decode
// the file (HEIC from the iOS library) and the original is uploaded as-is.
export const MEAL_PHOTO = {
  bucket: 'meal-photos',
  maxEdgePx: 1280,
  quality: 0.75,
  maxBytes: 5_000_000,
} as const;

// Default time is now, rounded — nobody ate at exactly 10:37.
export const MEAL_TIME_ROUND_MINUTES = 5;

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

// Range of motion, as an estimated path length per rep for a ~175cm lifter.
//
// WHY A RATIO AND NOT KG·M. True work — load × distance — reads zero for every
// isometric: a Side Plank has load and duration and no displacement at all.
// That is the same hole that stopped tonnage being a currency, so displacement
// is applied as a DIMENSIONLESS FACTOR (`metres ÷ referenceM`) on top of scaled
// volume. Nothing can zero out, and the readout stays the relative index it
// already claims to be rather than a unit the model cannot honour (it ignores
// the eccentric, path curvature and the limb's own mass).
//
// A movement with no `rom` on its profile scores 1.0. Absence is neutral, never
// a penalty — the same rule RPE follows in VOLUME below.
//
// HEIGHT IS DELIBERATELY NOT APPLIED. It is one global scalar per lifter, so it
// cancels out of a dimensionless factor exactly as it cancels out of every
// score measured against that lifter's own history. It would only mean
// something if this were reported in absolute metres.
export const ROM = {
  // A typical compound bar path — bench, row, overhead press. The denominator.
  referenceM: 0.45,
  // Load travel per rep, in metres. Estimates, and reviewable as estimates:
  // change one and every movement built on it moves together.
  squat: 0.55,
  hinge: 0.45,
  lunge: 0.45,
  kneeIsolation: 0.35,
  hipIsolation: 0.35,
  calf: 0.12,
  pushHorizontal: 0.42,
  pushVertical: 0.55,
  dip: 0.4,
  pullVertical: 0.6,
  pullHorizontal: 0.4,
  deltIsolation: 0.5,
  armIsolation: 0.35,
  prehab: 0.3,
  coreDynamic: 0.3,
  jump: 0.55,
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
  // Kg-equivalent for one unweighted rep (box jump, push-up, plank second) when
  // the owner's bodyweight is unknown. A UNIT CONVERSION, not a norm: it says
  // nothing about any person, and because every axis is scored against the
  // user's own history its absolute value cancels out. It only sets how
  // weighted and unweighted work trade off.
  unweightedRepKg: 40,
  // With a bodyweight on `user_stats`, an unweighted rep costs this fraction of
  // the lifter's own mass instead. Deliberately ONE global number rather than a
  // per-movement leverage table: a pull-up and a push-up load different
  // fractions, but pricing that difference needs a constant for every movement
  // in the vocabulary, for an effect that is second-order against getting the
  // mass right at all.
  bodyweightFraction: 0.65,
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
  '(v)': 'variation',
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
//   3 — unweighted work priced against the owner's bodyweight; HR ceiling from age
//   4 — volume scaled by each movement's range of motion (ROM)
export const ASPECT_METRICS_VERSION = 4;

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
  rom: ROM,
  genders: GENDERS,
  disciplines: DISCIPLINES,
  bodyTypes: BODY_TYPES,
  load: LOAD,
  touch: TOUCH,
  notations: NOTATIONS,
  e1rm: E1RM,
  mealSizes: MEAL_SIZES,
  mealKinds: MEAL_KINDS,
  mealSources: MEAL_SOURCES,
  mealTags: MEAL_TAGS,
  mealRepeatSeed: MEAL_REPEAT_SEED,
  mealScale: MEAL_SCALE,
  mealDefaults: MEAL_DEFAULTS,
  mealPhoto: MEAL_PHOTO,
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
export type GenderKey = keyof typeof GENDERS;
export type GoalKey = keyof typeof GOALS;
export type ExperienceKey = keyof typeof EXPERIENCE_LEVELS;
export type EquipmentKey = (typeof EQUIPMENT)[number]['key'];
export type DisciplineKey = (typeof DISCIPLINES)[number]['key'];

export const GENDER_KEYS = Object.keys(GENDERS) as GenderKey[];
export const EXPERIENCE_KEYS = Object.keys(EXPERIENCE_LEVELS) as ExperienceKey[];

/**
 * `user_stats.experience` is an unconstrained `text` column, so a stored value
 * is NOT guaranteed to be one of these keys however the type says otherwise.
 * Anything that indexes EXPERIENCE_LEVELS with a database value must narrow it
 * first — `EXPERIENCE_LEVELS[unknown].blurb` is a crash, and it blanked
 * /app/you. Applied at the boundary in `getUserStats`.
 */
export function isExperienceKey(v: unknown): v is ExperienceKey {
  // hasOwnProperty, not `in`: `in` walks the prototype chain, so `'toString'`
  // and `'constructor'` would pass and hand callers a Function to read `.label`
  // off. Caught by userStatsRow.test.ts on the first run.
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXPERIENCE_LEVELS, v);
}
export const DISCIPLINE_KEYS = DISCIPLINES.map((d) => d.key) as DisciplineKey[];

export const MUSCLE_REGION_KEYS = Object.keys(MUSCLE_REGIONS) as RegionKey[];
export const MODALITY_KEYS = Object.keys(MOVEMENT_MODALITIES) as ModalityKey[];
export const PLANE_KEYS = Object.keys(MOVEMENT_PLANES) as PlaneKey[];

export type MealSizeKey = keyof typeof MEAL_SIZES;
export type MealKindKey = keyof typeof MEAL_KINDS;
export type MealSourceKey = keyof typeof MEAL_SOURCES;
export type MealTagKey = (typeof MEAL_TAGS)[number]['key'];

export const MEAL_SIZE_KEYS = Object.keys(MEAL_SIZES) as MealSizeKey[];
export const MEAL_KIND_KEYS = Object.keys(MEAL_KINDS) as MealKindKey[];
export const MEAL_SOURCE_KEYS = Object.keys(MEAL_SOURCES) as MealSourceKey[];
export const MEAL_TAG_KEYS = MEAL_TAGS.map((t) => t.key) as MealTagKey[];

/**
 * `meal_logs.size` / `.kind` / `.source` are unconstrained `text`, so a stored
 * value is NOT guaranteed to be one of these keys however the TypeScript says
 * otherwise. Applied at the boundary in getMealLogs, exactly as isExperienceKey
 * is applied in getUserStats.
 *
 * hasOwnProperty, not `in`: `in` walks the prototype chain, so 'toString' and
 * 'constructor' would pass and hand callers a Function to read `.label` off.
 */
export function isMealSizeKey(v: unknown): v is MealSizeKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MEAL_SIZES, v);
}
export function isMealKindKey(v: unknown): v is MealKindKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MEAL_KINDS, v);
}
export function isMealSourceKey(v: unknown): v is MealSourceKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MEAL_SOURCES, v);
}

// Normalised weight maps. Values are ≥0 and sum to 1, so a set's load
// distributes across regions rather than double-counting.
export type RegionWeights = Partial<Record<RegionKey, number>>;
export type PlaneWeights = Partial<Record<PlaneKey, number>>;

export interface MovementProfile {
  regions: RegionWeights;
  modality: ModalityKey | null;
  planes: PlaneWeights;
  rotary: RotaryRole | null;
  /**
   * Estimated load travel per rep in metres (see `ROM`). Optional: absent means
   * "not estimated", which scores the neutral 1.0 rather than penalising the
   * movement. Isometrics leave it unset on purpose — a plank displaces nothing,
   * and pricing that as zero work would be wrong, not precise.
   */
  rom?: number;
  // Whole-organism demand. Additive to the region weights, never a substitute:
  // Run is systemic AND posteriorChain/quads/calves.
  systemic: boolean;
}
