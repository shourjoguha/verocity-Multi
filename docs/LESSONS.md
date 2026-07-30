# Lessons

Traps this codebase has already sprung, and the decisions taken in response.

**Read this before debugging anything that smells familiar** — a flicker, a
stutter, a blink, a hang, stale content, an overlap, a build step that "should"
work.

**How to use it:** grep the symptom, not the cause. Entries lead with the
observable symptom for exactly that reason:

```
grep -i flicker docs/LESSONS.md
grep -i stale   docs/LESSONS.md
```

**Every entry carries a confidence tag.** This matters more than it looks: a
five-round bug hunt was prolonged because reasoned-from-the-spec guesses read
exactly like measured facts, so four of them looked settled when none was.

| Tag | Means |
|---|---|
| `[confirmed in the wild]` | The symptom was observed to stop on a real device or in production. |
| `[measured in Chromium]` | Reproduced and measured in the local harness. The engine that showed the bug may differ. |
| `[argued — not reproduced]` | Reasoned from documented engine behaviour. Never observed directly. Treat as a hypothesis. |

**How to add:** append to the right section, symptom first, tag it, keep it
under ~8 lines, name the files. If you spent more than twenty minutes on
something, or you were wrong before you were right, it belongs here. If a later
fix supersedes yours, **move the old entry to Superseded** rather than leaving
two live answers — see that section for why.

---

## Rendering & animation

### A sheet flickers, stutters, blinks or hangs — and an in-flow form does not
`[confirmed in the wild]` for the symptom; `[argued — not reproduced]` for the
compositing mechanism, which was never reproduced outside WebKit.

Sheets open and close **exactly like the ordinary in-flow forms** on the same
screens: mounted while `open`, one CSS keyframe on the panel's transform,
removed immediately on close. No JS animation, no deferred unmount, and **the
full-viewport scrim does not animate at all** — a viewport-sized element
changing opacity is the one thing an in-flow form never does, and compositing
that over the fixed `.bg-backdrop` is work no form ever asks for.

Cost, accepted deliberately: no slide-out on close. The sheet goes when you tap.

Also load-bearing, both `[confirmed in the wild]`:
- **Do not move focus to a text field when a sheet opens on `(pointer: coarse)`.**
  It raises the iOS keyboard, and every keyboard transition resizes the visual
  viewport — relayouting every `dvh` box and the fixed backdrop behind the
  sheet. Focus the panel itself (`tabIndex={-1}`). Desktop keeps the convenience.
- **Never lock scroll by toggling `document.body.style.overflow` on touch.**
  Making the document unscrollable is a viewport-state change in WebKit. Use the
  scrim's `overflow-hidden overscroll-contain` instead; see `src/lib/scrollLock.ts`,
  which keeps the document lock for `(pointer: fine)` only.

**The heuristic that actually solved it, and the reason this entry is one entry
and not six:** when two things on one screen do the same job and only one
misbehaves, port the mechanism from the one that works instead of tuning the one
that doesn't.
→ `src/components/ui/Modal.tsx`, `logger/SetEntrySheet.tsx`, `logger/MovementPicker.tsx`,
`sheet-rise` in `global.css`, `src/lib/scrollLock.ts`

### Whole page flashes ~1s after load, while sitting still
`[measured in Chromium]`
A JS entrance animation on server-rendered content. Astro paints the island's
HTML immediately; Motion then mounts, snaps every block to `opacity: 0` and
fades it back in — measured at **t=735ms**. The content was visible, then wasn't.
**Entrance animations on SSR content must be CSS**, with `animation-fill-mode:
both`, so the from-state holds from the first painted frame.
Distinguishing symptom: happens while *not* scrolling, and on every page.
→ `src/components/anim.tsx` (`PageStagger`/`Item`), `.stagger` in `global.css`

