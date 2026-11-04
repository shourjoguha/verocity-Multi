-- Invite ledger: who each invite code was for, and where every code stands.
--
-- `invites` stores only sha-256 hashes, so a plaintext code can never be
-- recovered from the database. That stays true: `code_hint` keeps the last 4
-- characters only, enough to match a code someone reads back to you, not
-- enough to redeem one. `label` is free text (who it was sent to).
--
-- Status is DERIVED, never stored, so it cannot drift from what the signup
-- function actually enforces (supabase/functions/signup/index.ts):
--   used    -> used_at is set
--   expired -> unused and expires_at has passed
--   open    -> unused and not expired (redeemable right now)
--
-- Both views are service-role only. They are security_invoker over `invites`
-- (RLS on, zero policies), and select is revoked from anon/authenticated as a
-- second lock, so they read nothing from the client.

alter table public.invites
  add column label     text check (label is null or char_length(label) <= 120),
  add column code_hint text check (code_hint is null or char_length(code_hint) = 4);

create view public.invite_ledger
with (security_invoker = true) as
select
  i.id,
  i.label,
  i.code_hint,
  case
    when i.used_at is not null then 'used'
    when i.expires_at is not null and i.expires_at <= now() then 'expired'
    else 'open'
  end as status,
  i.created_at,
  i.expires_at,
  i.used_at,
  i.used_by,
  p.display_name as used_by_name
from public.invites i
left join public.profiles p on p.id = i.used_by;

-- 100 mirrors PROFILE_CAP in supabase/functions/signup/index.ts. Change both.
create view public.invite_capacity
with (security_invoker = true) as
with c as (
  select
    100 as profile_cap,
    (select count(*) from public.profiles)::int as profiles,
    (select count(*) from public.invite_ledger where status = 'open')::int as open_codes,
    (select count(*) from public.invite_ledger where status = 'used')::int as used_codes,
    (select count(*) from public.invite_ledger where status = 'expired')::int as expired_codes
)
select
  profile_cap,
  profiles,
  greatest(profile_cap - profiles, 0) as spots_left,
  open_codes,
  used_codes,
  expired_codes,
  greatest(profile_cap - profiles - open_codes, 0) as spots_without_a_code
from c;

revoke all on public.invite_ledger   from anon, authenticated;
revoke all on public.invite_capacity from anon, authenticated;

comment on view public.invite_ledger is
  'One row per invite code with derived status (open/used/expired). Service-role only. Plaintext codes are never stored; code_hint is the last 4 characters.';
comment on view public.invite_capacity is
  'Signup headroom: cap, profiles, spots left, and how many of those spots already have an open code. Service-role only.';
