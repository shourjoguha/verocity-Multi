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
  cluster left them at ~166px and defeated the point.
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
