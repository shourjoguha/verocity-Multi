// Garmin connection / token custody (plan §6, §14B). Establishes or revokes a
// user's live-sync connection. Security-sensitive: it logs in to Garmin
// (unofficial, fragile — see garminClient.ts), encrypts the resulting OAuth2
// token AT REST with AES-GCM, and writes the deny-all `garmin_connections` table
// service-role. The raw password is NEVER persisted; the browser only ever sees
// connection STATUS via the garmin_connection_status view.
//
// ⚠️ VALIDATE BEFORE ENABLING: the login (garminClient.ts) is transcribed from
// the documented unofficial flow and unverified against a real account. The
// custody/lifecycle here is sound; the login is the part to exercise first.
//
// Auth: the user's JWT (this is a browser action). Owner = the authenticated
// user; the body never names an owner.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { garminClientLogin, GarminLoginError } from './garminClient.ts';

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

interface ConnectRequest {
  action: 'connect' | 'disconnect';
  email?: string;
  password?: string;
}

// Encode bytes as a Postgres bytea hex literal (\x…) for PostgREST insert.
function toByteaHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return '\\x' + hex;
}

// AES-GCM encrypt with a base64 32-byte key from GARMIN_TOKEN_KEY. Output is
// iv(12) || ciphertext, as a bytea hex literal. Decryption lives in the sync
// worker (which replays the token), never the browser.
async function encryptToken(plaintext: string, keyB64: string): Promise<string> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toByteaHex(out);
}

const LOGIN_STATUS: Record<string, number> = {
  mfa_required: 422,
  bad_credentials: 401,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: ConnectRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (body.action !== 'connect' && body.action !== 'disconnect') {
    return json({ error: 'invalid_action' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Authenticate the user from their JWT; owner is always that user.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'unauthorized' }, 401);
  const { data: userData, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !userData.user) return json({ error: 'unauthorized' }, 401);
  const ownerId = userData.user.id;

  if (body.action === 'disconnect') {
    const { error } = await admin
      .from('garmin_connections')
      .update({ status: 'revoked', access_token_enc: null, refresh_token_enc: null })
      .eq('owner_user_id', ownerId);
    if (error) return json({ error: 'disconnect_failed' }, 500);
    return json({ ok: true, status: 'revoked' });
  }

  // action === 'connect'
  if (!body.email || !body.password) return json({ error: 'missing_credentials' }, 400);

  const tokenKey = Deno.env.get('GARMIN_TOKEN_KEY');
  if (!tokenKey) return json({ error: 'not_configured' }, 503);

  let token;
  try {
    token = await garminClientLogin(body.email, body.password);
  } catch (err) {
    if (err instanceof GarminLoginError) {
      return json({ error: err.code, detail: err.message }, LOGIN_STATUS[err.code] ?? 502);
    }
    return json({ error: 'login_failed', detail: String(err) }, 502);
  }

  let accessTokenEnc: string;
  try {
    accessTokenEnc = await encryptToken(JSON.stringify(token.oauth2), tokenKey);
  } catch {
    return json({ error: 'encrypt_failed' }, 500);
  }

  const { error } = await admin.from('garmin_connections').upsert(
    {
      owner_user_id: ownerId,
      provider_user_id: token.providerUserId,
      access_token_enc: accessTokenEnc,
      scopes: token.scopes,
      token_expires_at: token.expiresAt,
      status: 'connected',
      connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: 'owner_user_id' },
  );
  if (error) return json({ error: 'persist_failed', detail: error.message }, 500);

  return json({ ok: true, status: 'connected' });
});
