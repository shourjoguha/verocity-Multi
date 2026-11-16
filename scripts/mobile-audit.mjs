// Mobile audit — the standing regression test for the two failure modes that
// keep coming back on a phone-first app:
//
//   1. horizontal overflow (the document scrolls sideways), and
//   2. tap targets below TOUCH.minTargetPx (44px, see app.config.ts), and
//   3. menu items that are painted underneath other content and cannot be
//      tapped.
//
// Loads every /app route at two phone widths and fails the process if either
// regresses. Auth is seeded into localStorage and Supabase REST traffic is
// stubbed with fixtures, so this needs no credentials and no live database —
// and the Logger boots against a real LogDocument, so the set rows are
// genuinely measured rather than skipped behind a redirect to /login.
//
// WHAT IT CANNOT SEE — read this before citing a green run as evidence:
//   - It LOADS routes. Apart from opening `[aria-haspopup="menu"]` triggers
//     (rule 3, below) it clicks nothing, opens no sheet, and triggers no
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
        // A FINISHED superset, stamped `completedAt` so the Logger parks it and
        // the "Done" pile actually renders. Without one the pile is absent and
        // this audit measures a surface it never drew — the failure recorded in
        // docs/LESSONS.md as "audit:mobile is green on a surface it never
        // rendered". Long names, four sets and a notation on purpose: the done
        // row is [✓][name + tags][set summary] on one line, and this is what
        // squeezes it at 375px.
        {
          id: 'g0',
          kind: 'superset',
          completedAt: '2026-01-06T09:00:00Z',
          items: [
            {
              id: 'i0a',
              movement: 'single-arm half-kneeling landmine press',
              primaryMetric: 'weight',
              sets: [
                { ...set('10', 32.5, 10, 7, true), notations: ['/side'] },
                { ...set('10', 32.5, 10, 8, true), notations: ['/side'] },
                { ...set('10', 32.5, 9, 8.5, true), notations: ['/side'] },
                { ...set('10', 32.5, 8, 9, true), notations: ['/side'] },
              ],
            },
            {
              id: 'i0b',
              movement: 'chest-supported row',
              primaryMetric: 'weight',
              sets: [set('12', 45, 12, 7, true), set('12', 45, 12, 8, true)],
            },
          ],
        },
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
  // Linked to the active plan's day 1, cycle 1, so the Logger's Session
  // details row renders its cycle and note marker while measured.
  plan_id: '33333333-3333-3333-3333-333333333333',
  day_key: 'day-1',
  week_number: 1,
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

