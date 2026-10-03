-- Saved meals, and the fibrous share of a meal's carbs.
--
-- WHY A TABLE. Repeat-meal shortcuts used to be derived from "custom tags" —
-- free text sharing `meal_logs.tags` with the fixed vocabulary. That made a
-- label ("post-workout") and a description ("3+ eggs only") the same kind of
-- thing as a macro, leaked them into `tag_mix` as zero-percent keys, and left
-- no way to edit or delete a shortcut. A saved meal is a named bundle of the
-- fields a draft is prefilled from. `tags` goes back to the fixed vocabulary.
--
-- COPY ON LOG. A meal logged from a saved meal copies its values; `preset_id`
-- only records where it started. Editing a saved meal never rewrites history,
-- and deleting one nulls the link (on delete set null) and nothing else.
--
-- FIBRE. Veg was a tag beside protein/carbs/fat, so it could be ticked with no
-- carbs at all, and nuts or fruit had nowhere to go. It is now a property OF
-- the carbs: `carb_fibre_pct` is the share of the meal's carbs that came from
-- fibrous sources (veg, fruit, legumes, nuts), in quarter steps because nobody
-- can tell 37% from 45% on a plate. NULL = not recorded. The app clears it
-- whenever carbs are absent, so it is never a share of nothing.
--
-- WHY NO ANON POLICY on meal_presets: same reason as meal_logs (0032). The
-- showcase reads through the anon role, and what someone eats never travels
-- that way.

