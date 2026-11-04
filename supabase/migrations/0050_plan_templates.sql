-- Plan templates: ready-made programs a new user can start from instead of
-- authoring their own (SPEC §10.4, "plan adoption").
--
-- WHY NOT `plans.is_public`. That column and its `or is_public` read policy
-- (0002/0004) exist, but every plans read in src/lib/queries.ts leans on RLS
-- for owner scoping: getActivePlan is `.eq('is_active', true).maybeSingle()`
-- and getAllPlans has no owner filter at all. One public ACTIVE row would
-- become a second "active plan" for every user (maybeSingle fails -> no plan)
-- and every public row would join every user's plan history, adherence and
-- coach reads. So templates are a separate table, read by nothing that reads
-- `plans`.
--
-- Rows are SNAPSHOTS of `parsed` (the frozen ParsedPlan contract), not links
-- to a live plan: editing the source plan later does not change what new
-- users adopt, and the source owner's logs/ids never leave their rows.
-- Dates are stored as authored and re-based to the adoption day by the client
-- (adoptPlanTemplate), because the Logger derives the program week from
-- plans.start_date.
--
-- Curated, not user-published: no write policies, so only the service role
-- (migrations / scripts/plan-templates/seed.sql) can add or retire one.
create table public.plan_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  summary     text check (summary is null or char_length(summary) <= 400),
  parsed      jsonb not null,
  sort_order  int not null default 0,
  retired     boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.plan_templates enable row level security;

-- Any signed-in user may read the catalogue. No anon policy: adoption needs an
-- account, and /showcase has no use for it.
create policy pt_select_auth on public.plan_templates
  for select to authenticated using (not retired);

comment on table public.plan_templates is
  'Curated ParsedPlan snapshots new users can adopt (copied into their own plans row). Read-only to authenticated; written by the service role only. Never link back to a live plans row.';