// Friends / inbox (migration 0052). A needs_review log — a friend's workout
// accepted but not confirmed — so the history lists render their "Review"
// marker and /app/inbox its To review block. Without these the inbox would
// render its empty state and be measured as one.
const reviewLog = {
  ...doneLog,
  id: '44444444-4444-4444-4444-444444444444',
  status: 'needs_review',
  plan_id: null,
  day_key: null,
  week_number: null,
  activity_type: 'Upper body — long friend-sent session title',
  shared_item_id: 'si-h1',
};
// A second review row on a day with no log of mine: the Logger's review mode
// without the duplicates sheet over it (Counts toward, Confirm / Discard), and
// the inbox's Confirm as is, which is withheld over a same-day log.
const REVIEW2_ID = '66666666-6666-6666-6666-666666666666';
const reviewLog2 = {
  ...reviewLog,
  id: REVIEW2_ID,
  log_date: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
  shared_item_id: 'si-h2',
  // One movement doneLog lacks, so Combine (doneLog + this) marks an Added row.
  data: {
    sections: [
      ...reviewLog.data.sections,
      {
        key: 'accessory',
        groups: [{ id: 'ga', kind: 'single', items: [{ id: 'ia', movement: 'cable face pull with a long name', primaryMetric: 'reps', sets: [set('15', 20, 15, 7, true)] }] }],
      },
    ],
  },
};
const logById = new Map([workoutLog, doneLog, reviewLog, reviewLog2].map((l) => [l.id, l]));
const sharedPayload = (logDate) => ({
  log_date: logDate,
  started_at: null,
  ended_at: null,
  total_seconds: 3600,
  activity_type: null,
  tags: ['strength'],
  data: doneLog.data,
  movements: [],
});
const today = new Date().toISOString().slice(0, 10);
const ymdAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const sharedItem = (id, batch, sender, date, status, extra = {}) => ({
  id, sender_id: 'f1', recipient_id: session.user.id, sender_name: sender, kind: 'log',
  batch_id: batch, title: 'Day 3 — Lower body strength with a long label', item_date: date,
  payload: status === 'pending' ? sharedPayload(date) : null, status,
  created_at: new Date().toISOString(), acted_at: null, sender_seen_at: null,
  accepted_log_id: null, accepted_digest: null, ...extra,
});
// Batch b1 has three items, one dated today (same day as doneLog, so its
// overlap chip renders); b2 is a single item.
const pendingItems = [
  sharedItem('si-1', 'b1', 'Samantha Rivera-Longname', today, 'pending'),
  sharedItem('si-2', 'b1', 'Samantha Rivera-Longname', ymdAgo(2), 'pending'),
  sharedItem('si-3', 'b1', 'Samantha Rivera-Longname', ymdAgo(4), 'pending'),
  sharedItem('si-4', 'b2', 'Alex', ymdAgo(1), 'pending'),
];
const historyItems = [
  sharedItem('si-h1', 'b0', 'Alex', ymdAgo(9), 'accepted', { accepted_log_id: reviewLog.id }),
  sharedItem('si-h2', 'b0', 'Alex', ymdAgo(10), 'accepted', { accepted_log_id: 'gone' }),
  sharedItem('si-h3', 'b0', 'Alex', ymdAgo(11), 'dismissed'),
];
const friendRow = (id, name, status, direction) => ({
  friendship_id: id, user_id: `u-${id}`, display_name: name, status, direction,
  created_at: new Date().toISOString(), responded_at: null,
});
const friends = [
  friendRow('fr1', 'Jordan Incoming-Request', 'pending', 'incoming'),
  friendRow('fr2', 'Samantha Rivera-Longname', 'accepted', 'outgoing'),
  friendRow('fr3', 'Alex', 'accepted', 'incoming'),
  friendRow('fr4', 'Morgan Waiting', 'pending', 'outgoing'),
];
const acceptances = [
  { batch_id: 'b9', recipient_id: 'u-fr2', recipient_name: 'Samantha Rivera-Longname', kind: 'log', accepted_count: 5, last_acted_at: new Date().toISOString(), seen: false },
];

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
  // A long cycle note and a linked pair on day 1, so /app/plan and the Logger
  // render the note line and a superset rather than only the bare case.
  ...(i === 0
    ? { notesByWeek: { 1: 'Cycle 1: open every lift at RPE 7 and write the load down; next cycle adds 2.5 kg where all reps were clean.' } }
    : {}),
  exercises: Array.from({ length: 5 + (i % 4) }, (_, k) => ({
    movement: `movement ${k + 1}`,
    section: 'primary',
    primaryMetric: 'weight',
    plannedByWeek: { 1: '5x5', 2: '5x5' },
    ...(i === 0 && k < 2 ? { group: { id: 'pair', kind: 'superset' }, restSeconds: 90 } : {}),
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
    weekNotes: { 1: 'Build-up week: every strength lift at RPE 7; hypertrophy work at the bottom of its rep range.' },
  },
  is_active: true,
  is_public: false,
  created_at: '2026-01-06T00:00:00Z',
};

// A PLAN a friend sent (phase 4), in its own batch, so the inbox renders a plan
// row — long title, its day count, Dismiss + Accept & review — rather than
// only log rows. Pushed here because activePlan must exist first.
pendingItems.push({
  ...sharedItem('si-5', 'b3', 'Samantha Rivera-Longname', ymdAgo(0), 'pending'),
  kind: 'plan',
  title: 'Endurance & Cut Block with a deliberately long plan name',
  payload: { name: activePlan.name, start_date: '2026-01-06', end_date: null, parsed: activePlan.parsed, source_markdown: null },
});

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

// Saved sessions, so /app/sessions renders rows instead of "No sessions yet."
// Owned AND shared on purpose, same reason as m3 above: an owned row can carry
// controls a shared one never does. Multi-tag and from-plan rows are the
// widest variants of the row.
const sessionRow = (id, extra) => ({
  id, owner_user_id: session.user.id, name: 'Upper A — Push bias', tags: ['strength'],
  frame: { exercises: [
    { movement: 'bench press', section: 'primary', primaryMetric: 'weight', planned: '4x5' },
    { movement: 'weighted pull-up', section: 'accessory', primaryMetric: 'reps', planned: '3x8' },
  ] },
  source_plan_id: null, source_day_key: null, is_mini: false, created_at: '2026-01-10T00:00:00Z',
  session_type: null, time_cap_seconds: null, duration_seconds: null, rounds: null, partner: false,
  instructions: null, source: null, source_text: null, source_ref: null,
  ...extra,
});
const savedSessions = [
  sessionRow('s1'),
  sessionRow('s2', { name: 'Hyrox Sim — Half Race Simulation', tags: ['hyrox', 'endurance'], session_type: 'FOR_TIME' }),
  sessionRow('s3', { name: '5×5 Base · Day 2', tags: [], source_plan_id: 'plan-1', source_day_key: 'd2' }),
  sessionRow('s4', { owner_user_id: null, name: 'Fran', tags: ['crossfit'], session_type: 'FOR_TIME', source: 'crossfit' }),
];

// Coach rows, so /app/coach renders its brief card, the created-at slider and
// the Snoozed/Decided lists instead of the empty state — without them this
// audit measured none of those controls.
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const rec = (id, status, created, extra = {}) => ({
  id, owner_user_id: session.user.id, status, drift_score: 0.6, confidence: 0.8,
  tldr: 'Hard sets for legs are under the weekly floor',
  action: 'Add two working sets of squats this week', body_md: 'Body.',
  disposition: null, disposition_note: null, linked_log_id: null, snooze_until: null,
  created_at: daysAgo(created), rule_id: null, period_key: null, pack_version: null,
  evidence: null, ...extra,
});
const recommendations = [
  rec('r1', 'open', 2),
  rec('r2', 'acted', 20, { disposition: 'acted_modified' }),
];
const brief = (id, created, extra = {}) => ({
  id, owner_user_id: session.user.id, theme: null, rule_ids: [],
  headline: 'Endurance is the limiting side', body_md: 'Body.',
  window_start: null, window_end: null, author: 'claude-code', expires_at: null,
  created_at: daysAgo(created), status: 'open', disposition: null,
  disposition_note: null, snooze_until: null, ...extra,
});
const coachBriefs = [
  brief('b1', 1),
  brief('b2', 30, { status: 'snoozed', snooze_until: daysAgo(-3) }),
];

// Planned breaks (0049): one just ended, one ahead, so Home's calendar draws
// ribbons, Stats hatches grid cells and Settings → Holidays lists both groups.
const holiday = (id, kind, from, to, name) => ({
  id, owner_user_id: session.user.id, kind, name,
  starts_on: daysAgo(from).slice(0, 10), ends_on: daysAgo(to).slice(0, 10),
  created_at: daysAgo(40), updated_at: daysAgo(40),
});
const holidays = [
  holiday('h1', 'dive', 12, 5, 'A long holiday name that has to truncate'),
  holiday('h2', 'hike', -20, -27, null),
];

function fixtureFor(url) {
  const path = new URL(url).pathname;
  if (path.includes('/holidays')) return holidays;
  if (path.includes('/recommendations')) return recommendations;
  if (path.includes('/coach_briefs')) return coachBriefs;
  if (path.endsWith('/rpc/list_friends')) return friends;
  if (path.endsWith('/rpc/my_friend_code')) return 'K7MX2QPA';
  if (path.endsWith('/rpc/list_acceptances')) return acceptances;
  if (path.includes('/rpc/')) return null;
  // getSharedItem (the review banner's sender) is a by-id maybeSingle.
  const byId = /[?&]id=eq\.([^&]+)/.exec(url)?.[1];
  if (path.includes('/shared_items')) {
    if (byId) return historyItems.find((i) => i.id === byId) ?? null;
    return url.includes('pending') ? pendingItems : historyItems;
  }
  if (path.includes('/workout_logs'))
    return byId ? (logById.get(byId) ?? workoutLog) : [workoutLog, doneLog, reviewLog, reviewLog2];
  if (path.includes('/movements')) return movements;
  if (path.endsWith('/sessions')) return url.includes('id=eq.') ? savedSessions[0] : savedSessions;
  if (path.includes('/profiles')) return url.includes('id=eq.') ? null : [];
  // getUserStats() is .maybeSingle() with no filter, so it must resolve to an
  // OBJECT or null. null is the interesting case: it is what a user who has
  // never opened Settings sees, and what the anon showcase client always sees.
  if (path.includes('/user_stats')) return null;
  // getActivePlan uses .maybeSingle(), so the is_active lookup must resolve to
  // an OBJECT; the unfiltered list query still wants an array.
  // The Ready-plan picker on /app/plan/upload: one curated row reusing the
  // active plan's document, so the dropdown, preview and sticky bar render.
  if (path.includes('/plan_templates'))
    return [{ id: 'tpl-1', name: activePlan.name, summary: null, parsed: activePlan.parsed, sort_order: 1, retired: false, created_at: '2026-01-01T00:00:00Z' }];
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
  '/app/plan/view',
  '/app/plan/upload',
  // The plan editor: day picker, section tabs, one stepper card per exercise.
  // Not measured until it stopped being a sideways-scrolling table.
  '/app/plan/edit',
  '/app/review',
  '/app/sessions',
  '/app/library',
  // /app/settings is now a redirect to /app/you. Its two entries became the
  // states of /app/you that a plain load leaves folded: the Holidays section,
  // and Appearance with its Coach icon row (#coach-icon opens both). Plus
  // /app/shares, the full share list the You page now links to.
  '/app/you#holidays',
  '/app/you#coach-icon',
  '/app/shares',
  '/app/activity',
  '/app/activity?mode=holiday',
  '/app/onboarding',
  `/app/log?logId=${LOG_ID}`,
  // Friends (You → Friends, opened by the hash) and the inbox, both with rows.
  '/app/you#friends',
  '/app/inbox',
  // Review mode (§5.4): with the same-day duplicates sheet open over it, then
  // plain (Counts toward, Confirm / Discard), then Combine on my own log.
  `/app/log?logId=${reviewLog.id}&edit=1`,
  `/app/log?logId=${REVIEW2_ID}&edit=1&queue=${REVIEW2_ID},${reviewLog.id}`,
  `/app/log?logId=${doneLog.id}&edit=1&combine=${REVIEW2_ID}`,
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
  /^Add meal: /, // Home meal strip segments: 40px tall by the owner's decision
  // (MealChipRail.tsx header). The alternative was 44px hit boxes overlapping
  // the Start bar above, where a mis-tap starts a meal instead of a workout.
  /^Manage saved meals$/, // the same strip's bowl cell (opens saved meals), same reason.
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
      // Supabase is cross-origin (:54321 vs the preview's :4321), so the
      // browser hides content-range unless it is exposed — as the real API
      // does. Without this every head count (the inbox bell's three) read 0
      // and the bell showed 1 where the fixture means 4.
      headers: { 'content-range': '0-0/1', 'access-control-expose-headers': 'content-range' },
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

    // 3. An open menu's items must be the thing a tap actually hits. This is
    // the audit's ONE interaction, added after the plan header's menu shipped
    // painted underneath the content that followed it: every item was visible
    // through nothing and tappable by no one, and a load-only audit could not
    // tell. Opens each `[aria-haspopup="menu"]` (first 6 per route), and for
    // every item inside the scroller's visible box asks what element is at its
    // centre. Items that run past the scroller's edge are not counted — those
    // are reachable by scrolling.
    const coveredMenu = [];
    const triggers = page.locator('[aria-haspopup="menu"]:visible');
    const triggerCount = Math.min(await triggers.count(), 6);
    for (let i = 0; i < triggerCount; i++) {
      await triggers.nth(i).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await triggers.nth(i).tap();
      await page.waitForTimeout(120);
      const covered = await page.evaluate(() => {
        const box = (document.querySelector('[data-scroll-root]') ?? document.documentElement).getBoundingClientRect();
        const out = [];
        for (const it of document.querySelectorAll('[role="menu"] [role="menuitem"]')) {
          const r = it.getBoundingClientRect();
          if (r.top < box.top || r.bottom > box.bottom) continue;
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!top || !(top === it || it.contains(top))) out.push((it.textContent || '').trim().slice(0, 30));
        }
        return out;
      });
      coveredMenu.push(...covered);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
    }

    results.push({ vp: vp.name, route, ...report, coveredMenu });
  }

  await context.close();
}

await browser.close();

let fail = 0;
for (const r of results) {
  const overflowBad = r.overflow > 0;
  const targetsBad = r.smallCount > 0;
  const menuBad = r.coveredMenu.length > 0;
  if (overflowBad || targetsBad || menuBad) fail++;
  const mark = overflowBad || targetsBad || menuBad ? 'FAIL' : ' ok ';
  console.log(
    `[${mark}] ${r.vp}  ${r.route.padEnd(34)} scrollWidth=${r.scrollWidth} (vw ${r.innerWidth})  small-targets=${r.smallCount}`,
  );
  if (overflowBad) {
    console.log(`         overflow +${r.overflow}px, e.g.`, JSON.stringify(r.culprits));
  }
  if (targetsBad) console.log('        ', JSON.stringify(r.small));
  if (menuBad) console.log('         menu items covered by other content:', JSON.stringify(r.coveredMenu));
}
console.log(fail === 0 ? '\nAll checks passed.' : `\n${fail} route/viewport combos failed.`);
process.exit(fail === 0 ? 0 : 1);
