-- Friends limits (docs/SPEC.md §7C): a friend-code rate limit, larger send
-- caps, refusals that say which item, and one-batch-per-page inbox paging.
-- 0052 may already be applied live, so this replaces its functions rather than
-- editing it. Same discipline as 0052: SECURITY DEFINER with search_path = '',
-- auth.uid() checked first, executable by `authenticated` only.
--
-- Caps are mirrored from FRIENDS in src/app.config.ts as `c_* constant` lines
-- tagged `-- FRIENDS.<key>`. friendsConfig.test.ts reads the LATEST definition
-- of each function across the migrations and fails when the two disagree.

-- ---------------------------------------------------------------------------
-- friend_code_attempts — FAILED request_friend calls, for the rate limit
-- ---------------------------------------------------------------------------
-- RLS on, zero policies, no grants: reached only through request_friend.
-- Rows older than a day are pruned by request_friend itself, per caller.
create table public.friend_code_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index friend_code_attempts_user_idx on public.friend_code_attempts (user_id, created_at);
alter table public.friend_code_attempts enable row level security;
revoke all on public.friend_code_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- request_friend — now RETURNS a status instead of raising on refusal
-- ---------------------------------------------------------------------------
-- Why a status: a plpgsql `raise exception` rolls back every write the call
-- made, including the attempt row, so a limit that counted raised failures
-- would never trip. Refusals now return normally and the attempt row commits.
--
-- Returns { ok: true, id } or { ok: false, error } where error is one of:
--   too_many_attempts      FRIENDS.failedCodeAttemptsPerDay failures in the
--                          last 24h. Checked first, so past it even a valid
--                          code is refused. Not itself recorded, so the window
--                          rolls off a day after the failures.
--   request_cap            the caller's own pending-request cap. Not a failure.
--   friend_request_failed  unknown code, own code, any existing pair (pending
--                          either way, accepted, blocked by either side). ONE
--                          code for all of them, so a code cannot be probed.
--                          Recorded as a failed attempt.
-- not_authenticated still raises (there is no caller to rate-limit).
drop function public.request_friend(text);
create function public.request_friend(p_code text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  c_pending_cap     constant int := 20; -- FRIENDS.pendingRequestCap
  c_failed_attempts constant int := 20; -- FRIENDS.failedCodeAttemptsPerDay
  v_target uuid;
  v_id     uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- Serialise one caller's attempts so two parallel calls cannot both pass
  -- the count below.
  perform pg_advisory_xact_lock(hashtextextended('request_friend:' || v_uid::text, 0));
  delete from public.friend_code_attempts
   where user_id = v_uid and created_at < now() - interval '1 day';
  if (select count(*) from public.friend_code_attempts where user_id = v_uid) >= c_failed_attempts then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;
  if (select count(*) from public.friendships
        where requester_id = v_uid and status = 'pending') >= c_pending_cap then
    return jsonb_build_object('ok', false, 'error', 'request_cap');
  end if;
  select owner_user_id into v_target from public.friend_codes
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_target is not null and v_target <> v_uid then
    begin
      insert into public.friendships (requester_id, addressee_id)
        values (v_uid, v_target) returning id into v_id;
    exception when unique_violation then
      v_id := null;
    end;
  end if;
  if v_id is null then
    -- Outside the exception block, so it commits with the call.
    insert into public.friend_code_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'friend_request_failed');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- send_shared_items — larger caps, and every refusal says what it refused
