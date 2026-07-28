# CLAUDE.md — Verocity v2

A strength/training logger rebuilt on **Astro + React islands** and **Supabase**
(Postgres · Auth · RLS · Realtime · Edge Functions), deployed static-first on
**Vercel**, with **Railway** reserved for future heavy/scheduled jobs.
Full spec: `docs/SPEC.md`.

## Routing

Keyed on the symptom you can see, because that is how `docs/LESSONS.md` is
indexed. Visual bugs go there **first** — this file and `docs/SPEC.md` describe
intent, LESSONS describes what actually happened.

| About to...                                                              | Read first                                        |
|--------------------------------------------------------------------------|---------------------------------------------------|
| **Debug anything visual** — flicker, stutter, blink, hang, jump, flash, darken, repaint, overlap | **`docs/LESSONS.md` — grep the symptom**          |
| Touch a sheet, modal, drawer or overlay                                  | `docs/LESSONS.md` § Rendering, then `ui/Modal.tsx` |
| Debug stale content, or "my fix didn't work"                             | `docs/LESSONS.md` § Caching — it may not have shipped |
| Change mobile / touch behaviour                                          | `docs/LESSONS.md`, then `npm run audit:mobile`    |
| Claim something is verified                                              | `docs/LESSONS.md` § Testing — what each check *cannot* see |
| Touch the data model, RLS, or sharing                                    | `docs/SPEC.md` §6 (auth), §8 (data)               |
| Build the public showcase or share links                                 | `docs/SPEC.md` §7                                 |
| Edit plan/log JSONB or domain types                                      | `docs/SPEC.md` §8, `lib/types.ts`                 |
| Touch saved sessions (templates / frames)                                | `docs/SPEC.md` §8, `SessionsView.tsx`             |
| Change visuals, tokens, or layout                                        | **Hard rules below** (canonical), then `app.config.ts` |
| Touch the AI coach                                                       | `supabase/functions/coach/index.ts`, `lib/deepGovernors.ts` |
| Sequence work or check what shipped                                      | `docs/ROADMAP.md`                                 |
| **Change a component, sheet, token or layout**                           | skill ui-change — `.claude/skills/ui-change/SKILL.md` |
| **Add a migration, RLS policy, edge function or query helper**           | skill db-change — `.claude/skills/db-change/SKILL.md` |
| **Map a movement to a region/modality/plane, or edit the body map**      | skill movement-taxonomy — `.claude/skills/movement-taxonomy/SKILL.md` |
| Record a lesson, or reconcile the guidance docs                          | skill docs-upkeep — `.claude/skills/docs-upkeep/SKILL.md` |

**Checks:** `npm run audit:mobile` · `npm run audit:flicker` · `npm run audit:docs`.
Each is narrow, and `docs/LESSONS.md` § Testing states what each is blind to.

**Record what bit you.** `docs/LESSONS.md` logs traps and the decisions taken in
response, symptom first so it can be grepped mid-debug. Add to it if something
cost you more than twenty minutes, or you were wrong before you were right.

**And demote what you replace.** It is a log, not an append-only pile: when your
fix supersedes an earlier one, move the old entry to `## Superseded` instead of
leaving two live answers. One bug reached five merged PRs partly because five
co-equal entries answered the same grep and four of them were wrong.

## Ownership

Three skills split the rules by surface, so a CSS tweak stops carrying the
migration discipline and a migration stops carrying the `.lift` rules. Each
one names the check that can observe *its own* symptom — the asymmetry matters,
because `npm run audit:flicker` cannot see a broken policy and `get_advisors`
cannot see a flicker.

- **skill ui-change** — `src/components/**`, `src/layouts/**`, `src/pages/**`
  markup, `src/styles/global.css`, `src/lib/theme.ts`, `src/lib/background.ts`,
  `src/lib/scrollLock.ts`. Verified by `npm run audit:mobile` and
  `npm run audit:flicker`.
- **skill db-change** — `supabase/migrations/**`, `supabase/functions/**`,
  `src/lib/queries.ts`, `src/lib/supabase.ts`, `src/lib/auth.ts`,
  `src/lib/share.ts`, DB row types. Verified by `npm test`, `npm run check`
  and the Supabase advisors.
- **skill movement-taxonomy** — the region/modality/plane vocabulary in
  `app.config.ts`, `src/lib/movementTaxonomy.ts`, `src/lib/bodyLoad.ts`,
  `src/lib/bodyRegions.ts` and their tests. Verified by `npm test` — which
  cannot see whether a mapping is anatomically *right*, only that the rules
  fire in the intended order.
