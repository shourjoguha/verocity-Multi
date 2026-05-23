import { supabase } from '@/lib/supabase';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signOut() {
  return supabase.auth.signOut();
}
