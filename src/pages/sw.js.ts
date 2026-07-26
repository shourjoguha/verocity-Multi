// Emits /sw.js as a normal build route.
//
// This used to be a static file in public/ stamped by an `astro:build:done`
// integration. That worked locally and silently did nothing on Vercel, which
// auto-injects its own adapter — the adapter's output packaging and our hook
// both run at build:done, and ours lost. The deployed worker shipped with the
// literal `verocity-__BUILD_ID__` cache name, so `activate` never dropped the
// previous cache and clients kept being served the old build.
//
// Generating it as a route removes the ordering problem entirely: it is part of
// the normal build output that every adapter already knows how to emit.
import source from '../sw-source.js?raw';

export const prerender = true;

// Stable per commit on Vercel, per build elsewhere. Any value works as long as
// it changes when the deployed output changes — the service worker keys its
// cache on it and deletes every other cache on activate.
const BUILD_ID = (
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  Date.now().toString(36)
).slice(0, 12);

if (!source.includes('__BUILD_ID__')) {
  // Fail the build rather than ship a worker whose cache name never changes —
  // that is the exact failure this file exists to prevent, and it is invisible
  // at runtime until someone is stuck on a stale build.
  throw new Error('sw-source.js has no __BUILD_ID__ token to stamp');
}

export function GET() {
  return new Response(source.replaceAll('__BUILD_ID__', BUILD_ID), {
    headers: {
      'Content-Type': 'text/javascript',
      // The worker script must always be revalidated, or a deploy can go
      // unnoticed for as long as the browser is willing to reuse it.
      'Cache-Control': 'no-cache',
    },
  });
}
