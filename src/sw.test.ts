import { describe, expect, it } from 'vitest';
import { GET } from './pages/sw.js';
import source from './sw-source.js?raw';

// The service worker's cache name has to change when the deployed output
// changes, or `activate` never drops the previous cache and clients keep being
// served the old build. That regressed once already — the worker shipped with
// the literal token because the build hook stamping it silently lost a race
// with Vercel's adapter — and it is invisible at runtime until someone is stuck
// on a stale build. These assertions are the tripwire.
// Lives at src/ rather than src/pages/ on purpose: anything under pages/ is a
// route, and Astro tried to prerender this file as /sw.test — importing vitest
// at build time, which fails the build.
describe('/sw.js', () => {
  // Deliberately pinned to the cache-name line, not just "somewhere in the
  // file". A looser check passes while the token sits in a comment and the
  // cache name has been hardcoded back to a constant — which is precisely the
  // broken state this is meant to catch.
  it('keeps the token on the cache-name line', () => {
    expect(source).toContain("const CACHE = 'verocity-__BUILD_ID__';");
  });

  it('emits a worker with no unstamped token left', async () => {
    const body = await GET().text();
    expect(body).not.toContain('__BUILD_ID__');
  });

  it('emits a concrete, non-empty cache name', async () => {
    const body = await GET().text();
    const match = /const CACHE = '([^']+)'/.exec(body);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^verocity-.+/);
    expect(match![1]).not.toContain('BUILD_ID');
  });
});
