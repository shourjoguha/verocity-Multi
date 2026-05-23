import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Movement, Plan, Profile, WorkoutLog } from '@/lib/types';

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
