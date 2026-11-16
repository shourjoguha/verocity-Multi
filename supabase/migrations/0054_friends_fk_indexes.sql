-- Covering indexes for the three foreign keys 0052 added without one, flagged
-- by the performance advisor (unindexed_foreign_keys) after 0052/0053 went
-- live. Each FK is `on delete cascade | set null`, so without an index every
-- delete of the referenced row scans the referencing table. Partial on
-- `is not null` because most rows never set these columns.
create index if not exists friendships_blocked_by_idx
  on public.friendships (blocked_by) where blocked_by is not null;
create index if not exists shared_items_accepted_log_idx
  on public.shared_items (accepted_log_id) where accepted_log_id is not null;
create index if not exists workout_logs_shared_item_idx
  on public.workout_logs (shared_item_id) where shared_item_id is not null;
