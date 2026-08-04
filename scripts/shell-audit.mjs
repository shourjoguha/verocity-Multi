// Shell audit — the standing guard for the app shell's one load-bearing
// invariant: THE DOCUMENT DOES NOT SCROLL.
//
// Why that is worth a check of its own. Anything pinned to the viewport's
// BOTTOM edge is positioned by WebKit against iOS Safari's LAYOUT viewport,
// which lags the VISUAL one for the whole of a scroll-down while the address
// bar retracts. The tab bar was stranded ~69px above the bottom with page
// content running on underneath it, and snapped home on the first scroll up.
// `position: fixed` does this. `position: sticky` ALSO does this — that was
// shipped as the fix, and did not fix it. The lag exists only because the root
// scroller scrolls, so App.astro's shell takes the scrolling away from the
// document and gives it to `[data-scroll-root]`. See docs/LESSONS.md.
//
// WHAT IT CANNOT SEE — read this before citing a green run as evidence:
//   - THE BUG. The symptom is a WebKit-only viewport lag; Chromium has no such
//     lag, so a naive "is the bar at the bottom of the screen" assertion is
//     GREEN ON THE BROKEN BUILD. Verified: against the pre-fix commit this
//     script fails checks A, B and C and passes D. Only a phone can observe
//     the symptom stopping.
//   - Whether the bar looks right: colour, shadow direction, safe-area padding.
//   - Any route not listed in ROUTES, and any state behind an interaction.
//
// Usage:  npm run build && npm run preview &   then   npm run audit:shell
// Override the origin with BASE=http://localhost:4322 npm run audit:shell
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';

// Enough of the app to catch a layout regressing on one surface only. The
// Logger is deliberately included: it is immersive (no tab bar) but owns the
// other bottom bar, the Finish bar, which had the identical bug.
const ROUTES = ['/app', '/app/stats', '/app/you', '/app/settings', '/showcase'];

// Three viewport heights, because the failure was a MISMATCH between two
// viewport sizes. A shell that only holds at the height it was authored
// against is the same bug wearing a different number.
const HEIGHTS = [852, 783, 667];

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

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 393, height: HEIGHTS[0] },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

await context.route('**/auth/v1/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }),
);
await context.route('**/rest/v1/**', (r) =>
  r.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': '0-0/0' },
    body: '[]',
  }),
);
await context.addInitScript(
  ([k, v]) => window.localStorage.setItem(k, v),
  ['sb-localhost-auth-token', JSON.stringify(session)],
);

const page = await context.newPage();
const failures = [];
const pass = (m) => console.log(`[ ok ] ${m}`);
const fail = (m) => {
  failures.push(m);
  console.log(`[FAIL] ${m}`);
};

