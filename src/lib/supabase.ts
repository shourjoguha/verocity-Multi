import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced in the browser console; the build itself does not need these.
  console.warn(
    '[supabase] PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY are not set — DB calls will fail until configured.',
  );
}

// Single anon client. RLS is the security boundary (CLAUDE.md hard rule);
// authenticated sessions layer onto this same client via Supabase Auth.
export const supabase: SupabaseClient = createClient(
  url || 'http://localhost:54321',
  anonKey || 'public-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  },
);

export const SHOWCASE_PROFILE_ID = import.meta.env.PUBLIC_SHOWCASE_PROFILE_ID ?? '';
