import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearQueryCache } from '@/lib/queryCache';
import { ASPECT_METRICS_VERSION, isExperienceKey, type MetricKey } from '@/app.config';
import { normalizeMovementName } from '@/lib/movementTaxonomy';
import type {
  AspectScores,
  AspectSnapshot,
  AspectSnapshotInput,
  FitnessAssessment,
  GarminActivity,
  GarminConnectionInfo,
  GarminHealthDaily,
  ItemKind,
  Movement,
  MovementSub,
  MovementTaxonomyOverride,
  ParsedPlan,
  Plan,
  Profile,
  Recommendation,
  RxDeepResult,
  Session,
  SessionFrame,
  SessionType,
  Share,
  ShareScope,
  UserStats,
  WorkoutLog,
} from '@/lib/types';

// All queries rely on RLS for scoping: the authenticated client returns the
// user's own rows; the session-less public client returns the showcase
// profile's rows. Pass `supabasePublic` for showcase reads.

export async function getCurrentProfile(client: SupabaseClient = supabase): Promise<Profile | null> {
  const { data } = await client.from('profiles').select('*').maybeSingle();
  return (data as Profile) ?? null;
}

/**
 * Owner anthropometrics. Returns null for the showcase/public client by design:
 * `user_stats` has no anon RLS policy, so every consumer must degrade to the
 * constants in app.config.ts rather than assume a row exists.
 *
 * NORMALISES the row before anyone sees it.
 *
 * `UserStats` types `experience` as `ExperienceKey | null` and the four jsonb
 * columns as arrays, but the database guarantees neither: `experience` is a
 * bare `text` column with no check constraint (deliberately — see migration
 * 0031's comment), so any string can be in there, and a row written before a
 * column existed can still surface a null. The TypeScript type is a claim about
 * the schema, not about the data.
 *
 * That gap crashed `/app/you` to a blank page: the UI indexes straight into
 * `EXPERIENCE_LEVELS[row.experience]` and reads `.blurb`/`.label` off the
 * result, and calls `.length` on the arrays. An unrecognised experience string
 * is `undefined.blurb`; a null array is `null.length`. Either takes the whole
 * island down, and a user cannot fix their own data from a page that will not
 * render.
 *
 * Normalising HERE rather than at each callsite is the point: this is the one
 * door the row comes through, so every present and future consumer is covered
 * instead of whichever ones someone remembered to guard.
 */
export async function getUserStats(client: SupabaseClient = supabase): Promise<UserStats | null> {
  const { data } = await client.from('user_stats').select('*').maybeSingle();
  if (!data) return null;
  const row = data as UserStats;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    ...row,
    experience: isExperienceKey(row.experience) ? row.experience : null,
    equipment: arr(row.equipment),
    disciplines: arr(row.disciplines),
    goals: arr(row.goals),
    injuries: arr(row.injuries),
  };
}

/**
 * Partial on purpose. Two forms write this one row — UserStatsPanel owns the
 * anthropometrics and preferences, GoalsEditor owns `goals` — and each must be
 * able to save without resending (and so without clobbering) the other's
 * fields. PostgREST's upsert only SETs the columns present in the payload, so
 * an omitted key is left alone on update and takes its column default on
 * insert.
 */
export type UserStatsInput = Partial<Omit<UserStats, 'owner_user_id' | 'updated_at' | 'created_at'>>;

/**
 * Upsert on the owner PK — there is exactly one stats row per profile, so this
 * is both the create and the update path. The owner comes from the session,
 * never from the caller.
 *
 * Clears the read-path cache: bodyweight reprices every unweighted set, so the
 * body map and the radar are stale the moment this succeeds.
 */
export async function upsertUserStats(input: UserStatsInput): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from('user_stats').upsert(
    { ...input, owner_user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'owner_user_id' },
  );
  if (!error) clearQueryCache();
  return !error;
}

export async function getActivePlan(client: SupabaseClient = supabase): Promise<Plan | null> {
  const { data } = await client.from('plans').select('*').eq('is_active', true).maybeSingle();
  return (data as Plan) ?? null;
}

