// App-shell service worker (ROADMAP decision 3: installable shell, no offline
// data sync). Static assets are served from cache so tab switches don't wait on
// the network:
//   - content-hashed /_astro/* bundles are immutable → cache-first (a new build
//     emits new filenames, so this never serves stale code);
//   - navigations / HTML and other same-origin GETs → stale-while-revalidate
//     (instant from cache, refreshed in the background while online).
// Cross-origin requests (Supabase, fonts) are never intercepted.
// The token below is stamped at build time by src/pages/sw.js.ts, which emits
// this file as the /sw.js route. A cache name that changes per deploy is what
// makes the `activate` cleanup fire: with a constant name the old cache is
// never dropped, the worker never reinstalls, and pages keep being served one
// build stale — silently, because the hashed /_astro/* bundles they reference
// are still cached. Do not inline a literal here; sw.test.ts asserts the token
// is present on exactly this line.
const CACHE = 'verocity-__BUILD_ID__';
const SHELL = [
  '/',
  '/app',
  '/app/stats',
  '/app/coach',
  '/app/plan',
  '/app/sessions',
  '/app/library',
  '/app/settings',
  '/app/you',
  '/login',
  '/showcase',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).then(() => warmScripts(cache).catch(() => {})))
      .then(() => self.skipWaiting()),
  );
});

// Cache the JavaScript every SHELL page needs, not just its HTML. The HTML was
// already precached, but each tab's island chunks were only cached on first
// visit — and every deploy renames them and drops the old cache, so after each
// deploy the first tap on each tab waited on the network for its code. Link
// prefetch could not help: it fetches HTML only, and on touch its "hover"
// trigger fires at the tap itself.
//
// Walks static imports only (`import"./x.js"` / `from"./x.js"` in the built
// chunks). Dynamic imports — three.js, p5, exceljs — are deliberately not
// followed: they are large and most sessions never load them. Runs inside
// `install`, so the previous worker keeps serving until this finishes, and a
// failure here never fails the install. Skipped when the user has asked the
// browser to save data.
const SCRIPT_IN_HTML = /\/_astro\/[^"'\s>]+\.js/g;
const STATIC_IMPORT = /(?:import|from)\s*"\.\/([^"]+\.js)"/g;

async function warmScripts(cache) {
  if (self.navigator.connection && self.navigator.connection.saveData) return;
  const seen = new Set();
  let next = [];
  for (const path of SHELL) {
    const page = await cache.match(path);
    if (!page) continue;
    for (const [src] of (await page.text()).matchAll(SCRIPT_IN_HTML)) next.push(src);
  }
  while (next.length > 0) {
    const level = [...new Set(next)].filter((src) => !seen.has(src));
    level.forEach((src) => seen.add(src));
    next = [];
    await Promise.all(
      level.map(async (src) => {
        let response = await cache.match(src, { ignoreVary: true });
        if (!response) {
          response = await fetch(src);
          if (!response.ok) return;
          await cache.put(src, response.clone());
        }
        for (const [, rel] of (await response.text()).matchAll(STATIC_IMPORT)) next.push('/_astro/' + rel);
      }).map((p) => p.catch(() => {})),
    );
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first: serve immutable hashed assets from cache, fall back to network
// (and store) on a miss.
//
// `ignoreVary`: a server that sends `Vary: Origin` (astro preview does) makes
// the page's module request — which carries an Origin header — miss every
// entry stored by warmScripts' own fetch, which does not. Measured: all 13 of
// Stats' chunks were in the cache and all 13 went to the network anyway. A
// content-hashed file is the same bytes whatever the request headers were.
function cacheFirst(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request, { ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
    }),
  );
}

// Stale-while-revalidate: respond from cache immediately when present, refresh
// the cache from the network in the background. An offline + uncached
// navigation falls back to the app shell.
//
// The revalidation MUST be handed to event.waitUntil. Returning `cached`
// settles respondWith immediately, and a service worker with no outstanding
// waitUntil is free to be terminated — killing the background fetch before it
// can write the fresh copy. That is how a page stayed stale across repeated
// visits instead of correcting itself on the next one.
function staleWhileRevalidate(event, request, isNavigation) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) return cache.put(request, response.clone()).then(() => response);
          return response;
        })
        .catch(() => cached || (isNavigation ? cache.match('/app') : undefined));
      event.waitUntil(network);
      return cached || network;
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, request, request.mode === 'navigate'));
});
