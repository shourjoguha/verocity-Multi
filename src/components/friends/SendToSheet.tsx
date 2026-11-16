// Send one or more of your finished workouts to friends (§5.2). Built on
// ui/Modal — no hand-rolled sheet — so it inherits the flicker contract: no
// animated scrim, immediate unmount, focus stops at the panel on touch.
//
// Four shapes, one sheet:
//   - `logIds`: a fixed set (the session page's single log).
//   - `rangeLogs`: the owner's history; the sheet shows a from/to picker and
//     sends every `done` log in that range, capped at FRIENDS.batchMaxItems.
//   - `planLogs`: every `done` log of one plan (the plan page's "Send this
//     plan's logs"). Over the cap, the sheet says so and the user must opt in
//     to the most recent FRIENDS.batchMaxItems — never truncated silently.
//   - `planId`: one plan (the plan page). Always exactly one per send.
//
// Every refusal reaches the user by name: sendError maps the RPC's code, and
// its detail (the refused ids) back to a date or the plan's title.
//
// Friendship lets you SEND; what goes is a snapshot built server-side by
// send_shared_items from an allow-list. Later edits here change nothing sent.
import { useEffect, useMemo, useState } from 'react';
import { FRIENDS } from '@/app.config';
import { listFriends, sendSharedItems } from '@/lib/queries';
import type { FriendSummary, WorkoutLog } from '@/lib/types';
import { ymdLocal } from '@/lib/streak';
import { addDays } from '@/lib/holidays';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button, FIELD } from '@/components/ui/primitives';
import { sendError } from '@/components/friends/friendCopy';

