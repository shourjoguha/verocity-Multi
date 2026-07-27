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

### Sheets flicker on a phone and in-flow forms on the same screen do not
Five rounds of fixes to the sheets' Motion setup each removed a real defect and
none of them settled it on an iPhone. What finally did: **stop animating the
sheets with JS and make them work exactly like the in-flow forms** — mounted
while open, one CSS keyframe on the panel's transform, removed immediately on
close. No Motion, no AnimatePresence, no deferred unmount.
The scrim does not animate at all. **A full-viewport element changing opacity is
the one thing an in-flow form never does**, and it was the last structural
difference between the two. Compositing a fading viewport-sized layer over the
fixed `.bg-backdrop` is work no form ever asks for.
Cost: no slide-out on close. The sheet goes when you tap, like the forms.
**When two things on one screen do the same job and only one misbehaves, port
the mechanism from the one that works instead of tuning the one that doesn't.**
→ `ui/Modal.tsx`, `logger/SetEntrySheet.tsx`, `logger/MovementPicker.tsx`, `sheet-rise` in `global.css`

### The background moves as a sheet opens, and it hangs ~1s before closing
Only on a phone, and only on sheets that contain a text field. The sheet was
focusing its first input a frame after the tap, which **raises the software
keyboard** — and every iOS keyboard transition resizes the visual viewport,
relayouting every `dvh` box and the fixed backdrop behind the sheet. Coming up
it moves the background mid-enter; going down on close it overlaps the 300ms
exit, so the sheet appears to hang. An in-flow form with `autoFocus` raises the
keyboard too and looks fine, because nothing there is `fixed`, animating, or
waiting on an exit — so the two never compound.
**Do not move focus to a text field when a sheet opens on `(pointer: coarse)`.**
Focus the panel itself (`tabIndex={-1}`) so screen readers still land inside.
It is better mobile UX regardless: the keyboard covers the sheet you just
opened. Desktop keeps the convenience.
→ `ui/Modal.tsx`, `logger/MovementPicker.tsx`, probe assertion `keyboard`

### The scrim's fade re-composites the fixed backdrop
An opacity animation on a full-viewport element promotes a compositing layer
when it starts and demotes it when it ends, and both re-composite the fixed
`.bg-backdrop` underneath.
**Give the scrim `will-change: opacity`** so the layer is created once at mount
and destroyed once at unmount, and the fade itself is compositor-only.
→ `ui/Modal.tsx`, `logger/SetEntrySheet.tsx`, `logger/MovementPicker.tsx`

### The background blinks as a sheet opens, and the drawer blinks as it closes
Two separate defects, both structural, both invisible to a still screenshot.
**The panel was a child of the opacity-animated scrim.** A full-viewport element
fading from 0 to 1 renders its entire subtree into an offscreen buffer every
frame — panel, border, shadow — and churns the compositing layer that the fixed
`.bg-backdrop` sits behind. Measured 30 frames per open/close cycle.
**And the scrim faded in 0.2s while the panel slid for 0.3s**, so on close the
wash was gone a measured 7 frames (~115ms) before the drawer had left: the
drawer spent its last frames against a bright, unscrimmed page.
**Make the scrim a SIBLING of the panel and give both the same duration.**
The useful tell: an ordinary in-flow form on the same screen never flickered —
if a sheet flickers and a plain form doesn't, suspect the overlay's structure,
not its animation.
→ `ui/Modal.tsx`, `logger/SetEntrySheet.tsx`, `logger/MovementPicker.tsx`

### A sheet flickers on open AND close, panel and background together (iOS)
Distinguishing symptom: both edges of the interaction, on every sheet, phone
only. The cause is the **scroll lock**, not the animation — `document.body.style
.overflow = 'hidden'` propagates to the viewport, and making the document
unscrollable is a viewport-state change in WebKit: the collapsed toolbar
expands and scroll is clamped. Both move `dvh`, and every panel is
`max-h-[85dvh]` over a `position: fixed` backdrop, so the panel resizes
mid-slide and the backdrop repaints — once on open, again on close.
**Lock structurally on touch** (`overflow-hidden overscroll-contain` on the
scrim swallows scroll chaining) and keep `overflow: hidden` behind
`(pointer: fine)`, where a wheel still needs it, with `scrollbar-gutter: stable`
so the desktop lock stops shifting the centred layout sideways.
Four earlier fixes chased the panel's own animation and verified clean because
**`npm run audit:mobile` never opens a sheet.** `npm run audit:flicker` does.
→ `src/lib/scrollLock.ts`, `ui/Modal.tsx`, `logger/SetEntrySheet.tsx`, `scripts/flicker-probe.mjs`

### A sheet disappears instantly instead of animating out
`AnimatePresence` lives *inside* `Modal`, so unmounting the component that
renders the `Modal` (`{x ? <Sheet/> : null}`) destroys the `AnimatePresence`
along with the child it was meant to animate out. The `exit` props are dead.
**Mount sheets permanently and toggle `open`.** A sheet that stays mounted can
no longer treat props as first-mount-only seeds — re-seed on the closed→open
transition, or the second thing you edit shows the first one's values.
→ `logger/SubroutineEditor.tsx`, `LibraryView.tsx`, `Logger.tsx`, `SessionsView.tsx`

### Focus lands in a sheet, then jumps a frame later
`panel.querySelector(FOCUSABLE)` returns the header's **Close** button — it is
first in DOM order — so "focus the first focusable" yanked focus off an
`autoFocus` input one frame after it arrived. On iOS that is the keyboard
opening and immediately closing: a `visualViewport` resize, i.e. every `dvh`
box and the fixed backdrop repainting.
**Skip the close control, and leave focus alone if it is already in the panel.**
Also: React's `autoFocus` calls `focus()` *without* `preventScroll`, which
scrolls the page behind a `fixed` sheet — focus via a ref instead.
→ `ui/Modal.tsx` (`data-modal-close`), `logger/SubroutineEditor.tsx`, `logger/MovementPicker.tsx`

### The background darkens then lifts when one sheet opens another
Closing sheet A and opening sheet B in the same commit leaves two
`fixed inset-0 bg-bg/80` scrims stacked for the length of the exit — composited
alpha peaks near 0.96 against an intended 0.8.
**Open the next sheet after the current one has left** (`SHEET_EXIT_MS` + a
frame; AnimatePresence removes the node on the frame *after* the animation
ends, so firing at exactly the duration still catches it).
→ `Logger.tsx` (`handoff`), `ui/Modal.tsx`

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

### Sheet open/close has a standing check
`npm run audit:flicker` opens and closes every sheet at 390×844 with touch
emulation and samples every frame: it fails on a scroll jump, any write to
`html`/`body` style on a touch device, two scrims at once, a missing exit
animation, focus moving after it settled, the panel's box resizing
mid-animation, the panel sitting inside an opacity-animated ancestor, or the
scrim clearing before the panel has left. Same credential-free fixtures as the
mobile audit. Not in CI; run it after touching anything overlay-shaped.
Every assertion has been shown to fail against the build that had the bug —
including the fallback that finds the panel in a build predating
`data-sheet-panel`, because an assertion that passes by finding nothing is not
an assertion.
**Its blind spot is the engine:** only Chromium is installed here, so the
WebKit-specific half (toolbar/`dvh`/scroll-clamp) is guarded, not demonstrated.
→ `scripts/flicker-probe.mjs`

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