### Flicker on touch devices, fine on desktop
`[argued — not reproduced]`
`backdrop-filter` on an element that is opacity-animated, or fixed/sticky over
scrolling content, is documented to make touch Safari re-sample its backdrop
every frame.
**Gate every blur to `pointer-fine:` and go opaque on touch.** This applies to
modal scrims *and* to the always-present header, tab bar and drawer — the second
group is easy to forget and is what would make flicker appear on "every page".
→ `src/layouts/App.astro`, `ui/Modal.tsx`, `logger/SetEntrySheet.tsx`

### Something repaints constantly while scrolling
`[measured in Chromium]`
The header's hide-on-scroll originally compared each frame to the previous with a
4px deadzone; momentum scrolling walked through it and produced **18 class flips
in a one-second scroll**, each starting a 300ms transition.
**Scroll handlers need hysteresis and a tracked state variable** — commit to a
direction (24px) and only touch the DOM when the state actually changes.
Measure it: `MutationObserver` on the element, count flips per gesture.
→ `src/layouts/App.astro` (`setupNav`)

### A modal's effect re-runs on every parent render
`[measured in Chromium]`
Every caller passes `onClose` as an inline arrow, so an effect depending on it
tears down and re-runs constantly — releasing/re-taking the scroll lock and
bouncing focus out to the trigger and back. Measured 6 `body.style.overflow`
writes where there should be 2.
**Hold callbacks in a ref and key the effect on mount, not on a changing prop.**
Pass `{ preventScroll: true }` to every `focus()` — React's `autoFocus` does not,
and focusing inside a `fixed` sheet scrolls the page behind it.
→ `src/components/ui/Modal.tsx`, `logger/SetEntrySheet.tsx`

### Overlay is covered by the bottom nav
`[measured in Chromium]`
The tab bar is `z-50` and is rendered *after* `<main>`, so at equal z-index it
wins. Overlays sit at **`z-[80]`**; toasts at `z-[90]`.
Layer order: tab bar 50 · nav backdrop 60 · drawer 70 · sheets 80 · toasts 90.
Check with `elementFromPoint` at each control's centre, not by eye.
→ `src/layouts/App.astro`, `ui/Modal.tsx`

### A shadow applied to the bottom bar renders nothing at all
`[measured in Chromium]`
Every depth token in `global.css` casts **downward** — `--shadow-lift-rest`,
`--shadow-lift-hover` and all six `--hill-btn-*` values have positive Y. The tab
bar is pinned to `bottom-0`, so a downward cast paints below the viewport and is
simply not there. Adding `.lift` or `.lift-fixed` to it looks like a no-op.
**Use `.ledge` / `--shadow-ledge`** — the one upward-casting member, layers 1-2
being `--shadow-lift-rest` with Y negated, plus a top inset highlight so the bar
reads as a raised slab rather than a card that happens to sit at the bottom.
Both theme blocks define it; a light-only value is a silent dark-mode break.
`.lift` is doubly wrong here even after fixing the direction: its
`perspective(900px)` promotes a composited layer on the same element that
carries `pointer-fine:backdrop-blur-md` (see the touch-flicker entry above), and
it would make the bar a containing block for any future `fixed` **descendant**.
It would *not* break the bar's own positioning — only a transformed *ancestor*
does that, which is the plausible-sounding reason to avoid reaching for.
→ `src/styles/global.css` (`.ledge`), `src/layouts/App.astro`

### The bottom bar detaches and floats mid-screen while scrolling down on iOS
`[confirmed in the wild]` for the symptom; `[argued — not reproduced]` for the
mechanism and the fix, neither of which any local harness can observe.
Scrolling **down** on an iPhone left the tab bar stranded ~75px above the
bottom edge with page content running on underneath it, on every route.
Scrolling back **up** snapped it home, which is what makes it look like a paint
bug rather than a layout one.

`position: fixed` is resolved against iOS Safari's **layout** viewport. Scrolling
down collapses the toolbar and grows the **visual** viewport immediately, but
the layout viewport does not catch up until the gesture ends — so `bottom: 0`
means the bottom of a box that is now shorter than what is on screen. The
sticky header never had the problem, which is the tell.

