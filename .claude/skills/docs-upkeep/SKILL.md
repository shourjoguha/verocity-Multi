---
name: docs-upkeep
description: Owns the guidance documents — CLAUDE.md, docs/SPEC.md, docs/LESSONS.md, docs/ROADMAP.md, docs/HANDOVER.md. Use when recording a lesson or trap after a debugging session, updating roadmap status, reconciling a doc that contradicts the code, or fixing an audit:docs failure. Run this as the tail of a ui-change or db-change task when the work cost more than twenty minutes or you were wrong before you were right.
---

# Guidance upkeep

This repo has standing checks for mobile layout, for sheet flicker, and for its
own instructions. The last one exists because the instructions rotted: a
five-round bug hunt was steered by a doc recommending the exact CSS that caused
the stutter, by five entries prescribing deleted code, and by six documents
claiming a shipped feature did not exist. Keep that from recurring.

## Which document takes what

| Document | Holds | Never holds |
|---|---|---|
| `CLAUDE.md` | Rules, hard constraints, the symptom-keyed routing table | Status, history |
| `docs/SPEC.md` | Design and intent — architecture, auth, data model | What went wrong |
| `docs/LESSONS.md` | What actually happened, symptom first | Intent, aspiration |
| `docs/ROADMAP.md` | Sequence and status — what shipped, what is next | Rules |
| `docs/HANDOVER.md` | Environment facts — commands, deploy, project refs | Current work |

`docs/HANDOVER.md` used to open with a task list that was two months stale, so
a fresh agent's first instruction was to redo a deploy that had already
happened. It carries no current work now. Keep it that way.

## Writing a LESSONS entry

**Write the heading as the symptom you would have grepped**, not as the fix.
The file is indexed by symptom because that is how it gets read — mid-debug, by
someone who knows what they are seeing and not what caused it. Match the
existing `###` style:

> `### Flicker on touch devices, fine on desktop`
> `### A modal's effect re-runs on every parent render`
> `### Users are stuck on a previous build`

File it under the right `##` section: *Rendering & animation*, *Build &
deploy*, *Caching*, *Testing & tooling*. Then state, in order: the symptom, the
actual cause, the fix, and — if you got it wrong first — what you tried that
did not work and why it looked right.

**Threshold:** log it if it cost more than twenty minutes, or you were wrong
before you were right. Not every change earns an entry.

## Demote what you replace

`docs/LESSONS.md` is a log, not an append-only pile. When your fix supersedes
an earlier entry, **move the old entry to `## Superseded`** rather than leaving
two live answers. One bug reached five merged PRs partly because five co-equal
entries answered the same grep and four of them were wrong.

If the demoted entry names code that no longer exists, add it to the `ALLOW`
array in `scripts/docs-audit.mjs` with **both** a `section: 'Superseded'` scope
and a `why:` reason:

```js
{ id: 'SHEET_EXIT_MS', doc: 'docs/LESSONS.md', section: 'Superseded', why: 'the sheet exit constant, removed with the JS animation' },
```

The section scope is the point. A blanket allowlist entry would let that dead
identifier pass anywhere in the docs, which is exactly the
guard-passes-while-the-thing-it-guards-is-broken trap LESSONS itself warns
about.

## If you defer something, say where

A shipped surface documented as "deferred" made agents refuse to touch working
code for weeks. State status where a reader will look for it —
`docs/ROADMAP.md` — and make sure the rule in `CLAUDE.md` agrees with it.

## Naming things the audit can adjudicate

`scripts/docs-audit.mjs` pulls every backtick-quoted token out of the five
documents and checks it resolves. Two traps when adding references:

- A backticked token matching `^/...` is classified as a **site route** and
  resolved against `src/pages/`. Writing `` `/ui-change` `` for a skill
  invocation fails as a dead route. Reference skills by path —
  `.claude/skills/ui-change/SKILL.md` — or name them unbackticked in prose.
- Fenced code blocks are skipped as illustrative, so an example is never a
  claim.

## Verify

```
npm run audit:docs
```

Must exit 0. **State what it cannot see:** it proves the docs *name things that
exist* — nothing more. It cannot tell whether a rule is true, cannot catch
prose contradicting other prose, and cannot see anything not written as a
`backticked` identifier. `.lift` resolves perfectly well; that it was the wrong
advice for a modal panel is not something the audit could ever have known.
