# Friends, send-to and adopt — plan and handover

Status: **planned, revised 2026-11-16 (second session) — see §12, which
overrides earlier sections where they conflict.** Written 2026-11-16 from a design session
with the owner. This file is the whole brief; the conversation that produced it
is not available to you.

Not one of the five audited guidance docs (`npm run audit:docs` does not read
it), so it may name tables and files that do not exist yet. When the work
ships, fold the durable parts into `docs/SPEC.md` §6/§7/§8, `docs/ROADMAP.md`
and `CLAUDE.md`, then delete this file.

## 1. What the owner wants

People who train together should be able to hand each other a workout or a plan
inside the app, and the receiver should be able to take it as a starting point.

1. Add another user as a **friend**.
2. **Send** a log to a friend: right after Finish, from any old log, or a batch
   picked by date range. Send a plan the same way.
3. The receiver sees a **bell** in the header with a count, and an **inbox
   page** listing what was sent.
4. The receiver taps **Accept & review**. Logs then appear in their own history,
   marked as not yet reviewed, and they adjust weights, RPE and so on.
5. Plans are accepted with the sender's dates by default; the receiver can
   change the start date before saving.

Explicitly **not** wanted: messaging, comments, reactions, a feed, leaderboards,
live co-logging, groups, a user directory, standing auto-share, push
notifications, realtime delivery, linked plans that sync. (Read receipts were
on this list; the owner has since asked for an acceptance notice — §12.4.)

## 2. Decisions already made by the owner

Do not reopen these.

| Topic | Decision |
|---|---|
| Friendship | Permits **sending only**. It grants no read of anything. |
| Delivery | **Snapshot at send.** Later edits or deletes by the sender do not change what was sent. |
| Accepted logs | Two paths (§12.1). **Accept & review** → `needs_review`, counts nowhere until confirmed; the button says "Accept & review", never bare "Accept". **Accept all / Accept selected** → `done` immediately, editable afterwards like any log. |
| Review | Must be low friction. Editing happens in review (see §5.4). |
| Duplicates | Warn with **"x% of movements overlap"**. Offer three choices: union (unique movements only), keep mine, use the shared version. |
| Plan link | The sender's `plan_id`, `day_key`, `week_number` are nulled. Adherence should count the accepted log against **whatever plan the receiver is on**, which may be a different plan. |
| Custom movements | Resolve by name; if no match, copy into the receiver's library. |
| Garmin | Ignore. Strip Garmin fields from the copy. |
| Inbox | **Paginated**, not infinite scroll. |
| Plans | Sender's dates by default; receiver can edit the start date before saving. |

## 3. What exists today (verified in code, 2026-11-16)

- **Share links** work: `shares` table (`supabase/migrations/0001_init.sql`),
  `supabase/functions/share-read/index.ts`, `src/lib/share.ts`,
  `ShareView.tsx`, `ShareManager.tsx`, `LogShareControl.tsx`, `/app/shares`.
  Scopes are `profile | plan | log`. Tokens are hashed; reads go through the
  edge function with the service role.
- **There is no Adopt on the share page.** `ShareView.tsx` is read-only.
  `docs/SPEC.md` §7B and `docs/ROADMAP.md` say adoption flows through share
  tokens; it does not. `adoptPlan` in `src/lib/queries.ts` reads `plans` by id
  through RLS, so it only works for own or `is_public` rows, and it does not
  rebase dates.
- **`is_public` is a landmine.** Read the header of
  `supabase/migrations/0050_plan_templates.sql` before touching plan reads.
- **`createPlan` always activates** the new plan and deactivates the current
  one. An accepted plan must not do that silently.
- **Logs carry no foreign key to movements.** `LogItem.movement` is a name
  string; the library is matched by normalised name (`resolveMovement` in
  `src/lib/queries.ts`). The Logger already calls `persistDocumentMovements` on
  finish.
- **Log status** is a check constraint: `planned | in_progress | paused | done
  | cancelled` (`LogStatus` in `src/lib/types.ts`). Nothing prevents two logs on
  one date.
- **Profiles are own-row only** under RLS. A user cannot read a friend's
  `display_name` with a plain select.
- **Header** (`src/layouts/App.astro`, `#app-header`): 48px, sticky inside
  `[data-scroll-root]`, hides on scroll-down. Its right-hand slot is empty for
  signed-in users (only the showcase "Sign in" link uses it).
- **`/app/review` is taken** by `ReviewView.tsx` (period look-back). Do not
  reuse that route or name.
