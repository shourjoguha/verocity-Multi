-- The athlete's answer to a Claude Code brief.
--
-- Until now a brief could only leave the page by expiring or being superseded,
-- so a synthesis the athlete had already acted on sat at the top of /app/coach
-- for as long as the model said it should. These columns give briefs the same
-- verbs a finding has — did it, modified, snooze — and delete is a plain DELETE
-- under the existing `cb_delete_own` policy, so it needs no column.
--
-- THE ATHLETE WRITES THESE, NOT THE MODEL. Nothing in src/lib/coach/** reads
-- them, same as the rest of the table (0043): a disposition changes whether the
-- brief is shown and not one finding. The owner-only update policy from 0043
-- already covers the write; no new policy is needed.
--
-- Vocabulary mirrors `recommendations` (RecStatus / RecDisposition in
-- src/lib/types.ts) so the page can speak about both in one voice. 'dismissed'
-- is absent on purpose: dismissing a brief deletes it.
alter table public.coach_briefs
  add column status           text not null default 'open'
    check (status in ('open', 'snoozed', 'acted')),
  add column disposition      text
    check (disposition is null or disposition in ('acted_as_prescribed', 'acted_modified')),
  add column disposition_note text,
  add column snooze_until     timestamptz;

comment on column public.coach_briefs.status is
  'Athlete-set. open | snoozed (hidden until snooze_until) | acted (see disposition). Deleting a brief is a row DELETE. Never read by src/lib/coach/**.';
