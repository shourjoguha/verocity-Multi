---
name: ui-change
description: Owns every frontend change in Verocity — components, sheets, modals, drawers, overlays, CSS, design tokens, theme and dark mode, layout, typography, animation, the backdrop, and mobile/touch behaviour. Use when changing anything a user can see, and when debugging a visual symptom (flicker, stutter, blink, hang, jump, flash, darken, repaint, overlap, overflow, tap target too small). Do NOT use for migrations, RLS, edge functions or query helpers — that is the db-change skill.
---

# UI changes

You own what the user sees. The rules below were paid for by bugs; the sheet
entry alone cost five merged PRs. Follow them in order.

## Step 0 — grep the symptom before you open a component

If anything is visually wrong, `docs/LESSONS.md` first. Its `###` headings are
written as symptoms so they can be grepped mid-debug:

- "A sheet flickers, stutters, blinks or hangs — and an in-flow form does not"
- "Whole page flashes ~1s after load, while sitting still"
- "Flicker on touch devices, fine on desktop"
- "Something repaints constantly while scrolling"
- "A modal's effect re-runs on every parent render"
- "Overlay is covered by the bottom nav"
- "Users are stuck on a previous build" — if your fix "didn't work", check this
  before changing anything else. It may simply never have shipped.

This is the highest-value step and the one most often skipped. `CLAUDE.md` and
`docs/SPEC.md` describe intent; LESSONS describes what actually happened.

## What you own

| | |
|---|---|
| Components | `src/components/**`, including `src/components/logger/**` |
| Chrome | `src/layouts/Base.astro`, `src/layouts/App.astro` |
| Pages | `src/pages/**` — markup and island boundaries only |
| Styles | `src/styles/global.css` — the whole design system, 1 file |
| Client UI state | `src/lib/theme.ts`, `src/lib/background.ts`, `src/lib/scrollLock.ts` |
| Motion helpers | `src/components/anim.tsx` |
| Your own checks | `scripts/mobile-audit.mjs`, `scripts/flicker-probe.mjs` |

**You never touch** `supabase/**`, `src/lib/queries.ts`, `src/lib/supabase.ts`,
`src/lib/auth.ts`, RLS or edge functions. Adapt to a query signature; never
change one. If the task needs a schema change, stop and hand off — see
*The boundary* below.

## Reuse before you write

- `src/components/ui/primitives.tsx` — `Button`, `Card`, `SectionHeader`,
  `StatCard`, `Tag`, `LoadingScreen`, `EmptyState`. Imported by ~24 components.
- `src/components/ui/Modal.tsx` — the one sheet/modal. Read its comments; they
  explain the flicker fixes rather than just describing behaviour.
- `src/components/EchoText.tsx` — the typographic Echo Stack, used in 17 files.
- `src/components/anim.tsx` — `EASE`, `PageStagger`, `Reveal`, `Item`,
  `AnimatedNumber`.
- `src/lib/toast.ts` + `src/components/Toaster.tsx` for transient feedback.

A new bespoke button, card or empty state is almost always the wrong move.

## The Modal contract

`src/components/ui/Modal.tsx` is bottom sheet on mobile, centered card at `sm`.
Every clause below is load-bearing:

- **The scrim never animates opacity**, and is a **sibling** of the panel, not
  an ancestor. A full-viewport element changing opacity was the last structural
  difference between a sheet and the in-flow forms on the same screens that
  never flickered.
- **Mount/unmount is immediate.** No deferred unmount, no JS-driven animation.
  Entrance is the CSS `sheet-rise` keyframe in `src/styles/global.css`.
- **The panel uses `lift-fixed`, never `lift`.** The rule outlives the shadows
  it was written for: never put a transform, *or a transform transition*, on a
  surface that is already being animated. `.lift` used to set both and the
  sheet visibly stuttered.
- **Focus enters the panel only under `(pointer: fine)`.** On touch, focus stops
  at the panel itself (`tabIndex={-1}`). Focusing a text field raises the iOS
  keyboard mid-animation, which resizes the visual viewport, which relayouts
  every `dvh` box and the fixed backdrop behind the sheet.
- **`onClose` is held in a ref.** Every caller passes an inline arrow, so
  depending on it in the effect re-runs on every parent render and bounces
  focus out to the trigger and back.
- Markers the flicker probe asserts on: `data-sheet-scrim`, `data-sheet-panel`,
  `data-modal-close`.

**Two sheets hand-roll this pattern and must change in lockstep** with any
Modal change: `src/components/logger/MovementPicker.tsx` and
`src/components/logger/SetEntrySheet.tsx`.

