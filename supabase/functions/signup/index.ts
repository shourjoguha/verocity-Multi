// Invite-gated signup (SPEC §6). Runs with the service-role key — never the
// client. Validates an invite code, enforces the < 100 profile cap, creates the
// auth user + profile, and marks the invite used. All server-side.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PROFILE_CAP = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let payload: { email?: string; password?: string; displayName?: string; inviteCode?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const { email, password, displayName, inviteCode } = payload;
  if (!email || !password || !displayName || !inviteCode) {
    return json({ error: 'missing_fields' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Atomically CLAIM the invite before doing anything else. A conditional
  // UPDATE (used_at IS NULL AND not expired → set used_at) lets Postgres row
  // locking serialize concurrent redemptions, so a single code can never mint
  // two accounts. If creation fails downstream we release the claim.
  const codeHash = await sha256Hex(inviteCode.trim());
  const nowIso = new Date().toISOString();
  const { data: invite, error: claimErr } = await admin
    .from('invites')
    .update({ used_at: nowIso })
    .eq('code_hash', codeHash)
    .is('used_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select('id')
    .maybeSingle();

  if (claimErr) return json({ error: 'lookup_failed' }, 500);
  if (!invite) return json({ error: 'invalid_invite' }, 403); // missing, used, or expired

  const releaseInvite = () =>
    admin.from('invites').update({ used_at: null }).eq('id', invite.id);

  // Enforce profile cap.
  const { count, error: countErr } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true });
  if (countErr) {
    await releaseInvite();
    return json({ error: 'count_failed' }, 500);
  }
  if ((count ?? 0) >= PROFILE_CAP) {
    await releaseInvite();
    return json({ error: 'cap_reached' }, 403);
  }

  // Create the auth user (email pre-confirmed for invite flow).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (createErr || !created.user) {
    await releaseInvite();
    return json({ error: 'create_user_failed' }, 400);
  }

  const userId = created.user.id;

  // Insert the profile row.
  const { error: profileErr } = await admin
    .from('profiles')
    .insert({ id: userId, display_name: displayName });
  if (profileErr) {
    await admin.auth.admin.deleteUser(userId); // roll back the orphaned auth user
    await releaseInvite();
    return json({ error: 'profile_failed' }, 500);
  }

  // Record who consumed the (already-claimed) invite.
  await admin.from('invites').update({ used_by: userId }).eq('id', invite.id);

  return json({ ok: true, userId });
});