export async function getPlanById(
  id: string,
  client: SupabaseClient = supabase,
): Promise<Plan | null> {
  const { data } = await client.from('plans').select('*').eq('id', id).maybeSingle();
  return (data as Plan) ?? null;
}

export async function getRecentLogs(
  limit = 10,
  client: SupabaseClient = supabase,
): Promise<WorkoutLog[]> {
  const { data } = await client
    .from('workout_logs')
    .select('*')
    .neq('status', 'cancelled')
    .order('log_date', { ascending: false })
    .limit(limit);
  return (data as WorkoutLog[]) ?? [];
}

export async function getLogsInRange(
  from: string,
  to: string,
  client: SupabaseClient = supabase,
): Promise<WorkoutLog[]> {
  const { data } = await client
    .from('workout_logs')
    .select('*')
    .neq('status', 'cancelled')
    .gte('log_date', from)
    .lte('log_date', to)
    .order('log_date', { ascending: true });
  return (data as WorkoutLog[]) ?? [];
}

export async function getMovements(client: SupabaseClient = supabase): Promise<Movement[]> {
  const { data } = await client.from('movements').select('*').order('name');
  return (data as Movement[]) ?? [];
}

export type MovementMatch = {
  movement: Movement;
  canonical_name: string;
  match_confidence: 'exact' | 'normalized';
  match_reason: string;
};

// Resolve a free-text (imported/source) movement name against the movement
// library. Case-insensitive exact match on `name` wins first (confidence
// 'exact'); otherwise falls back to comparing normalizeMovementName() forms
// (confidence 'normalized') so plural/hyphen/abbreviation variants still
// match. Never collapses two movements whose normalized forms differ — a
// miss returns null rather than a guess.
export function resolveMovement(name: string, library: Movement[]): MovementMatch | null {
  const raw = name.trim();
  const exact = library.find((m) => m.name.toLowerCase() === raw.toLowerCase());
  if (exact) {
    return {
      movement: exact,
      canonical_name: exact.name,
      match_confidence: 'exact',
      match_reason: 'case-insensitive exact match',
    };
  }

  const normalizedIncoming = normalizeMovementName(raw);
  if (!normalizedIncoming) return null;
  const normalized = library.find((m) => normalizeMovementName(m.name) === normalizedIncoming);
  if (normalized) {
    return {
      movement: normalized,
      canonical_name: normalized.name,
      match_confidence: 'normalized',
      match_reason: 'plural/hyphen/abbrev normalized',
    };
  }

  return null;
}

// Full owned sets (no limit), used by the data export.
export async function getAllPlans(client: SupabaseClient = supabase): Promise<Plan[]> {
  const { data } = await client.from('plans').select('*').order('created_at', { ascending: true });
  return (data as Plan[]) ?? [];
}

export async function getAllLogs(client: SupabaseClient = supabase): Promise<WorkoutLog[]> {
  const { data } = await client
    .from('workout_logs')
    .select('*')
    .order('log_date', { ascending: true });
  return (data as WorkoutLog[]) ?? [];
}

export async function getLogById(
  id: string,
  client: SupabaseClient = supabase,
): Promise<WorkoutLog | null> {
  const { data } = await client.from('workout_logs').select('*').eq('id', id).maybeSingle();
  return (data as WorkoutLog) ?? null;
}

// ---- movement library writes (custom movements only; RLS forbids touching the
// shared library, where owner_user_id IS NULL — see migration 0005) ----

export type MovementInput = {
  name: string;
  category: string | null;
  primary_metric: MetricKey;
  default_rest_seconds: number;
  // Set for library subroutines: kind 'subroutine', notes = description, url = link.
  kind?: ItemKind;
  notes?: string | null;
  url?: string | null;
  // Optional so every existing call site compiles unchanged.
  taxonomy?: MovementTaxonomyOverride | null;
};