- Latest migration is `0051_invite_ledger.sql`; the next is `0052`.

## 4. Data model

One migration, `0052_friends_sharing.sql`. Follow the db-change skill; run the
Supabase advisors after applying.

### 4.1 Tables

**`friend_codes`** — one row per user who has opened the Friends panel.
`owner_user_id` (pk, fk profiles, cascade), `code` (unique, short random,
unambiguous alphabet), `created_at`. Rotatable. No client policies; reached only
through RPCs.

**`friendships`** — `id`, `requester_id`, `addressee_id` (both fk profiles,
cascade), `status` (`pending | accepted | blocked`), `blocked_by` (nullable),
`created_at`, `responded_at`. Unique on the unordered pair
(`least(a,b), greatest(a,b)`), check `requester_id <> addressee_id`.
RLS: select where `auth.uid()` is either party. No client insert/update/delete;
all writes go through RPCs.

**`shared_items`** — the inbox.

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `sender_id`, `recipient_id` | fk profiles, cascade |
| `sender_name` | snapshot of the sender's `display_name` at send |
| `kind` | `log` or `plan` |
| `batch_id` | uuid; one per send action, groups a date-range send |
| `title`, `item_date` | denormalised for the inbox row (plan name or session label; `log_date`) |
| `payload` | jsonb snapshot, allow-listed fields only (§4.3). Set to null once accepted or dismissed. |
| `status` | `pending | accepted | dismissed` |
| `created_at`, `acted_at` | |

RLS: recipient may select their own rows. No sender select in v1 (no "Sent"
view, no read receipts). No client insert. Status changes through an RPC so the
recipient can never rewrite `payload`. Index `(recipient_id, status, created_at
desc)`.

### 4.2 Changes to existing tables

- `workout_logs.status`: add `needs_review` to the check constraint and to
  `LogStatus`.
- `workout_logs.shared_item_id`: nullable fk to `shared_items`, `on delete set
  null`, with a **unique partial index** on `(owner_user_id, shared_item_id)`.
  This is the provenance ("from Sam") and the idempotency guard: a retried
  accept cannot insert the same item twice.

No change to `plans`. A plan is reviewed **before** insert (the inbox item is
the pending state), so plans need no review status.

### 4.3 RPCs

All `security definer`, `set search_path = ''`, `auth.uid()` checked first,
execute granted to `authenticated` only.

| RPC | Does |
|---|---|
| `my_friend_code(rotate bool)` | Returns the caller's code, creating or rotating it. |
| `request_friend(code)` | Creates a `pending` friendship. Same generic error for unknown code, self, already friends, blocked — no enumeration. Cap outstanding outgoing requests. |
| `respond_friend(id, accept bool)` | Addressee only. |
| `remove_friend(id, block bool)` | Either party. Block also deletes that sender's pending `shared_items`. |
| `list_friends()` | Returns friendship id, the other party's id and `display_name`, status, direction. The only way a friend's name is read. |
| `send_shared_items(recipient, kind, ids[])` | Verifies an `accepted` friendship, that the caller owns every id, and the caps. Builds the snapshot **server-side** and inserts one row per id under one `batch_id`. |
| `set_shared_item_status(id, status)` | Recipient only; nulls `payload`. |

**Snapshot allow-list** (built in `send_shared_items`, never `select *`):

- Log: `log_date`, `started_at`, `ended_at`, `total_seconds`, `activity_type`,
  `tags`, `data` with `data.session` removed (that is the sender's sleep /
  energy / soreness check and feeds `src/lib/soreness.ts`), plus `movements`:
  the sender's **custom** movement rows whose names appear in the document
  (`name`, `category`, `tags`, `default_metrics`, `primary_metric`,
  `default_rest_seconds`, `taxonomy`).
- Plan: `name`, `start_date`, `end_date`, `parsed`, `source_markdown`.
- Never: ids, `owner_user_id`, `plan_id`, `session_id`, `day_key`,
  `week_number`, `hr_avg`, `hr_max`, `source`, `garmin_activity_id`, row-level
  `notes`.

**Caps** live in `app.config.ts` and are mirrored in the RPC: items per batch
(suggest 31), sends per sender per day, pending requests per user.

### 4.4 Types and queries

`src/lib/types.ts`: `Friendship`, `FriendSummary`, `SharedItem`,
`SharedLogPayload`, `SharedPlanPayload`; extend `LogStatus`.
`src/lib/queries.ts`: thin wrappers over the RPCs, `getInboxPage(page)` using
`.range()`, `getInboxCounts()` using head-count queries. These two files are
shared-ownership files in `CLAUDE.md`: backend leads, and the change is not done
until `npm test` and the relevant UI audit have both run.

