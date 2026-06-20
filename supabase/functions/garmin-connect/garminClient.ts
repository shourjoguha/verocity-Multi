// Unofficial Garmin Connect login (plan §6, §14B) — ISOLATED + UNVALIDATED.
//
// ⚠️ VALIDATE BEFORE ENABLING. This reproduces the "garth"/garmin-connect SSO
// dance (CSRF → credential POST → service ticket → OAuth1 token → OAuth2 token)
// by hand in Deno. It has NOT been run against a real Garmin account — the field
// names, endpoints, and the OAuth1 signing are transcribed from the documented
// unofficial flow and WILL need tuning on first real login. It is the single
// fragile surface of the connection feature, deliberately quarantined here so the
// custody/lifecycle code around it stays clean and testable.
//
// NO MFA: accounts with two-factor enabled are not handled yet (the SSO POST
// returns an MFA challenge instead of a ticket — we surface that as an error).
//
// IF THIS PROVES FLAKY: move the login to the Railway worker using the maintained
// `garth` (Python) / `garmin-connect` (Node) library and have it call the custody
// endpoint with the resulting token. Deno hand-rolling is the stopgap, not the
// destination. The raw password is NEVER persisted — only the OAuth2 token blob.

const CONSUMER_URL = 'https://thegarth.s3.amazonaws.com/oauth_consumer.json';
const SSO_ORIGIN = 'https://sso.garmin.com';
const API_ORIGIN = 'https://connectapi.garmin.com';
const USER_AGENT = 'com.garmin.android.apps.connectmobile';

export interface GarminToken {
  // The OAuth2 blob persisted (encrypted) and replayed by the sync worker.
  oauth2: Record<string, unknown>;
  providerUserId: string | null;
  scopes: string[];
  expiresAt: string | null;
}

export class GarminLoginError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

// ---- OAuth1 (HMAC-SHA1) signing, just enough for the two token exchanges ----

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

async function hmacSha1Base64(key: string, base: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(base));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function oauth1Header(
  method: string,
  url: string,
  consumer: { key: string; secret: string },
  token: { key: string; secret: string } | null,
  extraParams: Record<string, string>,
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumer.key,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token.key } : {}),
  };
  const allParams = { ...oauth, ...extraParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(allParams[k])}`)
    .join('&');
  const base = [method.toUpperCase(), rfc3986(url.split('?')[0]), rfc3986(paramString)].join('&');
  const signingKey = `${rfc3986(consumer.secret)}&${rfc3986(token?.secret ?? '')}`;
  oauth.oauth_signature = await hmacSha1Base64(signingKey, base);
  const header = Object.keys(oauth)
    .map((k) => `${rfc3986(k)}="${rfc3986(oauth[k])}"`)
    .join(', ');
  return `OAuth ${header}`;
}

function parseFormEncoded(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return out;
}

// ---- SSO steps ----

async function fetchConsumer(): Promise<{ key: string; secret: string }> {
  const res = await fetch(CONSUMER_URL);
  if (!res.ok) throw new GarminLoginError('consumer_fetch_failed');
  const json = await res.json();
  return { key: json.consumer_key, secret: json.consumer_secret };
}

function cookiesFrom(res: Response, jar: Map<string, string>) {
  // Deno fetch exposes Set-Cookie via getSetCookie() on recent runtimes.
  const setCookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const SSO_QUERY =
  'service=https%3A%2F%2Fconnect.garmin.com%2Fmodern&webhost=https%3A%2F%2Fconnect.garmin.com&gauthHost=https%3A%2F%2Fsso.garmin.com%2Fsso&clientId=GarminConnect&consumeServiceTicket=false';

async function getCsrf(jar: Map<string, string>): Promise<string> {
  const res = await fetch(`${SSO_ORIGIN}/sso/signin?${SSO_QUERY}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new GarminLoginError('signin_page_failed');
  cookiesFrom(res, jar);
  const html = await res.text();
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!m) throw new GarminLoginError('csrf_not_found');
  return m[1];
}

async function getTicket(
  email: string,
  password: string,
  csrf: string,
  jar: Map<string, string>,
): Promise<string> {
  const form = new URLSearchParams({ username: email, password, embed: 'true', _csrf: csrf });
  const res = await fetch(`${SSO_ORIGIN}/sso/signin?${SSO_QUERY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Cookie: cookieHeader(jar),
      Referer: `${SSO_ORIGIN}/sso/signin?${SSO_QUERY}`,
    },
    body: form.toString(),
  });
  cookiesFrom(res, jar);
  const html = await res.text();
  if (/mfa|verificationCode/i.test(html) && !/ticket=/.test(html)) {
    throw new GarminLoginError('mfa_required', 'Two-factor accounts are not supported yet.');
  }
  const m = html.match(/embed\?ticket=([^"]+)"/) ?? html.match(/ticket=([A-Za-z0-9-]+)/);
  if (!m) throw new GarminLoginError('bad_credentials', 'Login rejected — check email/password.');
  return m[1];
}

async function exchangeTicket(ticket: string, consumer: { key: string; secret: string }) {
  const url = `${API_ORIGIN}/oauth-service/oauth/preauthorized`;
  const params = {
    ticket,
    'login-url': `${SSO_ORIGIN}/sso/embed`,
    'accepts-mfa-tokens': 'true',
  };
  const auth = await oauth1Header('GET', url, consumer, null, params);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, {
    headers: { Authorization: auth, 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new GarminLoginError('oauth1_exchange_failed');
  const parsed = parseFormEncoded(await res.text());
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new GarminLoginError('oauth1_token_missing');
  }
  return { key: parsed.oauth_token, secret: parsed.oauth_token_secret };
}

async function exchangeOauth2(
  oauth1: { key: string; secret: string },
  consumer: { key: string; secret: string },
): Promise<Record<string, unknown>> {
  const url = `${API_ORIGIN}/oauth-service/oauth/exchange/user/2.0`;
  const auth = await oauth1Header('POST', url, consumer, oauth1, {});
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new GarminLoginError('oauth2_exchange_failed');
  return await res.json();
}

/**
 * Log in with an email + password and return the OAuth2 token blob to persist.
 * Throws GarminLoginError with a stable `code` on every failure mode so the
 * caller can map it to a user-facing message. UNVALIDATED — see file header.
 */
export async function garminClientLogin(email: string, password: string): Promise<GarminToken> {
  const jar = new Map<string, string>();
  const consumer = await fetchConsumer();
  const csrf = await getCsrf(jar);
  const ticket = await getTicket(email, password, csrf, jar);
  const oauth1 = await exchangeTicket(ticket, consumer);
  const oauth2 = await exchangeOauth2(oauth1, consumer);

  const expiresIn = typeof oauth2.expires_in === 'number' ? oauth2.expires_in : null;
  return {
    oauth2,
    providerUserId: typeof oauth2.jti === 'string' ? oauth2.jti : null,
    scopes: typeof oauth2.scope === 'string' ? oauth2.scope.split(' ').filter(Boolean) : [],
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
  };
}
