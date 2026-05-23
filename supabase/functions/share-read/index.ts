// Read-only share resolver (SPEC §7B). Validates a share token and returns the
// scoped data via read-only selects using the service-role key. Holders never
// receive a writable key; this function exposes no mutations.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const token = new URL(req.url).searchParams.get('token');
  if (!token) return json({ error: 'missing_token' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Validate token: exists, not revoked, not expired.
  const tokenHash = await sha256Hex(token.trim());
  const { data: share, error: shareErr } = await admin
    .from('shares')
    .select('owner_user_id, scope, resource_id, expires_at, revoked')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (shareErr) return json({ error: 'lookup_failed' }, 500);
  if (!share || share.revoked) return json({ error: 'invalid_token' }, 404);
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return json({ error: 'expired_token' }, 410);
  }

  // Scoped, read-only fetch.
  if (share.scope === 'log') {
    const { data, error } = await admin
      .from('workout_logs')
      .select('*')
      .eq('id', share.resource_id)
      .eq('owner_user_id', share.owner_user_id)
      .maybeSingle();
    if (error) return json({ error: 'read_failed' }, 500);
    return json({ scope: 'log', log: data });
  }

  if (share.scope === 'plan') {
    const { data, error } = await admin
      .from('plans')
      .select('*')
      .eq('id', share.resource_id)
      .eq('owner_user_id', share.owner_user_id)
      .maybeSingle();
    if (error) return json({ error: 'read_failed' }, 500);
    return json({ scope: 'plan', plan: data });
  }

  // scope === 'profile' → profile + active plan + recent logs.
  const [profile, plans, logs] = await Promise.all([
    admin.from('profiles').select('id, display_name, created_at').eq('id', share.owner_user_id).maybeSingle(),
    admin.from('plans').select('*').eq('owner_user_id', share.owner_user_id).eq('is_active', true),
    admin
      .from('workout_logs')
      .select('*')
      .eq('owner_user_id', share.owner_user_id)
      .order('log_date', { ascending: false })
      .limit(50),
  ]);

  return json({
    scope: 'profile',
    profile: profile.data,
    plans: plans.data ?? [],
    logs: logs.data ?? [],
  });
});
