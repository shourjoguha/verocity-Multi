// Performance baseline — the numbers the load-time work is judged against.
//
// One cold launch of /app on a throttled phone profile, then a soft
// (ClientRouter) walk through the tabs that read log history. It reports:
//
//   home-ready     ms from navigation start until Home's loading state is gone
//   js-bytes       script bytes Home fetched before it was ready
//   log-requests   every request to workout_logs across the walk, with rows and
//                  bytes — the same history fetched again is visible here as a
//                  repeated `select=*` with no date filter
//
// Supabase is stubbed (auth seeded, REST fulfilled from a synthetic history), so
// it needs no credentials. The stub adds a fixed latency plus a throughput cost
// per byte, because a fulfilled route skips Chromium's network throttling.
//
// WHAT IT CANNOT SEE — read this before citing a number:
//   - YOUR DATA. The history is synthetic: LOGS logs of a realistic shape. Scale
//     the per-log byte figure by your real count (SQL at the bottom of this
//     header) before concluding anything about payload size.
//   - A real network. Latency and throughput are modelled, not measured; treat
//     the ms figures as before/after deltas on this script, never as what a
//     phone sees.
//   - The service worker. It is blocked so every run is genuinely cold; the
//     warm path (cached shell, cached chunks) is not measured here.
//   - WebKit. Chromium only.
//
// Usage:
//   PUBLIC_SUPABASE_URL=http://localhost:54321 PUBLIC_SUPABASE_ANON_KEY=stub npm run build
//   npm run preview &        then        npm run perf:baseline
// Env: BASE (default http://localhost:4321), LOGS (default 150),
//      LATENCY_MS (default 150), KBPS (default 400, KB/s), CPU (default 4, slowdown).
//
// Your real history size (Supabase SQL editor):
//   select count(*), pg_size_pretty(sum(pg_column_size(w.*))) from workout_logs w
//   where status <> 'cancelled';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';
const LOGS = Number(process.env.LOGS || 150);
const LATENCY_MS = Number(process.env.LATENCY_MS || 150);
const KBPS = Number(process.env.KBPS || 400);
const CPU = Number(process.env.CPU || 4);
const UID = '22222222-2222-2222-2222-222222222222';

const session = {
  access_token: 'stub',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'stub',
  user: {
    id: UID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'demo@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  },
};

// A plausible strength session: warm-up, two working sections, five movements,
// four sets each. Sized to look like a real LogDocument, not a minimal one.
const set = (w, r) => ({
  planned: `${r} @RPE8`,
  actual: { weight: w, reps: r, rpe: 8, completed: true, prefilled: false },
  notations: [],
});
const item = (id, movement, w) => ({
  id,
  movement,
  primaryMetric: 'weight',
  restSeconds: 150,
  sets: [set(w, 5), set(w, 5), set(w + 2.5, 5), set(w + 2.5, 4)],
});
const doc = (n) => ({
  sections: [
    { key: 'warmup', groups: [{ id: `w${n}`, kind: 'single', items: [item(`w${n}a`, 'goblet squat', 16)] }] },
    {
      key: 'primary',
      groups: [
        { id: `p${n}`, kind: 'single', items: [item(`p${n}a`, 'barbell back squat', 100 + (n % 20))] },
        { id: `p${n}b`, kind: 'single', items: [item(`p${n}b`, 'bench press', 70 + (n % 10))] },
      ],
    },
    {
      key: 'accessory',
      groups: [
        {
          id: `a${n}`,
          kind: 'superset',
          items: [item(`a${n}a`, 'romanian deadlift', 80), item(`a${n}b`, 'pull up', 0)],
        },
      ],
    },
  ],
});

const today = new Date();
const history = Array.from({ length: LOGS }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() - (LOGS - i) * 2);
  const date = d.toISOString().slice(0, 10);
  return {
    id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    owner_user_id: UID,
    plan_id: null,
    day_key: null,
    session_id: null,
    week_number: null,
    log_date: date,
    status: 'done',
    total_seconds: 3600,
    tags: ['strength'],
    activity_type: null,
    notes: null,
    started_at: `${date}T18:00:00Z`,
    ended_at: `${date}T19:00:00Z`,
    data: doc(i),
    created_at: `${date}T19:00:00Z`,
  };
});

// PostgREST filters this route actually uses on workout_logs. Anything else
// gets the whole history, which over-serves rather than hides a request.
function logsFor(url) {
  const q = new URL(url).searchParams;
  let rows = history;
  for (const [k, v] of q.entries()) {
    if (k !== 'log_date') continue;
    if (v.startsWith('gte.')) rows = rows.filter((r) => r.log_date >= v.slice(4));
    if (v.startsWith('lte.')) rows = rows.filter((r) => r.log_date <= v.slice(4));
  }
  const order = q.get('order') ?? '';
  if (order.includes('desc')) rows = [...rows].reverse();
  const limit = Number(q.get('limit'));
  if (limit) rows = rows.slice(0, limit);
  if (url.includes('id=eq.')) return rows[0] ?? null;
  return rows;
}