-- ---------------------------------------------------------------------------
-- 1. meal_presets
-- ---------------------------------------------------------------------------
create table public.meal_presets (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references public.profiles (id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 60),
  -- Vocabularies live in app.config.ts, as on meal_logs; guarded at the read
  -- boundary (getMealPresets), not by check constraints.
  size            text not null default 'medium',
  kind            text not null default 'meal',
  source          text not null default 'home',
  tags            text[] not null default '{}',
  tag_mix         jsonb,
  carb_fibre_pct  smallint check (carb_fibre_pct in (0, 25, 50, 75, 100)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One saved meal per name per owner, case- and edge-space-insensitively.
create unique index meal_presets_owner_name_unique
  on public.meal_presets (owner_user_id, lower(trim(name)));

alter table public.meal_presets enable row level security;

create policy mp_select_own on public.meal_presets
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy mp_insert_own on public.meal_presets
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy mp_update_own on public.meal_presets
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy mp_delete_own on public.meal_presets
  for delete to authenticated using (owner_user_id = (select auth.uid()));

comment on table public.meal_presets is
  'Saved meals: a named bundle (size/kind/source/tags/tag_mix/carb_fibre_pct) a meal draft is prefilled from. Values are copied on log. Owner-only — never add an anon policy.';

-- ---------------------------------------------------------------------------
-- 2. meal_logs: fibre share + link to the saved meal it started from
-- ---------------------------------------------------------------------------
-- MEAL_CARB_FIBRE_STEPS in app.config.ts must stay in step with this check.
alter table public.meal_logs
  add column carb_fibre_pct smallint check (carb_fibre_pct in (0, 25, 50, 75, 100)),
  add column preset_id uuid references public.meal_presets (id) on delete set null;

-- Covers the foreign key (the advisor flags an unindexed one) and the
-- set-null cascade on delete.
create index meal_logs_preset_idx on public.meal_logs (preset_id) where preset_id is not null;

comment on column public.meal_logs.carb_fibre_pct is
  'Share of this meal''s carbs from fibrous sources (veg, fruit, legumes, nuts): 0/25/50/75/100. NULL = not recorded, and always NULL when the meal has no carbs.';
comment on column public.meal_logs.preset_id is
  'The saved meal this log started from. Values were copied at log time; this is provenance only.';

-- ---------------------------------------------------------------------------
-- 3. Backfill: fold a recorded veg share into carbs
-- ---------------------------------------------------------------------------
-- Only rows whose tag_mix MEASURED veg. Veg was a share of the whole meal; it
-- becomes part of carbs, and its proportion of the new carbs total becomes the
-- fibre share, snapped to a quarter. A row tagged veg with no mix stays
-- unrecorded: a guessed share would read as a measurement. The `veg` TAG is
-- left in place on every row; the coach still reads it as history.
update public.meal_logs m
set
  tag_mix = (m.tag_mix - 'veg')
    || jsonb_build_object(
      'carbs',
      coalesce((m.tag_mix ->> 'carbs')::numeric, 0) + (m.tag_mix ->> 'veg')::numeric
    ),
  carb_fibre_pct = (
    round(
      4 * (m.tag_mix ->> 'veg')::numeric
        / (coalesce((m.tag_mix ->> 'carbs')::numeric, 0) + (m.tag_mix ->> 'veg')::numeric)
    ) * 25
  )::smallint,
  tags = case when 'carbs' = any (m.tags) then m.tags else array_append(m.tags, 'carbs') end
where m.tag_mix ? 'veg'
  and (m.tag_mix ->> 'veg')::numeric > 0;

update public.meal_logs
set tag_mix = nullif(tag_mix - 'veg', '{}'::jsonb)
where tag_mix ? 'veg';

-- ---------------------------------------------------------------------------
-- 4. Backfill: every distinct custom tag becomes a saved meal
-- ---------------------------------------------------------------------------
-- "Custom" = anything outside the vocabulary that has ever shipped
-- (protein, carbs, fat, veg, sweet, coffee). Each is seeded from the newest
-- meal carrying it. Some were descriptions rather than repeat meals ("3+ eggs
-- only"); they arrive as saved meals and can be deleted from the rail's
-- manage sheet. The mix is not carried over: a meal's split was a reading of
-- that meal, not a template.
with custom as (
  select
    m.owner_user_id, t.tag, m.size, m.kind, m.source, m.tags, m.carb_fibre_pct,
    m.log_date, m.eaten_time
  from public.meal_logs m
  cross join lateral unnest(m.tags) as t (tag)
  where t.tag <> all (array['protein', 'carbs', 'fat', 'veg', 'sweet', 'coffee'])
    and length(trim(t.tag)) between 1 and 60
),
seeded as (
  select distinct on (owner_user_id, lower(trim(tag))) *
  from custom
  order by owner_user_id, lower(trim(tag)), log_date desc, eaten_time desc
)
insert into public.meal_presets (owner_user_id, name, size, kind, source, tags, carb_fibre_pct)
select
  owner_user_id,
  upper(left(trim(tag), 1)) || substr(trim(tag), 2),
  size, kind, source,
  array(
    select x from unnest(tags) as x
    where x = any (array['protein', 'carbs', 'fat', 'sweet', 'coffee'])
  ),
  case when 'carbs' = any (tags) then carb_fibre_pct end
from seeded;

-- Link each meal to the saved meal named by its FIRST custom tag. A meal that
-- carried two custom tags keeps a link to one; the second survives only as a
-- saved meal of its own.
update public.meal_logs m
set preset_id = p.id
from public.meal_presets p
where p.owner_user_id = m.owner_user_id
  and lower(trim(p.name)) = (
    select lower(trim(t.tag))
    from unnest(m.tags) with ordinality as t (tag, ord)
    where t.tag <> all (array['protein', 'carbs', 'fat', 'veg', 'sweet', 'coffee'])
    order by t.ord
    limit 1
  );

-- Strip custom tags from `tags`, and custom keys from `tag_mix` (where they
-- sat as e.g. "post-workout": 0).
update public.meal_logs m
set
  tags = array(
    select x from unnest(m.tags) as x
    where x = any (array['protein', 'carbs', 'fat', 'veg', 'sweet', 'coffee'])
  ),
  tag_mix = case
    when m.tag_mix is null then null
    else nullif(
      (
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        from jsonb_each(m.tag_mix) as e
        where e.key = any (array['protein', 'carbs', 'fat', 'sweet', 'coffee'])
      ),
      '{}'::jsonb
    )
  end
where exists (
    select 1 from unnest(m.tags) as x
    where x <> all (array['protein', 'carbs', 'fat', 'veg', 'sweet', 'coffee'])
  )
  or (
    m.tag_mix is not null
    and exists (
      select 1 from jsonb_object_keys(m.tag_mix) as k
      where k <> all (array['protein', 'carbs', 'fat', 'sweet', 'coffee'])
    )
  );