## Tokens, depth and buttons

**Design tokens only — no raw color in a component, ever.** Dark mode is a set
of token overrides under `html[data-theme='dark']` in `src/styles/global.css`;
a hardcoded hex breaks it silently and no check will catch it. Colors are HSL,
declared in the `@theme` block.

- **Depth is retired — separation is a hairline.** `--shadow-lift-*`,
  `--shadow-ledge` and all six `--hill-btn-*` resolve to `none` in **both**
  themes. Surfaces separate with a 1px `--color-border` and a surface-tone step,
  never a cast shadow and never an inline `box-shadow`. `.lift` is now the flat
  card treatment (radius + a fill/border transition); `.lift-interactive`
  changes fill and border on hover instead of tilting. Two hairline weights and
  the distinction carries the look: `--color-border` outlines a card,
  `--color-border-soft` divides rows *inside* one (see `ListCard`). Rows inside
  a hairline-divider container stay flat — that is the default now, not the
  exception. **Any surface whose transform is animated takes `.lift-fixed`.**
- **Buttons are flat** — `.hill-btn` is `--radius-control` plus a fill/border
  state change. No insets, no outer cast, and **no transform in any state**:
  several of these sit inside surfaces carrying `pointer-fine:backdrop-blur-*`,
  and a transform there promotes a composited layer. Toggle buttons MUST still
  set `aria-pressed` — that is an accessibility contract, `ui/SegmentedTabs`
  depends on it, and the flat pressed state is keyed off it. `.hill-btn-flush`
  is kept for callers that name it. Ghost variants keep their `bg-surface` body,
  now for the hover fill. Icon-only buttons h-5..h-8 stay flat by design.
- **EchoText layers** must set both `--echo-dx` and `--echo-tz`.
- **Backdrop presets are enumerated only in `src/lib/background.ts`**
  (`BACKGROUNDS`, `BACKGROUND_KEYS`). New presets stay monochrome and derived
  from existing `--color-*` tokens. Never default to `aurora` unconditionally —
  it is ~170KB gzip of three.js. `pickDeviceDefault()` owns that decision.
- Motion is **CSS-first**. Reach for a keyframe in `global.css` before JS.

## Mobile is the primary target

- 44px minimum tap target — `TOUCH.minTargetPx` in `src/app.config.ts`, never a
  literal.
- No horizontal overflow at 375px.
- **Check `pointer: coarse` and `pointer: fine` separately.** Blur, the 3D
  backdrop, sheet focus and the scroll lock all branch on it, so a fix verified
  on one says nothing about the other.

## The boundary

Four files are shared. Backend leads on all four; you adapt.

| File | Rule for you |
|---|---|
| `src/lib/types.ts` | Read it. `ParsedPlan` and `LogDocument` are frozen JSONB contracts — if your change needs a new field, that is a handoff, not an edit. |
| `src/lib/queries.ts` | Add call sites. Never change a signature. Reads take `client` as the last arg; showcase paths pass `supabasePublic`. |
| `src/app.config.ts` | Domain truth read by both sides. Adding a visual token is fine; changing `BLOCKS`/`SECTIONS`/`METRICS`/`UNITS` is a handoff. |
| `src/lib/planTemplate.ts` | **Hard handoff.** Any change to plan structure moves the CSV/TSV wireframe, the AI authoring prompt, the compatibility checker in `PlanUpload.tsx` and the tests *together*. `validateParsedPlan` is the gate before save and is never bypassed. |

Hand off by stopping and reporting what is needed — do not work around it.

## Verify

```
npm run check
npm run build && npm run preview &
npm run audit:mobile
npm run audit:flicker      # anything overlay-shaped
npm run audit:shell        # anything touching App.astro, Base.astro or scrolling
```

**Restart preview after every rebuild.** `astro preview` serves a startup
snapshot, so it will happily hand you the previous build and let you conclude
a fix failed.

**"Verified" means the symptom was observed to stop.** Cite the check that can
see *your* symptom. A unit-test count and a tap-target audit say nothing about
a flicker — `audit:mobile` only loads routes, clicks nothing and opens no
sheet, and four sheet fixes shipped citing "all 20 audit combinations pass"
while the bug was live. State plainly what your check could not see: both
audits are Chromium-only, and the original sheet bug was WebKit compositing on
iOS, which Chromium rendered smoothly in every broken version.

Then run the `docs-upkeep` skill if this cost you more than twenty minutes or
you were wrong before you were right.