export function SendToSheet({
  open,
  onClose,
  logIds,
  rangeLogs,
  planLogs,
  planId,
  planName,
}: {
  open: boolean;
  onClose: () => void;
  logIds?: string[];
  rangeLogs?: WorkoutLog[];
  planLogs?: WorkoutLog[];
  planId?: string;
  /** Names the plan in a refusal ("Block A" is too large to send). */
  planName?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={planLogs ? "Send this plan's logs" : 'Send to a friend'}>
      <SendBody
        onClose={onClose}
        logIds={logIds}
        rangeLogs={rangeLogs}
        planLogs={planLogs}
        planId={planId}
        planName={planName}
      />
    </Modal>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// Mounted only while the sheet is open, so every open starts clean.
function SendBody({
  onClose,
  logIds,
  rangeLogs,
  planLogs,
  planId,
  planName,
}: {
  onClose: () => void;
  logIds?: string[];
  rangeLogs?: WorkoutLog[];
  planLogs?: WorkoutLog[];
  planId?: string;
  planName?: string;
}) {
  const [friends, setFriends] = useState<FriendSummary[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const today = ymdLocal(new Date());
  const [from, setFrom] = useState(() => addDays(today, -6));
  const [to, setTo] = useState(today);
  // planLogs over the cap: off until the user chooses the most recent ones.
  const [takeRecent, setTakeRecent] = useState(false);

  useEffect(() => {
    let active = true;
    listFriends().then((f) => {
      if (active) setFriends(f.filter((x) => x.status === 'accepted'));
    });
    return () => {
      active = false;
    };
  }, []);

  // Only `done` logs can be sent (the RPC refuses anything else as not_owned),
  // so a range never counts an in-progress or needs_review row.
  // Newest first, so "the most recent N" is a prefix.
  const planDone = useMemo(
    () =>
      (planLogs ?? [])
        .filter((l) => l.status === 'done')
        .sort((a, b) => b.log_date.localeCompare(a.log_date) || (b.started_at ?? '').localeCompare(a.started_at ?? '')),
    [planLogs],
  );
  const planOver = planDone.length > FRIENDS.batchMaxItems;

  const ids = useMemo(() => {
    if (planId) return [planId];
    if (planLogs) return (planOver && takeRecent ? planDone.slice(0, FRIENDS.batchMaxItems) : planDone).map((l) => l.id);
    if (!rangeLogs) return logIds ?? [];
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    return rangeLogs
      .filter((l) => l.status === 'done' && l.log_date >= lo && l.log_date <= hi)
      .map((l) => l.id);
  }, [rangeLogs, logIds, planLogs, planDone, planOver, takeRecent, planId, from, to]);

  const overCap = ids.length > FRIENDS.batchMaxItems;
  const kind = planId ? 'plan' : 'log';

  // What a refused id is called on screen: its date (and activity), or the plan.
  const byId = useMemo(() => new Map([...(rangeLogs ?? []), ...(planLogs ?? [])].map((l) => [l.id, l])), [rangeLogs, planLogs]);
  function describe(id: string): string {
    if (planId) return planName ? `"${planName}"` : 'That plan';
    const l = byId.get(id);
    if (!l) return ids.length === 1 ? 'this workout' : 'a workout';
    return `${formatDate(l.log_date)}${l.activity_type ? ` (${l.activity_type})` : ''}`;
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    if (sending || picked.size === 0 || ids.length === 0 || overCap) return;
    setSending(true);
    setErrors([]);
    const targets = (friends ?? []).filter((f) => picked.has(f.user_id));
    const failed: string[] = [];
    const sentTo: string[] = [];
    // One batch per friend: send_shared_items addresses one recipient.
    for (const f of targets) {
      const res = await sendSharedItems(f.user_id, kind, ids);
      if (res.ok) sentTo.push(f.display_name);
      else
        failed.push(
          `${f.display_name}: ${sendError(res.error, { name: f.display_name, kind, detail: res.detail, describe })}`,
        );
    }
    setSending(false);
    if (sentTo.length > 0) toast(`Sent ${planId ? 'your plan' : plural(ids.length, 'workout')} to ${sentTo.join(', ')}`, 'success');
    if (failed.length === 0) {
      onClose();
      return;
    }
    // Keep the sheet open on the ones that failed, so a retry sends only those.
    setPicked(new Set(targets.filter((f) => !sentTo.includes(f.display_name)).map((f) => f.user_id)));
    setErrors(failed);
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {rangeLogs ? (
          <div className="mb-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="t-label text-muted">From</span>
                <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={FIELD} />
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className="t-label text-muted">To</span>
                <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className={FIELD} />
              </label>
            </div>
            <p className={`mt-2 text-sm tabular-nums ${overCap ? 'text-fg' : 'text-muted'}`} aria-live="polite">
              {overCap
                ? `${plural(ids.length, 'finished workout')} in range — send at most ${FRIENDS.batchMaxItems} at once. Narrow the dates.`
                : ids.length === 0
                  ? 'No finished workouts in this range.'
                  : `${plural(ids.length, 'finished workout')} in range.`}
            </p>
          </div>
        ) : null}

        {planLogs ? (
          <div className="mb-4">
            <p className="text-sm tabular-nums text-muted" aria-live="polite">
              {planDone.length === 0
                ? 'No finished workouts on this plan yet.'
                : planOver
                  ? `${plural(planDone.length, 'finished workout')} on this plan — at most ${FRIENDS.batchMaxItems} go in one send.`
                  : `${plural(planDone.length, 'finished workout')} on this plan.`}
            </p>
            {planOver ? (
              <button
                type="button"
                aria-pressed={takeRecent}
                onClick={() => setTakeRecent((v) => !v)}
                className="hill-btn mt-2 inline-flex min-h-11 max-w-full items-center border px-4 t-control text-fg"
              >
                <span className="truncate">
                  Send the most recent {FRIENDS.batchMaxItems} (
                  {formatDate(planDone[FRIENDS.batchMaxItems - 1].log_date)} – {formatDate(planDone[0].log_date)})
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* One shape for loading, empty and loaded: a label over a 44px row.
            The list arrives mid-sheet-rise, and a panel that changes height
            while it animates is the churn audit:flicker fails on (LESSONS: "A
            sheet grows while it rises"). More friends than fit on one row
            still wrap and grow it. */}
        <div>
          <div className="t-label mb-2 text-muted">Send to</div>
          {friends === null ? (
            <div className="flex min-h-11 items-center text-sm text-muted">Loading friends…</div>
          ) : friends.length === 0 ? (
            <div className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm text-muted">
              No friends yet.
              <a href="/app/you#friends" className="inline-flex min-h-11 items-center text-fg underline underline-offset-2">
                Add a friend
              </a>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {friends.map((f) => (
                <button
                  key={f.user_id}
                  type="button"
                  aria-pressed={picked.has(f.user_id)}
                  onClick={() => toggle(f.user_id)}
                  className="hill-btn inline-flex min-h-11 max-w-full items-center border px-4 t-control text-fg"
                >
                  <span className="truncate">{f.display_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {errors.length > 0 ? (
          <ul role="alert" className="mt-4 flex flex-col gap-1 text-sm text-fg">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}

        <p className="mt-4 text-xs leading-relaxed text-muted">
          {planId
            ? 'They get a copy of the plan as it is now, and choose their own start date. Your logs do not go with it.'
            : 'They get a copy of the movements and sets as they are now. Movement notes go with it; your heart rate and readiness do not.'}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border-soft p-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={send} disabled={sending || picked.size === 0 || ids.length === 0 || overCap}>
          {sending ? 'Sending…' : picked.size > 1 ? `Send to ${picked.size}` : 'Send'}
        </Button>
      </div>
    </>
  );
}
