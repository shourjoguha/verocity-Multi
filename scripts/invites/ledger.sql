-- Invite ledger. Service-role only: run through the Supabase MCP (execute_sql).
-- Views are defined in supabase/migrations/0051_invite_ledger.sql.

-- Headroom: cap, signed-up profiles, spots left, and how many of those spots
-- already have an open (unused, unexpired) code out in the world.
select * from public.invite_capacity;

-- Every code ever minted, newest first. Status is derived: open / used / expired.
select status, label, code_hint, created_at::date as created, expires_at::date as expires,
       used_at::date as used, used_by_name
from public.invite_ledger
order by created_at desc;

-- Kill an open code (e.g. sent to the wrong person). Match it by its last 4.
-- update public.invites set expires_at = now() where code_hint = 'XXXX' and used_at is null;
