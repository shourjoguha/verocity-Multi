# Coach tuning — the weekly routine

A scheduled Claude Code session that reads how the deterministic coach has been
behaving against the athlete's logs and nudges it towards signal. **It refines;
it does not rebuild, and it does not grow the coach by default.** Every run has a
fixed budget, every write goes through a surface that already exists, and every
change it makes is checked by the next run.

Runs Sunday morning, after the Saturday training check-in. Read this whole file
before acting; the boundary section is not optional.

## The boundary

The same one `src/lib/coach/governor.ts` enforces, plus a write budget.

| May | Never |
|---|---|
| Write ≤ **1** `coach_briefs` row (whole-picture, `theme` null) | Write `recommendations` or `coach_observations` |
| Upsert ≤ **3** `coach_rule_notes` context notes, ≤ **1** edge | Put a digit in a note (governor drops it — write it in words or not at all) |
| Open ≤ **1** **draft** PR touching `src/lib/coach/**` | Change a threshold, claim or rule outside that PR |
| Append one entry to the vault tuning ledger | Push to `main`, merge, mark a PR ready, or touch brief `status`/`disposition` (athlete-owned, 0044) |
| Set `expires_at = now()` on its own earlier briefs | Write a note whose only effect is to quiet a rule — there is no such surface, and that is deliberate |

**Author** every row as `coach-tuning`, so the page labels it and the next run can
find its own work.

**Net size.** A PR that adds a rule or a claim must, in its description, name the
rule it retires, merges or gates — or argue why net growth is the better fix for
the verdict it answers. The default fix for noise is a gate on an existing rule,
not a new one.

## Inputs

- **Supabase** (project `Verocity-Multi-Project`): `coach_observations`,
  `recommendations` (incl. `disposition_note`), `workout_logs`, `meal_logs`,
  `user_stats`, `coach_briefs`, `coach_rule_notes`.
- **The knowledge vault** via the `1kb_Shos` MCP: `bundle(q, scope='health')`,
  `themes()`, and the vault files themselves for verbatim quotes.