-- ---------------------------------------------------------------------------
-- Same allow-list as 0052 (see its comment); only the caps and the errors
-- change. Error codes (the exception message) and their DETAIL:
--   invalid_kind       —
--   batch_size         detail = FRIENDS.batchMaxItems
--   not_friends        —
--   daily_cap          detail = items still sendable today
--   not_owned          detail = comma-separated ids that are not the caller's
--   not_done           detail = comma-separated ids of the caller's logs that
--                      are not `done` (logs only)
--   payload_too_large  detail = comma-separated ids over the byte cap
-- The UI maps each id back to a date or title; nothing here names content.
create or replace function public.send_shared_items(p_recipient uuid, p_kind text, p_ids uuid[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  c_batch_max          constant int := 120;     -- FRIENDS.batchMaxItems
  c_daily_cap          constant int := 200;     -- FRIENDS.dailySendCap
  c_log_payload_bytes  constant int := 262144;  -- FRIENDS.maxLogPayloadBytes
  c_plan_payload_bytes constant int := 1048576; -- FRIENDS.maxPlanPayloadBytes
  v_ids   uuid[];
  v_n     int;
  v_used  int;
  v_bad   text;
  v_name  text;
  v_batch uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind is null or p_kind not in ('log', 'plan') then raise exception 'invalid_kind'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_ids) x where x is not null;
  v_n := cardinality(v_ids);
  if v_n = 0 or v_n > c_batch_max then
    raise exception 'batch_size' using detail = c_batch_max::text;
  end if;

  if p_recipient is null or p_recipient = v_uid or not exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and least(f.requester_id, f.addressee_id) = least(v_uid, p_recipient)
       and greatest(f.requester_id, f.addressee_id) = greatest(v_uid, p_recipient)
  ) then
    raise exception 'not_friends';
  end if;

  select count(*)::int into v_used from public.shared_items
   where sender_id = v_uid and created_at > now() - interval '1 day';
  if v_used + v_n > c_daily_cap then
    raise exception 'daily_cap' using detail = greatest(0, c_daily_cap - v_used)::text;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  if p_kind = 'log' then
    select string_agg(x::text, ',') into v_bad from unnest(v_ids) x
     where not exists (select 1 from public.workout_logs l where l.id = x and l.owner_user_id = v_uid);
    if v_bad is not null then raise exception 'not_owned' using detail = v_bad; end if;
    select string_agg(l.id::text, ',') into v_bad from public.workout_logs l
     where l.id = any (v_ids) and l.owner_user_id = v_uid and l.status <> 'done';
    if v_bad is not null then raise exception 'not_done' using detail = v_bad; end if;
    select string_agg(l.id::text, ',') into v_bad from public.workout_logs l
     where l.id = any (v_ids) and l.owner_user_id = v_uid and octet_length(l.data::text) > c_log_payload_bytes;
    if v_bad is not null then raise exception 'payload_too_large' using detail = v_bad; end if;
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
    select string_agg(x::text, ',') into v_bad from unnest(v_ids) x
     where not exists (select 1 from public.plans p where p.id = x and p.owner_user_id = v_uid);
    if v_bad is not null then raise exception 'not_owned' using detail = v_bad; end if;
    select string_agg(p.id::text, ',') into v_bad from public.plans p
     where p.id = any (v_ids) and p.owner_user_id = v_uid
       and octet_length(p.parsed::text) + octet_length(coalesce(p.source_markdown, '')) > c_plan_payload_bytes;
    if v_bad is not null then raise exception 'payload_too_large' using detail = v_bad; end if;
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

-- ---------------------------------------------------------------------------
-- list_inbox_batches — the inbox pages by batch, never by row
-- ---------------------------------------------------------------------------
-- One row per batch of the caller's inbox that has an item in `p_statuses`,
-- newest first. SECURITY INVOKER: it reads only what si_select_recipient
-- already lets the caller read, and the recipient predicate is restated so it
-- is obvious without the policy.
create function public.list_inbox_batches(p_statuses text[])
returns table (
  batch_id    uuid,
  sender_name text,
  kind        text,
  item_count  int,
  created_at  timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select s.batch_id, min(s.sender_name), min(s.kind), count(*)::int, max(s.created_at)
    from public.shared_items s
   where s.recipient_id = (select auth.uid()) and s.status = any (p_statuses)
   group by s.batch_id
   order by max(s.created_at) desc, s.batch_id;
$$;

revoke execute on function public.request_friend(text)                  from public, anon;
revoke execute on function public.send_shared_items(uuid, text, uuid[]) from public, anon;
revoke execute on function public.list_inbox_batches(text[])            from public, anon;
grant execute on function public.request_friend(text)                  to authenticated;
grant execute on function public.send_shared_items(uuid, text, uuid[]) to authenticated;
grant execute on function public.list_inbox_batches(text[])            to authenticated;