**Pin bottom bars with `sticky bottom-0`, not `fixed bottom-0`.** A sticky box
is laid out in the document, so it tracks what is actually painted. It needs
three things: a full-height flex column (`min-h-svh`, not `dvh` — the small
unit does not move when the toolbar collapses), a `flex-1` sibling above it so
short pages still push it to the edge, and to be the **last in-flow child**.
Two consequences that look like bugs if you do not expect them: the column above
drops the bottom padding it used to reserve for the bar (the bar now occupies
real space at the document end), and `inset-x-0` must go — on a sticky box
`left`/`right` are sticky *constraints*, not offsets; the flex column already
stretches it full width.

Not tried, and rejected on sight: reading `visualViewport` and translating the
bar per frame. That is JS-driven motion on the scroll path — see "Something
repaints constantly while scrolling".
→ `src/layouts/App.astro`, `src/components/Logger.tsx` (the Finish bar, same fix)

### A stat tile is far taller than its font sizes predict
`[measured in Chromium at 375px]`
`StatCard` in a `grid-cols-3` gives each value ~88px of inner width at 375px. A
duration like `3h 52m` needs **120px** at the old `text-3xl`, so the value
silently wrapped to a second line and the tile stood at **125px** — 36px of that
was a wrap nobody designed. Shrinking the font alone does not fix it: at
`text-2xl` the same string still needs 96px and still wraps.
**Size a value to the width it actually has, not to how big it looks.** Measure
with a hidden `white-space: nowrap` probe in the real page (the loaded Clash
Display, not a fallback) before choosing a tier. `text-xl` + `px-2` on phones
fits a 2-digit-hour duration (93.5px in 95.7px) on one line, and both step back
up at `sm:` where nothing constrains the column.
Neither audit can see this: a wrap is not overflow and not a tap target, so
`audit:mobile` passes with the tile at either height.
→ `src/components/ui/primitives.tsx` (`StatCard`)

## Build & deploy

### A build step works locally and silently does nothing on Vercel
`[confirmed in the wild]`
Vercel auto-injects its own Astro adapter. An `astro:build:done` integration that
post-processes the output races the adapter's packaging **and loses** — with no
error. The service worker shipped with an unstamped `__BUILD_ID__` for a full
release this way.
**Emit generated files as routes** (`src/pages/<name>.<ext>.ts`), not as
files rewritten by a hook. Routes are ordinary build output that every adapter
already handles.
→ `src/pages/sw.js.ts`, `src/sw-source.js`, `src/sw.test.ts`

### Anything in `src/pages/` is a route
`[confirmed in the wild]`
Putting a `.test.ts` there made Astro try to prerender `/sw.test`, import vitest
at build time, and fail the build. Colocated tests go anywhere **except**
`src/pages/`.

### Hand-written CSS loses its unprefixed property
`[confirmed in the wild]`
Lightning CSS dropped plain `backdrop-filter` from a hand-authored rule and kept
only `-webkit-`. **Prefer a Tailwind utility/variant** over hand-rolled CSS for
anything needing prefixes.

## Caching

### A stat is stuck on a round number
`[measured in Chromium]`
Home's "Sessions" tile sat at exactly **30** and no new workout moved it. Not a
cache: the tiles were derived from `getRecentLogs(30)`, so `logs.length` was
reporting the page size. Total time and Top e1RM shared that window, which is
worse than frozen — both could go **down** after a workout as an old row fell
out. The streak and the ribbon read the unbounded `getAllLogs()`, so they kept
moving, which is what made it read as a caching bug rather than a query bug.
**A round, unmoving number is a `limit`, not a cache.** Check the query's page
size before clearing anything. Tiles that mean "all time" must read an
unbounded source; keep the windowed fetch for the list that wants a window.
→ `ProfileView.tsx`, `completedLogs` in `src/lib/stats.ts`

