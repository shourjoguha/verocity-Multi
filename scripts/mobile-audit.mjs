// Mobile audit — the standing regression test for the two failure modes that
// keep coming back on a phone-first app:
//
//   1. horizontal overflow (the document scrolls sideways), and
//   2. tap targets below TOUCH.minTargetPx (44px, see app.config.ts).
//
// Loads every /app route at two phone widths and fails the process if either
// regresses. Auth is seeded into localStorage and Supabase REST traffic is
// stubbed with fixtures, so this needs no credentials and no live database —
// and the Logger boots against a real LogDocument, so the set rows are
// genuinely measured rather than skipped behind a redirect to /login.
//
// WHAT IT CANNOT SEE — read this before citing a green run as evidence:
//   - It LOADS routes. It clicks nothing, opens no sheet, and triggers no
//     interaction. A bug that only appears on open/close is invisible to it.
//     Four sheet-flicker fixes shipped citing "all 20 audit combinations pass"
//     while the bug was live. Use `npm run audit:flicker` for overlays.
//   - Anything that is not overflow or a tap-target size: colour, contrast,
//     z-order, animation, jank, scroll behaviour.
//   - Chromium in mobile emulation, not a real phone and not WebKit.
//
// Usage:  npm run build && npm run preview &   then   npm run audit:mobile
// Override the origin with BASE=http://localhost:4322 npm run audit:mobile
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';
const LOG_ID = '11111111-1111-1111-1111-111111111111';