for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // The fixtures are empty, so most routes render an empty state that fits on
  // one screen — and a page with nothing to scroll cannot exhibit a scrolling
  // bug. Force one that is genuinely taller than the viewport.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '4000px';
    spacer.dataset.shellAuditSpacer = '';
    document.getElementById('main')?.appendChild(spacer);
  });
  await page.waitForTimeout(150);

  for (const height of HEIGHTS) {
    await page.setViewportSize({ width: 393, height });
    await page.waitForTimeout(150);

    const r = await page.evaluate(() => {
      const doc = document.scrollingElement;
      const scroller = document.querySelector('[data-scroll-root]');
      // The drawer is also a <nav aria-label="Primary">; the bar is the one
      // that is not the drawer.
      const bar = document.querySelector('nav[aria-label="Primary"]:not(#nav-menu)');
      const at = [];
      if (scroller && bar) {
        const max = scroller.scrollHeight - scroller.clientHeight;
        for (const top of [0, Math.round(max / 2), max]) {
          scroller.scrollTop = top;
          at.push({
            top: scroller.scrollTop,
            bottom: Math.round(bar.getBoundingClientRect().bottom),
          });
        }
        scroller.scrollTop = 0;
      }
      // The page's own root, stepping over Astro's `display: contents`
      // `<astro-island>` — the element that made this necessary — and over the
      // box-less nodes it emits alongside the markup (`<template>`, scripts).
      const contentRoot = (el) => {
        for (const child of el.children) {
          const cs = getComputedStyle(child);
          if (cs.display === 'none') continue;
          if (cs.display === 'contents') {
            const inner = contentRoot(child);
            if (inner) return inner;
            continue;
          }
          if (child.getClientRects().length === 0) continue;
          return child;
        }
        return null;
      };
      const main = document.getElementById('main');
      const pageRoot = main ? contentRoot(main) : null;

      return {
        docScrollable: doc.scrollHeight - doc.clientHeight,
        scrollerScrollable: scroller ? scroller.scrollHeight - scroller.clientHeight : -1,
        barPosition: bar ? getComputedStyle(bar).position : 'MISSING',
        innerHeight: window.innerHeight,
        mainWidth: main ? Math.round(main.clientWidth) : -1,
        pageRootWidth: pageRoot ? Math.round(pageRoot.getBoundingClientRect().width) : -1,
        at,
      };
    });

    const tag = `${route.padEnd(16)} @${height}px`;

    // A — the document must not scroll. This is the whole fix: a page the root
    //     scroller cannot scroll never makes Safari retract its address bar,
    //     so the layout and visual viewports never diverge in the first place.
    if (r.docScrollable > 1)
      fail(`${tag}  document scrolls by ${r.docScrollable}px — the shell is not in effect`);
    else pass(`${tag}  document not scrollable`);

    // B — with the document still, nothing may re-introduce a viewport-relative
    //     bottom offset for the platform to resolve late.
    if (r.barPosition === 'fixed' || r.barPosition === 'sticky')
      fail(`${tag}  bottom bar is position:${r.barPosition} — anchored to the viewport again`);
    else pass(`${tag}  bottom bar position:${r.barPosition}`);

    // C — the scrolling has to have gone somewhere, or the page is simply cut off.
    if (r.scrollerScrollable < 1000)
      fail(`${tag}  [data-scroll-root] scrollable by only ${r.scrollerScrollable}px`);
    else pass(`${tag}  [data-scroll-root] scrolls (${r.scrollerScrollable}px)`);

    // E — the page's root must FILL the scroller, not fit its content. An
    //     overflow check cannot see this: when `#main` was a flex container,
    //     Astro's `display: contents` island made each page's `mx-auto` root a
    //     flex item, auto margins stopped it stretching, and it took
    //     `fit-content` — NARROWER than the viewport here, and clamped to
    //     `max-w-3xl` (768px) on a real phone where the fonts are wider. Both
    //     are the same defect; only this assertion catches the narrow one.
    if (r.pageRootWidth < 0) fail(`${tag}  no page root under #main`);
    else if (Math.abs(r.pageRootWidth - r.mainWidth) > 1)
      fail(`${tag}  page root is ${r.pageRootWidth}px inside a ${r.mainWidth}px #main — sized to content, not stretched`);
    else pass(`${tag}  page root fills #main (${r.pageRootWidth}px)`);

    // D — and the bar stays put. Green on the broken build too (see the header);
    //     it is here to catch a plain layout mistake, not the viewport lag.
    const off = r.at.filter((s) => Math.abs(s.bottom - r.innerHeight) > 1);
    if (off.length)
      fail(
        `${tag}  bar bottom ${off.map((s) => `${s.bottom}@${s.top}`).join(', ')} vs viewport ${r.innerHeight}`,
      );
    else pass(`${tag}  bar bottom == ${r.innerHeight} at scrollTop ${r.at.map((s) => s.top).join('/')}`);
  }
}

await browser.close();

if (failures.length) {
  console.log(`\n${failures.length} failure(s).`);
  process.exit(1);
}
console.log('\nShell invariants hold. This does NOT mean the iOS symptom is gone — see the header.');
