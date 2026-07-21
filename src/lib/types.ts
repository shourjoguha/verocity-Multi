import type { AspectKey, BlockKey, MetricKey, SectionKey } from '@/app.config';

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
}

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
  owner_user_id: string;
  name: string;
  tags: string[];
  frame: SessionFrame;
  source_plan_id: string | null;
  source_day_key: string | null;
  is_mini: boolean;
  created_at: string;
}

// sessions.frame JSONB contract: a flat, ordered exercise list (grouping is
// reconstructed in the Logger, exactly as plan days are).
export interface SessionFrame {
  exercises: SessionExercise[];
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
