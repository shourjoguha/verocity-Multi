-- "Minis": shorter, plan-tagged sessions you can do in place of a scheduled
-- workout (short on time / back from a break) while staying on-plan. A mini is
-- just a session flagged is_mini, with source_plan_id pointing at the plan it
-- belongs to. No new table — reuses the sessions pipeline (logging, RLS,
-- save-as-session). Existing owner RLS on sessions covers the new column.
alter table public.sessions
  add column is_mini boolean not null default false;
create index sessions_plan_minis_idx on public.sessions (source_plan_id)
  where is_mini;
