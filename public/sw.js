// App-shell service worker (ROADMAP decision 3: installable shell, no offline
// data sync). Static assets are served from cache so tab switches don't wait on
// the network:
//   - content-hashed /_astro/* bundles are immutable → cache-first (a new build
//     emits new filenames, so this never serves stale code);
//   - navigations / HTML and other same-origin GETs → stale-while-revalidate
//     (instant from cache, refreshed in the background while online).
// Cross-origin requests (Supabase, fonts) are never intercepted.
// __BUILD_ID__ is replaced at build time with a hash of the emitted site (see
// the swVersion integration in astro.config.mjs). A new cache name per deploy is
// what makes the `activate` cleanup below actually fire: with a constant name
// the old cache was never dropped, the SW never reinstalled, and every page was
// served one build stale — forever, silently, because the hashed /_astro/*
// bundles it referenced were still in cache. In `astro dev` the token is left
// as-is, which is fine: one stable dev cache.
const CACHE = 'verocity-__BUILD_ID__';
const SHELL = [
  '/',
  '/app',
  '/app/calendar',
  '/app/stats',
  '/app/coach',
  '/app/plan',
  '/app/sessions',
  '/app/library',
  '/app/settings',
  '/login',
  '/showcase',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

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
function cacheFirst(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
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
