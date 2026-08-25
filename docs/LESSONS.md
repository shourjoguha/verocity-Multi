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

### One route paints, blinks, and goes blank
`[reproduced in Chromium, and the symptom observed to stop]`
`/app/you` showed a blank screen; tapping the tab flashed the page in for about
half a second and it went blank again. Nothing was wrong with the data layer —
the server-rendered markup was correct and complete in `dist/app/you/index.html`,
which is exactly why it painted. Then the island hydrated and tore itself down.

**The ordering is the whole diagnosis.** *paint → blank* means SSR worked and
hydration killed it, so look for a **throw**, not for a query. React unmounts the
entire root on an uncaught render- or commit-phase error and leaves an empty
container; "the db wiring is off" is what it looks like from outside, and it is
never what it is.

**Two independent throws did it, and they were found by two people at once.**
Both are real; neither subsumes the other:

1. **Bad row shapes** (fixed first, in `getUserStats`). `user_stats.experience`
   is bare `text` with no check constraint — 0030 chose config over a constraint
   deliberately — while `UserStats` *types* it `ExperienceKey | null`. **The type
   is a claim about the schema, not about the data.** `EXPERIENCE_LEVELS[row.experience]`
   then read `.label`/`.blurb` off `undefined`. Normalised at the boundary, so
   one door covers every consumer instead of whichever callsite someone
   remembers. See `src/lib/userStatsRow.test.ts`.
2. **A `localStorage` READ that throws.** Not "returns null" — a `SecurityError`,
   on Safari with site data blocked, in some private-browsing configurations, and
   behind content blockers. `lib/theme.ts` (`getStoredPref`) and
   `applyBackground`'s **write** both guarded for this; the background **read**
   was hand-rolled unguarded in three components instead — `BackgroundPicker`,
   `BackgroundScene3D` and `YouView`. **Two of those three are mounted by
   `/app/you` and only by `/app/you`**, which is why one route was blank while
   every other one was fine. It now lives in one guarded
   `getStoredBackground()`, deliberately the twin of `getStoredPref()`. Three
   hand-rolled copies of a read is three chances to forget the `try`.

That two causes hid behind one symptom is the durable part: **stopping at the
first throw you can reproduce is how a page gets "fixed" twice and stays
broken.** Neither fix would have cured the other user's device.

**So `/app/you` now has an `ErrorBoundary`, and that matters more than either
fix.** `<details>` renders its children whether or not it is open, so the page
MOUNTS all seven of its sections on arrival — each with its own fetch and its own
render. It is the widest crash surface in the app and was the one heavy island
with no boundary above it. A boundary does not fix a bug; it converts an
undiagnosable blank into a message and a reload button — and a user cannot repair
the data that broke the page from a page that will not render.

To reproduce the storage class of failure at all, stub the **throw**; a fixture
where storage merely returns `null` exercises the happy path and proves nothing:
```js
await context.addInitScript(() => {
  const proto = Object.getPrototypeOf(window.localStorage);
  const orig = proto.getItem;
  proto.getItem = function (k) {
    if (k === 'verocity:bg') throw new DOMException('insecure', 'SecurityError');
    return orig.call(this, k);
  };
});
```
With that installed, `main.innerText` on `/app/you` was **empty** before the fix
and complete after it, while `/app` was unaffected in both runs. The same shape
of probe — feed the surface a hostile input, then assert `main` rendered — is
what found cause 1 as well.

**No standing check here can see any of this.** A blank page has no horizontal
overflow and no sub-44px tap targets, so `audit:mobile` and `audit:shell` are
green on it, as recorded below under "The whole page is blank, and two of the
three audits are green on it".
→ `src/lib/background.ts`, `src/lib/background.test.ts`,
`src/components/YouView.tsx`, `src/components/BackgroundPicker.tsx`,
`src/components/BackgroundScene3D.tsx`, `src/lib/queries.ts`,
`src/lib/userStatsRow.test.ts`

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

### A pinned backdrop is set on `<html>` and the 3D scene ignores it
`[measured in Chromium]` — verified the wrong artefact before the right one.
The showcase is pinned to the `dots` backdrop by the FOUC script in
`Base.astro`, which forces `data-bg="dots"` on `<html>`. The attribute was
correct — a test asserting it passed — and the screenshot still showed the
`aurora` WebGL scene stacked over the dots. `BackgroundScene3D` is a separate
island that re-derived the preference from **localStorage first**
(`raw ?? attr`), so a visitor whose stored preference was `aurora` re-booted the
3D scene regardless of the pin. On an ordinary page the attribute mirrors the
stored value, so the two never disagreed and the bug was invisible until a
surface deliberately overrode the attribute.
**The pre-paint attribute is the single source of truth for the backdrop; an
island must read the attribute, not re-read localStorage** — `attr ?? stored`,
not `stored ?? attr`. And when a pin sets an ancestor attribute, verify the
thing it is supposed to suppress is gone (a blank/absent canvas), not just that
the attribute reads what you wrote.
→ `src/components/BackgroundScene3D.tsx`, `src/layouts/Base.astro`

### Something repaints constantly while scrolling
`[measured in Chromium]`
The header's hide-on-scroll originally compared each frame to the previous with a
4px deadzone; momentum scrolling walked through it and produced **18 class flips
in a one-second scroll**, each starting a 300ms transition.
**Scroll handlers need hysteresis and a tracked state variable** — commit to a
direction (24px) and only touch the DOM when the state actually changes.
Measure it: `MutationObserver` on the element, count flips per gesture.
→ `src/layouts/App.astro` (`setupNav`)

The home activity strip is the pattern to copy when a scroll must drive a visual
change: the listener is `{ passive: true }` and does **one** thing — reset a
120ms timer. All the work happens after the gesture, the visible range is
arithmetic off `scrollLeft` (uniform pitch, so no `IntersectionObserver`), and
the result lands as a single inherited custom property on the row rather than a
write per bar. A 3% gate stops a one-bar nudge re-rendering. Measured at **0
style writes mid-gesture and 1 for the whole gesture**, with the
`MutationObserver` count above as the assertion.
→ `ActivityStrip` in `src/components/ProfileView.tsx`

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

### A sheet opens with its header off-screen, or anchored to the wrong box
`[measured in Chromium]`
`position: fixed` resolves against the nearest ancestor that has a transform —
and **a CSS animation that fills on `transform` makes an element a containing
block permanently**, even when the animation has finished and its `to` keyframe
says `transform: none`. `.stagger-item` runs `stagger-in` with
`animation-fill-mode: both`, so every staggered block on every page computes to
`transform: matrix(1, 0, 0, 1, 0, 0)` — an identity matrix, visually nothing, and
enough.

Any sheet rendered inside a `PageStagger` `Item` was therefore positioned against
that item rather than the viewport: measured on `/app/stats` at `top: -304px`,
header and Close button above the fold, `max-h-[85dvh]` correctly applied to a
panel nobody could reach the top of. It looked like a too-tall-content bug and
was not one — the panel and its internal scroll were both fine.

`Modal` now portals to `document.body`, which puts the overlay outside every
stagger wrapper at once. **Prefer the portal to hunting the ancestor**: the next
transformed parent is one `motion.div` away, and the failure is silent on short
sheets that happen to fit anyway. Confirm with
`getComputedStyle(el).transform !== 'none'` walking up from the overlay, not by
eye — an identity matrix looks like nothing in DevTools' visual overlay.
→ `ui/Modal.tsx`, `.stagger-item` / `@keyframes stagger-in` in `global.css`

### The page lays out wider than the screen and pans sideways
`[confirmed in the wild; the same defect measured in Chromium, smaller]`
Home rendered at **768px inside a 393px phone** — text at the correct size, but
every box twice as wide and the whole page pannable left/right. The tab bar was
unaffected and stayed exactly 393px, which is the tell: the bar sits outside
`[data-scroll-root]`, so whatever went wrong was inside it.

**Astro gives `<astro-island>` `display: contents`.** It has no box, so an
island's own root div is the direct child of whatever contains the island. When
`#main` was made `display: flex; flex-direction: column` (to let the Logger claim
the scrollport with `flex-1`), every page's root became a **flex item** — and
those roots all carry `mx-auto`. **A flex item with auto margins in the cross
axis does not stretch**: auto margins absorb the free space, so the item takes
`fit-content` instead. `fit-content` is `max-content` clamped by `max-width`,
and the max-width is `max-w-3xl` — **768px**. Real Clash Display and Satoshi push
max-content past that cap; the fallback fonts in the Chromium harness do not,
which is why the same build measured a mere 319px-wide root locally.

`#main` is a plain block again on every route but the Logger's, which opts in
with `.main-immersive` and whose root has no auto margins. **Reach for
`display: contents` and auto margins with care in the same subtree** — either
alone is fine, together they silently change which box does the sizing.