- **skill docs-upkeep** — the five guidance documents. Verified by
  `npm run audit:docs`.

Two agents delegate the first two with the same boundary: **ui-engineer** and
**backend-engineer** (`.claude/agents/`). ui-engineer holds no database tools
at all, so the boundary is enforced and not merely stated; backend-engineer is
unrestricted because the Supabase MCP tool names are not stable enough to pin,
and observes its half of the boundary by rule.

**Four files are shared, and backend leads on all four:** `lib/types.ts`
(DB rows and the frozen JSONB contracts), `src/lib/queries.ts` (signatures),
`app.config.ts` (domain truth), and `src/lib/planTemplate.ts` — the hard
handoff, where the wireframe, the authoring prompt, the checker in
`PlanUpload.tsx` and the tests must all move together. A change touching any
of them is a two-owner change: not done until `npm test` **and** the relevant
UI audit have both run.

## Hard rules

- **RLS is the security boundary.** The anon key is public; never rely on the UI to
  enforce read-only or access control.
- **Private by default.** Authenticated users read AND write only their own rows
  (`owner_user_id = auth.uid()`). The shared movement library
  (`owner_user_id IS NULL`) is the only ambient cross-user read.
- **Cross-user access is explicit** — via read-only share tokens served by the
  `share-read` Edge Function. Never grant ambient cross-profile reads.
- **Anon key reads only the showcase profile** (SELECT-only) plus the shared library.
- **Never ship the service-role key to the client.** It lives only in Edge Functions
  / Railway env.
- **Keep Vercel light.** The browser talks directly to Supabase; no Vercel
  serverless/edge functions on the authenticated hot path. Heavy/AI work → Supabase
  Edge Functions or Railway.
- **Islands, not a SPA.** Static Astro pages; hydrate React only where interaction is
  required (`client:load`/`client:visible`). The Logger is one large self-contained
  island — avoid many tiny islands.
- **Preserve the JSONB contracts** (`plans.parsed` = ParsedPlan, `workout_logs.data`
  = LogDocument) so the original's logic ports cleanly.
- **Plan-import surface stays in sync with the domain.** The CSV/TSV wireframe
  and the AI authoring prompt live in `src/lib/planTemplate.ts` and are derived
  from `app.config.ts` + `ParsedPlan` in `lib/types.ts`. Any change to the plan
  structure, blocks, sections, metrics, or units MUST update that module (and
  its tests) so the downloadable template, the copyable prompt, and the
  compatibility checker in `PlanUpload` move together. `validateParsedPlan` is
  the gate before save — never bypass it.
- **Design tokens only** (HSL); no raw colors in components — **this one MUST
  hold**, because a three-way light/dark/system theme ships (`lib/theme.ts`,
  `ThemeToggle.tsx`) and every dark override is a token value in `global.css`.
  A hardcoded hex breaks dark mode silently. Identity per the design spec +
  reference screenshots (these take precedence on aesthetics): Clash Display +
  Satoshi, monochrome, hairlines, tabular numbers, the typographic Echo Stack,
  **CSS-first motion** (see the sheet entry in LESSONS for why JS-driven
  animation was removed from overlays).
- **Backdrop & depth.** The full-viewport backdrop is `BackgroundLayer.astro`
  mounted once in `Base.astro`. Six presets — `off`, `grain`, `dots`,
  `hairlines`, `topography`, `aurora` — listed in `lib/background.ts`, which is
  the single source of truth. CSS presets paint via
  `html[data-bg="<key>"] .bg-backdrop::before` rules in `global.css`; the
  `aurora` preset (labelled "Depth" in the UI) mounts `BackgroundScene3DCanvas`,
  lazy-loaded via `client:idle` + dynamic import. New backdrops stay monochrome
  and derived from the existing `--color-*` tokens. The user toggle is
  `BackgroundPicker.tsx`, rendered in `SettingsView.tsx`.
- **Default backdrop is device-gated.** Base.astro's pre-paint script picks
  `aurora` only when `(min-width: 768px) and (pointer: fine)` AND no
  `prefers-reduced-motion`. Touch / narrow / reduced-motion devices default
  to the `topography` CSS preset (still a depth cue, no WebGL). Never
  unconditionally default to the 3D scene — the three.js chunk is
  ~170KB gzip and would tank LCP on mobile.