export async function createMovement(input: MovementInput): Promise<Movement | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('movements')
    .insert({
      ...input,
      tags: [],
      default_metrics: [input.primary_metric],
      owner_user_id: user.id,
    })
    .select('*')
    .single();
  if (error) return null;
  return data as Movement;
}

export async function updateMovement(id: string, patch: MovementInput): Promise<boolean> {
  const { error } = await supabase
    .from('movements')
    .update({ ...patch, default_metrics: [patch.primary_metric] })
    .eq('id', id);
  return !error;
}

export async function deleteMovement(id: string): Promise<boolean> {
  const { error } = await supabase.from('movements').delete().eq('id', id);
  return !error;
}

// ---- sessions (saved workout templates; owner-scoped by RLS) ----

export async function getSessions(client: SupabaseClient = supabase): Promise<Session[]> {
  const { data } = await client
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false });
  return (data as Session[]) ?? [];
}

export async function getSessionById(
  id: string,
  client: SupabaseClient = supabase,
): Promise<Session | null> {
  const { data } = await client.from('sessions').select('*').eq('id', id).maybeSingle();
  return (data as Session) ?? null;
}

export type SessionInput = {
  name: string;
  tags: string[];
  frame: SessionFrame;
  source_plan_id?: string | null;
  source_day_key?: string | null;
  is_mini?: boolean;
  // Structured-session fields (0023). Optional; legacy strength sessions omit them.
  session_type?: SessionType | null;
  time_cap_seconds?: number | null;
  duration_seconds?: number | null;
  rounds?: number | null;
  partner?: boolean;
  instructions?: string | null;
  source?: string | null;
  source_text?: string | null;
  // Stable per-workout provenance key (e.g. 'benchmark/fran'), set on imported
  // rows so a re-import is idempotent — see supabase/migrations/0027.
  source_ref?: string | null;
};

export async function createSession(input: SessionInput): Promise<Session | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('sessions')
    .insert({ ...input, owner_user_id: user.id })
    .select('*')
    .single();
  if (error) return null;
  return data as Session;
}

export async function updateSession(
  id: string,
  patch: Partial<SessionInput>,
): Promise<boolean> {
  const { error } = await supabase.from('sessions').update(patch).eq('id', id);
  return !error;
}

export async function deleteSession(id: string): Promise<boolean> {
  const { error } = await supabase.from('sessions').delete().eq('id', id);
  return !error;
}

// ---- fitness assessments (Stats spider chart; owner-scoped by RLS, anon reads
// only the showcase profile's snapshots) ----

export async function getAssessments(
  client: SupabaseClient = supabase,
): Promise<FitnessAssessment[]> {
  const { data } = await client
    .from('fitness_assessments')
    .select('*')
    .order('taken_at', { ascending: false });
  return (data as FitnessAssessment[]) ?? [];
}

export async function createAssessment(scores: AspectScores): Promise<FitnessAssessment | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('fitness_assessments')
    .insert({ owner_user_id: user.id, scores })
    .select('*')
    .single();
  if (error) return null;
  // A check-in overrides the derived radar for the next ASPECT_OVERRIDE_DAYS, so
  // it changes what Stats should draw. Without this the cached read-path would
  // keep serving the pre-check-in radar on any screen reached by link rather
  // than by reload — the same staleness the log writers below clear for.
  clearQueryCache();
  return data as FitnessAssessment;
}

// ---- aspect_snapshots (derived radar history; owner-scoped by RLS, anon reads
// only the showcase profile's rows) ----

/**
 * Snapshots in an inclusive ymd range, oldest first.
 *
 * Filtered to the current ASPECT_METRICS_VERSION. Migration 0019 clears stale
 * rows, but this is the guard that matters: a row written under an older
 * definition of a metric must never reach a baseline, because the median of two
 * different definitions of "strength" describes neither and looks entirely
 * normal on the chart.
 */
export async function getAspectSnapshots(
  from: string,
  to: string,
  client: SupabaseClient = supabase,
): Promise<AspectSnapshot[]> {
  const { data } = await client
    .from('aspect_snapshots')
    .select('*')
    .eq('metrics_version', ASPECT_METRICS_VERSION)
    .gte('period_end', from)
    .lte('period_end', to)
    .order('period_end', { ascending: true });
  return (data as AspectSnapshot[]) ?? [];
}