## 5. Behaviour

### 5.1 Friends

Lives in You as a `Disclosure` named Friends (hash `#friends`, opened by
`openFromHash()` in `YouView.tsx`). Shows: my code and a copyable link, an
"Add by code" `FIELD`, incoming requests with Accept / Decline, the friend
list with Remove and Block. No search, no directory, no profile pages.

### 5.2 Sending

One sheet, `SendToSheet`, built on `ui/Modal.tsx`: pick one or more friends
(toggle buttons with `aria-pressed`), confirm. Entry points:

1. **After Finish** — on the session page the Logger redirects to
   (`/app/session?id=…`, `SessionDetail.tsx`), next to the existing
   `LogShareControl`. This also covers "open an old log and send it".
2. **Date range** — a multi-select mode on the log history surface with a
   from/to picker, capped at the batch limit. Find the history surface first
   (`YouView.tsx`, `/app/activity`, `LogQuickView.tsx`).
3. **Plan** — on the plan page.

Only `done` logs can be sent. With no friends, the sheet says so and links to
`/app/you#friends`.

### 5.3 Inbox and bell

- **Route `/app/inbox`**, island `InboxView`. Three blocks, in this order:
  **To review** (the user's own `needs_review` logs), **Friend requests**,
  **Shared with you** (pending items, grouped by `batch_id`, paginated with
  Newer / Older buttons at `INBOX.pageSize`, suggest 20). Accepted and dismissed
  items sit behind a `Disclosure`.
- Each pending log row shows sender, date, title, movement count, and, when the
  user already has a log that day, a chip: **"62% overlaps your log"** (§5.5).
- Row actions: **Accept & review**, **Dismiss**. A batch header offers
  **Accept all & review**.
- **Bell** in the header's empty right slot, linking to `/app/inbox`, with a
  count = pending items + friend requests + logs awaiting review. Counted on
  page load only; no realtime, no polling. Not rendered in showcase mode.
  `CLAUDE.md` says avoid many tiny islands: check how the coach signal badge is
  wired (`src/lib/coachSignal.ts`) and reuse that pattern before adding a new
  island. The header hides on scroll, so add an Inbox entry with the same count
  to the nav drawer.
- Tap target 44px; the badge is chrome, so it stays monochrome
  (`bg-accent text-accent-fg`), no red dot.

### 5.4 Accept & review for logs

The owner asked whether the receiver can edit during review. **Yes: review is
the existing editor.** Planning-session decision, owner may overrule.

1. **Accept & review** runs the payload through the validator and sanitiser
   (§6), inserts a `workout_logs` row with `status: 'needs_review'` and
   `shared_item_id`, marks the item `accepted`, then opens
   `/app/log?logId=<id>&edit=1`.
2. The Logger, when `status === 'needs_review'`, shows a banner — "From Sam.
   These are Sam's numbers until you confirm." — and two actions: **Confirm**
   (saves as `done`, runs `persistDocumentMovements`) and **Discard** (deletes
   the row). Everything else is the normal edit mode.
3. For a batch, Confirm moves to the next unreviewed log from that batch; the
   last one returns to `/app/inbox`.
4. Leaving mid-way is safe. The row stays `needs_review`, stays out of every
   number, appears in history with a "Review" marker, and stays in the inbox's
   To review block and the bell count.
5. The inbox's To review rows also offer **Confirm as is** for a log the
   receiver did exactly as the sender did.

### 5.5 Duplicates

Resolved **at review time, not at accept time**, so batch accept stays one tap
and an unreviewed duplicate is harmless (it counts nowhere).

- **Overlap %** = shared movement names also present in my log ÷ shared
  movement names. Compared with `normalizeMovementName`; subroutine items
  excluded; against the user's non-cancelled, non-`needs_review` logs on the
  same `log_date` (if several, the highest overlap).
- When opening a `needs_review` log that has a same-day log, show a sheet
  before the editor: "You already logged this day — 62% of movements overlap."
  - **Keep mine** — delete the review row.
  - **Combine** — my log survives (it keeps its plan link, times, heart rate).
    Movements from the shared log that mine lacks are appended to the matching
    section, the editor opens on **my** log with the added items marked, and the
    review row is deleted on save.
  - **Use shared** — continue reviewing the shared row; on Confirm, delete my
    original after an explicit confirmation. Disabled when my original has a
    `garmin_activity_id`.
- Union rules for groups: a superset or circuit that loses items to
  de-duplication keeps the rest; one item left becomes `kind: 'single'`.

### 5.6 Plan link and adherence

`computePlanAdherence` only sees logs with `plan_id === planId` and a
`day_key`. So "count it against whatever plan the receiver is on" means the
accepted log must be **attached to the receiver's active plan**:

- Inserted with all three fields null.
- In review, a "Counts toward" control lists the days of the receiver's active
  plan plus "None". Preselect the day whose prescribed movements best overlap
  the log, if the overlap clears a threshold in `app.config.ts`; otherwise
  "None". Compare with `compareMovements` from `src/lib/movementSimilarity.ts`
  — **never `familyOf`** (`CLAUDE.md`).
- On Confirm, write `plan_id`, `day_key`, and `week_number` from the existing
  helpers in `src/lib/progression.ts`.
- No active plan: the control is hidden.

### 5.7 Custom movements

On accept, for each entry in `payload.movements`: `resolveMovement` against the
receiver's library (own + shared). Hit → nothing to do. Miss → insert as the
receiver's custom movement. Respect the `(owner, name)` unique index from
`0045_movements_owner_name_unique.sql`.

### 5.8 Plans

**Accept & review** opens a sheet, nothing is inserted yet: plan name, day
count, a start-date `FIELD` defaulting to the sender's `start_date` (end date
shifts with it; see `src/lib/planRebase.ts`), and a pick-one via
`ui/SegmentedTabs`: "Make it my active plan" / "Save for later". Save runs
`validateParsedPlan` — **never bypass it** — then inserts. "Save for later"
needs a non-activating insert, which `createPlan` does not offer today.