function fixtureFor(url) {
  const path = new URL(url).pathname;
  if (path.includes('/workout_logs')) return logsFor(url);
  if (path.includes('/profiles')) return url.includes('id=eq.') ? null : [];
  return [];
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
});

const logRequests = [];
let phase = 'home';
await context.route('**/auth/v1/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }),
);
await context.route('**/rest/v1/**', async (route) => {
  const url = route.request().url();
  const data = fixtureFor(url);
  const body = JSON.stringify(data);
  if (new URL(url).pathname.includes('/workout_logs')) {
    const q = new URL(url).searchParams;
    logRequests.push({
      phase: `${phase}${new URL(page.url()).pathname === phase || phase === 'home' ? '' : ' (url ' + new URL(page.url()).pathname + ')'}`,
      filter: [...q.entries()]
        .filter(([k]) => k !== 'select')
        .map(([k, v]) => `${k}=${v}`)
        .join('&'),
      rows: Array.isArray(data) ? data.length : data ? 1 : 0,
      bytes: body.length,
    });
  }
  await new Promise((r) => setTimeout(r, LATENCY_MS + body.length / KBPS));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': '0-0/1' },
    body,
  });
});
await context.addInitScript(
  ([key, value]) => window.localStorage.setItem(key, value),
  ['sb-localhost-auth-token', JSON.stringify(session)],
);

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: LATENCY_MS,
  downloadThroughput: KBPS * 1024,
  uploadThroughput: KBPS * 1024,
});

let jsBytes = 0;
let counting = true;
cdp.on('Network.loadingFinished', (e) => {
  if (counting && scriptIds.has(e.requestId)) jsBytes += e.encodedDataLength;
});
const scriptIds = new Set();
cdp.on('Network.responseReceived', (e) => {
  if (e.type === 'Script') scriptIds.add(e.requestId);
});

// Home is ready when its island has hydrated and the loader is gone.
const ready = () =>
  page.waitForFunction(
    () =>
      document.querySelector('main') &&
      !document.querySelector('main .loading-sweep') &&
      document.querySelector('main')?.textContent?.trim().length > 0 &&
      document.querySelector('astro-island:not([ssr])') !== null,
    null,
    { timeout: 60_000, polling: 50 },
  );

// No stubbed REST request for QUIET_MS. The stub's own latency means a read
// in flight is always visible to this counter.
let lastRest = Date.now();
let inFlight = 0;
page.on('request', (r) => {
  if (r.url().includes('/rest/v1/')) (inFlight++, (lastRest = Date.now()));
});
page.on('requestfinished', (r) => {
  if (r.url().includes('/rest/v1/')) (inFlight--, (lastRest = Date.now()));
});
page.on('requestfailed', (r) => {
  if (r.url().includes('/rest/v1/')) (inFlight--, (lastRest = Date.now()));
});
async function quiet(ms = 1500) {
  while (inFlight > 0 || Date.now() - lastRest < ms) await new Promise((r) => setTimeout(r, 100));
}

await page.goto(BASE + '/app', { waitUntil: 'commit' });
await page.waitForSelector('astro-island', { state: 'attached' });
await ready();
const homeReady = await page.evaluate(() => Math.round(performance.now()));
counting = false;

// Soft navigations, the way a tab tap does it: ClientRouter intercepts any
// same-origin anchor click, so the JS realm (and the in-memory query cache)
// survives — which is the condition under which duplicate fetches matter.
async function softGo(path) {
  phase = path;
  await page.evaluate((href) => {
    const a = document.createElement('a');
    a.href = href;
    document.body.appendChild(a);
    a.click();
  }, path);
  await page.waitForURL(BASE + path);
  // networkidle alone returns before a freshly swapped island has hydrated and
  // issued its reads, which credited one tab's requests to the next.
  await ready();
  await quiet();
}
await quiet();
for (const path of ['/app/stats', '/app/plan', '/app/you', '/app']) await softGo(path);

await browser.close();

const perLog = Math.round(JSON.stringify(history).length / LOGS);
const full = logRequests.filter((r) => !/log_date=|limit=|id=eq\./.test(r.filter));
console.log(`\nperf-baseline · ${LOGS} synthetic logs (~${perLog} B each) · ${LATENCY_MS}ms + ${KBPS}KB/s · CPU ${CPU}x\n`);
console.log(`home-ready   ${homeReady} ms`);
console.log(`js-bytes     ${Math.round(jsBytes / 1024)} KB (transferred, before Home was ready)\n`);
console.log('workout_logs requests (KB = uncompressed JSON):');
for (const r of logRequests)
  console.log(`  ${r.phase.padEnd(11)} ${String(r.rows).padStart(5)} rows ${String(Math.round(r.bytes / 1024)).padStart(6)} KB  ${r.filter}`);
const total = logRequests.reduce((a, r) => a + r.bytes, 0);
console.log(`\n  total ${logRequests.length} requests, ${Math.round(total / 1024)} KB; full-history fetches: ${full.length}`);