/**
 * Idempotent upsert on (owner_user_id, period_end, window_days) — recomputing a
 * period overwrites it rather than accumulating duplicates. The owner comes from
 * the session, never from the caller.
 */
export async function upsertAspectSnapshots(rows: AspectSnapshotInput[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from('aspect_snapshots').upsert(
    rows.map((r) => ({
      ...r,
      owner_user_id: user.id,
      metrics_version: ASPECT_METRICS_VERSION,
      computed_at: new Date().toISOString(),
    })),
    { onConflict: 'owner_user_id,period_end,window_days' },
  );
  return !error;
}

// ---- write paths (authenticated only; owner_user_id is set from the session) ----

// The three log writers below clear the read-path cache in queryCache.ts. That
// Map survives every ClientRouter navigation, and until this was added its only
// invalidation was signOut() — so a log written here stayed invisible on any
// screen reached by link rather than by reload, which is one of the ways Home's
// stats appeared frozen. Clearing wholesale is deliberate: a log write also
// moves the streak, the program week and the timeline, so evicting by key would
// just be a list to forget to update.
export async function createLog(
  row: Partial<WorkoutLog> & { log_date: string },
): Promise<WorkoutLog | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('workout_logs')
    .insert({ ...row, owner_user_id: user.id })
    .select('*')
    .single();
  if (error) return null;
  clearQueryCache();
  return data as WorkoutLog;
}

export async function updateLog(id: string, patch: Partial<WorkoutLog>): Promise<boolean> {
  const { error } = await supabase.from('workout_logs').update(patch).eq('id', id);
  if (!error) clearQueryCache();
  return !error;
}

export async function deleteLog(id: string): Promise<boolean> {
  const { error } = await supabase.from('workout_logs').delete().eq('id', id);
  if (!error) clearQueryCache();
  return !error;
}

// Insert a plan and make it the active one (the partial unique index allows a
// single active plan per owner, so deactivate any existing active first).
export async function createPlan(
  parsed: ParsedPlan,
  sourceMarkdown: string,
): Promise<Plan | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  await supabase
    .from('plans')
    .update({ is_active: false })
    .eq('owner_user_id', user.id)
    .eq('is_active', true);
  const { data, error } = await supabase
    .from('plans')
    .insert({
      owner_user_id: user.id,
      name: parsed.title,
      start_date: parsed.startDate,
      end_date: parsed.endDate,
      source_markdown: sourceMarkdown,
      parsed,
      is_active: true,
    })
    .select('*')
    .single();
  if (error) return null;
  return data as Plan;
}

// Overwrite a plan's parsed content (plan edit mode autosave). Owner-scoped by RLS.
export async function updatePlan(id: string, parsed: ParsedPlan): Promise<boolean> {
  const { error } = await supabase.from('plans').update({ parsed }).eq('id', id);
  return !error;
}

// Substitution memory for the current plan (newest/most-used first), used to
// surface "you usually swap X → Y" suggestions in the Logger.
export async function getMovementSubs(planId: string | null): Promise<MovementSub[]> {
  const base = supabase.from('movement_subs').select('*').is('dismissed_at', null);
  const scoped = planId ? base.eq('plan_id', planId) : base.is('plan_id', null);
  const { data } = await scoped.order('count', { ascending: false });
  return (data as MovementSub[]) ?? [];
}

// Record a substitution (insert or bump count) via the security-invoker RPC.
export async function bumpMovementSub(
  planId: string | null,
  dayKey: string | null,
  original: string,
  replacement: string,
): Promise<void> {
  await supabase.rpc('bump_movement_sub', {
    p_plan_id: planId,
    p_day_key: dayKey,
    p_original: original,
    p_replacement: replacement,
  });
}

// Dismiss a substitution suggestion so it stops surfacing in the picker.
export async function dismissMovementSub(id: string): Promise<void> {
  await supabase.from('movement_subs').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
}

