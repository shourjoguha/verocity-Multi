# Lessons

Traps this codebase has already sprung, and the decisions taken in response.

**Read this before debugging anything that smells familiar** — flicker, stale
content, overlap, a build step that "should" work. Every entry below cost real
time to find; several were diagnosed wrong once or twice first.

**How to use it:** grep the symptom, not the cause. Entries lead with the
observable symptom for exactly that reason:

```
grep -i flicker docs/LESSONS.md
grep -i stale   docs/LESSONS.md
```

**How to add:** append to the right section, symptom first, keep it under ~8
lines, name the files. If you spent more than twenty minutes on something, or
you were wrong before you were right, it belongs here.

---

## Rendering & animation

### Sheets/modals stutter as they slide in
`.lift` sets a `transform` **and** `transition: transform .3s`. Motion animates
the same element's `y`/`scale` by writing an inline transform every frame, and
each write gets re-transitioned on top of the animation already running. The two
fight.
**Use `.lift-fixed`** (same resting shadow, no transform, no transition) on any
surface whose transform is driven by JS.
→ `src/styles/global.css`, `src/components/ui/Modal.tsx`, `logger/SetEntrySheet.tsx`

### A sheet flickers as it opens
Nested opacity. The panel is a child of the scrim, so it already fades with it —
animating the panel's own opacity too means the two multiply, and the panel gets
its own offscreen compositing layer. Measured mid-open: scrim 0.669 × panel
0.107 = an effective 0.07, across 12 frames. A `scale` on the same panel makes
it worse, re-rasterising its border and shadow every frame.
**Animate one property on the panel — `y`. Let the scrim carry the fade.**
Distinguishing symptom: only when a sheet opens, not on page load or scroll.
→ `src/components/ui/Modal.tsx`, `logger/MovementPicker.tsx`

### Whole page flashes ~1s after load, while sitting still
A JS entrance animation on server-rendered content. Astro paints the island's
HTML immediately; Motion then mounts with `initial="hidden"` and snaps every
block to `opacity: 0` before fading it back in — measured at **t=735ms** on a
fast machine, later on a phone. The content was visible, then wasn't.
**Entrance animations on SSR content must be CSS**, with `animation-fill-mode:
both`, so the from-state holds from the first painted frame and there is nothing
to yank. Never `initial="hidden"` on markup the server already rendered.
Distinguishing symptom: happens while *not* scrolling, and on every page.
→ `src/components/anim.tsx` (`PageStagger`/`Item`), `.stagger` in `global.css`

### Flicker on touch devices, fine on desktop
`backdrop-filter` on an element that is opacity-animated, or fixed/sticky over
scrolling content, makes touch Safari re-sample its backdrop every frame.
**Gate every blur to `pointer-fine:` and go opaque on touch.** This applies to
modal scrims *and* to the always-present header, tab bar and drawer — the second
group is easy to forget and is what makes flicker appear on "every page".
→ `src/layouts/App.astro`, `ui/Modal.tsx`, `logger/SetEntrySheet.tsx`, `logger/MovementPicker.tsx`

### Something repaints constantly while scrolling
The header's hide-on-scroll originally compared each frame to the previous with a
4px deadzone; momentum scrolling walked through it and produced **18 class flips
in a one-second scroll**, each starting a 300ms transition.
**Scroll handlers need hysteresis and a tracked state variable** — commit to a
direction (24px) and only touch the DOM when the state actually changes.
Measure it: MutationObserver on the element, count flips per gesture.
→ `src/layouts/App.astro` (`setupNav`)

### A modal's effect re-runs on every parent render
Every caller passes `onClose` as an inline arrow, so an effect depending on it
tears down and re-runs constantly — releasing/re-taking the scroll lock and
bouncing focus out to the trigger and back. Measured 6 `body.style.overflow`
writes where there should be 2.
**Hold callbacks in a ref and key the effect on `open` alone.** Pass
`{ preventScroll: true }` to every `focus()` so pulling focus can't scroll the page.
→ `src/components/ui/Modal.tsx`, `logger/SetEntrySheet.tsx`

