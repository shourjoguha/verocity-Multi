import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { MetricKey } from '@/app.config';
import type {
  AspectScores,
  FitnessAssessment,
  GarminActivity,
  GarminConnectionInfo,
  GarminHealthDaily,
  ItemKind,
  Movement,
  MovementSub,
  ParsedPlan,
  Plan,
  Profile,
  Recommendation,
  RxDeepResult,
  Session,
  SessionFrame,
  Share,
  ShareScope,
  WorkoutLog,
} from '@/lib/types';

// All queries rely on RLS for scoping: the authenticated client returns the
// user's own rows; the session-less public client returns the showcase
// profile's rows. Pass `supabasePublic` for showcase reads.

export async function getCurrentProfile(client: SupabaseClient = supabase): Promise<Profile | null> {
  const { data } = await client.from('profiles').select('*').maybeSingle();
  return (data as Profile) ?? null;
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
  return data as FitnessAssessment;
}

// ---- write paths (authenticated only; owner_user_id is set from the session) ----

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
  return data as WorkoutLog;
}

export async function updateLog(id: string, patch: Partial<WorkoutLog>): Promise<boolean> {
  const { error } = await supabase.from('workout_logs').update(patch).eq('id', id);
  return !error;
}

export async function deleteLog(id: string): Promise<boolean> {
  const { error } = await supabase.from('workout_logs').delete().eq('id', id);
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