### A write lands in the database but not on the screen
`[argued — not reproduced]`
`queryCache.ts` is a module-level `Map`, and under ClientRouter the JS realm
survives every tab navigation — so it is only as fresh as its invalidation. Its
sole caller was `signOut()`. Writes were masked by the Logger finishing with
`window.location.href` (a new realm, empty Map), so the hole only opened when a
screen was reached **by link**. `createLog` / `updateLog` / `deleteLog` now
clear it. **Any island holding data in a module Map must be invalidated by the
write path, not by luck of a full page load.** A component that patches its own
state after an edit must write the cache too, or the edit reverts on the next
navigation.
→ `src/lib/queries.ts`, `src/lib/queryCache.ts`, `ProfileView.tsx`

### A loader that fails leaves stale numbers looking current
`[argued — not reproduced]`
`ProfileView`'s loader was an un-caught async IIFE. One rejected query and none
of its setters ran — including `setLoading(false)` — so a revisit seeded from
the cache kept painting last-known values with no spinner and no error, for as
long as the tab stayed open. Indistinguishable from "the stats are frozen".
**A seeded stale-while-revalidate view needs `try/catch/finally` and a visible
failure state**; silent staleness is the one outcome the SWR pattern must never
have.
→ `ProfileView.tsx`

### Users are stuck on a previous build
`[confirmed in the wild]`
The service worker serves HTML **stale-while-revalidate**, so the first view
after a deploy is always the previous build. Two things made that permanent:
- the cache name was a constant, so `activate`'s cleanup was dead code;
- the revalidation promise was never passed to `event.waitUntil`, so the worker
  could be killed before writing the fresh copy.
Stale HTML still boots, because it references content-hashed `/_astro/*` bundles
that are cache-first — so **a user can silently run an old app indefinitely, and
"my fix didn't work" may mean "my fix never shipped to that device"**. Check the
served `const CACHE` line before believing a UI bug survived a fix. On an
installed PWA, test the Vercel preview URL instead: a fresh origin has no worker.
→ `src/sw-source.js` (was `public/sw.js` — see the build-step entry above)

**Unresolved:** never demonstrated a client picking up a new build.
`registration.update()` was observed being called and never settling under
headless automation. If this bites again, the durable fix is network-first for
navigations rather than more patching of the update path.

## Testing & tooling

### `astro preview` serves a startup snapshot
`[confirmed in the wild]`
It does **not** pick up files rebuilt while it is running, which silently
invalidates any test that rebuilds mid-run. Three separate deploy investigations
were meaningless before this was spotted. Restart it after every `npm run build`.
**For anything involving a rebuild, serve `dist` with a server that reads from
disk per request**, and always assert the origin really changed.

### A guard that can pass while the thing it guards is broken
`[confirmed in the wild]` — twice now.
The first service-worker test asserted its token appeared *somewhere in the
file*; it passed happily while the cache name had been hardcoded back to a
constant, because the token sat in a comment. Later, `scripts/docs-audit.mjs`
indexed **itself**, so every identifier in its allowlist "resolved" — the check
vouched for exactly what it was built to catch.
**Pin assertions to the exact line that matters, then prove the test fails by
breaking the code on purpose.** An unproven guard is worse than none.
→ `src/sw.test.ts`, `scripts/docs-audit.mjs`

### A probe selector silently grabs the wrong nav
`[measured in Chromium]`
`App.astro` mounts **two** `<nav aria-label="Primary">` — the drawer and the
bottom tab bar. `querySelector('nav[aria-label="Primary"]')` returns the
drawer, so a probe asserting on the tab bar measured nine 44px drawer links and
reported the bar's active-tab marker missing when it was rendering correctly.
**Target the bar by `nav.ledge`.** More generally: when an assertion says an
element is absent, prove the selector matched the intended node before
believing it — an assertion that passes or fails by finding the wrong thing is
no assertion. (The duplicate landmark label is a real a11y smell in its own
right; two same-named landmarks are ambiguous to a screen reader.)
→ `src/layouts/App.astro`