Two things this taught about detecting it:
- **An overflow check cannot see it.** In the harness the root was *narrower*
  than the viewport (319 < 393), so `scrollWidth` never exceeded the device
  width and `npm run audit:mobile` was green on the broken build. The assertion
  that catches it is "**the page root must FILL `#main`**", which fails on both
  the narrow local case and the 768px device case — same defect, one check.
- `overflow-y: auto` **computes the other axis to `auto` too**, which is what
  turned the overflow into something you could pan. `[data-scroll-root]` now
  sets `overflow-x: hidden` explicitly — `hidden`, not `clip`, so `scrollWidth`
  still reports the overflow and the audit can still see it.
→ `src/layouts/App.astro` (`#main`), `src/styles/global.css`,
`scripts/shell-audit.mjs` (check E)

### The bottom bar detaches and floats mid-screen while scrolling down on iOS
`[confirmed in the wild, measured from a device screenshot]`. Scrolling **down**
on an iPhone leaves the tab bar stranded above the bottom edge with page content
running on underneath it, on every route. Scrolling back **up** snaps it home,
which is what makes it look like a paint bug rather than a layout one.

Measured off a full-resolution iPhone 15 screenshot (1179×2556 → 393×852 CSS):
the bar's bottom edge at **783px** against a viewport of **852**, so **69px** of
live page content below it. Read it off the session cards' left accent stripes,
which run at a fixed 184-device-px pitch — one is cut off at the bar's top edge
and the next one's tail reappears below it, so the content is continuous and the
bar is genuinely mispositioned, not a repaint artifact. **Measure the gap before
theorising**: 69px is the height of the floating address bar, which is what
identifies the mechanism. Eyeballing "about 75px" identifies nothing.

Both `fixed` and `sticky` resolve `bottom: 0` against iOS Safari's **layout**
viewport. Scrolling down retracts the address bar and grows the **visual**
viewport immediately, but the layout viewport does not catch up — so `bottom: 0`
means the bottom of a box now shorter than what is on screen. The header never
had the problem because the viewport's **top** edge does not move; sheets never
had it because they are full-height overlays.

**The tell: it happens on a cold load and stops after an app switch.**
`[confirmed in the wild]` Safari establishes the layout viewport when the page
loads, sized for the EXPANDED toolbar. Retracting the toolbar does not
re-establish it, so the stale value persists for the rest of that page's life.
Backgrounding the app and returning forces a re-layout — and if you return while
scrolled down with the toolbar already retracted, the layout viewport is
re-established at the TALLER size, the two agree, and the bar behaves for the
rest of the session. Same reason a scroll **up** fixes it momentarily: it
re-expands the toolbar, so the stale number becomes the true one again.
Two consequences worth holding on to: **the bug lives in the first-load state**,
so a reproduction attempt that starts by switching away and back will find
nothing and conclude wrongly that it is fixed — and a symptom that clears on
app-switch is evidence of a **stale viewport**, not of a rendering fault, which
is what sends people looking at paint and compositing instead of layout.

**`sticky bottom-0` was shipped as the fix and does not work.** The reasoning
was that a sticky box is laid out in the document so it must track what is
painted — plausible, and wrong: WebKit positions sticky nodes on the scrolling
thread against the same lagging layout viewport. It survived review for months
because no local harness can observe the lag, and **Chromium is green on the
broken build** — a "is the bar at the bottom of the screen" assertion passes
there at every scroll offset while the phone is visibly broken.

**Stop the document from scrolling instead.** The lag exists only because the
root scroller scrolls: a page Safari cannot scroll never makes it retract
anything, so the two viewports never diverge and there is nothing left to chase.
`.app-shell` (global.css, opted into by `Base.astro`'s `shell` prop) gives
`html`/`body` `height: 100dvh; overflow: hidden`, and `App.astro` puts the
scrolling in an inner `[data-scroll-root]`. The tab bar is then an ordinary flex
child of a box whose bottom edge *is* the screen's bottom edge — no position, no
offset, nothing to resolve late. The Logger's Finish bar stays `sticky bottom-0`
and is fixed by the same change, because the scrollport it sticks to is now a
real element rather than the viewport.

Four things this drags along, each of which looks like a separate bug:
- **`100dvh`, never `height: 100%`.** On iOS the initial containing block is the
  *large* viewport, so `100%` resolves taller than the screen and pushes the bar
  back under Safari's chrome — the same symptom by another route.
- **The scroll lock has to follow.** `lib/scrollLock.ts` set `overflow: hidden`
  on `<body>`; under the shell that is already hidden and a wheel over the scrim
  still scrolled the page. It targets `[data-scroll-root]` now, capturing the
  element at acquire time so a ClientRouter swap mid-sheet cannot leave a
  different one stuck.
- **Back/forward scroll restoration has to be rebuilt.** ClientRouter restores
  `window` scroll, which no longer reaches anything. Two traps: the position must
  be filed under `e.from.pathname`, **not** `location.pathname` — on a traversal
  the browser has already moved `location` to the destination, so keying on it
  files the outgoing position under the incoming path and overwrites the entry
  you are about to read — and it must be re-applied across a few frames, because
  the island's content arrives after `astro:page-load` and a single assignment
  clamps to 0 against a scroller that is still one viewport tall.
- **Cost, stated plainly:** Safari's address bar no longer auto-hides, so that
  69px is gone for good in the browser. In the installed PWA there is no address
  bar and it costs nothing.

Not tried, and rejected on sight: reading `visualViewport` and translating the
bar per frame. That is JS-driven motion on the scroll path — see "Something
repaints constantly while scrolling".

`npm run audit:shell` guards the invariant. Read its header before citing it:
it asserts the document does not scroll and the bar carries no viewport-relative
position — both of which fail against the pre-fix commit — but it **cannot see
the symptom**, because the lag is WebKit-only. A phone is the only place this
was observed to stop.
→ `src/styles/global.css` (`.app-shell`), `src/layouts/App.astro`,
`src/layouts/Base.astro`, `src/lib/scrollLock.ts`,
`src/components/Logger.tsx` (the Finish bar), `scripts/shell-audit.mjs`

### A read-only mirror of the app drifts into an old build
`[confirmed in the wild]` — the public showcase sat months behind `/app`.
`/showcase` was not a read-only VIEW of the app, it was a parallel
implementation: five hand-written pages against the app's seventeen, a second
nav and ribbon hardcoded in `App.astro`, and thirty-odd `mode === 'app'`
branches hiding features that read perfectly well without a session. Each of
those is a place a human has to remember to mirror, and the failure is silent —
nothing breaks, the public page just quietly stops being the product.
**A read-only surface must be the SAME code with a different client, never a
second implementation.** The fix was three collapses, and the shape generalises:
one module deriving the surface (`src/lib/surface.ts`), one route table the nav
and the router both read, and views that take a `mode` rather than a private
copy. What is left to remember is one row per new page instead of four places.
Two traps inside that:
- **`mode` defaulting to `'app'`** means every new component is wrong on the
  showcase until someone notices. Default it to the surface — but pass it
  EXPLICITLY from the page for anything server-rendered, or the island renders
  app markup on the server and showcase markup after hydration.
- **A disabled write control still leaks its `href`.** `preventDefault` stops
  the click, and the anchor still advertises `/app/log?...` on a public page to
  anyone reading the DOM or browsing with JS off. Neutralise the href too, not
  just the handler.
No audit sees any of this: `audit:mobile` only walks `/app/*`, and every check
was green for the whole time the showcase was stale.
→ `src/lib/surface.ts`, `src/layouts/App.astro`, `src/pages/showcase/[...slug].astro`

### A canvas wordmark reads on a desktop and is mush on a phone
`[measured in Chromium at 1280px and 375px]` — got this wrong twice.
`ForceFieldCanvas` samples a brightness map — the word rendered into an
offscreen buffer — on a particle grid. Its type is sized to the surface, so on
a phone the word shrinks (a `13vw` heading goes 160px → 48px) while anything
fixed in **pixels** does not. Every such constant broke the same way, and each
looks like "the effect is broken" rather than "one number does not scale":
- **Pitch.** Fixed at 8px/12px, barely one particle spanned a 17px letter
  stroke. Derive it from the fitted type size, not the viewport and not the
  input device: `spacing = constrain(fittedSize / 22, 5, 10)` puts the same
  number of particles across a stroke at every size.
- **Dot weight.** Fixed at 1.2–5.5px, a 5.5px dot on a 5px pitch overlaps its
  neighbours and the word turns to porridge. Make it a share of the pitch
  (`0.16`–`0.85`), which also lands on the old values at the desktop pitch, so
  nothing that already looked right moves.
- **Blur.** A radius wide relative to the stroke pulls the letter **interiors**
  below full brightness — and interiors are where the ink and the fattest dots
  come from, so the wordmark renders as a hollow outline. 3px was invisible at
  160px type and hollowed the same word at 48px. Also a share of the pitch.
Separately, and not a scaling problem: a map whose background is pure black
leaves every particle off the letters below any threshold, so the band is bare
and the cursor does nothing until it crosses a glyph — the "force field" reads
as a hole punched in some text. A low floor (26/255) instead of 0 gives the
whole band a faint ambient field, which is what makes the *whole* band the
interaction surface.
No audit can see any of this: it is legibility, not overflow and not a tap
target, and neither `audit:mobile` nor `audit:flicker` visits `/`. Screenshot
it, at both widths, in both themes.
→ `src/components/ForceFieldCanvas.tsx`

### A particle wordmark crossfades in and the swap visibly pops
`[measured in Chromium at 1280px and 375px]`
The landing hero keeps its real `<h1>` — it is the heading, and it is what a
reduced-motion or pre-hydration visitor sees — then fades it out as the particle
field paints the same word. Three things have to coincide or the swap reads as
a jump, and only the first is obvious:
- **Position.** Solved by geometry, not measurement: the canvas is a band
  *wrapping the heading*, and the word is drawn at the canvas centre, so the two
  coincide by construction. Do not reach for measuring the heading against the
  section box.
- **Size.** The heading is `13vw`; the canvas sized its word to the band height.
  Pass the heading's **computed** `font-size` (a `ResizeObserver`, because it
  moves with the viewport) rather than trying to express one scale twice.