## 6. Untrusted input

The payload was written by another user. Treat it as hostile.

- New pure module `src/lib/sharedLog.ts` with `validateLogDocument`: shape
  check against `LogDocument`, caps on sections / groups / items / sets and
  string lengths, section keys and metric keys from `app.config.ts`, numbers
  finite and non-negative. Reject, do not repair.
- **Subroutine `url`** must be `http:` or `https:`. A `javascript:` URL in a
  shared log is stored XSS.
- Sanitiser, same module: regenerate group and item ids; set every set's
  `prefilled: true` and `rpeRated: false` (an RPE the receiver did not rate
  must not read as theirs — see the `rpeRated` comment in `src/lib/types.ts`);
  drop `session`; keep `completed` as sent.
- Plans go through `validateParsedPlan` only.
- The server builds snapshots, but the client still validates on accept:
  defence in depth, and the validator is what the tests exercise.

## 7. Readers that must learn about `needs_review`

Most analysis already filters `status === 'done'` and is safe by default. These
are not, or need a deliberate choice. Line numbers as of 2026-11-16.

| Where | Today | Required |
|---|---|---|
| `src/lib/progression.ts:50` `planCycles` | `!== 'cancelled'` | **Exclude `needs_review`.** A stray row here shifts the program week of every later log. |
| `src/lib/queries.ts` `getRecentLogs`, `getLogsInRange`, `getAllLogs` | `.neq('cancelled')` | Keep returning them (history needs them); audit every caller. |
| `src/lib/timeline.ts:65` | `done` or `in_progress` | Decide: show with a Review marker, or leave out. |
| `LogQuickView.tsx` `STATUS_LABEL`, `SessionDetail.tsx:135` | label per status | Add a label; link to the review flow. |
| `src/lib/activeSession.ts`, `LogTabButton.tsx` | `in_progress` only | Confirm a review row is never treated as a live session. |
| `Logger.tsx` | sets `done` in `finish` / `autoEnd` | `autoEnd` must not fire on a review row; review mode per §5.4. |
| `supabase/functions/share-read/index.ts` profile scope | no status filter | Exclude `needs_review`, or a receiver's public profile link shows unreviewed copies. |
| `src/lib/exportData.ts` | exports all | Fine; status is a column in the export. |
| `supabase/functions/coach/index.ts:80` | `eq('done')` | Safe. |

Extending `LogStatus` will surface exhaustive `Record<LogStatus, …>` maps as
type errors. Use `npm run check` as the finder, then grep `status` once more by
hand: a string comparison does not fail to compile.

**Trap — backdated rows and plan cycles.** `planCycles` walks logs in logged
order and closes a cycle when a day repeats. Attaching an accepted log dated
three weeks ago to a plan day inserts it mid-history and can renumber the weeks
of everything after it. Write a test for this before wiring §5.6, and consider
attaching only when the log's date is on or after the plan's first log.