### Overlay is covered by the bottom nav
The tab bar is `z-50` and is rendered *after* `<main>`, so at equal z-index it
wins. Overlays sit at **`z-[80]`**; toasts at `z-[90]`.
Layer order: tab bar 50 · nav backdrop 60 · drawer 70 · sheets 80 · toasts 90.
Check with `elementFromPoint` at each control's centre, not by eye.
→ `src/layouts/App.astro`, `ui/Modal.tsx`

## Build & deploy

### A build step works locally and silently does nothing on Vercel
Vercel auto-injects its own Astro adapter. An `astro:build:done` integration that
post-processes the output races the adapter's packaging **and loses** — with no
error. The service worker shipped with an unstamped `__BUILD_ID__` for a full
release this way.
**Emit generated files as routes** (`src/pages/<name>.<ext>.ts`), not as
`public/` files rewritten by a hook. Routes are ordinary build output that every
adapter already handles.
→ `src/pages/sw.js.ts`, `src/sw-source.js`, `src/sw.test.ts`

### Anything in `src/pages/` is a route
Putting a `.test.ts` there made Astro try to prerender `/sw.test`, import vitest
at build time, and fail the build. Colocated tests go anywhere **except**
`src/pages/`.

### Hand-written CSS loses its unprefixed property
Lightning CSS dropped plain `backdrop-filter` from a hand-authored rule and kept
only `-webkit-`. **Prefer a Tailwind utility/variant** over hand-rolled CSS for
anything needing prefixes.

## Caching

### Users are stuck on a previous build
`public/sw.js` serves HTML **stale-while-revalidate**, so the first view after a
deploy is always the previous build. Two things made that permanent:
- the cache name was a constant, so `activate`'s cleanup was dead code;
- the revalidation promise was never passed to `event.waitUntil`, so the worker
  could be killed before writing the fresh copy.
Stale HTML still boots, because it references content-hashed `/_astro/*` bundles
that are cache-first — so **a user can silently run an old app indefinitely, and
"my fix didn't work" may mean "my fix never shipped to that device"**. Check
`/sw.js`'s `const CACHE` line before believing a UI bug survived a fix.
→ `src/sw-source.js`

**Unresolved:** never demonstrated a client picking up a new build.
`registration.update()` was observed being called and never settling under
headless automation. If this bites again, the durable fix is network-first for
navigations rather than more patching of the update path.

## Testing & tooling

### `astro preview` serves a startup snapshot
It does **not** pick up files rebuilt while it is running, which silently
invalidates any test that rebuilds mid-run. Three separate deploy investigations
were meaningless before this was spotted.
**For anything involving a rebuild, serve `dist` with a server that reads from
disk per request** (see the pattern used in the deploy harness), and always
assert the origin really changed before trusting the result.

### A guard that can pass while the thing it guards is broken
The first version of the service-worker test asserted its token appeared
*somewhere in the file* — it passed happily while the cache name had been
hardcoded back to a constant, because the token was sitting in a comment.
**Pin assertions to the exact line that matters, then prove the test fails by
breaking the code on purpose.** An unproven guard is worse than none.
→ `src/sw.test.ts`

### Mobile regressions have a standing check
`npm run audit:mobile` loads every `/app` route at 375×812 and 390×844 and fails
on horizontal overflow or a sub-44px tap target. Needs no credentials — auth is
seeded into localStorage and Supabase REST is stubbed, so the Logger boots
against a real `LogDocument`. Not wired into CI; run it by hand after layout work.
→ `scripts/mobile-audit.mjs`

## Decisions

- **Bottom tab bar, not a drawer.** Seven destinations behind a top-left burger
  is the furthest point from a thumb. Four tabs + "More" (which keeps the
  drawer). The Logger opts out — it owns the bottom with its own Finish bar.
- **Set rows are read-only summaries.** All entry happens in `SetEntrySheet`,
  which tracks `visualViewport` to stay clear of the keyboard. The old inline
  editor could not fit a phone: three stepper fields plus a shrink-0 action
  cluster needed ~317px inside a ~283px box.
- **Completed movements park into a foldable "Done" pile**, deferred until you
  touch a *different* movement so nothing jumps mid-set. Collapsed groups must
  stay genuinely compact — dropping only the set rows while keeping the control
  cluster left them at ~166px and defeated the point.
- **44px targets, `TOUCH.minTargetPx`.** The glyph may stay small; the *target*
  may not. Exceptions live in `scripts/mobile-audit.mjs`'s allowlist and each
  carries its reason.