- **Tracking.** `g.text()` applies none of the heading's `letter-spacing`, so a
  tracked heading and an untracked particle word are different widths — 8
  characters at `-0.05em` is ~20px at desktop size. Set
  `drawingContext.letterSpacing` on the offscreen buffer.
And a fourth, which is about the plate rather than the word: an **absolutely
positioned** backdrop with negative insets paints over its siblings. It ate the
eyebrow above and the first line of the paragraph below. Give the stage a margin
that reserves exactly what the plate bleeds into, and fade the plate's edges
(`mask-image`) so it does not sit on the page as a hard rectangle.
→ `src/components/Landing.tsx`, `src/components/ForceFieldCanvas.tsx`

### A canvas particle loop drops to 22fps, and the particle count is only half of it
`[measured in headless Chromium at 1280x900]`
Rendering the landing hero's small copy as particles needed a 3px pitch, which
took a full-hero field from ~18k particles to ~108k, and the loop visibly
stalled. Reverting the pitch was the obvious half of the fix and it was **not
enough** — back at ~18k the loop still ran at 22–26fps against a 60fps
baseline on the same page with the canvas removed.
**Find out whether it is the maths or the draw calls before optimising
either.** Commenting out the three draw calls while leaving the physics intact
took it straight to 60fps: the entire cost was rendering, none of it was the
force integration. Two things then mattered, in this order:
- **Draw fewer things.** Sample density should follow INFORMATION density. A
  uniform grid over a full-hero canvas spends ~85% of itself on ambient dust at
  the field floor — ~1px dots nobody can resolve, each costing exactly what an
  ink dot costs. Full grid inside the letterforms, every other cell outside,
  and the picture is unchanged while the count falls by ~60%. That alone took
  26fps → 60.
- **Batch state changes.** `stroke()` + `strokeWeight()` + `point()` per
  particle is ~54k canvas state changes a frame. Quantising shade and radius to
  a 16×16 grid and drawing each bucket as one path with one `fillStyle` is a
  couple of hundred. Worth doing, but on its own it only bought 23→26fps —
  which is why the measurement above has to come first.
The eye cannot resolve 18k distinct greys and radii on soft dots, so the
quantisation is free visually; the thinning is free because the dust it removes
was below the resolution limit anyway.
→ `src/components/ForceFieldCanvas.tsx` (`generatePoints`, the BUCKETS block)

### p5's `text()` has two signatures that anchor differently
`[measured in Chromium at 1280px]`
Making the particle field carry more than one text source needed each source's
position measured from the DOM and drawn at that position in the offscreen
buffer. First cut anchored every source with `textAlign(CENTER)` at
`x + width/2`. The wordmark landed correctly. The paragraph didn't — its centre
of gravity was ~330px to the right of where the DOM box sat.
p5 has two `text()` signatures and they anchor differently, and only one of
them cares about textAlign for POSITIONING:
- `text(str, x, y, w, h)` — the wrapping form. `(x, y)` is the box's TOP-LEFT.
  `textAlign` decides how each wrapped line sits inside the box; the box itself
  does not move.
- `text(str, x, y)` — the anchor form. `textAlign` moves the anchor point:
  CENTER means `(x, y)` IS the string's centre.
Pass a paragraph's DOM `left/top` verbatim to the wrapping form; compute the
`left + width/2` anchor only for the single-line form. Signal wrapping intent
with a `height`, not a `width` — a heading with `whitespace-nowrap` also has a
width, but it must not wrap.
→ `src/components/ForceFieldCanvas.tsx` (`drawSource`)

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

### One card expands but nothing collapses — the row reads as "no animation"
`[measured in Chromium at 375px and 390px]`
Home's plan-day rail tweened `max-width` alone: active `max-w-[190px]`, inactive
`w-11 max-w-11`, on `transition-[max-width,…]`. The active card had **no explicit
`width`**, so it shrink-wrapped its content the instant the class flipped and only
the 190px *cap* glided — and the collapsing card went from `width: auto` to a
fixed 44px with `width` untransitioned, so it **snapped on frame one**. Half the
motion was missing and the half that survived was invisible for any label under
the cap.
**Animate `flex-grow` on siblings that share one flex free-space pool.** Give
every card `flex-basis: 2.75rem` (`TOUCH.minTargetPx`) and `flex-grow: 0`, and
the active one `flex-grow: 1`. The collapsing card then hands its width *directly*
to the expanding one: synchronised by construction rather than by matching two
durations, and the row's total width is the container's on every frame — which is
also what makes it fit the card above it without measuring anything.
Measured mid-flight at t=150ms of a 320ms tween: the collapsing card gave 72.7px
and the expanding card took 72.7px, at 45% of the total move. The row measured
338px at rest, mid-tween and settled.
Note the shape of the win: `max-width` was chosen because it *looked* animatable,
but the property that actually decides the box was `width`, and nothing was
transitioning it. **Tween the property that determines the layout, not a
constraint on it.**
→ `.day-card` in `src/styles/global.css`, `DayAccordion` in `src/components/ProfileView.tsx`

### A toggle's label promised a schema switch it didn't perform
`/app/plan/upload`'s only toggle was labelled "Upload as minis". It did not
change what was being uploaded — the input was always a plan-shaped CSV; on,
it reinterpreted each parsed plan day as a short session attached to the
active plan. Users reasonably read "Upload as minis" as a schema switch (plan
CSV vs. session CSV) and got confused when session-shaped input still failed
plan validation.
**A toggle's label is a claim about what changes when it's flipped — make the
label match the mechanism, not the intent.** Replaced with a `Plan | Sessions`
target toggle that actually swaps the prompt, template, parser and save path
(`buildSessionAiPrompt`/`parseSessionTabular`/`createSession` vs. their
plan-side equivalents in `src/lib/sessionTemplate.ts` and
`src/lib/planTemplate.ts`); sessions now save as N standalone `sessions` rows
with no active-plan gate.
→ `src/components/PlanUpload.tsx`, `src/lib/sessionTemplate.ts`

### The tail of the "g" in "kg" is sheared off
`[confirmed in the wild]` — reported by a user, on a surface four audits pass.
`truncate` is `overflow: hidden` plus `text-overflow: ellipsis`, and it clips
BOTH axes, not just the horizontal one people reach for it for. Pair it with
`leading-none` and the line box is exactly 1em while the face needs ~1.15em for
ascender plus descender, so every descender is trimmed by roughly a pixel and a
half. Archivo Black makes it obvious because its descenders are deep and the set
value is `text-xl`.
**`truncate` and `leading-none` on the same element is a bug wherever the text
can contain a descender.** Give the line box room (`leading-tight` was enough
here) rather than reaching for `overflow-visible`, which defeats the truncation.
Uppercase text is only accidentally safe — a `text-transform` does not stop a
`Q` or a comma descending.
No check here can see it: `audit:mobile` measures overflow and tap targets,
`audit:flicker` exercises sheets, and a screenshot only catches it if you read
the glyphs rather than the layout. Grep is the real guard —
`grep -rn "truncate" src/ --include=*.tsx | grep "leading-none"` must come back
empty.
→ `src/components/logger/SetRow.tsx`