## 8. Build order

Four PRs. Each leaves `main` shippable.

1. **Schema and pure logic, no UI.** Migration `0052`, RPCs, types, query
   wrappers, `src/lib/sharedLog.ts` (validate, sanitise, overlap, union) with
   tests, the §7 reader changes with tests.
   Verify: `npm test`, `npm run check`, Supabase advisors clean, and a manual
   two-account check that user B cannot select user A's rows, cannot insert
   into `shared_items`, and cannot send without an accepted friendship.
2. **Friends, send, inbox, bell — logs only.** §5.1–5.3 and step 1 of §5.4
   (accept inserts the review row; review opens plain edit mode).
   Verify: `npm run audit:mobile`, `npm run audit:shell`, `npm run audit:flicker`
   (new sheets), both themes, 375px.
3. **Review flow.** Logger review mode, batch stepping, duplicates sheet,
   "Counts toward", custom movement copy.
   Verify: tests for union and overlap; by hand, accept a batch of three with
   one same-day duplicate and confirm stats, body map and coach are unchanged
   until Confirm.
4. **Plans, then docs.** §5.8; fix or remove the dead `?adopt=` path; update
   `docs/SPEC.md` §6/§7/§8, `docs/ROADMAP.md`, and the `CLAUDE.md` hard rule
   "Cross-user access is explicit" to name friend-addressed snapshots alongside
   share tokens. Run `npm run audit:docs`. Delete this file.

Use the repo's skills: db-change for PR 1, ui-change for PR 2–4, docs-upkeep
for the tail of PR 4. `CLAUDE.md` hard rules apply throughout — tokens only, no
raw colours, `FIELD` for inputs, `ui/SegmentedTabs` for pick-one,
`aria-pressed` on toggles, every blur `pointer-fine:` gated, no bottom bar
anchored to the viewport.

## 9. Hard constraints specific to this feature

- **Friendship is an address book.** No RLS policy may reference
  `friendships` to grant a read of `workout_logs`, `plans`, `movements` or
  `profiles`. The only cross-user data path is the `payload` column, filled by
  `send_shared_items`.
- **No service-role key in the client**, and no Vercel functions. RPCs and RLS
  only; an edge function is not needed for this feature.
- **`needs_review` rows count nowhere.** Any new metric that reads logs must go
  through `completedLogs` in `src/lib/stats.ts` or filter `done` itself.
- **Do not flip `plans.is_public`** to implement any of this.
- **A collapsed default with no expansion is a removed feature.** The accepted
  / dismissed history and the Friends panel sit behind `Disclosure`; open each
  by hand.

## 10. Open points for the owner

Small, none blocks PR 1.

1. Row-level `notes` on a log are stripped from the snapshot (they read as
   private). Item-level notes are kept. Confirm.
2. The sender gets no signal that an item was accepted. Confirm.
3. Caps: 31 logs per batch, 20 inbox rows per page. Adjust if wanted.
4. Unfriending leaves already-delivered pending items in place; blocking
   removes them. Confirm.

**Answered 2026-11-16 (second session):** 1 — confirmed: row-level notes
stripped, item-level notes kept. 2 — overruled: the sender gets a notice
(§12.4). 3 — confirmed: 31 per batch, 20 per page. 4 — unfriend and block both
leave **accepted** logs as they are; the receiver can bulk-reject them later
(§12.5). Block still deletes that sender's **pending** items; unfriend leaves
pending items in place.

## 11. Environment notes

- The Supabase MCP server failed to connect during planning, so nothing here
  was checked against the live database — only against migrations in the repo.
  Confirm the live schema matches `0051` before writing `0052`.
- The three UI audits need a build and a running preview, restarted after every
  rebuild (`docs/HANDOVER.md`).

## 12. Revisions from the second session (owner decisions — do not reopen)

### 12.1 Two accept paths

- **Accept & review** (per item, or for a selection): as §5.4 —
  `needs_review`, Logger review mode, counts nowhere until Confirm.
- **Accept all** (batch header) / **Accept selected**: inserts each log as
  `done` in one action. Validated and sanitised exactly as §6. Custom movements
  copied as §5.7. They count in stats, body map and coach at once, and are
  edited afterwards through the normal `/app/log?logId=…&edit=1` path; edits
  feed every reader like any other log (nothing special to build — readers are
  pure functions of `workout_logs`).
