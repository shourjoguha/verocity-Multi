import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Movement, MovementSub, ParsedPlan, Plan, Profile, WorkoutLog } from '@/lib/types';

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

export async function getRecentLogs(
  limit = 10,
  client: SupabaseClient = supabase,
): Promise<WorkoutLog[]> {
  const { data } = await client
    .from('workout_logs')
    .select('*')
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
    .gte('log_date', from)
    .lte('log_date', to)
    .order('log_date', { ascending: true });
  return (data as WorkoutLog[]) ?? [];
}

export async function getMovements(client: SupabaseClient = supabase): Promise<Movement[]> {
  const { data } = await client.from('movements').select('*').order('name');
  return (data as Movement[]) ?? [];
}

export async function getLogById(
  id: string,
  client: SupabaseClient = supabase,
): Promise<WorkoutLog | null> {
  const { data } = await client.from('workout_logs').select('*').eq('id', id).maybeSingle();
  return (data as WorkoutLog) ?? null;
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

// Adopt a shared/public plan: copy its parsed content into a new owned plan.
export async function adoptPlan(planId: string): Promise<Plan | null> {
  const { data } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle();
  if (!data) return null;
  const src = data as Plan;
  return createPlan(src.parsed, src.source_markdown ?? '');
}