### Dark-theme cards dissolve into the page while the light theme looks fine
`[confirmed in the wild]` — reported on the Logger, where movement cards stopped
reading as objects sitting on the background.
The two themes were authored to the same token ROLES and the same *lightness
steps*, which is exactly the trap: **contrast is a ratio, not a difference in
lightness, and the ratio collapses at the dark end.** Paper put 5 points of L
between `--color-bg` (95%) and `--color-surface` (100%) and bought 1.117:1.
Carbon put 3.5 points between #050505 and #0E0E0E and bought **1.055:1 — barely
half the separation**, from numbers that look comparable in the file. The same
halving hit `surface → elevated` (1.076:1 against paper's 1.225:1), so tracks,
hover fills and pressed rows flattened too.
**Derive a dark value from the light theme's RATIO, never from its step.**
Matching paper took surface #141414 and elevated #242424 — both far lighter than
the reference palette's hexes, which are correct as a starting point and wrong
as a destination. There is a ceiling: `--color-border` at `0.14` white
composites to ≈15.7% over the page, so an `elevated` above ~15% swallows the
hairline on `.hill-btn[aria-pressed='true']`, which is filled *and* outlined.
No check in this repo can see any of it — `audit:mobile` measures overflow and
tap targets, `audit:flicker` exercises sheets, and neither reads a colour. The
guard is to measure: render the real markup under `data-theme='dark'`, sample
the painted `backgroundColor`s and compute the ratio against the light theme's.
**Sample it after the transition has settled.** `.lift` carries
`transition: background-color 0.18s`, so a computed colour read straight after
flipping `data-theme` is a mid-fade value, not the token — it read #1F1F1F for a
card whose token says #141414 and sent this investigation after a phantom
override. Set the attribute before first paint, or wait past 180ms.
→ `src/styles/global.css` (dark token block)

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

### A form saves nothing, and the fields that fail are the newest ones
`[confirmed against the live project]`
`/app/you` → Profile silently refused to save experience, disciplines, days-per-week,
equipment and plan length — all at once, behind one generic "Could not save" toast. The
client was correct at every line: the controls were wired, `onSave` sent all eleven
columns, `upsertUserStats` stripped nothing, and the owner-scoped policies permit the
write.
`supabase/migrations/0031_onboarding.sql` had been **written but never applied**, so
`user_stats` had no `disciplines` column. PostgREST answers an unknown key with PGRST204
and **rejects the entire payload**, not the one bad field — which is why every value on
the form failed together and none of them looked like the cause. The same drift had
hidden a second bug: `supabase/migrations/0016_library_subroutines.sql` was missing too,
so `Movement` promised `kind` and `url` that the table did not have and the library's
"+ Subroutine" save was dead.
**Check the schema before you read the component.** Migrations here are applied by hand
(`docs/HANDOVER.md`), so drift is the default failure and not an unlikely one — it had
happened twice in thirty-one. The ten-second diff is the Supabase MCP's migration list
against `ls supabase/migrations/`, matched on the file's NAME: applied rows carry
timestamp versions, and a few early ones dropped the numeric prefix entirely.
**Two weaker forms of the same drift exist and are not the same bug.** A migration can be
applied by hand without writing a history row (0019 — the column and its comment are
live, the history entry is not), and a table can exist with no file behind it at all
(`rx_deep_results`), which a fresh clone cannot rebuild. Compare against the live columns
before calling a gap a missing migration.
**And the reason it survived for weeks:** `OnboardingView`'s `persist()` discarded the
boolean `upsertUserStats` returns, so the very first surface to write these columns failed
in total silence and advanced anyway. **A write path that cannot report failure hides a
schema fault indefinitely** — which is also why no check here caught it. `npm test` stubs
the network, and all three browser audits stub Supabase REST, so none of them can see a
column that does not exist.
→ `src/components/UserStatsPanel.tsx`, `src/components/OnboardingView.tsx`, `src/lib/queries.ts`

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

### A widened query window paints the old window first
`[argued — not reproduced]`
`useAuthedQuery` seeds `useState` synchronously from `getCached(key)`, so the
first frame is whatever the last visit stored under that key. Widening a fetch
without renaming the key therefore paints the **old** span and computes anything
derived from it — legend dates, window-scoped scores — against the wrong range
until revalidation lands, which reads as "my window change did nothing".
**The SWR key must name the window it holds** (`stats:logs:120d`, not
`stats:logs:8w`), so changing the span changes the key and the stale entry is
simply never read. Stats builds its key from `ASPECT_WINDOW_DAYS` for that reason.
→ `src/lib/useAuthedQuery.ts`, `StatsView.tsx`, `ASPECT_WINDOW_DAYS` in `src/app.config.ts`

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

### A resumed session's duration resets to zero
`[measured in Chromium]`
`useStopwatch(0, false)` had no way to be seeded **after** mount, so the Logger's
`?logId=` branch called `stopwatch.start()` against a counter still at 0. The
autosave then wrote `total_seconds: secondsRef.current` — a 47-minute session
overwritten with `3` on the first tick. Measured directly: a fixture live for 25
minutes reopened reading `00:00`, and the first PATCH carried `5`.
**A value that is authoritative in the database must be read back into the state
that overwrites it, not merely displayed.** The autosave was always the write
path; the resume path just never told it where the clock actually was. It stayed
invisible because resume was a rare route — reopening a finished log — until the
Home button made it the main one.
Now seeded before it is started, and from `started_at` rather than
`total_seconds` for a live session: you can leave the Logger and browse while it
runs, so the clock is wall-clock (`TIMERS.maxWorkoutSeconds` caps it, the same
bound the auto-end uses). A reopened `done` log still seeds from its recorded
duration and stays frozen.
→ `src/lib/useTimer.ts`, `Logger.tsx`

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

### A slim segmented tab shipped a sub-44px tap target and reddened audit:mobile
`[measured in Chromium, and the symptom observed to stop]`
A per-instance `[&_button]:min-h-[26px]` override on ProfileView's "Selected
month / Recent" tabs (the "reduce tab height 40%" commit) dropped those two
`<button>`s to 26px — so `audit:mobile` failed `/app` with `small-targets=2` at
both widths, while every other `ui/SegmentedTabs` stayed the chunky 44px it was.
The lesson is the general one CLAUDE.md states and this proved the hard way: a
segmented control reads slim by making the **visible thumb** short, never by
shrinking the button. The fix put the thumb on an inner `<span>` at
`min-h-[26px]` and kept the `<button>` at `min-h-11`, collapsing its 44px box to
the 26px thumb with a `-my-[9px]` — slim look, real tap target, and the shell
measures 36px. Doing it in the shared primitive made every tab slim at once and
turned `/app` back to `small-targets=0`. **Never chase a slimmer control with a
button height override; audit:mobile measures the button, not the thumb.**
→ `src/components/ui/SegmentedTabs.tsx`, `scripts/mobile-audit.mjs`

### The slim-thumb trick does not transfer to a stacked list
`[reasoned, not measured — the faked version was deliberately never built]`
The `min-h-11` + negative-margin pattern above buys a real 44px target because
`ui/SegmentedTabs` lays its buttons out **side by side**: the extra height grows
into empty space above and below the row, and no sibling competes for it. Copy
it into a vertical list — the Logger's Done pile, a settings list, any column of
rows — and it buys nothing. Each row's 44px box then overlaps its neighbours',
the shared band goes to whichever row paints last, and every row's *exclusive*
tap band collapses back to its visible height. `audit:mobile` still reports 44
and the control still taps like 28.
**So compress a column by deleting chrome, not by faking the row.** The Done
pile went from ~62px per finished movement (a bordered card, `px-4 py-1`, plus
an 8px gap) to ~45px by dropping the per-card border, the padding and the gaps
and keeping the row a genuine `min-h-11` — and it now shows the movement names
inside a superset, which the taller version did not.
→ `src/components/Logger.tsx`, `src/components/ui/SegmentedTabs.tsx`

### `audit:mobile` never visits `/app/plan/upload`
`[measured in Chromium]`
Its `ROUTES` list covers the nav destinations, so the entire plan/session
authoring surface — every button on `PlanUpload`, including the ones added for
the AI repair loop — is **unaudited**. A green `audit:mobile` says nothing about
that page. The same goes for `/app/settings`' newer controls, which are reached
through a `Disclosure` the audit does not open.
Checked by hand at 375 and 390 instead: no horizontal overflow, `Copy fix
request` at 179x44, equipment toggles at `min-h-11`. **If you change
`PlanUpload` or `UserStatsPanel`, cite a measurement, not the audit.**
→ `scripts/mobile-audit.mjs`, `src/components/PlanUpload.tsx`

### Ask the LLM for "no fences, no prose" and it will still send fences and prose
`[measured — reviewed the shipped code and pasted three model outputs at the parser]`
`parsePlanTabular` demanded the header on `rawLines[0]`, so a ` ```csv ` fence
or a "Here is your plan:" preamble made the check report `Header row must be
exactly: … (got: \`\`\`csv)` on a file whose every data row was already valid
— the parser's own count said `days=2`. The user then paid a repair round trip
for a failure the prompt cannot fully prevent, because fences and preamble are
what models do when they see "no markdown fences."
Two-part fix: `stripLlmWrapper` drops fence lines and preamble; **the fence
strip runs BEFORE `detectDelimiter`**, because that helper reads the first
line and a fenced TSV would otherwise be sniffed as CSV. Deliberately narrow:
no fuzzy section/metric matching, no header reordering, and trailing prose
after the data still surfaces as `unknown kind` because a line that might be a
mistyped row must not be silently dropped. The workbook path already scanned
for the header anywhere in the sheet, which is what made the text-path
strictness clearly a gap and not a design choice.
→ `src/lib/planTemplate.ts`, `src/lib/sessionTemplate.ts`

### A page ready-gate that awaits an optional read is a page that never renders
`[caught in own-code review, same session it was written]`
`PlanUpload.tsx` fetched the athlete's profile inside its mount effect and only
then called `setReady(true)`. The comment claimed a failed read "degrades to
the generic prompt"; it actually degrades to a permanent `LoadingScreen` with
no way to author a plan at all, because `await` inside the IIFE never runs the
line after it if the promise rejects. **Ready must gate only on what the page
cannot function without.** The profile is optional (its absence just makes the
prompt ask more questions), so the fix was to flip `ready` before the fetch and
let stats land later — the tiny race is a sub-second window where a fast click
gets the no-profile prompt, which is what happens for a real profile-less user
anyway.
→ `src/components/PlanUpload.tsx`

### The prompt's worked example must be the LAST thing in the prompt
`[caught by its own test, same session it was written]`
`buildPlanAiPrompt` / `buildSessionAiPrompt` end with a full valid CSV for the
model to imitate, and the test proves it is still valid by slicing from the
**final** header-row occurrence to the end and parsing it. That makes the slice
load-bearing: `sessionTemplate.ts` left `Produce ONLY the CSV. No prose…` sitting
*after* the example, and the parser dutifully read it as `Row 30: unknown kind
"PRODUCE ONLY THE CSV. NO PROSE"`.
**Append nothing after the worked example.** Instructions that belong near the
end go before it. The failure is loud, which is the point — the alternative is
shipping a prompt whose own example does not import.
→ `src/lib/planTemplate.ts`, `src/lib/sessionTemplate.ts`

### Hydration is broken in `astro dev` in this container; `astro preview` is fine
`[measured]`
`/@id/astro:scripts/before-hydration.js` returns **500 — "Missing field
moduleType"** (a Vite-internal field, not ours) on every page, so React islands
never hydrate and every page sits
on its server-rendered `LOADING` state. It reproduces on a clean tree, so it is
environmental (astro 6.3.7 resolving against vite 8), not a regression — do not
go hunting for it in your own diff. `package-lock.json` is untouched.
**Drive interactive checks against `npm run build && npm run preview`**, where
islands hydrate normally. A Playwright script pointed at the dev server will
report "button not found" for a button that is perfectly fine.

### `astro preview` serves a startup snapshot
`[confirmed in the wild]`
It does **not** pick up files rebuilt while it is running, which silently
invalidates any test that rebuilds mid-run. Three separate deploy investigations
were meaningless before this was spotted. Restart it after every `npm run build`.
**For anything involving a rebuild, serve `dist` with a server that reads from
disk per request**, and always assert the origin really changed.

### A `fullPage` screenshot of `/app/*` shows exactly one viewport
`[confirmed in the wild]`
Playwright's `fullPage: true` grows the capture to the **document's** scroll
height, and under `.app-shell` the document cannot scroll at all — `html`/`body`
are `height: 100dvh; overflow: hidden` and the scrolling lives in
`[data-scroll-root]` inside `App.astro`. So `fullPage` returns a plain viewport
shot with no error and no clue, and a Logger screenshot taken to check the Done
pile showed a surface that was simply below the fold. Same root cause as
`audit:mobile` measuring the scroller rather than `documentElement.scrollWidth`.
**To capture below the fold, scroll the scroller, not the window**:
`page.evaluate(() => { const s = document.querySelector('[data-scroll-root]');
s.scrollTop = s.scrollHeight; })`, then shoot the viewport. `window.scrollTo` and
`page.mouse.wheel` on the document are equally inert here.
→ `src/layouts/App.astro`, `scripts/mobile-audit.mjs`

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

### `audit:mobile` is green on `/app/body`, which was rendering an empty state
`[measured in Chromium]`
The only log fixture in `scripts/mobile-audit.mjs` was `status: 'in_progress'`,
because `/app/log` needs a live session. `summarizeBodyLoad` counts `done` logs
only — so `/app/body` rendered "No completed sessions in this window" and the
audit measured that. No region list, no heat map, no toggle, nothing to overflow
and nothing to tap. It reported `small-targets=0` for a page that was blank.
This is the same failure the active-plan fixture was added to fix, on a
different surface, which is why it is worth a second entry: **a fixture is only
as good as the widest status filter downstream of it.** A `doneLog` now sits
alongside the in-progress one.
**Before trusting an audit line, screenshot the page it claims to have checked.**
The audit cannot tell "passed" from "there was nothing to fail".
→ `scripts/mobile-audit.mjs`, `src/lib/bodyLoad.ts`

### A fix silently switched off an existing guard
`[measured in Chromium]`
`audit:mobile`'s overflow check reads `document.documentElement.scrollWidth`.
The app shell then gave `html`/`body` `overflow: hidden`, which pins that number
to the viewport **whatever the page does** — so the check kept printing
`scrollWidth=390 (vw 390)` on a build that laid Home out at 768px on a phone. It
did not fail; it stopped being able to fail, and nothing said so.
Nobody edited the audit. **A guard can be disabled from outside itself**, by a
change to the thing it measures rather than to the assertion — which makes it
invisible in the diff that breaks it. It now measures
`[data-scroll-root]`'s `scrollWidth` as well.
**When a change moves where scrolling, sizing or layout happens, go and re-read
every check that measures the old location** — and prove the check still fails
on a deliberately broken build, which is the only thing that distinguishes
"passing" from "no longer looking".
→ `scripts/mobile-audit.mjs`, `src/styles/global.css` (`.app-shell`)

### `audit:shell` is green on the build whose bottom bar is broken
`[measured — the pre-fix commit was checked out and re-run against]`
The bar-detaches-on-iOS symptom is WebKit resolving a bottom offset against a
stale layout viewport. **Chromium has no such lag**, so the obvious assertion —
"is the bar's bottom edge at the viewport bottom, at every scroll offset?" —
passes on the broken build at every viewport height tried. Left alone, that is a
guard vouching for the bug it was written for.
`scripts/shell-audit.mjs` therefore asserts the *structural precondition*
instead: the document must not scroll, and the bar must carry no viewport
-relative `position`. Both fail against the pre-fix commit, which is the only
reason to trust the file. Check D is kept, labelled, and explicitly described in
the header as green-on-broken, so nobody promotes it to evidence later.
**When the symptom is platform-specific and your harness is not that platform,
assert the precondition and prove the assertion fails on the old code.** Then
say in the output that the symptom itself was not observed — this script's last
line does.
→ `scripts/shell-audit.mjs`

### Two form controls whose accessible names substring-match each other
`[measured in Chromium]`
The Settings stats form has a "Birth year" field and, per injury row, a year
input labelled `aria-label="Year"`. A Playwright `getByLabel('Year')` matched
**both**, resolved `.nth(0)` to the birth-year input, and wrote the injury year
into it — where 2023 fell outside `STATS_LIMITS.birthYear` and parsed to `null`.
The payload looked like a parsing bug in the component; the component was fine.
A screen reader has exactly the same ambiguity, so this is not only a test
concern. **Give every control an accessible name that is unique under substring
matching**, not merely unique as a string.
→ `src/components/UserStatsPanel.tsx`

### A chart normalised to what is on screen still renders flat
`[measured in Chromium]`
The home activity strip scales bar heights so the tallest session **in view**
fills the strip. It was built, measured as working — scale went 1 → 2.75 on
scroll — and still drew a row of identical bars, because a *second* clamp
upstream had already flattened the data: heights were computed as
`min(1, seconds / 7200)`, so every session over two hours became the same bar
before normalisation ever ran.
**Two clamps in series is one clamp too many.** When a view-relative scale is
what keeps marks inside the box, the intrinsic value must stay linear — the
scale can go below 1 and shrink everything to fit, which is the honest reading.
The absolute ceiling only made sense while the scale was fixed at 1.
Worth noting how it was caught: the numeric assertion passed. It took *looking
at a screenshot* of two different scroll positions to see that both were flat.
→ `barHeight` / `BAR_NOMINAL_SECONDS` in `src/components/ProfileView.tsx`

### An animation assertion that a snap also satisfies
`[measured in Chromium]` — third instance of the trap above, worth its own grep.
Checking that the day accordion was *synchronised* meant sampling mid-tween and
comparing how much width the collapsing card gave against how much the expanding
one took. It passed. It also passed with `transition: none` forced on — because
with no animation at all both cards jump the full delta on the same frame, so
`gave === took` exactly. **The check was measuring symmetry, and a snap is
perfectly symmetric.**
**An animation needs an assertion about being PARTWAY**, not only about being
consistent: at t=150ms of a 320ms tween the move must be somewhere in 15–85%
complete (it measures 45% on `--ease-editorial`). Forcing `transition: none` with
Playwright's addStyleTag is the cheap negative control, and it is the step that
found this — run it before believing any motion check.
→ the accordion probe pattern, and `scripts/flicker-probe.mjs`

### Running `prettier` rewrites the whole file, because there is no config
`[observed — a 77-line diff became a whole-file rewrite]`
This repo has **no `.prettierrc` and no prettier dependency**; the source is
hand-formatted at single quotes and ~100 columns. `npx prettier --write` on a
touched file therefore applies prettier's *defaults* — double quotes, 80 columns
— and rewrites every line, burying the real change in hundreds of unrelated ones
and silently breaking the single-quote rule. Recovered with `git checkout
<file>` and re-applying the edits by script.
**Do not run a formatter this project does not configure.** Match the
surrounding style by hand; if a generated edit runs long, wrap only the lines
you added.
→ `package.json`

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

### A saturated fixture can't show the score changing
`[measured in Chromium]`
A probe meant to prove the radar is data-driven added two much heavier sessions
and asserted the polygon moved. It didn't: scores were absolute and clamped at
`ASPECT_SCALE.max`, and the fixture was already at 10 on every axis the data
could reach — so the assertion was measuring the ceiling, not the wiring. The
same fixture also made the striped day the volume maximum, where `opacity` is
1.0 by design, and an "intensity is applied" check failed on correct code.
**Seed a fixture that sits mid-scale, then perturb an input the metric responds
to monotonically.** A maxed-out fixture makes a passing assertion meaningless
and a failing one a false alarm.
The clamp itself is gone — `scoreAgainstBaseline` is a logistic against the
user's own history and is asymptotic, so an ordinary value no longer pins. The
trap outlives it, because rounding still snaps an extreme to 10.0: when the
question is "does this input move this axis", assert on the **raw metric** from
`computeAspectMetrics`, which is unbounded and unit-ful. Keep score assertions
for the scoring itself.
→ `computeAspectMetrics` / `scoreAgainstBaseline` in `src/lib/aspects.ts`,
`scripts/mobile-audit.mjs`

### A metric changes meaning and every score built on it goes quietly wrong
`[argued — not reproduced]`
`aspect_snapshots.metrics` stores raw measurements and the radar scores each axis
against the **median of the owner's own past values**. So redefining a metric
poisons the baseline rather than resetting it: `strength` was a mean best e1RM in
kilograms (~110) and became scaled training volume per week (thousands). A median
over both describes neither, and **there is no symptom** — the polygon still
draws, the vertices still fill, the numbers are simply wrong.

A bare `delete from aspect_snapshots` fixes the day it ships and becomes a
landmine: re-applied later against a database that has since rebuilt a good
baseline, it wipes it. So the metrics carry a version
(`ASPECT_METRICS_VERSION`, `aspect_snapshots.metrics_version`), the reset is
`delete … where metrics_version < N`, and `getAspectSnapshots` filters on it —
the migration cleans up, but **the read filter is the guard that matters**,
because it holds even if a stale row survives by some other route.
**Changing `computeAspectMetrics` means bumping the version and adding the
two-line migration.** `0019` is the template and `AspectMetrics` in
`src/lib/types.ts` says so at the definition site.
→ `src/lib/types.ts`, `src/lib/queries.ts`, `supabase/migrations/0019_aspect_metrics_version.sql`

### The logger records more than the metrics read
`[measured — verified against the source]`
Two things were being computed around data that was already sitting in the
LogDocument:

- **`/side` was never priced.** `toggleItemNotation` only pushes the string onto
  `LogSet.notations[]`; nothing in the codebase doubles reps for it. Reps are
  logged per side, so half of every unilateral set was invisible to every metric.
- **Actual rest is never recorded.** `TIMERS.restPresets` is UI config and no
  rest-timer result is persisted. `LogItem.restSeconds` is user-set *intent*
  defaulting to 120, so an untouched item reads as un-dense whatever happened.
  `LogGroup.restSeconds` is in the type and nothing writes it at all.
  What *is* measured: `LogGroup.completedAt` (stamped in `logEdits.ts`) and
  `workout_logs.total_seconds`, so working-minutes ÷ elapsed is a real density
  read — which is why the endurance axis averages the clock and the prescription
  instead of trusting either.

**Before adding a field to capture something, check whether the logger already
stores it.** Notations are also ITEM-level in practice — `toggleItemNotation`
writes to every set in the item — so nothing should be built expecting per-set
notation granularity.
→ `src/lib/bodyLoad.ts` (`setVolume`), `src/lib/logEdits.ts`, `src/app.config.ts`

### audit:mobile is green on a surface it never rendered
`[measured in Chromium]`
`fixtureFor()` in `scripts/mobile-audit.mjs` used to return `[]` for the plans
table, so `getActivePlan()` resolved null and Home painted "No active plan." The
Active-plan card, the day rail and every other plan-dependent control were
**absent from the DOM the audit measures** — a rail of sub-44px chips would have
shipped with `small-targets=0` on all 22 combinations.
**Fixed for plans:** the fixture now serves a six-day `activePlan` (six, not
four, because day count is what squeezes a collapsed-card row at 375px). The
first run with it red-flagged **ten** genuine sub-44px targets that had been
invisible for as long as the gap existed — `View →` and `Coach →` on Home, and
`Edit` / `New plan` / six × `Start →` on `/app/plan`, all bare text links
measuring 12px tall. Every one was live on a phone the whole time.
**The general rule stands: before citing a green run as evidence for a
data-driven surface, confirm the surface was in the DOM.** Either extend the
fixture, or run a throwaway probe that seeds the row (copy the auth/REST stubbing
out of the audit; it needs no credentials). Still thin, and still able to hide a
regression this way: saved sessions, the movement library, and `aspect_snapshots`.
Note also that `getActivePlan()` uses `.maybeSingle()`, so the `is_active=eq.true`
lookup must be fulfilled with an **object** while the unfiltered list query wants
an array — return the wrong shape and the surface silently stays empty, which
looks exactly like the bug you are trying to fix.
**The radar is the same trap for a different reason:** the fixture's only
`workout_logs` row is `status: 'in_progress'`, so `completedLogs` drops it,
`computeAspectMetrics` returns `{}` and FitnessProfile paints its empty state —
the chart, its vertex markers and the toggles are never in the DOM. A green
`/app/stats` run says nothing about any of them.

**The Logger's "Done" pile was the same gap, found the same way:** the fixture's
groups carried no `completedAt`, so nothing ever parked and the pile was absent
from every run — a compressed-row rewrite of it could have shipped with
`small-targets=0` twice over. The fixture now opens with a finished superset
(`g0`, stamped `completedAt`, every set `completed: true`), deliberately holding
a 40-character movement name, four sets and a `/side` notation, because the done
row is name + tags + set summary on ONE line and that is what squeezes it at
375px.

A probe that does see them needs completed logs **and** `aspect_snapshots` rows,
because the chart has four distinct renderings and the baseline depth is what
picks between them: unscored (raw measurements, no polygon), thin (hollow
vertices), mixed (some axes scored, some not, no polygon) and settled (filled).
**Fixture depth is itself an assertion** — one run reported `hollow 0` across all
four scenarios, which was not a rendering bug but `ASPECT_GOOD_BASELINE` sitting
exactly on `ASPECT_BACKFILL_WEEKS`, so every successful backfill landed on
"settled" and the hollow state was unreachable in production. A scenario whose
fixture cannot produce the state it is named for passes silently.
→ `scripts/mobile-audit.mjs`

### A scenario that stops finding its target reads as a pass
`[measured in Chromium]`
`audit:flicker` ends on "All sheets open and close cleanly", and a scenario whose
`open` selector matches nothing prints `[skip]` above that line and **does not
fail the run**. Changing Home's no-plan CTA from a `Start workout` button to a
`Resume workout` link (the fixture's only log is `status: 'in_progress'`, so the
resume state was always on) silently retired
`Home · start workout (AddSessionMenu)` — the tail of the output still said
everything passed.
**Read the per-scenario lines, not the summary, and diff the skip count against
the run before your change.** The same shape as "audit:mobile is green on a
surface it never rendered" — there the surface was missing from the DOM, here the
scenario was missing from the run — and the same fix applies: a check is only
evidence for what it actually reached.
The CTA now renders **above** the existing pair rather than replacing one of
them, which restored the scenario and closed a real hole at the same time: with
no active plan that row is the only route to the chooser, so a live session would
have left resuming as the single thing you could do.
→ `scripts/flicker-probe.mjs`, `ProfileView.tsx`

### The whole page is blank, and two of the three audits are green on it

`[measured in Chromium]`
Home and Stats rendered nothing — `main` was empty, the console had a single
minified **React error #310** ("rendered more hooks than during the previous
render"). Cause: a new `useMemo` placed BELOW the component's early
`if (loading) return <LoadingScreen />`. The loading render runs N hooks, the
loaded render runs N+1, React tears the component down. `ProfileView` already
carried a comment saying hooks must sit above the early returns; the comment was
there and the hook still went under it.

**The dangerous part is not the crash, it is what the checks said about it.**
`npm run audit:shell` and `npm run audit:mobile` were **both fully green on the
blank build** — and they were right to be. A page that renders nothing has no
horizontal overflow and no sub-44px tap targets. Every assertion they make is
vacuously satisfied by an empty DOM.

The only signal came from `npm run audit:flicker`, and it was not a failure:
three scenarios went from `[ok]` to `[skip]` because their selectors no longer
matched anything. **A scenario that stops finding its target reads as a pass** —
the summary line still said "All sheets open and close cleanly", with
"(3 skipped)" appended.

So: **treat a new `[skip]` as a failure**, and when a layout change lands, assert
the page rendered rather than inferring it from a green audit. The cheapest
proof is a headless run that asserts a known selector resolves and dumps
`main`'s `innerText`; a screenshot is better because it also catches a page that
renders but renders wrong.

Not a fix, but the reason this was cheap to find at all: the flicker probe
prints per-scenario status. A probe that only printed a pass/fail total would
have said "pass".
→ `src/components/ProfileView.tsx`, `src/components/StatsView.tsx`,
`scripts/flicker-probe.mjs`

### What a standing check covers — and what it cannot
The three checks are deliberately narrow. **A green run means only what the
check measures.** Four sheet-flicker fixes shipped citing "183 tests, astro
check clean, all 20 audit combinations pass" — none of which can see a flicker.

| Command | Catches | Cannot see |
|---|---|---|
| `npm run audit:mobile` | horizontal overflow, sub-44px targets, on every `/app` route at two widths — including the plan-dependent surfaces, since the fixture gained an active plan | **Opens no sheet and clicks nothing** — it loads routes. It measures a **resting** DOM, so nothing about a transition, a tween or an expand/collapse is visible to it. Fixtures for saved sessions, the library and `aspect_snapshots` are still thin (see below). |
| `npm run audit:flicker` | scroll jump, `html`/`body` style writes on touch, two scrims at once, an animated scrim, a sheet lingering after the tap, focus moving after it settled, panel resizing mid-animation, a text field focused on open | **Chromium only.** Blind to the WebKit compositing and keyboard/viewport behaviour the original bug lived in. |
| `npm run audit:docs` | code identifiers in the docs that no longer resolve | Whether a rule is **true**. `.lift` resolves fine; that it is wrong advice for a modal panel is invisible to it. |

None is wired into CI; run them by hand. All three seed auth into localStorage
and stub Supabase REST, so none needs credentials.
Every assertion in the flicker probe has been shown to fail against the build
that had the bug — including its fallback for finding the panel, because an
assertion that passes by finding nothing is not an assertion.
→ `scripts/mobile-audit.mjs`, `scripts/flicker-probe.mjs`, `scripts/docs-audit.mjs`

## Data & privacy

### A hard session reads 460kg of volume and the number is obviously wrong
`[measured — one Hyrox session, before and after]`
The Stats screen's Volume column was `sessionVolume` in `lib/stats.ts`: raw
`weight × reps`, and nothing else. A session of pull-ups, dips, wall balls, sled
and runs scored **460kg** — one weighted movement — because a bodyweight rep
prices at `0 × reps` and `distance`, `time` and `calories` are fields it never
reads. The suspicion was that normalisation was broken. It was not: the
normalised model (`setVolume`, bodyweight-priced, ROM-scaled) already existed
and fed the radar and the body map. **Stats simply bypassed it.** Two live
implementations of one concept, sharing no code.

The replacement is `lib/work.ts`, and the model is one line: **work = force ×
displacement**, output in kg·m. `bwLoad`/`forceFactor` is the force term, `rom`
is the displacement term — they are the two halves of one product, not two
competing corrections, which is the question to answer before adding either.

Three things that fell out and are worth keeping:
- **Time is not a work unit.** The first instinct is to normalise reps and
  distance *through* time, since every movement has a duration. It is exactly
  backwards: a minute says nothing about how much was moved, where a rep and a
  metre both say it directly. Converting through time is what made the same 50m
  sled push score **4.5× differently** depending on whether the logger filled
  the distance box or the time box — the metric moved when logging habits moved.
  Isometrics score zero work and keep their minutes on the body map.
- **`bwLoad: 0` is a correct claim that breaks a force term.** A row erg bears
  none of you, so 0 is right — and a work model reading it as force prices a
  maximal 2km row at literally nothing. Hence `forceFactor`, which exists only
  for the machines where "fraction of you that you lift" and "force you
  generate" come apart.
- **An absent estimate is louder than a wrong one.** `rom` was absent on double
  unders, so they inherited the 0.45m reference bar path and 100 skips priced as
  100 near-squats. The neutral default is only neutral where the movement is
  ordinary.

### One modality reads 51% of training and the chart is obviously wrong
`[measured — 48 real sessions, before and after]`
`setMinutes` priced a resistance set at its **time under tension** — reps ×
`LOAD.repSeconds` — while an endurance block was priced at the duration it
logged. A 5×5 back squat scored 1.25 minutes against a 90-minute run's 90, so
the modality mix read **56% endurance / 23% resistance** for an athlete who
mostly lifts. Rest was never counted at all; the two numbers were never in the
same unit.
The fix is NOT a per-modality multiplier — that is the coefficient nobody can
defend when the chart looks wrong, and the taxonomy skill forbids it. It is to
spend a quantity that was already measured: each session's own `total_seconds`,
allocated across the modalities it contains (`SESSION_CLOCK`, `allocateSession`
in `lib/bodyLoad.ts`). Same 48 sessions after: **67% resistance / 22%
endurance**.
**Three things cost the most time, and none of them was the arithmetic.**

1. **Ranking the remainder's owner by raw `setMinutes` reproduces the exact bias
   being fixed.** Two sets of hamstring stretch out-score one set of squats on
   time under tension, so a lift with a cooldown elected *mobility* as its own
   main work. Rank by `itemShareWeight` — work plus prescribed rest — and only
   over items **outside** warmup/cooldown/conditioning, because those sections
   are by definition not what the session was. A session with no main work at
   all (a run logged as one conditioning block, a yoga class as one cooldown
   block) falls back to ranking everything.
2. **The session tag is a tiebreak, never an override.** Two of five
   `mobility`-tagged sessions in real data are mostly dips, carries and band
   work. A tag is what a session was *called*; the taxonomy is what was
   *performed*. Same rule `inferModality` already followed.
3. **A clock below the plausibility floor is not an abandoned session.** Real
   logs held 0s and 203s carrying 13–20 completed sets — the timer was off, the
   work was not. Deleting them would have destroyed real training to fix a clock
   problem. They fall back to raw working minutes, and **nothing is reallocated**
   in that case: claiming and the floor both need a real clock, and applied to a
   total that *is* the sum of its parts the floor reshapes data that was never
   mismeasured. That last one only surfaced as a failing test.

The floors (`resistanceFloor`, `mixedFloor`) never fire on real data — lowest
strength remainder 76%, lowest hyrox 79%. They are a guard, not a tuning knob;
do not tune them without measuring first.
Minutes are now allocated once, in `summarizeBodyLoad`. `coach/signals.ts` used
to re-derive the same split from working minutes; doing both allocates the clock
twice, so the duplicate working-minutes field there was removed and
`sessionMinutesPerWeek` now reads `modalityMinutes` directly.
**`npm test` cannot see any of this being right** — it sees the rules firing in
the intended order. The 56%→22% swing was measured against the live database,
which is the only thing that observed the symptom stop.


### A new column on `profiles` is published to anonymous visitors immediately
`[argued — read off the policy and the query]`
`profiles_select_showcase` is `for select to anon using (is_showcase)` — a
**whole-row** grant with no column list — and `ProfileView` calls
`getCurrentProfile(supabasePublic)`, which is `.select('*')`. So every column on
`profiles` is fetched by an unauthenticated visitor to `/showcase` and sits in
their browser, whether or not anything renders it. Only `display_name` is drawn,
which makes the leak invisible in the UI.
Adding bodyweight, age, gender and injury history there would have published all
of it. They live on `user_stats` instead, which has **no anon policy at all** —
the deny-all shape `invites` and `garmin_connections` already use.
`share-read` is not affected: it selects an explicit column list.
**Postgres RLS grants rows, not columns.** Before adding a column to a table any
role can read, check what that role's policy actually covers, and prefer a
separate owner-only table over trusting the UI not to render the field.
→ `supabase/migrations/0002_rls.sql`, `supabase/migrations/0020_user_stats.sql`,
`src/lib/queries.ts`, `src/components/ProfileView.tsx`

### A late-arriving input gets persisted into a baseline at the wrong value
`[argued — not reproduced]`
`useAspectProfile` both computes metrics and **writes snapshots**. Bodyweight
now feeds `computeAspectMetrics`, and it arrives on its own fetch. If the write
effect had run on logs alone, the first pass would have priced every unweighted
set at the fallback constant and persisted that under the current
`ASPECT_METRICS_VERSION` — a permanently mispriced row in a baseline that the
version guard cannot catch, because the version is right and only the value is
wrong. Nothing on screen would show it.
Worse, `useAuthedQuery` returns `null` **both** while loading and for a user who
genuinely has no stats row, so `data == null` cannot distinguish them. The
**loading flag** is the only usable gate.
**When a derived value is persisted, gate the write on every input having
settled — not on the inputs being non-null.**
→ `src/lib/useAspectProfile.ts`, `src/lib/useAuthedQuery.ts`

### A "more physical" metric silently prices isometrics at zero
`[argued — caught at design time, before it shipped]`
Volume was `load × reps`, so a Calf Raise and a Back Squat scored identically at
matched tonnage despite a quarter of the bar path. The obvious fix is real work
— `load × displacement`, in kg·m, with displacement per movement and scaled by
the lifter's height.

It is wrong, and the reason generalises. **Work is zero wherever displacement is
zero**, which is every isometric: a Side Plank has load and duration and moves
nothing. That is the *same hole* that stopped tonnage being the currency in the
first place — the fix reintroduces the bug it was brought in to fix, one axis
over. Absolute kg·m is also only half-honest: it ignores the eccentric, path
curvature and the limb's own mass, so the unit promises a precision the model
cannot deliver.

Shipped instead as a **dimensionless ROM factor** — estimated path length over a
0.45m reference compound path. Same per-movement information, no unit to
over-claim, and nothing can zero out. A movement with no estimate scores 1.0, so
absence is neutral, matching the rule RPE already follows.

Two consequences worth keeping:
- **Height cancels.** A single global scalar divides out of a dimensionless
  factor exactly as it divides out of any score measured against the lifter's
  own history. Bodyweight genuinely matters (it *prices* unloaded work); height
  does not. It stays stored and unused, which is the correct outcome, not a
  deferral.
- **The neutral cases are the design, not gaps.** Ergs and locomotion log
  machine/ground travel, not a load path; carries, mobility, rotation and every
  isometric have no meaningful per-rep displacement. 22 of the 63 names in the
  production vocabulary sit at 1.0 on purpose.

**Before converting an index into a real unit, ask what the unit reads as zero
for.** If the answer is a kind of training the user actually does, keep the index.
→ `src/app.config.ts` (`ROM`), `src/lib/bodyLoad.ts` (`romFactor`),
`src/lib/movementTaxonomy.ts`, `supabase/migrations/0022_aspect_metrics_v4.sql`

## Superseded

Kept so the search path survives, **demoted so it stops reading as advice.**
Every line below was once a live entry with a confident prescription. A grep hit
here means "this was tried and is no longer how the code works."

The sheet flicker took five merged PRs. These were the wrong turns:

- **A shadow on the bottom bar renders nothing — use `.ledge`.** True while
  depth existed: every token cast downward, so on a `bottom-0` element it
  painted off-screen and looked like a no-op. The whole hazard class went with
  the redesign — `--shadow-lift-rest`, `--shadow-lift-hover`, `--shadow-ledge`
  and all six `--hill-btn-*` now resolve to `none` in both themes, and the bar
  separates with `border-t` plus an opaque fill. `.ledge` survives, but only to
  carry the one part that is still true and is NOT about shadows: **never put a
  transform on that element**, because it carries
  `pointer-fine:backdrop-blur-md` and a transform there promotes a composited
  layer. (It would not break the bar's own position — only a transformed
  *ancestor* does that, which is the plausible-sounding wrong reason.)

- **`.lift` fights JS-driven transforms → use `.lift-fixed`.** True while sheets
  were Motion-animated. Nothing in a sheet is JS-animated now, and there is no
  resting shadow left either. `.lift-fixed` survives to carry the rule rather
  than the styling: **no transform, and no transform transition, on a surface
  that is already being animated.** That is about compositing, not depth, and
  will be true again the moment someone adds a hover effect to a sheet panel.
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

The bottom bar detaching on iOS:

- **Pin bottom bars with `sticky bottom-0`, not `fixed bottom-0`** — "a sticky
  box is laid out in the document, so it tracks what is actually painted."
  Shipped as the fix, marked `[argued — not reproduced]`, and the bar kept
  detaching. WebKit resolves sticky offsets against the same lagging layout
  viewport `fixed` uses; the document/painted distinction does not exist on the
  scrolling thread. Both are now wrong for a bottom bar, and the live entry
  removes the offset instead of relocating it.
- **A full-height flex column with `min-h-svh`, a `flex-1` sibling, and the bar
  as last in-flow child.** The scaffolding that sticky needed. The shell replaces
  it: `h-full` on a `100dvh` body, and `min-h-svh` is gone from `Logger.tsx`,
  where it was wrong by exactly the header's height once the scrollport stopped
  being the viewport.

**The second meta-lesson.** The first fix was wrong for months because the check
that would have caught it could not exist — the symptom is WebKit-only and every
harness here is Chromium. When no check can see the symptom, say so in the entry
and write down what you measured instead; `[argued — not reproduced]` was the
honest label and it was still not loud enough to stop the wrong mechanism being
prescribed as settled.

The fitness radar:

- **`clampScore` caps every aspect at `ASPECT_SCALE.max`.** It did, and that is
  precisely why the chart went inert — a committed user pinned every reachable
  axis at 10 and the polygon stopped responding. Scoring is now relative to the
  user's own stored history via `scoreAgainstBaseline`, a logistic with no clamp.
- **`computeAspectSuggestions(logs)` is the radar's scoring entry point.** Gone,
  and with it the single-stage model. Raw measurement and scoring are now
  separate steps — `computeAspectMetrics` then `scoreAspects` — because a score
  is only meaningful against a baseline, and the baseline is not in the logs.
- **`power` and `mobility` are `auto: false`, so they only move on a check-in.**
  The `auto` flag no longer exists. Both derive from the taxonomy's
  `plyometric` / `mobility` modality minutes; a check-in still overrides any
  axis, but only for `ASPECT_OVERRIDE_DAYS`.
- **A thin baseline falls back to `ASPECT_ABSOLUTE_ANCHORS`.** Removed outright.
  Those six constants were invented reference values, and while an axis rested on
  one the chart still captioned itself "the middle ring is typical for you" — a
  claim about the user that came from nobody's data. An axis with fewer than
  `ASPECT_MIN_BASELINE` samples now has **no score**; the chart draws its raw
  measurement with a unit instead.
- **Snapshots anchor to completed calendar months (`completedMonthEnds`).**
  Weekly now, via `completedWeekEnds`. Monthly meant four months of logging
  before a real baseline existed, which is the only reason the invented anchors
  had a job in the first place.

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
  cluster left them at ~166px and defeated the point. A parked group is now a
  *summary*, not a shrunken logging card (`renderDoneGroup` in `Logger.tsx`):
  one 44px row per movement reading `✓ name [tags] 60 × 8, 60 × 8`, the same
  shape `LogQuickView` and `SessionDetail` use for a finished workout, inside
  one bordered pile with `--color-border-soft` dividers instead of a stack of
  bordered cards with an 8px gap. A superset lists its movements indented under
  its kind rather than hiding them behind "2 movements". Tapping any row expands
  the group back into the full editable card, which is the only reason the
  controls can leave the summary at all.
- **44px targets, `TOUCH.minTargetPx`.** The glyph may stay small; the *target*
  may not. Exceptions live in `scripts/mobile-audit.mjs`'s allowlist and each
  carries its reason.
- **Sheets have no exit animation.** Deliberate, not an oversight — see the
  first entry. Adding one back reintroduces the deferred unmount.
- **The radar's responsiveness lever is window length, not recompute cadence.**
  Its displayed value has always rolled daily: `StatsView` anchors
  `aspectWindows` on `new Date()` and the log writers clear the query cache, so a
  logged workout moves the shape the same day. "It feels unresponsive" was one
  session being ~1/25th of a 60-day window. Hence `ASPECT_WINDOWS` — a shorter
  span, not more frequent snapshots. Sampling the *baseline* more finely changes
  how well the median is estimated and essentially nothing on screen; that is
  worth doing for a different reason (it reaches `ASPECT_MIN_BASELINE` sooner),
  and it is what made the invented anchor values deletable.
- **Two window lengths mean two baseline series.** `aspect_snapshots` is keyed
  `(owner, period_end, window_days)` and `baselinesFor` filters on it. Scoring a
  28-day reading against 60-day samples is wrong on every axis and looks
  completely normal, so the separation lives in one named function with a test
  rather than at each call site.
