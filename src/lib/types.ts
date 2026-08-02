import type {
  AspectKey,
  BlockKey,
  GenderKey,
  MetricKey,
  MovementProfile,
  RegionKey,
  SectionKey,
} from '@/app.config';

// ---- DB row types (mirror supabase/migrations) ----

export type LogStatus = 'planned' | 'in_progress' | 'paused' | 'done' | 'cancelled';
export type ShareScope = 'profile' | 'plan' | 'log';
export type LogSource = 'manual' | 'garmin';

export interface Profile {
  id: string;
  display_name: string;
  is_showcase: boolean;
  created_at: string;
}

/**
 * One entry in `user_stats.injuries`. `region` is a MUSCLE_REGIONS key rather
 * than free text so /app/body can later flag load on an injured region without
 * a data migration — nothing reads it today. `null` means "not localised".
 */
export interface Injury {
  id: string;
  region: RegionKey | null;
  label: string;
  year?: number;
  notes?: string;
}

/**
 * Owner anthropometrics — one current row, never a time series (migration 0020
 * explains why). Deliberately NOT columns on `profiles`: the showcase RLS
 * policy grants anon a whole-row read, so age/gender/injuries there would be
 * public. Only `body_weight_kg` and `birth_year` reach a metric.
 */
export interface UserStats {
  owner_user_id: string;
  body_weight_kg: number | null;
  height_cm: number | null;
  birth_year: number | null;
  gender: GenderKey | null;
  body_type: string | null;
  injuries: Injury[];
  updated_at: string;
  created_at: string;
}

export interface Movement {
  id: string;
  name: string;
  category: string | null;
  tags: string[];
  default_metrics: MetricKey[];
  primary_metric: MetricKey;
  default_rest_seconds: number;
  notes: string | null;
  owner_user_id: string | null; // null = shared library
  // Library subroutines (kind === 'subroutine'): name holds the title, notes the
  // ≤300-char description, url an optional link. Absent kind ⇒ a normal movement.
  kind: ItemKind;
  url: string | null;
  // Per-user taxonomy correction (movements.taxonomy jsonb), matched to logged
  // movements by NORMALISED NAME because logs carry no FK to this table. Null
  // for the vast majority of rows — the static rules in lib/movementTaxonomy.ts
  // are the main road; this is the escape hatch for names they cannot resolve
  // (e.g. the truncated "Wtd"). Nullable and optional so a client reading a
  // database without the column still typechecks.
  taxonomy?: MovementTaxonomyOverride | null;
}

// A partial profile: setting only `modality` leaves the rule-derived regions in
// place, which is what the classifier's shallow merge relies on.
export type MovementTaxonomyOverride = Partial<MovementProfile>;

export interface Plan {
  id: string;
  owner_user_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  source_markdown: string | null;
  parsed: ParsedPlan;
  is_active: boolean;
  is_public: boolean;
  created_at: string;
}

export interface WorkoutLog {
  id: string;
  owner_user_id: string;
  plan_id: string | null;
  session_id: string | null;
  log_date: string;
  day_key: string | null;
  week_number: number | null;
  status: LogStatus;
  started_at: string | null;
  ended_at: string | null;
  total_seconds: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  notes: string | null;
  activity_type: string | null;
  tags: string[];
  data: LogDocument;
  source: LogSource; // 'garmin' rows are projected from garmin_activities (mig 0014)
  garmin_activity_id: string | null;
  created_at: string;
}

export interface MovementSub {
  id: string;
  owner_user_id: string;
  plan_id: string | null;
  day_key: string | null;
  original: string;
  replacement: string;
  count: number;
  last_used_at: string;
  dismissed_at: string | null;
}

export interface Share {
  id: string;
  token_hash: string;
  owner_user_id: string;
  scope: ShareScope;
  resource_id: string | null;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
}

// ---- sessions: saved workout templates (SPEC §8). A standalone, named, tagged
// frame — a plan day without the per-week dimension (one planned string per
// exercise). owner-scoped; `tags` are ActivityTagKey strings. ----

export interface Session {
  id: string;
  // Shared-library sessions (seeded via migration, visible to all users) have
  // `owner_user_id === null`. See supabase/migrations/0023_hyrox_sessions.sql.
  owner_user_id: string | null;
  name: string;
  tags: string[];
  frame: SessionFrame;
  source_plan_id: string | null;
  source_day_key: string | null;
  is_mini: boolean;
  created_at: string;
  // Structured-session metadata (added 0023). NULL on legacy strength sessions;
  // populated on Hyrox / metcon templates so the card can show a format badge
  // and the Logger can start a live time cap.
  session_type: SessionType | null;
  time_cap_seconds: number | null;
  duration_seconds: number | null;
  rounds: number | null;
  partner: boolean;
  instructions: string | null;
  source: string | null;
  source_text: string | null;
}

