import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { captureUserIdentified, resetAnalyticsIdentity } from '@/lib/analytics';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced in the browser console; the build itself does not need these.
  console.warn(
    '[supabase] PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY are not set — DB calls will fail until configured.',
  );
}

const fallbackUrl = url || 'http://localhost:54321';
const fallbackKey = anonKey || 'public-anon-key';

// Authenticated client. RLS is the security boundary (CLAUDE.md hard rule);
// user sessions layer onto this client via Supabase Auth.
export const supabase: SupabaseClient = createClient(fallbackUrl, fallbackKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Identify/reset PostHog at the auth boundary so every consumer of this
// client (the only one that ever signs in/out) gets tracked consistently.
supabase.auth.onAuthStateChange((event, session) => {
  if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
    captureUserIdentified(session.user.id, { email: session.user.email });
  } else if (event === 'SIGNED_OUT') {
    resetAnalyticsIdentity();
  }
});

// Session-less public client for the read-only showcase. Never adopts a user
// session, so it always resolves to the `anon` role even for a logged-in
// viewer — RLS then scopes reads to the showcase profile (SPEC §7A).
export const supabasePublic: SupabaseClient = createClient(fallbackUrl, fallbackKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export const SHOWCASE_PROFILE_ID = import.meta.env.PUBLIC_SHOWCASE_PROFILE_ID ?? '';