- **This repo at `main`**, cloned fresh (never the operator's working checkout):
  `src/lib/coach/**`, `docs/LESSONS.md`.
- **The ledger**: `~/Documents/knowledge-vault/Topics/fitness/insights/coach-tuning-log.md`.

## Steps

### 0. Preflight
1. `git -C <clone> fetch && git -C <clone> checkout -q main && git -C <clone> reset -q --hard origin/main`
   (the clone is the routine's own; nothing else lives in it).
2. Read the newest ledger entry. Its **Check next week** lines are this run's
   first job.

### 1. Measure (no judgement yet)
1. Run `scripts/coach-tuning/scorecard.sql` with `{{OWNER_USER_ID}}` substituted.
2. Run the data-quality read below. A rule cannot be better than its inputs; if
   coverage moved, say so before blaming a rule.

```sql
with w as (
  select l.id, l.hr_max, l.data
  from workout_logs l
  where l.owner_user_id = '{{OWNER_USER_ID}}' and l.status = 'done'
    and l.log_date >= current_date - 28
),
sets as (
  select a->'actual' x
  from w, jsonb_array_elements(w.data->'sections') s,
       jsonb_array_elements(s->'groups') g, jsonb_array_elements(g->'items') i,
       jsonb_array_elements(i->'sets') a
  where s->>'key' not in ('warmup', 'cooldown')
)
select
  (select count(*) from w)                                                as sessions,
  (select count(*) from w where hr_max is not null)                       as sessions_with_hr,
  (select count(*) from w where data->'session'->'vibe' is not null)      as sessions_with_vibe,
  count(*) filter (where (x->>'completed')::bool)                         as completed_sets,
  count(*) filter (where (x->>'completed')::bool and x ? 'rpeRated')      as sets_with_flag,
  count(*) filter (where (x->>'completed')::bool and (x->>'rpeRated')::bool) as sets_rated
from sets;
```

### 2. Close last week's loop
For each **Check next week** line in the previous entry, write one verdict:
**held** (the metric moved the way the action predicted), **no effect**, or
**backfired**. A note that had no effect after two checks is replaced or left to
expire — never stacked with a second opinion.

### 3. Triage by verdict
A verdict must hold for **two consecutive runs** before it earns a PR (one bad
week is weather). Notes may go out on the first run.

| Verdict | Response |
|---|---|
| `stuck` | Suspect the **measurement** first. Pull the raw logs behind the rule's `observed` fields and look for seeded values, defaults, unit slips, misclassified movements. Measurement bug → PR candidate. The athlete's context explains it (plan does not prescribe it, a disposition note says why) → context note. |
| `rejected` | Read every `disposition_note`. Write a context note that names what the athlete does instead, in their words. Third consecutive run → PR candidate to change the action or the gate. |
| `noise-flat` | A reminder dressed as a finding. PR candidate: gate it on a material drift, or move it to a display surface. A note cannot fix this and must not try. |
| `signal`, `signal-improving` | Leave alone. Name the improving ones in the brief; that is what the athlete acted for. |
| `quiet` | Nothing. Silence measured clean is the coach working. |

Rank candidates **stuck > rejected > noise-flat**, then by `impact.ts` weight.
Take the top one for a PR, the top three for notes.

### 4. Ground it in the vault
For the PR candidate and each note:
1. `bundle(q=<what the rule claims>, scope='health', k=5)`. Look for a claim that
   supports, conditions or **contradicts** the rule as it stands.
2. Any claim the PR adds or changes must have its `quote` found **verbatim** in
   the vault file (`grep -F` the exact sentence) and a person as `speaker`,
   exactly as `src/lib/coach/knowledge.ts` demands. If you cannot paste the
   sentence, it does not go in. Bump `KNOWLEDGE_PACK_VERSION`.
3. Note which uncited vault sources were relevant. They are the backlog for
   `kv coach-claims` (kv-setup) and get listed in the ledger, not acted on here.

### 5. Write — within budget
**Brief** — expire your own earlier open briefs first, then insert one:

```sql
update coach_briefs set expires_at = now()
 where owner_user_id = '{{OWNER_USER_ID}}' and author = 'coach-tuning'
   and (expires_at is null or expires_at > now());

insert into coach_briefs (owner_user_id, theme, rule_ids, headline, body_md,
                          window_start, window_end, author, expires_at)
values ('{{OWNER_USER_ID}}', null, array[...], '<≤60 chars>', '<body>',
        current_date - 28, current_date, 'coach-tuning', now() + interval '8 days');
```

The brief is for the athlete: what moved, what the coach is unsure of and why,
one thing to try. Plain language, no rule ids in the prose.

**Context note** — upsert, so a rerun replaces rather than stacks:

```sql
insert into coach_rule_notes (owner_user_id, rule_id, kind, note, confidence, author, expires_at)
values ('{{OWNER_USER_ID}}', '<rule_id>', 'context', '<≤280 chars, no digits>', 0.7,
        'coach-tuning', now() + interval '28 days')
on conflict (owner_user_id, rule_id) where kind = 'context'
do update set note = excluded.note, confidence = excluded.confidence,
              author = excluded.author, expires_at = excluded.expires_at,
              created_at = now();
```

Verify every note against the governor before writing: known rule id, no digit
outside `HH:MM` / `YYYY-MM-DD`, ≤ 280 characters. Edges need confidence ≥ 0.6.

**Draft PR** — branch `coach-tuning/<yyyy-ww>-<rule>`, change + test, `npm test`
and `npm run check` green, `gh pr create --draft`. The description carries the
scorecard rows, the two runs the verdict held for, the vault quote, and the
net-size line.

### 6. Ledger
Append one entry to the ledger (create the file with a front-matter header if
missing). Keep the last twelve weekly entries in full; fold older ones into a
one-line-per-week **History** section at the bottom.

```markdown
## <yyyy-Www> — <date>

**Inputs:** sessions · rated-set share · HR coverage · vibe coverage
**Last week's checks:** <rule> — held / no effect / backfired (one line each)

| rule | verdict | runs held | action |
|---|---|---|---|

**Wrote:** brief "<headline>" · notes: <rule ids> · PR: <url or none>
**Vault:** used <paths> · relevant but uncited <paths>
**Check next week:** <rule> — expect <metric> to <direction> because <action>
```

## What this cannot see

Whether a rule is right about the athlete's body. The scorecard sees only what
the coach said and what the athlete did about it; a rule can be accepted every
week and still be wrong. Anything that looks like that goes in the brief as a
question to the athlete, not into code.