const session = {
  access_token: 'stub',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'stub',
  user: {
    id: '22222222-2222-2222-2222-222222222222',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'demo@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  },
};

const set = (planned, weight, reps, rpe, completed) => ({
  planned,
  actual: { weight, reps, rpe, completed, prefilled: false },
  notations: [],
});

// Deliberately hostile numbers: 3-digit weights and a planned label, which is
// what pushed the old row past the viewport.
const logDoc = {
  sections: [
    {
      key: 'primary',
      groups: [
        {
          id: 'g1',
          kind: 'single',
          items: [
            {
              id: 'i1',
              movement: 'barbell back squat',
              primaryMetric: 'weight',
              sets: [
                set('5 @70%', 142.5, 5, 8, true),
                set('5 @75%', 145, 5, 8.5, true),
                set('5 @80%', 100, 12, 9, false),
              ],
            },
          ],
        },
        {
          id: 'g2',
          kind: 'superset',
          items: [
            {
              id: 'i2',
              movement: 'romanian deadlift',
              primaryMetric: 'weight',
              sets: [set('8', 120, 8, 7, false)],
            },
            {
              id: 'i3',
              movement: 'walking lunge',
              primaryMetric: 'reps',
              sets: [set('12/side', undefined, 12, 7, false)],
            },
          ],
        },
      ],
    },
  ],
};

const workoutLog = {
  id: LOG_ID,
  owner_user_id: session.user.id,
  plan_id: null,
  day_key: null,
  session_id: null,
  week: null,
  log_date: new Date().toISOString().slice(0, 10),
  status: 'in_progress',
  total_seconds: 1830,
  tags: ['strength'],
  started_at: new Date().toISOString(),
  ended_at: null,
  data: logDoc,
  created_at: new Date().toISOString(),
};

// A COMPLETED log, for the same reason the active plan below is load-bearing.
// summarizeBodyLoad counts `done` logs only, so with `workoutLog` alone (which
// is in_progress, because /app/log needs a live session) /app/body rendered
// "No completed sessions" and the audit measured an empty state — the exact
// failure docs/LESSONS.md records as "audit:mobile is green on a surface it
// never rendered". Every set here is completed so the region list, the currency
// toggle and the heat map are all on screen when the audit runs.
const doneLog = {
  ...workoutLog,
  id: '22222222-2222-2222-2222-222222222222',
  status: 'done',
  ended_at: new Date().toISOString(),
  data: {
    sections: logDoc.sections.map((s) => ({
      ...s,
      groups: s.groups.map((g) => ({
        ...g,
        items: g.items.map((it) => ({
          ...it,
          sets: it.sets.map((st) => ({ ...st, actual: { ...st.actual, completed: true } })),
        })),
      })),
    })),
  },
};

// An ACTIVE PLAN is load-bearing for the same reason m3 below is owned: the
// fixture used to return [] for plans, so every plan-dependent surface rendered
// its empty state and was never measured — Home's plan unit and day accordion,
// /app/plan, the calendar's day chips. See docs/LESSONS.md, "audit:mobile is
// green on a surface it never rendered".
//
// SIX days, deliberately: the accordion collapses every non-active day to a
// 44px card, so day count is what squeezes the row. Four days is the pleasant
// case; six is where the collapsed cards and the gaps actually compete for a
// 375px column. Keep it at six or more.
const planDays = [
  'Monday — Lower (Squat)+Jumps',
  'Tuesday — Upper (Pull)',
  'Wednesday — Conditioning',
  'Thursday — Lower (Hinge)',
  'Friday — Upper (Push)+Core',
  'Saturday — Full Body (Power)',
].map((label, i) => ({
  dayKey: `day-${i + 1}`,
  label,
  exercises: Array.from({ length: 5 + (i % 4) }, (_, k) => ({
    movement: `movement ${k + 1}`,
    section: 'primary',
    primaryMetric: 'weight',
    plannedByWeek: { 1: '5x5', 2: '5x5' },
  })),
}));

const activePlan = {
  id: '33333333-3333-3333-3333-333333333333',
  owner_user_id: session.user.id,
  name: 'Endurance & Cut Block',
  start_date: '2026-01-06',
  end_date: null,
  source_markdown: null,
  parsed: {
    title: 'Endurance & Cut Block',
    startDate: '2026-01-06',
    endDate: null,
    blocks: [],
    weeklyTemplate: planDays.map((d) => d.dayKey),
    days: planDays,
  },
  is_active: true,
  is_public: false,
  created_at: '2026-01-06T00:00:00Z',
};

// m3 is OWNED (owner_user_id set), and that is load-bearing: Library renders
// its per-row controls (Map / Edit / ×) only for rows the user owns, so a
// fixture of purely shared rows meant this audit never measured them at all.
// Three sub-44px targets shipped behind that gap. Keep an owned row here.
const movements = [
  { id: 'm1', owner_user_id: null, name: 'barbell back squat', category: 'squat' },
  { id: 'm2', owner_user_id: null, name: 'bench press', category: 'press' },
  {
    id: 'm3',
    owner_user_id: session.user.id,
    name: 'weighted pull-up',
    category: 'pull',
    tags: [],
    default_metrics: ['reps'],
    primary_metric: 'reps',
    default_rest_seconds: 120,
    notes: null,
    kind: 'movement',
    url: null,
    taxonomy: null,
  },
];

function fixtureFor(url) {
  const path = new URL(url).pathname;
  if (path.includes('/workout_logs')) return url.includes('id=eq.') ? workoutLog : [workoutLog, doneLog];
  if (path.includes('/movements')) return movements;
  if (path.includes('/profiles')) return url.includes('id=eq.') ? null : [];
  // getUserStats() is .maybeSingle() with no filter, so it must resolve to an
  // OBJECT or null. null is the interesting case: it is what a user who has
  // never opened Settings sees, and what the anon showcase client always sees.
  if (path.includes('/user_stats')) return null;
  // getActivePlan uses .maybeSingle(), so the is_active lookup must resolve to
  // an OBJECT; the unfiltered list query still wants an array.
  if (path.includes('/plans')) return url.includes('is_active=eq.true') ? activePlan : [activePlan];
  return [];
}

const ROUTES = [
  '/app',
  '/app/you',
  '/app/stats',
  '/app/body',
  '/app/coach',
  '/app/plan',
  '/app/sessions',
  '/app/library',
  '/app/settings',
  '/app/activity',
  '/app/onboarding',
  `/app/log?logId=${LOG_ID}`,
];

const VIEWPORTS = [
  { name: '375x812 (iPhone SE/mini)', width: 375, height: 812 },
  { name: '390x844 (iPhone 14)', width: 390, height: 844 },
];

// Glyph-scale controls that are deliberately small; the rule is about the
// *target*, and these are either decorative or have a large parent target.
// Deliberate exceptions. Keep this list short and justified — every entry is a
// place the 44px rule is knowingly not met, not a place to silence a finding.
const ALLOW = [
  /^Skip to content$/, // skip link: visually hidden until keyboard-focused
  /^Close$/, // sheet dismissal; the backdrop and Escape are the large targets
  /^Skip$/, // rest-timer skip, inside a bar that is itself the affordance
  /^\d{4}-\d{2}-\d{2}/, // Home activity strip: chart columns, one per day of the
  // logged history, at a fixed 8px pitch inside a horizontal scroller — not a
  // control strip. Widening them to 44px would destroy the visualization; the
  // same data is reachable from Calendar, where the cells are real targets.
  // (Keep every bar's aria-label date-first, or they stop matching this.)
];

const results = [];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  await context.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }),
  );
  await context.route('**/rest/v1/**', (route) => {
    const body = fixtureFor(route.request().url());
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify(body),
    });
  });

  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ['sb-localhost-auth-token', JSON.stringify(session)],
  );

  const page = await context.newPage();

  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const report = await page.evaluate(({ allowSrc, deviceWidth }) => {
      const allow = allowSrc.map((s) => new RegExp(s.slice(1, s.lastIndexOf('/')), 'i'));
      const doc = document.documentElement;
      // Measure the SCROLLER, not just the document. Under App.astro's shell
      // the document cannot scroll at all (`.app-shell` clips it), so
      // `documentElement.scrollWidth` is pinned to the viewport whatever the
      // page does — this check went blind the day the shell landed, and passed
      // on a build that laid Home out at 768px inside a 393px phone. The
      // scroll root still reports its true content width because it is
      // `overflow-x: hidden`, not `clip`.
      const scroller = document.querySelector('[data-scroll-root]');
      const widest = Math.max(doc.scrollWidth, scroller ? scroller.scrollWidth : 0);
      // Compare against the DEVICE width, not innerWidth: when content
      // overflows, mobile Chromium widens the layout viewport, so innerWidth
      // grows with scrollWidth and their difference stays 0.
      const overflow = Math.max(widest, window.innerWidth) - deviceWidth;

      // Which elements actually stick out past the viewport.
      const culprits = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > deviceWidth + 1) {
          culprits.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute('class') || '').slice(0, 90),
            right: Math.round(r.right),
          });
        }
      }

      const small = [];
      for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
        if (allow.some((re) => re.test(label))) continue;
        if (r.height < 44) small.push({ label, h: Math.round(r.height), w: Math.round(r.width) });
      }

      return {
        overflow,
        scrollWidth: widest,
        innerWidth: window.innerWidth,
        culprits: culprits.slice(0, 6),
        small: small.slice(0, 10),
        smallCount: small.length,
        text: document.body.innerText.slice(0, 60).replace(/\s+/g, ' '),
      };
    }, { allowSrc: ALLOW.map(String), deviceWidth: vp.width });

    results.push({ vp: vp.name, route, ...report });
  }

  await context.close();
}

await browser.close();

let fail = 0;
for (const r of results) {
  const overflowBad = r.overflow > 0;
  const targetsBad = r.smallCount > 0;
  if (overflowBad || targetsBad) fail++;
  const mark = overflowBad || targetsBad ? 'FAIL' : ' ok ';
  console.log(
    `[${mark}] ${r.vp}  ${r.route.padEnd(34)} scrollWidth=${r.scrollWidth} (vw ${r.innerWidth})  small-targets=${r.smallCount}`,
  );
  if (overflowBad) {
    console.log(`         overflow +${r.overflow}px, e.g.`, JSON.stringify(r.culprits));
  }
  if (targetsBad) console.log('        ', JSON.stringify(r.small));
}
console.log(fail === 0 ? '\nAll checks passed.' : `\n${fail} route/viewport combos failed.`);
process.exit(fail === 0 ? 0 : 1);