// Workout scoring formats. Union values are stored verbatim in
// `sessions.session_type` (checked by a CHECK constraint in 0023).
export type SessionType =
  | 'AMRAP'
  | 'EMOM'
  | 'FOR_TIME'
  | 'FOR_TOTAL_REPS'
  | 'FOR_TOTAL_DISTANCE'
  | 'FOR_LOAD'
  | 'INTERVALS'
  | 'ROUNDS_FOR_TIME'
  | 'CHIPPER'
  | 'PARTNER'
  | 'OTHER';

// sessions.frame JSONB contract. Two shapes coexist:
//
// - Legacy (strength-style): a flat, ordered `exercises[]` list — grouping
//   is reconstructed in the Logger as `single`-kind groups per exercise.
// - Structured (Hyrox / metcon): an ordered `groups[]` array that carries
//   round/circuit structure directly; `exercises` is a flattened mirror kept
//   only for back-compat readers that ignore `groups`.
//
// When both are present, `groups` is authoritative.
export interface SessionFrame {
  exercises: SessionExercise[];
  groups?: SessionGroup[];
}

// A group of items opened together in the Logger — mirrors `LogGroup` on the
// log side (types below). `rounds` expands into repeated set counts on each
// item's `planned` when the frame is unfolded by logBuilder.
export interface SessionGroup {
  kind: GroupKind;
  section: SectionKey;
  items: SessionExercise[];
  rounds?: number;
  restSeconds?: number;
  label?: string;
}

export interface SessionExercise {
  movement: string;
  section: SectionKey;
  primaryMetric: MetricKey;
  planned: string; // single planned-set string, e.g. "3x5" (no per-week dimension)
  notes?: string;
  // Subroutine fields (kind === 'subroutine'): movement holds the title,
  // description the ≤300-char body, url an optional link. planned stays "".
  kind?: ItemKind;
  description?: string;
  url?: string;
}

// ---- fitness_assessments: dated 1–10 self-ratings per fitness aspect (Stats
// spider chart). `scores` is keyed by AspectKey; missing axes are unrated. ----

export type AspectScores = Partial<Record<AspectKey, number>>;

export interface FitnessAssessment {
  id: string;
  owner_user_id: string;
  taken_at: string;
  scores: AspectScores;
  created_at: string;
}

// ---- aspect_snapshots: derived per-window measurements for the radar. Both
// columns are keyed by AspectKey. `metrics` is the load-bearing one — the radar
// scores an axis against the distribution of the owner's own past metrics, so
// this is the history that makes a score mean "typical for you". `scores` is a
// presentation of `metrics` against that baseline, stored only so a past reading
// can be shown as it was drawn. Computed in lib/aspects.ts. ----

/**
 * Raw, unit-ful measurements for one window. Units matter here because these
 * land in JSONB and a bare number is unreadable six months later:
 *
 * - `strength`     scaled resistance volume per week, weighted by load relative
 *                  to each movement's own best e1RM
 * - `endurance`    per week: HR-weighted aerobic minutes + dense strength work
 *                  + heart-rate spread × session length
 * - `power`        scaled plyometric volume per week, biased toward low-rep sets
 * - `mobility`     mobility working-minutes per week, scaled by plane variety
 * - `consistency`  training days per week × set-completion adherence
 * - `recovery`     0–1 index — vibe damped by acute:chronic workload ratio
 *
 * "Scaled volume" is `setVolume` in lib/bodyLoad.ts: load × rep-equivalents,
 * adjusted for `/side`, `(p)` paused reps and RPE.
 *
 * CHANGING ANY OF THESE INVALIDATES STORED SNAPSHOTS. The baseline is a median
 * over past values, so mixing two definitions of `strength` yields a median that
 * describes neither — silently, with nothing on screen to show it. A definition
 * change must come with a migration that clears the table (see 0019).
 */
export type AspectMetrics = Partial<Record<AspectKey, number>>;

export interface AspectSnapshot {
  id: string;
  owner_user_id: string;
  period_end: string;
  window_days: number;
  /** Which definition of computeAspectMetrics produced `metrics`. */
  metrics_version: number;
  metrics: AspectMetrics;
  scores: AspectScores;
  computed_at: string;
  created_at: string;
}

/** What a client computes and upserts. The owner comes from the session. */
export type AspectSnapshotInput = Pick<
  AspectSnapshot,
  'period_end' | 'window_days' | 'metrics' | 'scores'
>;

// ---- Garmin integration (plan §6). Reads are owner-scoped by RLS; rows are
// written only by the ingestion worker / import function (service-role). The
// browser sees connection state only through `garmin_connection_status` (a safe
// view that never exposes token columns). ----

export type GarminConnectionStatus =
  | 'pending'
  | 'connected'
  | 'needs_reconnect'
  | 'revoked'
  | 'error';

export type GarminBackfillStatus = 'pending' | 'running' | 'done' | 'error';

