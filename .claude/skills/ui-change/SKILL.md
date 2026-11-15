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
  `StatCard`, `Tag`, `FilterChip`, `LoadingScreen`, `EmptyState`, and `FIELD`,
  the one class string for every input, select and textarea (no local
  `inputClass`). Imported by ~24 components.
- `src/components/ui/SegmentedTabs.tsx` — every pick-one control.
- `src/components/ui/ActionMenu.tsx` — a "⋯" menu of navigation links, for when
  a row of header buttons would crowd the title.
- `src/components/ui/InfoPopover.tsx` — the "!" caption bubble; clamps itself
  inside a 375px viewport.
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

- **The palette is warm paper / warm carbon**, and the radius is three tokens:
  `rounded-chip` 6px, `rounded-control` 8px, `rounded-card` 12px. No
  `rounded-[4px]`, bare `rounded` or `rounded-sm` on chrome; `rounded-[1px]` /
  `[2px]` stay on data marks. `src/lib/themeTokens.test.ts` parses `global.css`
  and fails on a token missing from one theme or a contrast ratio under target.
- **Three fills, and grey never means selected.** `bg-surface` = content;
  `bg-tappable` = can be tapped, no visible border at rest; `bg-accent
  text-accent-fg` = selected or the one primary (at most one per card). Pick-one
  is `ui/SegmentedTabs`; pick-many is `aria-pressed` toggles. The lever is
  `.hill-btn[aria-pressed]` in `global.css` — **unlayered**, so it beats any
  `bg-`/`border-`/`text-`/`rounded-` utility on the same element. A control that
  needs its own radius or fill must not carry `.hill-btn` (that is why
  `FilterChip` and `InfoPopover` do not). The bottom dock marks the current
  tab with the coloured `.dock-rail` (owner's decision, `--color-rail`) and a
  filled icon, not a grey cell; Log is the one accent square beside the pill.
- **Depth is retired, and a card has no visible outline.** `--shadow-lift-*`,
  `--shadow-ledge` and all six `--hill-btn-*` resolve to `none` in **both**
  themes — never a cast shadow, never an inline `box-shadow`. A card is
  `rounded-card border border-outline bg-surface`; `--color-outline` is
  `transparent` in both themes and is the single lever that puts outlines back
  (the 1px stays in layout). `--color-border` is for edge bars and **floating**
  layers (popover, menu, toast), which keep it because nothing else separates
  them now; `--color-border-soft` divides rows *inside* a card (see
  `ListCard`). A nested non-interactive box in a card is a `rounded-control
  bg-bg` well. `.lift` is the flat card treatment; `.lift-interactive` changes
  fill and border on hover. **Any surface whose transform is animated takes
  `.lift-fixed`** — and note it carries an unlayered card radius.
- **Buttons are flat** — `.hill-btn` is `--radius-control` plus a fill/border
  state change. No insets, no outer cast, and **no transform in any state**:
  several of these sit inside surfaces carrying `pointer-fine:backdrop-blur-*`,
  and a transform there promotes a composited layer. `Button` primary is accent;
  ghost is a `bg-tappable` fill. `:active` is a border cue and sets no
  background. Toggle buttons MUST still set `aria-pressed` — that is an
  accessibility contract, `ui/SegmentedTabs` depends on it, and the pressed
  fill is keyed off it. `.hill-btn-flush` is kept for callers that name it.
  Icon-only buttons h-5..h-8 stay flat by design.
- **Segmented controls** are a filled tappable track with an accent thumb (both
  `as` modes); the thumb is a 26px span, the button stays `min-h-11`.
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
