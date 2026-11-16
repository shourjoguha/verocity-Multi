-- Friends, send-to and accept (docs/SPEC.md §7C; original plan: git show edd9f53:docs/FRIENDS_SHARING_PLAN.md §4, §12).
--
-- FRIENDSHIP IS AN ADDRESS BOOK. It permits SENDING a snapshot to someone and
-- grants no read of anything. No RLS policy anywhere references `friendships`
-- (§9, §12.6): a future friend-read feature goes through grant-scoped
-- security-definer RPCs like `list_friends`, so the boundary stays in this one
-- reviewable file. The only cross-user data path is `shared_items.payload`,
-- written by `send_shared_items` from an allow-list, never `select *`.
--
-- Three tables, all write-locked to the client:
--   friend_codes  RLS on, zero policies, no grants. RPC-only.
--   friendships   either party may SELECT their own rows; writes are RPC-only.
--   shared_items  the recipient may SELECT their inbox; writes are RPC-only, so
--                 the recipient can never rewrite a payload or forge a sender.
--
-- Every RPC is SECURITY DEFINER with `search_path = ''`, checks auth.uid()
-- first, and is executable by `authenticated` only (revoked from public and
-- anon — Supabase's default privileges grant anon EXECUTE on new functions).
--
-- Caps are mirrored from FRIENDS in src/app.config.ts as `c_* constant`
-- declarations tagged `-- FRIENDS.<key>`; friendsConfig.test.ts reads this
-- file and fails when the two disagree. Change both.

-- ---------------------------------------------------------------------------
-- friend_codes
-- ---------------------------------------------------------------------------
create table public.friend_codes (
  owner_user_id uuid primary key references public.profiles (id) on delete cascade,
  code          text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at    timestamptz not null default now()
);
alter table public.friend_codes enable row level security;
revoke all on public.friend_codes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------
-- `status` is a check constraint that can gain values (§12.6). It encodes the
-- state of the pair only — never direction (that is requester/addressee) and
-- never permissions.
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'blocked')),
  blocked_by   uuid references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id),
  constraint friendships_blocked_by check (
    (status = 'blocked') = (blocked_by is not null)
    and (blocked_by is null or blocked_by in (requester_id, addressee_id))
  )
);
create unique index friendships_pair_unique on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);
create index friendships_requester_idx on public.friendships (requester_id, status);

alter table public.friendships enable row level security;
create policy friendships_select_party on public.friendships
  for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.friendships from anon, authenticated;
revoke all on public.friendships from anon;

-- ---------------------------------------------------------------------------
-- shared_items — the inbox
-- ---------------------------------------------------------------------------
create table public.shared_items (
  id              uuid primary key default gen_random_uuid(),
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  recipient_id    uuid not null references public.profiles (id) on delete cascade,
  -- display_name at send time. A snapshot, like the payload.
  sender_name     text not null,
  kind            text not null check (kind in ('log', 'plan')),
  -- One per send action; groups a date-range send.
  batch_id        uuid not null,
  title           text,
  item_date       date,
  -- Allow-listed snapshot (see send_shared_items). Nulled once acted on.
  payload         jsonb,
  status          text not null default 'pending'
                    check (status in ('pending', 'accepted', 'dismissed', 'removed')),
  created_at      timestamptz not null default now(),
  acted_at        timestamptz,
  -- §12.4: null until the SENDER has seen the acceptance notice.
  sender_seen_at  timestamptz,
  -- §12.5: the recipient's log the accept produced, and md5(data::text) of it
  -- at accept time, so a later bulk removal can say how many were edited.
  accepted_log_id uuid references public.workout_logs (id) on delete set null,
  accepted_digest text,
  constraint shared_items_not_self check (sender_id <> recipient_id),
  constraint shared_items_payload_pending check (status <> 'pending' or payload is not null)
);
create index shared_items_inbox_idx on public.shared_items (recipient_id, status, created_at desc);
create index shared_items_sender_idx on public.shared_items (sender_id, created_at desc);
create index shared_items_batch_idx on public.shared_items (batch_id);