// Safe status subset exposed to the client (the garmin_connection_status view).
export interface GarminConnectionInfo {
  owner_user_id: string;
  status: GarminConnectionStatus;
  connected_at: string | null;
  last_sync_at: string | null;
  backfill_status: GarminBackfillStatus;
  backfill_from: string | null;
  backfill_to: string | null;
  scopes: string[];
  last_error: string | null;
}

export interface GarminActivity {
  id: string;
  owner_user_id: string;
  provider_activity_id: string;
  activity_type: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  avg_speed: number | null;
  elevation_gain_m: number | null;
  raw: Record<string, unknown>;
  garmin_updated_at: string | null;
  created_at: string;
}

export interface GarminHealthDaily {
  id: string;
  owner_user_id: string;
  calendar_date: string;
  resting_hr: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  hrv_ms: number | null;
  stress_avg: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  sleep_seconds: number | null;
  sleep_score: number | null;
  deep_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  awake_seconds: number | null;
  respiration_avg: number | null;
  spo2_avg: number | null;
  steps: number | null;
  calories: number | null;
  vo2max: number | null;
  raw: Record<string, unknown>;
  garmin_updated_at: string | null;
  created_at: string;
}

// ---- plans.parsed JSONB contract: ParsedPlan (SPEC §8) ----

export interface ParsedPlan {
  title: string;
  startDate: string | null;
  endDate: string | null;
  blocks: PlanBlock[];
  weeklyTemplate: string[]; // ordered day keys, e.g. ["mon","wed","fri"]
  days: PlanDay[];
}

export interface PlanBlock {
  type: BlockKey;
  startWeek: number;
  endWeek: number;
}

export interface PlanDay {
  dayKey: string;
  label: string;
  exercises: PlanExercise[];
}

export interface PlanExercise {
  movement: string;
  section: SectionKey;
  primaryMetric: MetricKey;
  // per-week planned-set strings, keyed by 1-based week number
  plannedByWeek: Record<number, string>;
  notes?: string;
  // Subroutine fields (kind === 'subroutine'): movement holds the title,
  // description the ≤300-char body, url an optional link. No sets/weeks.
  kind?: ItemKind;
  description?: string;
  url?: string;
}

// ---- workout_logs.data JSONB contract: LogDocument (SPEC §8) ----

export interface LogDocument {
  sections: LogSection[];
  session?: { vibe?: VibeCheck };
}

export interface VibeCheck {
  sleep: number;
  energy: number;
  soreness: number;
}

export interface LogSection {
  key: SectionKey;
  groups: LogGroup[];
}

export type GroupKind = 'single' | 'superset' | 'circuit';

// Item discriminator. Absent ⇒ a normal movement (back-compat with existing
// JSONB). A 'subroutine' item carries free text (title + description + link)
// instead of sets/metric.
export type ItemKind = 'movement' | 'subroutine';

export interface LogGroup {
  id: string;
  kind: GroupKind;
  items: LogItem[];
  restSeconds?: number;
  // ISO timestamp set when the group first became fully complete; cleared if it
  // later goes incomplete. Drives the Logger's completion-ordered "Done" list.
  completedAt?: string;
}

export interface LogItem {
  id: string;
  movement: string;
  primaryMetric: MetricKey;
  sets: LogSet[];
  restSeconds?: number;
  notes?: string;
  // Subroutine fields (kind === 'subroutine'): movement holds the title,
  // description the ≤300-char body, url an optional link. sets stays [].
  kind?: ItemKind;
  description?: string;
  url?: string;
}

export interface LogSet {
  planned: string | null;
  actual: SetActual;
  notations: string[];
}

export interface SetActual {
  weight?: number;
  reps?: number;
  rpe?: number;
  distance?: number;
  time?: number;
  completed: boolean;
  prefilled: boolean;
}

// ---- recommendations (Coach, SPEC §12) ----

export type RecStatus = 'open' | 'snoozed' | 'acted' | 'dismissed';
export type RecDisposition = 'acted_as_prescribed' | 'acted_modified' | 'skipped';

export interface Recommendation {
  id: string;
  owner_user_id: string;
  status: RecStatus;
  drift_score: number | null;
  confidence: number | null;
  tldr: string | null;
  action: string | null;
  body_md: string | null;
  disposition: RecDisposition | null;
  disposition_note: string | null;
  linked_log_id: string | null;
  snooze_until: string | null;
  created_at: string;
}

// ---- rx deep enrichment (retrieval-depth cross-door porting) ----
// Out-of-band enrichment computed in a Claude Code session (deep retrieval /
// contradiction / external counter) and written to `rx_deep_results` for the
// Coach view to surface. The trust decisions (conflict banner, counter
// credibility) are pre-computed by a deterministic governor and carried in
// `payload.governor`.
export type RxDeepKind = 'deep_retrieval' | 'contradiction' | 'disconfirmation';

export interface RxDeepResult {
  id: string;
  owner_user_id: string;
  rec_id: string | null;
  query_hash: string | null;
  domain: string;
  kind: RxDeepKind;
  payload: Record<string, unknown>;
  created_at: string;
}