// Adopt a shared/public plan: copy its parsed content into a new owned plan.
export async function adoptPlan(planId: string): Promise<Plan | null> {
  const { data } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle();
  if (!data) return null;
  const src = data as Plan;
  return createPlan(src.parsed, src.source_markdown ?? '');
}

// ---- share tokens (SPEC §7B). The client stores only the token_hash; the raw
// token is shown once and resolved later by the share-read edge function. ----

export type ShareInput = {
  token_hash: string;
  scope: ShareScope;
  resource_id: string | null;
  label: string | null;
  expires_at: string | null;
};

export async function createShare(input: ShareInput): Promise<Share | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('shares')
    .insert({ ...input, owner_user_id: user.id })
    .select('*')
    .single();
  if (error) return null;
  return data as Share;
}

export async function getShares(): Promise<Share[]> {
  const { data } = await supabase
    .from('shares')
    .select('*')
    .order('created_at', { ascending: false });
  return (data as Share[]) ?? [];
}

export async function revokeShare(id: string): Promise<boolean> {
  const { error } = await supabase.from('shares').update({ revoked: true }).eq('id', id);
  return !error;
}

// ---- recommendations (Coach). Reads are owner-scoped by RLS; owner insert/
// update enabled in migration 0007 for on-demand generation + dispositions. ----

export type RecInput = {
  tldr: string;
  action: string;
  body_md: string;
  drift_score: number | null;
  confidence: number | null;
};

export async function getRecommendations(
  client: SupabaseClient = supabase,
): Promise<Recommendation[]> {
  const { data } = await client
    .from('recommendations')
    .select('*')
    .order('created_at', { ascending: false });
  return (data as Recommendation[]) ?? [];
}

export async function insertRecommendations(rows: RecInput[]): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from('recommendations')
    .insert(rows.map((r) => ({ ...r, owner_user_id: user.id, status: 'open' })));
  return !error;
}

export async function updateRecommendation(
  id: string,
  patch: Partial<Recommendation>,
): Promise<boolean> {
  const { error } = await supabase.from('recommendations').update(patch).eq('id', id);
  return !error;
}

// ---- Garmin integration (plan §6, §7). Reads are owner-scoped by RLS. Tokens
// are never exposed: connection state comes from the safe `garmin_connection_
// status` view (no token columns). All writes happen server-side (the import
// function / sync worker via service-role), so there are no client write paths
// here. ----

export async function getGarminConnection(
  client: SupabaseClient = supabase,
): Promise<GarminConnectionInfo | null> {
  const { data } = await client.from('garmin_connection_status').select('*').maybeSingle();
  return (data as GarminConnectionInfo) ?? null;
}

export async function getGarminActivities(
  limit = 50,
  client: SupabaseClient = supabase,
): Promise<GarminActivity[]> {
  const { data } = await client
    .from('garmin_activities')
    .select('*')
    .order('start_time', { ascending: false })
    .limit(limit);
  return (data as GarminActivity[]) ?? [];
}

export async function getGarminHealthDaily(
  from: string,
  to: string,
  client: SupabaseClient = supabase,
): Promise<GarminHealthDaily[]> {
  const { data } = await client
    .from('garmin_health_daily')
    .select('*')
    .gte('calendar_date', from)
    .lte('calendar_date', to)
    .order('calendar_date', { ascending: true });
  return (data as GarminHealthDaily[]) ?? [];
}

// ---- rx deep enrichment (retrieval-depth cross-door porting) ----
// Read-only here: rows are written by a Claude Code session via the
// `/rx-deep-retrieve|contradiction-check|counter-external --door fitness`
// commands. Owner-scoped by RLS, same as recommendations.
export async function getDeepResults(
  recId: string,
  client: SupabaseClient = supabase,
): Promise<RxDeepResult[]> {
  const { data } = await client
    .from('rx_deep_results')
    .select('*')
    .eq('rec_id', recId)
    .order('created_at', { ascending: false });
  return (data as RxDeepResult[]) ?? [];
}