- **Same-day conflict overrides the bulk path.** Any item in a bulk accept
  whose `log_date` already has a non-cancelled, non-`needs_review` log of the
  receiver's goes in as `needs_review` instead, and is resolved by the §5.5
  duplicates sheet. The result toast says "5 added · 2 need review (same day as
  your log)". Conflicts are also checked within the batch itself only against
  existing logs, not against siblings (two shared logs on one day are the
  sender's own business).

### 12.2 Selection ("multiplexer")

In a batch with more than one pending item, each row carries a checkbox-style
toggle (`aria-pressed`, pick-many per CLAUDE.md). With anything selected the
batch header actions become **Accept selected** and **Review selected**
(and **Dismiss selected**); with nothing selected they read **Accept all** and
**Review all**. Review stepping (§5.4.3) walks only the reviewed subset.
Selection is local component state; it does not persist.

### 12.3 Plan link on the bulk path

Attach automatically when **both** hold: the best-matching day of the active
plan clears `FRIENDS.planMatchThreshold` (`compareMovements`, never
`familyOf`), and `log_date` is on or after the receiver's first log on that
plan (so a backdated row cannot renumber weeks — the §7 trap). Otherwise
leave `plan_id`/`day_key`/`week_number` null. The "Counts toward" control of
§5.6 is available in **edit mode for any log that came from a share**
(`shared_item_id` not null), not only in review, so a bulk-accepted log can be
attached or detached later. The pure chooser lives in `src/lib/sharedLog.ts`
and is shared by both paths.

### 12.4 Sender notice

The sender learns that an item was accepted. Not realtime; counted on page
load like the bell.

- `shared_items` gains `sender_seen_at timestamptz` (null until the sender
  views the notice).
- RPC `list_acceptances()` — caller is sender; returns accepted rows grouped
  by `batch_id`: recipient display name (via the friendship), count accepted,
  latest `acted_at`, whether seen. **Never returns `payload`** (null by then
  anyway) or any receiver data beyond the name and the count.
- RPC `mark_acceptances_seen(batch_ids uuid[])`.
- The bell count adds unseen acceptance batches. The inbox gets a fourth
  block, **Accepted by friends**: "Sam accepted 5 of your logs", one line per
  batch, marked seen when the inbox renders it.
- Suppressed when the friendship is `blocked`. Dismissals are **not** reported
  (no rejection signal to the sender).

### 12.5 Rejecting previously accepted logs

Unfriend and block leave accepted logs alone. The inbox's accepted history
(behind its `Disclosure`) is grouped by batch with the same selection
toggles and a **Remove from my logs** action (selected, or the whole batch).

- On accept, the status RPC stores `accepted_log_id` and `accepted_digest`
  (`md5(data::text)` of the inserted row) on the `shared_items` row.
- RPC `remove_accepted_items(ids uuid[], dry_run bool)` — recipient only.
  Dry run returns `{ total, edited }` where *edited* = linked log's
  `md5(data::text)` ≠ `accepted_digest`. Real run deletes the caller's
  `workout_logs` rows whose `shared_item_id` is in `ids`, sets item status
  `removed`. A confirm sheet shows "Delete 7 logs? 2 of them you edited."
- Logs folded into the receiver's own log by **Combine** have no row left to
  delete and are untouched; the item shows "Combined into your log".
- `shared_items.status` becomes `pending | accepted | dismissed | removed`.

### 12.6 Room for friend read access later (not built)

A future feature may let friends read each other's data. Shape today's work so
that is additive, without building it:

- Keep CLAUDE.md's rule: **no RLS policy references `friendships`.** Future
  reads go through grant-scoped `security definer` RPCs (like `list_friends`),
  so the security boundary stays in one reviewable place.
- `list_friends()` returns a `FriendSummary` object, not a tuple, so a later
  `grants` field is additive.
- `friendships.status` is a check constraint that can gain values; do not
  encode direction or permissions in it.
- Do **not** add a grants table, a "visibility" setting, or any read path now.

### 12.7 Execution layout

All phases land on one branch / one PR, one commit per phase, in §8 order.
Phase 2 includes §12.1–12.2 for the inbox UI; Phase 3 includes §12.3 and the
"Counts toward" edit-mode control; §12.4–12.5 RPCs land in Phase 1 and their
UI in Phase 2. The Supabase MCP was unreachable again this session: verify the
migration against a **local Postgres 16** (`/usr/bin/psql`, cluster
`16/main`) with a stub `auth` schema, and say plainly that the advisors were
not run.
