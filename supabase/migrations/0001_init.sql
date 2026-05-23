-- Verocity v2 — initial schema (SPEC §8).
-- Postgres on Supabase. Ownership is auth-backed; RLS lives in 0002_rls.sql.

-- profiles: 1:1 with auth.users.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_showcase boolean not null default false,
  created_at  timestamptz not null default now()
);

-- At most one designated public showcase profile.
create unique index profiles_one_showcase on public.profiles (is_showcase)
  where is_showcase;

-- Stable lookup of the showcase profile id, used by anon RLS policies.
create or replace function public.showcase_profile_id()
returns uuid language sql stable as $$
  select id from public.profiles where is_showcase limit 1
$$;

-- movements: shared library (null owner) + per-profile custom.
create table public.movements (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text,
  tags          text[] not null default '{}',
  default_metrics text[] not null default '{}',
  primary_metric text not null default 'weight',
  default_rest_seconds int not null default 120,
  notes         text,
  owner_user_id uuid references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index movements_owner_idx on public.movements (owner_user_id);

-- plans: multi-week structured program.
create table public.plans (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references public.profiles (id) on delete cascade,
  name            text not null,
  start_date      date,
  end_date        date,
  source_markdown text,
  parsed          jsonb not null default '{}'::jsonb,
  is_active       boolean not null default false,
  is_public       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index plans_owner_idx on public.plans (owner_user_id);
-- At most one active plan per owner.
create unique index plans_one_active_per_owner on public.plans (owner_user_id)
  where is_active;

-- workout_logs: realtime-enabled session logs.
create table public.workout_logs (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id       uuid references public.plans (id) on delete set null,
  log_date      date not null,
  day_key       text,
  week_number   int,
  status        text not null default 'planned'
                  check (status in ('planned','in_progress','paused','done','cancelled')),
  started_at    timestamptz,
  ended_at      timestamptz,
  total_seconds int,
  notes         text,
  activity_type text,
  tags          text[] not null default '{}',
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index workout_logs_owner_date_idx on public.workout_logs (owner_user_id, log_date desc);
create index workout_logs_plan_idx on public.workout_logs (plan_id);

-- movement_subs: substitution memory.
create table public.movement_subs (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id       uuid references public.plans (id) on delete cascade,
  day_key       text,
  original      text not null,
  replacement   text not null,
  count         int not null default 1,
  last_used_at  timestamptz not null default now(),
  dismissed_at  timestamptz,
  unique nulls not distinct (owner_user_id, plan_id, day_key, original, replacement)
);

-- recommendations: coach output. Kept in schema, unused until the AI phase.
create table public.recommendations (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references public.profiles (id) on delete cascade,
  status           text not null default 'open',
  drift_score      numeric,
  confidence       numeric,
  tldr             text,
  action           text,
  body_md          text,
  disposition      text,
  disposition_note text,
  linked_log_id    uuid references public.workout_logs (id) on delete set null,
  snooze_until     timestamptz,
  created_at       timestamptz not null default now()
);
create index recommendations_owner_idx on public.recommendations (owner_user_id);

-- invites: signup gating (caps < 100). Redeemed server-side only.
create table public.invites (
  id         uuid primary key default gen_random_uuid(),
  code_hash  text not null unique,
  used_by    uuid references public.profiles (id),
  used_at    timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- shares: read-only share tokens (SPEC §7B). Resolved via share-read edge fn.
create table public.shares (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  scope         text not null check (scope in ('profile','plan','log')),
  resource_id   uuid,
  label         text,
  expires_at    timestamptz,
  revoked       boolean not null default false,
  created_at    timestamptz not null default now()
);
create index shares_owner_idx on public.shares (owner_user_id);

-- Substitution bump RPC (security invoker → RLS applies, owner = auth.uid()).
create or replace function public.bump_movement_sub(
  p_plan_id uuid,
  p_day_key text,
  p_original text,
  p_replacement text
) returns void language plpgsql security invoker as $$
begin
  insert into public.movement_subs
    (owner_user_id, plan_id, day_key, original, replacement, count, last_used_at)
  values
    (auth.uid(), p_plan_id, p_day_key, p_original, p_replacement, 1, now())
  on conflict (owner_user_id, plan_id, day_key, original, replacement)
  do update set
    count = public.movement_subs.count + 1,
    last_used_at = now(),
    dismissed_at = null;
end;
$$;

-- Realtime on workout_logs (defensive: publication exists on Supabase).
do $$
begin
  alter publication supabase_realtime add table public.workout_logs;
exception
  when undefined_object then null;
  when duplicate_object then null;
end
$$;
