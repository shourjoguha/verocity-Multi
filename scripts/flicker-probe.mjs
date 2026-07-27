// Flicker probe — the standing regression test for what happens when a sheet
// OPENS and CLOSES. `mobile-audit.mjs` only loads routes; it never opens a
// sheet, which is why four separate "flicker fix" commits verified clean while
// the bug was still there.
//
// Each scenario opens one sheet, closes it, and samples every animation frame
// throughout. It fails on the things that are actually visible as a flicker:
//
//   scroll-jump   the page behind moved across an open/close cycle
//   lock-writes   the document's scrollability was toggled on a touch device
//                 (that is a viewport-state change in WebKit: the toolbar
//                 moves, `dvh` moves, and every dvh-sized box repaints)
//   stacked       two full-viewport scrims on screen at once
//   scrim-static  the full-viewport scrim animated its opacity
//   slow-close    the sheet lingered after the close tap
//   focus-jump    focus moved again after the sheet settled (on iOS that is
//                 the keyboard opening and immediately closing)
//   layout-churn  the panel's own box changed size while it was animating
//
// Auth is seeded into localStorage and Supabase REST is stubbed, same as the
// mobile audit, so this needs no credentials and no live database.
//
// Usage:  npm run build && npm run preview &   then   node scripts/flicker-probe.mjs
// Override the origin with BASE=http://localhost:4322
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
              sets: [set('5 @70%', 142.5, 5, 8, true), set('5 @80%', 100, 12, 9, false)],
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

// Enough movements that /app/library scrolls — a page that cannot scroll cannot
// show a scroll jump, which would make the scroll-jump assertion vacuous.
const movements = Array.from({ length: 40 }, (_, i) => ({
  id: `m${i}`,
  owner_user_id: null,
  name: `movement ${i}`,
  category: i % 2 ? 'squat' : 'press',
}));

function fixtureFor(url) {
  const path = new URL(url).pathname;
  if (path.includes('/workout_logs')) return url.includes('id=eq.') ? workoutLog : [workoutLog];
  if (path.includes('/movements')) return movements;
  if (path.includes('/profiles')) return url.includes('id=eq.') ? null : [];
  return [];
}

// Each scenario is: land here, scroll down a bit (so a scroll jump has room to
// show), click `open`, then click `close`.
const SCENARIOS = [
  {
    name: 'Home · workout preview (LogQuickView)',
    route: '/app',
    open: 'main li button',
    close: '[role="dialog"] button:has-text("Close")',
  },
  {
    name: 'Home · start workout (AddSessionMenu)',
    route: '/app',
    open: 'button:has-text("Start workout")',
    close: '[role="dialog"] button:has-text("Close")',
  },
  {
    name: 'Library · + Subroutine (SubroutineEditor)',
    route: '/app/library',
    open: 'button:has-text("+ Subroutine")',
    close: '[role="dialog"] button:has-text("Close")',
  },
  {
    name: 'Logger · movement options',
    route: `/app/log?logId=${LOG_ID}`,
    open: '[aria-label="Movement options"]',
    close: '[role="dialog"] button:has-text("Close")',
  },
  {
    name: 'Logger · edit a set (SetEntrySheet)',
    route: `/app/log?logId=${LOG_ID}`,
    open: '[aria-label^="Edit set"]',
    close: '[role="dialog"] button:has-text("Close")',
  },
  {
    name: 'Logger · options → swap movement (handoff)',
    route: `/app/log?logId=${LOG_ID}`,
    open: '[aria-label="Movement options"]',
    // The handoff is the interesting part: this closes the options sheet and
    // opens the picker. Both scrims used to be on screen together.
    then: '[role="dialog"] button:has-text("Swap movement")',
    close: '[role="dialog"] button:has-text("Close")',
  },
];