### audit:mobile is green on a surface it never rendered
`[measured in Chromium]`
`fixtureFor()` in `scripts/mobile-audit.mjs` returns `[]` for the plans table, so
`getActivePlan()` resolves null and Home paints "No active plan." The Active-plan
card, the day rail and every other plan-dependent control are **absent from the
DOM the audit measures** — a rail of sub-44px chips would have shipped with
`small-targets=0` on all 22 combinations.
**Before citing a green run as evidence for a plan-driven surface, confirm the
surface was in the DOM.** Either extend the fixture, or run a throwaway probe
that seeds a plan (copy the auth/REST stubbing out of the audit; it needs no
credentials) and measure the nodes you actually changed. Same trap for saved
sessions and the movement library, whose fixtures are likewise thin.
→ `scripts/mobile-audit.mjs`

### What a standing check covers — and what it cannot
The three checks are deliberately narrow. **A green run means only what the
check measures.** Four sheet-flicker fixes shipped citing "183 tests, astro
check clean, all 20 audit combinations pass" — none of which can see a flicker.

| Command | Catches | Cannot see |
|---|---|---|
| `npm run audit:mobile` | horizontal overflow, sub-44px targets, on every `/app` route at two widths | **Opens no sheet and clicks nothing** — it loads routes. Its fixture has **no active plan**, so every plan-dependent surface renders its empty state and is never measured (see below). |
| `npm run audit:flicker` | scroll jump, `html`/`body` style writes on touch, two scrims at once, an animated scrim, a sheet lingering after the tap, focus moving after it settled, panel resizing mid-animation, a text field focused on open | **Chromium only.** Blind to the WebKit compositing and keyboard/viewport behaviour the original bug lived in. |
| `npm run audit:docs` | code identifiers in the docs that no longer resolve | Whether a rule is **true**. `.lift` resolves fine; that it is wrong advice for a modal panel is invisible to it. |

None is wired into CI; run them by hand. All three seed auth into localStorage
and stub Supabase REST, so none needs credentials.
Every assertion in the flicker probe has been shown to fail against the build
that had the bug — including its fallback for finding the panel, because an
assertion that passes by finding nothing is not an assertion.
→ `scripts/mobile-audit.mjs`, `scripts/flicker-probe.mjs`, `scripts/docs-audit.mjs`

## Superseded

Kept so the search path survives, **demoted so it stops reading as advice.**
Every line below was once a live entry with a confident prescription. A grep hit
here means "this was tried and is no longer how the code works."

The sheet flicker took five merged PRs. These were the wrong turns:

- **`.lift` fights JS-driven transforms → use `.lift-fixed`.** True while sheets
  were Motion-animated. Nothing in a sheet is JS-animated now. `.lift-fixed`
  survives for its resting shadow only.
- **Nested opacity: animate `y` on the panel, let the scrim carry the fade.**
  The scrim no longer fades.
- **Mount sheets permanently and toggle `open` so `AnimatePresence` can play the
  exit.** Reversed: sheets unmount the moment they close, and there is no exit.
- **Give the scrim `will-change: opacity` so its layer is created once.** There
  is no opacity animation to promote a layer for.
- **Stagger a sheet-to-sheet handoff by `SHEET_EXIT_MS` so two scrims never
  stack.** Fixed a real symptom — the page behind visibly *darkens* then lifts
  when one sheet opens another, composited alpha peaking near 0.96 against an
  intended 0.8. That constant is gone; with instant unmount there is no overlap
  to stagger, so the symptom cannot recur by that route.

**The meta-lesson.** Four of those five were real defects, individually correct,
and each shipped describing itself as the fix. An append-only log turned that
into five co-equal answers to one grep, four of them wrong, with the entry point
routing every future reader straight at the pile. Demote as you go.

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
- **Sheets have no exit animation.** Deliberate, not an oversight — see the
  first entry. Adding one back reintroduces the deferred unmount.