- **Card depth** is the `.lift` / `.lift-interactive` utility built from
  `--shadow-lift-rest` / `--shadow-lift-hover` — don't inline a `box-shadow`
  in a component. `.lift-interactive` adds a perspective tilt on hover
  (`rotateX(1.4deg) rotateY(-2.2deg) translateZ(6px)`) wrapped in
  `prefers-reduced-motion: no-preference`; reduced-motion users still get
  the shadow bump but no rotation. Lists and cards opt into `.lift`; rows
  inside a hairline-divider container (`gap-px` grids, StatCard grids) stay
  flat — shadow would muddy the hairlines.
  **`.lift` is wrong for any surface whose transform is animated**: it sets a
  `transform` *and* `transition: transform`, which fights the animation. Use
  **`.lift-fixed`** — same resting shadow, no transform, no transition. Sheet
  panels use it.
  **`.lift` is also wrong for anything pinned to the bottom edge**, because
  every other shadow token in the file casts downward and paints off-screen
  there. Use **`.ledge`** / `--shadow-ledge` — the one upward-casting member,
  shadow-only for the same reason as `.lift-fixed`. The bottom tab bar uses it.
- **Bottom bars are `sticky bottom-0`, never `fixed bottom-0`.** A fixed bar
  is placed against iOS Safari's layout viewport, which lags the visual
  viewport while the toolbar collapses — it detaches and floats mid-screen on
  every scroll down. Sticky needs a `min-h-svh` flex column, a `flex-1`
  sibling above, and the bar as the last in-flow child. See `docs/LESSONS.md`
  § "The bottom bar detaches". `src/layouts/App.astro` and the Logger's Finish
  bar are the two.
- **Buttons are 3D pillows.** The `Button` primitive (and most bespoke
  button-shaped surfaces) carries `.hill-btn`: 4px radius + outer drop
  shadow + inset highlight (top-left) + inset shadow (bottom-right). On
  `:active` (or `aria-pressed="true"`) both insets invert and the button
  drops 1px — it reads as pressed in. Toggle buttons MUST set
  `aria-pressed` so the pressed-in state lands; the existing styling
  (border-fg, accent color) stacks on top. `.hill-btn-flush` is the
  no-outer-shadow variant for buttons inside a popover/modal that already
  has its own elevation. Ghost variants need a `bg-surface` body — a
  fully transparent button has nothing for the highlight inset to render
  against. Tiny icon-only buttons (h-5 to h-8, ✓ checkboxes inside set
  rows, ↑/↓/× table-cell utilities, text-only link buttons) stay flat by
  design; the pillow doesn't read at that scale.
- **EchoText is 3D.** Each shadow layer sits at a real `translateZ` offset
  behind the foreground (`--echo-tz`, -8px increments) and the parent
  `.echo` carries `perspective(800px)`. Any new echo layers MUST set both
  `--echo-dx` and `--echo-tz` so the stack stays coherent.
- **Signup is invite-gated** (caps < 100), redeemed server-side.
- **The AI coach ships.** `supabase/functions/coach/index.ts` calls the Anthropic
  API with the caller's own logs and writes to `recommendations`; the UI is
  `CoachView.tsx` at `/app/coach`. It degrades to `{ok:false,error:'no_key'}`
  when `ANTHROPIC_API_KEY` is unset. Governors that bound what it may claim live
  in `lib/deepGovernors.ts` — enforce them in the UI, don't trust the model's
  output shape. (This surface was documented as "deferred" for weeks after it
  shipped, which made agents refuse to touch working code. If you defer
  something, say where.)
- **Mobile is the primary target.** 44px minimum tap targets
  (`TOUCH.minTargetPx`); no horizontal overflow at 375px; `pointer: coarse` and
  `pointer: fine` get different behaviour in several places (blur, the 3D
  backdrop, sheet focus, the scroll lock) — check both before assuming a fix
  applies. `npm run audit:mobile` guards the first two only.
- **"Verified" means the symptom was observed to stop.** Naming a check that
  cannot see the bug is not evidence: unit-test counts and an overflow/tap-target
  audit say nothing about a flicker. Cite the check that observes the *symptom*,
  or say plainly that it was not observed and what you measured instead.
- **TypeScript strict.** Domain config in `app.config.ts`; types in `lib/types.ts`.
  No hardcoded constants in components.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```


Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