alter table public.shared_items enable row level security;
-- Recipient reads their own inbox. No sender select (there is no "Sent" view;
-- the acceptance notice is list_acceptances, which never returns payload).
create policy si_select_recipient on public.shared_items
  for select to authenticated
  using (recipient_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.shared_items from anon, authenticated;
revoke all on public.shared_items from anon;

-- ---------------------------------------------------------------------------
-- workout_logs: review status and provenance
-- ---------------------------------------------------------------------------
-- `needs_review`: accepted from a friend and not yet confirmed. Counts nowhere
-- (stats, body map, coach, plan cycles) until it becomes `done`.
alter table public.workout_logs drop constraint workout_logs_status_check;
alter table public.workout_logs add constraint workout_logs_status_check
  check (status in ('planned', 'in_progress', 'paused', 'done', 'cancelled', 'needs_review'));

-- Provenance ("from Sam") and the idempotency guard: a retried accept cannot
-- insert the same item twice for one owner.
alter table public.workout_logs
  add column shared_item_id uuid references public.shared_items (id) on delete set null;
create unique index workout_logs_shared_item_unique
  on public.workout_logs (owner_user_id, shared_item_id)
  where shared_item_id is not null;

-- A showcase owner who accepts a friend's log must not publish the unreviewed
-- copy to anon. RESTRICTIVE, so it ANDs onto whatever logs_select_anon says
-- rather than restating it: live never received 0034, and its policy still
-- carries 0014's `source = 'manual'` guard, which a rewrite here would have
-- silently dropped (exposing the showcase's Garmin rows to anon).
create policy logs_select_anon_no_review on public.workout_logs
  as restrictive for select to anon
  using (status <> 'needs_review');

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Caller's friend code, created on first use; `p_rotate` replaces it (an old
-- code then resolves to nothing). Alphabet has no 0/O/1/I.
create function public.my_friend_code(p_rotate boolean default false)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  i int;
  attempt int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not p_rotate then
    select code into v_code from public.friend_codes where owner_user_id = v_uid;
    if v_code is not null then return v_code; end if;
  end if;
  loop
    attempt := attempt + 1;
    -- Two v4 uuids' random bytes. 256 % 32 = 0, so byte % 32 is uniform.
    v_bytes := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..7 loop
      -- Skip byte 6 (version nibble) of the first uuid.
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, case when i >= 6 then i + 10 else i end) % 32) + 1, 1);
    end loop;
    begin
      insert into public.friend_codes (owner_user_id, code) values (v_uid, v_code)
      on conflict (owner_user_id) do update set code = excluded.code, created_at = now();
      return v_code;
    exception when unique_violation then
      if attempt >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- Send a friend request by code. Unknown code, own code, an existing pair in
-- any state (pending either way, accepted, blocked by either side) all raise
-- the SAME error, so a code cannot be probed for who it belongs to or whether
-- they blocked you. The cap check runs first and concerns only the caller.
create function public.request_friend(p_code text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  c_pending_cap constant int := 20; -- FRIENDS.pendingRequestCap
  v_target uuid;
  v_id     uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from public.friendships
        where requester_id = v_uid and status = 'pending') >= c_pending_cap then
    raise exception 'request_cap';
  end if;
  select owner_user_id into v_target from public.friend_codes
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_target is null or v_target = v_uid then
    raise exception 'friend_request_failed';
  end if;
  begin
    insert into public.friendships (requester_id, addressee_id)
      values (v_uid, v_target) returning id into v_id;
  exception when unique_violation then
    raise exception 'friend_request_failed';
  end;
  return v_id;
end;
$$;

