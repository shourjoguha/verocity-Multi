-- Garmin integration — connection / token custody (plan §6, §14B).
-- One row per user holding the encrypted Garmin credential used by the ingestion
-- worker (the unofficial daily client now; the official OAuth2 tokens later — the
-- same columns serve both). This table is the security-sensitive custody surface:
-- like `invites`, it has NO client RLS policies, so the anon/authenticated roles
-- cannot read or write it at all. All access is service-role (the worker / edge
-- functions). The browser sees only a safe status subset via the
-- `garmin_connection_status` view below.
create table public.garmin_connections (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null unique references public.profiles (id) on delete cascade,
  -- Garmin's own user id, when known (official path / client profile lookup).
  provider_user_id  text unique,
  -- Encrypted at rest (Supabase Vault or pgcrypto — done in the worker/function,
  -- never the browser). For the unofficial client this holds the saved OAuth
  -- token blob; the raw Garmin password is NEVER persisted.
  access_token_enc  bytea,
  refresh_token_enc bytea,
  scopes            text[] not null default '{}',
  token_expires_at  timestamptz,
  status            text not null default 'pending'
                      check (status in ('pending','connected','needs_reconnect','revoked','error')),
  connected_at      timestamptz,
  last_sync_at      timestamptz,
  backfill_status   text not null default 'pending'
                      check (backfill_status in ('pending','running','done','error')),
  backfill_from     date,
  backfill_to       date,
  last_error        text,
  created_at        timestamptz not null default now()
);

alter table public.garmin_connections enable row level security;
-- No policies → all client (anon + authenticated) access denied; service-role only.

-- Safe, owner-scoped read of connection STATUS only — never the token columns.
-- security_invoker is left off (default) so the view body runs as its owner and
-- bypasses the table's deny-all RLS, while the WHERE clause restricts each row to
-- the requesting user (auth.uid() reads the request JWT regardless of the
-- executing role — the standard Supabase "safe subset view" pattern). Granted to
-- authenticated only; anon never sees Garmin data (health PII).
create view public.garmin_connection_status as
  select
    owner_user_id,
    status,
    connected_at,
    last_sync_at,
    backfill_status,
    backfill_from,
    backfill_to,
    scopes,
    last_error
  from public.garmin_connections
  where owner_user_id = (select auth.uid());

grant select on public.garmin_connection_status to authenticated;
