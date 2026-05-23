# CLAUDE.md — Verocity v2

A strength/training logger rebuilt on **Astro + React islands** and **Supabase**
(Postgres · Auth · RLS · Realtime · Edge Functions), deployed static-first on
**Vercel**, with **Railway** reserved for future heavy/scheduled jobs.
Full spec: `.claude/docs/SPEC.md`.

## Routing

| About to...                                       | Read first                           |
|---------------------------------------------------|--------------------------------------|
| Touch the data model, RLS, or sharing             | `.claude/docs/SPEC.md` §6 (auth), §8 (data)  |
| Build the public showcase or share links          | `.claude/docs/SPEC.md` §7                    |
| Edit plan/log JSONB or domain types               | `.claude/docs/SPEC.md` §8, `lib/types.ts`    |
| Change visuals, tokens, or layout                 | `.claude/docs/SPEC.md` §11, `app.config.ts`  |
| Scaffold, sequence work, or deploy                | `.claude/docs/SPEC.md` §4–5, §13 (roadmap)   |
| Add anything AI / plan-parsing / "coach"          | `.claude/docs/SPEC.md` §12 — DEFERRED, ask   |

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
- **Design tokens only** (HSL); no raw colors in components. Swiss-minimalist
  identity: Clash Display + Satoshi, hairlines, tabular numbers, sharp corners, dark.
- **Signup is invite-gated** (caps < 100), redeemed server-side. **AI is deferred** —
  don't build it without an explicit go-ahead.
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