-- Addressee answers a pending request. Decline deletes the row, so the pair can
-- try again later (the requester's pending cap bounds the noise).
create function public.respond_friend(p_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
      where id = p_id and addressee_id = v_uid and status = 'pending';
  else
    delete from public.friendships
      where id = p_id and addressee_id = v_uid and status = 'pending';
  end if;
  if not found then raise exception 'not_found'; end if;
end;
$$;

-- Either party removes (unfriend, cancel a request, decline) or blocks.
-- Unfriend touches nothing that was delivered. Block also deletes the OTHER
-- party's pending items to the caller; accepted logs stay (§10 answer 4).
-- A block can be lifted only by whoever set it; the blocked party gets the
-- same not_found as for a row that does not exist.
create function public.remove_friend(p_id uuid, p_block boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.friendships%rowtype;
  v_other uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.friendships
    where id = p_id and v_uid in (requester_id, addressee_id)
    for update;
  if not found or (v_row.status = 'blocked' and v_row.blocked_by <> v_uid) then
    raise exception 'not_found';
  end if;
  v_other := case when v_row.requester_id = v_uid then v_row.addressee_id else v_row.requester_id end;
  if p_block then
    update public.friendships
      set status = 'blocked', blocked_by = v_uid, responded_at = now()
      where id = p_id;
    delete from public.shared_items
      where sender_id = v_other and recipient_id = v_uid and status = 'pending';
  else
    delete from public.friendships where id = p_id;
  end if;
end;
$$;

-- The caller's friendships as FriendSummary objects (one row = one object;
-- add columns, never reorder meaning). The only way a friend's name is read.
-- A blocked pair is listed only to the party who blocked.
create function public.list_friends()
returns table (
  friendship_id uuid,
  user_id       uuid,
  display_name  text,
  status        text,
  direction     text,
  created_at    timestamptz,
  responded_at  timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return query
    select f.id,
           p.id,
           p.display_name,
           f.status,
           case when f.requester_id = v_uid then 'outgoing' else 'incoming' end,
           f.created_at,
           f.responded_at
      from public.friendships f
      join public.profiles p
        on p.id = case when f.requester_id = v_uid then f.addressee_id else f.requester_id end
     where v_uid in (f.requester_id, f.addressee_id)
       and (f.status <> 'blocked' or f.blocked_by = v_uid)
     order by f.status, p.display_name;
end;
$$;

-- Snapshot one or more of the caller's own logs (status 'done' only) or plans
-- and deliver them to one accepted friend, under one batch_id. The payload is
-- built HERE from an allow-list:
--   log:  log_date, started_at, ended_at, total_seconds, activity_type, tags,
--         data.sections ONLY (data.session — sleep/energy/soreness — and any
--         other top-level key are never copied), and the sender's custom
--         movement rows named in the document (name, category, tags,
--         default_metrics, primary_metric, default_rest_seconds, taxonomy).
--   plan: name, start_date, end_date, parsed, source_markdown.
-- Never: ids, owner_user_id, plan_id, session_id, day_key, week_number,
-- hr_avg, hr_max, source, garmin_activity_id, row-level notes.
create function public.send_shared_items(p_recipient uuid, p_kind text, p_ids uuid[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  c_batch_max     constant int := 31;     -- FRIENDS.batchMaxItems
  c_daily_cap     constant int := 200;    -- FRIENDS.dailySendCap
  c_payload_bytes constant int := 262144; -- FRIENDS.maxPayloadBytes
  v_ids   uuid[];
  v_n     int;
  v_name  text;
  v_batch uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind is null or p_kind not in ('log', 'plan') then raise exception 'invalid_kind'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_ids) x where x is not null;
  v_n := cardinality(v_ids);
  if v_n = 0 or v_n > c_batch_max then raise exception 'batch_size'; end if;

  if p_recipient is null or p_recipient = v_uid or not exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and least(f.requester_id, f.addressee_id) = least(v_uid, p_recipient)
       and greatest(f.requester_id, f.addressee_id) = greatest(v_uid, p_recipient)
  ) then
    raise exception 'not_friends';
  end if;

  if (select count(*) from public.shared_items
        where sender_id = v_uid and created_at > now() - interval '1 day') + v_n > c_daily_cap then
    raise exception 'daily_cap';
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  if p_kind = 'log' then
    if (select count(*) from public.workout_logs
          where id = any (v_ids) and owner_user_id = v_uid and status = 'done') <> v_n then
      raise exception 'not_owned';
    end if;
    if exists (select 1 from public.workout_logs
                where id = any (v_ids) and octet_length(data::text) > c_payload_bytes) then
      raise exception 'payload_too_large';
    end if;
    insert into public.shared_items
      (sender_id, recipient_id, sender_name, kind, batch_id, title, item_date, payload)
    select v_uid, p_recipient, coalesce(v_name, ''), 'log', v_batch,
           coalesce(
             (select d ->> 'label'
                from public.plans pl, jsonb_array_elements(pl.parsed -> 'days') d
               where pl.id = l.plan_id and pl.owner_user_id = v_uid
                 and d ->> 'dayKey' = l.day_key
               limit 1),
             l.activity_type, l.tags[1], 'Session'),
           l.log_date,
           jsonb_build_object(
             'log_date', l.log_date,
             'started_at', l.started_at,
             'ended_at', l.ended_at,
             'total_seconds', l.total_seconds,
             'activity_type', l.activity_type,
             'tags', to_jsonb(l.tags),
             'data', jsonb_build_object(
               'sections',
               case when jsonb_typeof(l.data -> 'sections') = 'array'
                    then l.data -> 'sections' else '[]'::jsonb end),
             'movements', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'name', m.name,
                        'category', m.category,
                        'tags', to_jsonb(m.tags),
                        'default_metrics', to_jsonb(m.default_metrics),
                        'primary_metric', m.primary_metric,
                        'default_rest_seconds', m.default_rest_seconds,
                        'taxonomy', m.taxonomy)
                      order by m.name)
                 from public.movements m
                where m.owner_user_id = v_uid
                  and m.kind = 'movement'
                  and lower(btrim(m.name)) in (
                    select lower(btrim(n #>> '{}'))
                      from jsonb_path_query(l.data, '$.sections[*].groups[*].items[*].movement') n
                     where jsonb_typeof(n) = 'string')
             ), '[]'::jsonb)
           )
      from public.workout_logs l
     where l.id = any (v_ids) and l.owner_user_id = v_uid
     order by l.log_date, l.started_at nulls first;
  else
    if (select count(*) from public.plans
          where id = any (v_ids) and owner_user_id = v_uid) <> v_n then
      raise exception 'not_owned';
    end if;
    if exists (select 1 from public.plans
                where id = any (v_ids)
                  and octet_length(parsed::text) + octet_length(coalesce(source_markdown, '')) > c_payload_bytes) then
      raise exception 'payload_too_large';
    end if;
    insert into public.shared_items
      (sender_id, recipient_id, sender_name, kind, batch_id, title, item_date, payload)
    select v_uid, p_recipient, coalesce(v_name, ''), 'plan', v_batch, p.name, p.start_date,
           jsonb_build_object(
             'name', p.name,
             'start_date', p.start_date,
             'end_date', p.end_date,
             'parsed', p.parsed,
             'source_markdown', p.source_markdown)
      from public.plans p
     where p.id = any (v_ids) and p.owner_user_id = v_uid
     order by p.created_at;
  end if;
  return v_batch;
end;
$$;

-- Recipient acts on a pending item. Nulls the payload either way.
-- 'accepted' requires the caller's OWN log carrying this shared_item_id (a
-- plan accept passes null — plans are reviewed before insert and need no
-- digest), and records accepted_log_id + md5(data::text) of that log (§12.5).
-- Retrying an accept with the same log is a no-op, not an error.
create function public.set_shared_item_status(p_id uuid, p_status text, p_log_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_item   public.shared_items%rowtype;
  v_digest text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_status is null or p_status not in ('accepted', 'dismissed') then
    raise exception 'invalid_status';
  end if;
  select * into v_item from public.shared_items
    where id = p_id and recipient_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_item.status <> 'pending' then
    if v_item.status = 'accepted' and p_status = 'accepted'
       and v_item.accepted_log_id is not distinct from p_log_id then
      return;
    end if;
    raise exception 'not_pending';
  end if;

  if p_status = 'accepted' and v_item.kind = 'log' then
    select md5(l.data::text) into v_digest from public.workout_logs l
      where l.id = p_log_id and l.owner_user_id = v_uid and l.shared_item_id = p_id;
    if v_digest is null then raise exception 'log_mismatch'; end if;
  elsif p_log_id is not null then
    raise exception 'log_mismatch';
  end if;

  update public.shared_items
     set status = p_status,
         acted_at = now(),
         payload = null,
         accepted_log_id = case when p_status = 'accepted' then p_log_id end,
         accepted_digest = v_digest
   where id = p_id;
end;
$$;

-- §12.4: the caller's sent items that were ACCEPTED, one row per batch. Never
-- returns payload or any receiver data beyond their name and the count.
-- Dismissed and removed items are not reported (no rejection signal). The name
-- is read only through a live accepted friendship, so a blocked or ended
-- friendship suppresses the notice.
create function public.list_acceptances()
returns table (
  batch_id       uuid,
  recipient_id   uuid,
  recipient_name text,
  kind           text,
  accepted_count int,
  last_acted_at  timestamptz,
  seen           boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return query
    select s.batch_id,
           s.recipient_id,
           p.display_name,
           min(s.kind),
           count(*)::int,
           max(s.acted_at),
           bool_and(s.sender_seen_at is not null)
      from public.shared_items s
      join public.friendships f
        on f.status = 'accepted'
       and least(f.requester_id, f.addressee_id) = least(s.sender_id, s.recipient_id)
       and greatest(f.requester_id, f.addressee_id) = greatest(s.sender_id, s.recipient_id)
      join public.profiles p on p.id = s.recipient_id
     where s.sender_id = v_uid and s.status = 'accepted'
     group by s.batch_id, s.recipient_id, p.display_name
     order by max(s.acted_at) desc;
end;
$$;

create function public.mark_acceptances_seen(p_batch_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.shared_items set sender_seen_at = now()
   where sender_id = v_uid and batch_id = any (p_batch_ids)
     and status = 'accepted' and sender_seen_at is null;
end;
$$;

-- §12.5: delete the caller's logs that came from these accepted items.
-- Dry run returns { total, edited } where edited = the log's md5(data::text)
-- no longer matches accepted_digest. The real run deletes those logs and marks
-- the items 'removed'. An accepted item with no linked log left (folded into
-- the receiver's own log by Combine) is untouched.
create function public.remove_accepted_items(p_ids uuid[], p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_total  int;
  v_edited int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select count(*)::int,
         count(*) filter (where md5(l.data::text) is distinct from s.accepted_digest)::int
    into v_total, v_edited
    from public.shared_items s
    join public.workout_logs l
      on l.shared_item_id = s.id and l.owner_user_id = v_uid
   where s.id = any (p_ids) and s.recipient_id = v_uid and s.status = 'accepted';

  if not p_dry_run then
    with gone as (
      delete from public.workout_logs l
       using public.shared_items s
       where l.shared_item_id = s.id and l.owner_user_id = v_uid
         and s.id = any (p_ids) and s.recipient_id = v_uid and s.status = 'accepted'
      returning s.id as item_id
    )
    update public.shared_items set status = 'removed', acted_at = now()
     where id in (select item_id from gone);
  end if;
  return jsonb_build_object('total', v_total, 'edited', v_edited);
end;
$$;

-- Execute: authenticated only.
revoke execute on function public.my_friend_code(boolean)                 from public, anon;
revoke execute on function public.request_friend(text)                    from public, anon;
revoke execute on function public.respond_friend(uuid, boolean)           from public, anon;
revoke execute on function public.remove_friend(uuid, boolean)            from public, anon;
revoke execute on function public.list_friends()                          from public, anon;
revoke execute on function public.send_shared_items(uuid, text, uuid[])   from public, anon;
revoke execute on function public.set_shared_item_status(uuid, text, uuid) from public, anon;
revoke execute on function public.list_acceptances()                      from public, anon;
revoke execute on function public.mark_acceptances_seen(uuid[])           from public, anon;
revoke execute on function public.remove_accepted_items(uuid[], boolean)  from public, anon;

grant execute on function public.my_friend_code(boolean)                 to authenticated;
grant execute on function public.request_friend(text)                    to authenticated;
grant execute on function public.respond_friend(uuid, boolean)           to authenticated;
grant execute on function public.remove_friend(uuid, boolean)            to authenticated;
grant execute on function public.list_friends()                          to authenticated;
grant execute on function public.send_shared_items(uuid, text, uuid[])   to authenticated;
grant execute on function public.set_shared_item_status(uuid, text, uuid) to authenticated;
grant execute on function public.list_acceptances()                      to authenticated;
grant execute on function public.mark_acceptances_seen(uuid[])           to authenticated;
grant execute on function public.remove_accepted_items(uuid[], boolean)  to authenticated;
