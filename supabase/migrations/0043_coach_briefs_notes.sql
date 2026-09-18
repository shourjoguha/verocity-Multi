-- The second intelligence: what a Claude Code session observes, written where
-- the app can render it and where the deterministic engine can read it.
--
-- WHY TWO TABLES AND NOT ONE. They differ on the only axis that matters here —
-- whether the engine reads them.
--
--   `coach_briefs`      is NARRATIVE. Rendered, never scored. Nothing in
--                       src/lib/coach/** reads it. Deleting every row changes
--                       what the page says and not one finding.
--   `coach_rule_notes`  is CALIBRATION. It reaches the engine, so it is the
--                       one with a hard boundary and a governor.
--
-- THE BOUNDARY, stated once and enforced in src/lib/coach/governor.ts: a note
-- may change what a rule SAYS and may raise how eagerly a rule that is ALREADY
-- TRUE re-speaks. It may never change what a rule MEASURES, invent a rule,
-- write a `recommendations` row, or silence one. Thresholds live in
-- src/lib/coach/knowledge.ts, where every value is a named person's claim with
-- a verbatim quote and a pack version; a model with write access to that is a
-- model that can quietly restate the evidence base as whatever it just
-- inferred, and the provenance argument the whole coach rests on would be
-- worth nothing.
--
-- THE PATTERN IS NOT NEW HERE. `rx_deep_results` already does exactly this —
-- LLM writes a payload, a pure deterministic function re-judges it at READ
-- time, the UI enforces the verdict (src/lib/deepGovernors.ts). Enforcing at
-- read rather than at write is the part worth copying: a row already in the
-- table is still checked on every render, so tightening the governor
-- retroactively disarms everything written under a looser one.

-- ---------------------------------------------------------------------------
-- Narrative. One synthesis of a window, optionally scoped to a theme.
create table public.coach_briefs (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  -- ThemeKey from src/lib/coach/themes.ts, or NULL for a whole-picture brief.
  -- Text, not an enum: the theme list is editorial and lives in code, the same
  -- call meal_logs.size made for its vocabulary.
  theme         text,
  -- Which rules the brief is talking about. Used to show it beside them and to
  -- let the athlete see it is grounded in the same findings, never to derive
  -- anything. Empty is legal for a whole-picture brief.
  rule_ids      text[] not null default '{}',
  headline      text not null,
  body_md       text not null,
  -- The window the observation covers, so a brief cannot silently be read as
  -- current six weeks later.
  window_start  date,
  window_end    date,
  -- Free text, e.g. 'claude-code'. The UI labels a brief with its author: an
  -- athlete must always be able to tell a model's synthesis from a rule's
  -- citation, and the difference is invisible once both are prose on a page.
  author        text not null default 'claude-code',
  -- Briefs go stale. NULL means "until replaced"; the read path prefers the
  -- newest unexpired row per theme.
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index coach_briefs_owner_idx
  on public.coach_briefs (owner_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Calibration. Per-rule context, and proposed interactions between rules.
create table public.coach_rule_notes (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references public.profiles (id) on delete cascade,
  rule_id         text not null,
  -- 'context' : prose shown beside the rule's own body. Says WHY the number
  --             reads as it does for this athlete ("their Zone 2 is a bike
  --             commute they do not log"). Rendered, never scored.
  -- 'edge'    : asserts this rule interacts with `related_rule_id` for this
  --             athlete, beyond the static themes. Feeds ONLY the
  --             `interacting` term in recurrence.ts, which by construction can
  --             raise a rule that is independently true and can do nothing
  --             else.
  kind            text not null check (kind in ('context', 'edge')),
  related_rule_id text,
  note            text not null,
  -- 0..1, the model's own stated confidence. The governor floors edges on it;
  -- it is deliberately NOT mixed into the rule's `confidence`, which means
  -- "how well measured" and must not absorb "how sure a model sounded".
  confidence      numeric check (confidence >= 0 and confidence <= 1),
  author          text not null default 'claude-code',
  -- Notes EXPIRE BY DEFAULT and the default is short. A model's reading of an
  -- athlete's context is a snapshot; one from four months ago quietly steering
  -- what a rule says today is the failure mode this column exists to prevent.
  expires_at      timestamptz not null default (now() + interval '60 days'),
  created_at      timestamptz not null default now()
);

-- An edge must name its other end. Enforced here rather than left to the
-- governor because it is a shape, not a judgement.
alter table public.coach_rule_notes
  add constraint coach_rule_notes_edge_has_target
  check (kind <> 'edge' or related_rule_id is not null);

-- One live note per (owner, rule, kind, target). Re-running an analysis must
-- REPLACE its own note rather than stack a fifth opinion under the same rule —
-- the lesson migration 0036 learned about recommendations, applied before it
-- can be relearned. `related_rule_id` is NULL for context notes and NULLs are
-- distinct in a unique index, so this is written as a pair of partial indexes
-- rather than one index over a nullable column.
create unique index coach_rule_notes_context_idx
  on public.coach_rule_notes (owner_user_id, rule_id)
  where kind = 'context';
create unique index coach_rule_notes_edge_idx
  on public.coach_rule_notes (owner_user_id, rule_id, related_rule_id)
  where kind = 'edge';

create index coach_rule_notes_owner_idx
  on public.coach_rule_notes (owner_user_id, rule_id);

-- ---------------------------------------------------------------------------
-- RLS. Owner-only, all four verbs, `(select auth.uid())` per 0004. No anon
-- policy on either: both quote the athlete's own training back at them, and
-- /showcase renders through the anon role.
alter table public.coach_briefs     enable row level security;
alter table public.coach_rule_notes enable row level security;

create policy cb_select_own on public.coach_briefs
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy cb_insert_own on public.coach_briefs
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy cb_update_own on public.coach_briefs
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy cb_delete_own on public.coach_briefs
  for delete to authenticated using (owner_user_id = (select auth.uid()));

create policy crn_select_own on public.coach_rule_notes
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy crn_insert_own on public.coach_rule_notes
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy crn_update_own on public.coach_rule_notes
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy crn_delete_own on public.coach_rule_notes
  for delete to authenticated using (owner_user_id = (select auth.uid()));

comment on table public.coach_briefs is
  'LLM-authored narrative synthesis shown above the deterministic findings. Rendered, never scored: nothing in src/lib/coach/** reads this table. Owner-only; never add an anon policy.';
comment on table public.coach_rule_notes is
  'LLM-authored per-rule context and proposed rule interactions. The ONLY model-written rows the engine reads, and bounded to that: a note changes what a rule says and can raise how eagerly an already-true rule re-speaks. It can never change a threshold, invent a rule or silence one. Validated at READ time by src/lib/coach/governor.ts so tightening the governor retroactively disarms rows written under a looser one.';
