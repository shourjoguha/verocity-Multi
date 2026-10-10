// Tiny stale-while-revalidate cache shared across the read-path islands. Under
// Astro's ClientRouter the JS realm is preserved across tab navigations, so a
// module-level Map survives tab switches — a revisited tab can paint last-known
// data instantly while the loader revalidates in the background. A full reload
// starts from the small persisted subset (persistedCache.ts). Cleared on
// sign-out so a
// different user never sees the previous session's rows (RLS is still the
// server-side boundary).
import { PERSISTED_KEYS, clearPersisted, restorePersisted, writePersisted } from '@/lib/persistedCache';

// Seeded from localStorage for the few keys Home paints from — see
// persistedCache.ts for what is kept, for whom, and when it is wiped.
const cache = new Map<string, unknown>(restorePersisted());

export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

// A Home load sets three persisted keys back to back; write them once.
let writeQueued = false;

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value);
  if (!PERSISTED_KEYS.has(key) || writeQueued) return;
  writeQueued = true;
  queueMicrotask(() => {
    writeQueued = false;
    writePersisted(cache);
  });
}

// Bumped by every clear. A read that started before a clear (a log write, a
// sign-out) must not write its now-stale result back afterwards; logStore
// compares generations before storing.
let generation = 0;

export function cacheGeneration(): number {
  return generation;
}

export function clearQueryCache(): void {
  cache.clear();
  clearPersisted();
  generation++;
}