// Installed before each interaction. Records one sample per animation frame,
// plus every write to <html>/<body>'s style attribute.
function recorder() {
  const w = window;
  w.__probe = { frames: [], lockWrites: 0, stopped: false };
  const p = w.__probe;

  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.attributeName === 'style') p.lockWrites += 1;
    }
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  obs.observe(document.body, { attributes: true, attributeFilter: ['style'] });

  const tick = () => {
    if (p.stopped) return obs.disconnect();
    const dialogs = document.querySelectorAll('[role="dialog"]');
    // Fall back to the first element child so this still finds the panel in a
    // build that predates the attribute — an assertion that can only pass
    // because it found nothing is not an assertion.
    const panel =
      dialogs[0]?.querySelector('[data-sheet-panel]') ?? dialogs[0]?.firstElementChild ?? null;
    // Is the panel rendered inside something that is mid-opacity-fade? That
    // puts it in an offscreen buffer for every frame of the fade — border and
    // shadow re-rasterised each time — and churns the layer the fixed backdrop
    // sits behind. The scrim must be the panel's SIBLING, not its ancestor.
    let nestedInFade = false;
    for (let el = panel?.parentElement; el && el !== document.body; el = el.parentElement) {
      const o = getComputedStyle(el).opacity;
      if (o !== '' && Number(o) < 1) nestedInFade = true;
    }
    p.frames.push({
      nestedInFade,
      t: Math.round(performance.now()),
      scrollY: Math.round(w.scrollY),
      dialogs: dialogs.length,
      overflow: document.body.style.overflow || '',
      // Which sheet this is. A handoff now swaps sheets within a single frame,
      // so "a sheet is on screen" is not enough to delimit one sheet's life.
      label: dialogs[0]?.getAttribute('aria-label') ?? '',
      scrimOpacity: dialogs[0]
        ? getComputedStyle(dialogs[0].querySelector('[data-sheet-scrim]') ?? dialogs[0]).opacity
        : '1',
      // The panel's own box. Motion drives `transform`; anything else changing
      // here mid-animation is layout churn on a composited element.
      panelH: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
      panelMB: panel ? getComputedStyle(panel).marginBottom : '0px',
      active: document.activeElement
        ? `${document.activeElement.tagName}:${(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim().slice(0, 24)}`
        : 'none',
      // Focus legitimately moves from the trigger into the panel once. What it
      // must not do is move again once it is inside.
      inPanel: !!(document.activeElement && dialogs[0]?.contains(document.activeElement)),
      // A focused text field on a touch device means the software keyboard is
      // coming up — which resizes the visual viewport and relayouts every
      // dvh-sized box and the fixed backdrop, mid-animation.
      typing:
        dialogs.length > 0 &&
        ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '') &&
        !['button', 'checkbox', 'radio', 'submit'].includes(document.activeElement?.type ?? ''),
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

// Touch context on purpose: this is where the user sees the bug, and it is the
// configuration in which the document lock must not fire at all.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

await context.route('**/auth/v1/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }),
);
await context.route('**/rest/v1/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': '0-0/1' },
    body: JSON.stringify(fixtureFor(route.request().url())),
  }),
);
await context.addInitScript(
  ([key, value]) => window.localStorage.setItem(key, value),
  ['sb-localhost-auth-token', JSON.stringify(session)],
);

const page = await context.newPage();
const results = [];

