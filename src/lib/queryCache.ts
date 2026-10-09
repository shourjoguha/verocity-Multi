// Tiny stale-while-revalidate cache shared across the read-path islands. Under
// Astro's ClientRouter the JS realm is preserved across tab navigations, so a
// module-level Map survives tab switches — a revisited tab can paint last-known
// data instantly while the loader revalidates in the background. In-memory
// only: a full reload (cold launch) starts empty. Cleared on sign-out so a
// different user never sees the previous session's rows (RLS is still the
// server-side boundary).
const cache = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value);
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
  generation++;
}
