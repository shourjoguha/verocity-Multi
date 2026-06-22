import { supabase } from '@/lib/supabase';
import { clearQueryCache } from '@/lib/queryCache';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signOut() {
  // Drop cached query results so the next user (or re-login) never sees the
  // previous session's rows from the in-memory SWR cache.
  clearQueryCache();
  return supabase.auth.signOut();
}

// Sends a Supabase recovery email. The link lands on /reset-password, where
// detectSessionInUrl picks up the recovery token and lets the user set a new
// password via updatePassword.
export function requestPasswordReset(email: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });
}

export function updatePassword(newPassword: string) {
  return supabase.auth.updateUser({ password: newPassword });
}

export type SignupInput = {
  email: string;
  password: string;
  displayName: string;
  inviteCode: string;
};

// Invite-gated signup via the server-side edge function (service-role only; the
// client never holds it). Raw fetch so we can read the JSON error code on a
// non-2xx and map a friendly message in the UI.
export async function signUpWithInvite(
  input: SignupInput,
): Promise<{ ok: boolean; error?: string }> {
  const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return { ok: false, error: 'not_configured' };
  try {
    const res = await fetch(`${url}/functions/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: data.error ?? 'signup_failed' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}