for (const s of SCENARIOS) {
  const result = { name: s.name, skipped: null, failures: [] };

  await page.goto(BASE + s.route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900); // let the CSS entrance stagger finish

  const trigger = page.locator(s.open).first();
  if ((await trigger.count()) === 0 || !(await trigger.isVisible().catch(() => false))) {
    result.skipped = `no element matching ${s.open}`;
    results.push(result);
    continue;
  }

  // Scroll down so a scroll jump has somewhere to jump from — then let
  // Playwright do its own scroll-into-view BEFORE the baseline is taken.
  // `click()` scrolls the target into view first, and a trigger near the top of
  // a long page moves the document to 0 on its own. Measuring across that reads
  // as a 300px app "jump" that is entirely the harness.
  await page.evaluate(() => window.scrollTo(0, Math.min(300, document.body.scrollHeight)));
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // past the header's hide-on-scroll transition
  const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));

  await page.evaluate(recorder);
  await trigger.click();
  await page.waitForTimeout(500); // enter animation + settle

  const afterOpen = await page.evaluate(() => window.__probe.frames.length);

  if (s.then) {
    await page.locator(s.then).first().click();
    await page.waitForTimeout(700); // exit of the first sheet + enter of the second
  }

  const closer = page.locator(s.close).first();
  if ((await closer.count()) === 0) {
    result.skipped = `no element matching ${s.close}`;
    await page.evaluate(() => (window.__probe.stopped = true));
    results.push(result);
    continue;
  }

  const closeAt = await page.evaluate(() => window.__probe.frames.length);
  await closer.click();
  await page.waitForTimeout(700); // exit animation + settle

  const probe = await page.evaluate(() => {
    window.__probe.stopped = true;
    return window.__probe;
  });
  const scrollAfter = await page.evaluate(() => Math.round(window.scrollY));

  const frames = probe.frames;
  const closeFrames = frames.slice(closeAt);
  const closeT0 = closeFrames[0]?.t ?? 0;

  // --- assertions -----------------------------------------------------------

  // scroll-jump: the page behind must be exactly where it was.
  if (scrollAfter !== scrollBefore) {
    result.failures.push(`scroll-jump: ${scrollBefore} -> ${scrollAfter}`);
  }
  const scrollSpread = Math.max(...frames.map((f) => f.scrollY)) - Math.min(...frames.map((f) => f.scrollY));
  if (scrollSpread > 1) {
    result.failures.push(`scroll-jump: page moved ${scrollSpread}px mid-cycle`);
  }

  // lock-writes: nothing may touch document scrollability on a touch device.
  if (probe.lockWrites > 0) {
    result.failures.push(`lock-writes: ${probe.lockWrites} style write(s) to html/body`);
  }
  if (frames.some((f) => f.overflow === 'hidden')) {
    result.failures.push('lock-writes: body overflow went hidden on a touch device');
  }

  // keyboard: nothing may focus a text field as the sheet opens. This context
  // is touch-emulated, so a focused input here is the iOS keyboard rising
  // mid-animation on a real phone.
  if (frames.slice(0, afterOpen).some((f) => f.typing)) {
    result.failures.push('keyboard: a text field was focused on open (raises the software keyboard)');
  }

  // nested-fade: the panel must never be a descendant of a fading element.
  if (frames.some((f) => f.nestedInFade)) {
    const n = frames.filter((f) => f.nestedInFade).length;
    result.failures.push(`nested-fade: panel inside an opacity-animated ancestor for ${n} frame(s)`);
  }

  // scrim-static: the full-viewport scrim must not animate its opacity at all.
  // That is the one thing an in-flow form never does, and in-flow forms are the
  // only overlay-shaped thing in this app that never flickered on a phone.
  const scrimOpacities = new Set(frames.filter((f) => f.dialogs > 0).map((f) => f.scrimOpacity));
  if (scrimOpacities.size > 1) {
    result.failures.push(`scrim-static: scrim opacity animated (${[...scrimOpacities].join(' -> ')})`);
  }

  // stacked: never two scrims at once.
  const maxDialogs = Math.max(...frames.map((f) => f.dialogs));
  if (maxDialogs > 1) result.failures.push(`stacked: ${maxDialogs} scrims on screen at once`);

  // slow-close: the sheet must be gone promptly. Sheets unmount on close now,
  // so anything still on screen a few frames later is a deferred unmount.
  const stillUp = closeFrames.filter((f) => f.t - closeT0 > 100 && f.dialogs > 0).length;
  if (stillUp > 0) {
    result.failures.push(`slow-close: sheet still on screen ${stillUp} frame(s) past 100ms after close`);
  }
  if ((closeFrames[closeFrames.length - 1]?.dialogs ?? 0) !== 0) {
    result.failures.push('slow-close: sheet never left');
  }

  // The remaining checks are per contiguous run of "a sheet is on screen". A
  // handoff scenario shows two different sheets in one cycle: they are allowed
  // to be different sizes and to hold focus in different places. What is not
  // allowed is either of those changing *within* one sheet's lifetime.
  const runs = [];
  let runLabel = null;
  for (const f of frames) {
    if (f.dialogs === 0) {
      if (runs.length && runs[runs.length - 1].length) runs.push([]);
      runLabel = null;
      continue;
    }
    if (!runs.length || f.label !== runLabel) {
      if (runs.length && runs[runs.length - 1].length) runs.push([]);
      else if (!runs.length) runs.push([]);
      runLabel = f.label;
    }
    runs[runs.length - 1].push(f);
  }

  // focus-jump: once focus is inside the panel it must stay on that control.
  // Moving it again is, on iOS, the keyboard opening and immediately closing —
  // a visualViewport resize, i.e. every dvh box repainting. Bounded to the
  // window between opening and the next click, because clicking a control
  // inside the sheet is *supposed* to move focus to it.
  const settled = [
    ...new Set(frames.slice(0, afterOpen).filter((f) => f.inPanel).map((f) => f.active)),
  ];
  if (settled.length > 1) result.failures.push(`focus-jump: ${settled.join(' -> ')}`);

  for (const run of runs) {
    if (run.length < 2) continue;

    // layout-churn: the panel's own box must not resize while it animates.
    const heights = new Set(run.map((f) => f.panelH));
    const margins = new Set(run.map((f) => f.panelMB));
    if (heights.size > 1) {
      result.failures.push(`layout-churn: panel height ${[...heights].join('/')} while animating`);
    }
    if (margins.size > 1) {
      result.failures.push(`layout-churn: panel margin-bottom ${[...margins].join('/')}`);
    }
  }

  results.push(result);
}

await context.close();
await browser.close();

let fail = 0;
let skipped = 0;
for (const r of results) {
  if (r.skipped) {
    skipped++;
    console.log(`[skip] ${r.name} — ${r.skipped}`);
    continue;
  }
  if (r.failures.length > 0) {
    fail++;
    console.log(`[FAIL] ${r.name}`);
    for (const f of r.failures) console.log(`         ${f}`);
  } else {
    console.log(`[ ok ] ${r.name}`);
  }
}

console.log(
  fail === 0
    ? `\nAll sheets open and close cleanly.${skipped ? ` (${skipped} skipped)` : ''}`
    : `\n${fail} scenario(s) flicker.`,
);
process.exit(fail === 0 ? 0 : 1);
