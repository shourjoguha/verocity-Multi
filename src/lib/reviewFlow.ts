// Reviewing a log a friend sent (the retired friends plan (git show edd9f53:docs/FRIENDS_SHARING_PLAN.md; now SPEC §7C) §5.4–5.6, §12.3).
// The pure half of the Logger's review mode and the inbox's Confirm as is:
//
// - The review QUEUE is the ordered subset the inbox handed over (Review all /
//   Review selected / a To review list), carried in the URL as `&queue=` —
//   not storage, so a reload, a back button or a second tab all see the same
//   queue and nothing has to be cleaned up when the user leaves mid-way.
//   Stepping skips anything already confirmed or discarded: the queue says
//   which logs, the database says which are still waiting.
// - confirmPatch is the one place `needs_review` becomes `done`, with the plan
//   link the Counts-toward control (or choosePlanDay) picked.
// - duplicateChoice decides what the same-day sheet may offer.
//
// Pure: no DOM, no storage, no queries.

import { FRIENDS } from '@/app.config';
import type { PlanLink } from '@/lib/sharedLog';
import type { WorkoutLog } from '@/lib/types';

const ID = /^[0-9A-Za-z-]{1,64}$/;

/** `?queue=` → ordered, de-duplicated ids. Junk entries are dropped, and the
 *  list is capped at one batch — it is a URL anyone can edit. */
export function parseQueue(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (ID.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= FRIENDS.batchMaxItems) break;
  }
  return out;
}

/** The Logger URL for reviewing `logId`, carrying the queue when there is one
 *  worth carrying (a queue of just this log is no queue). */
export function reviewHref(logId: string, queue: string[] = [], extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ logId, edit: '1', ...extra });
  if (queue.length > 1 || (queue.length === 1 && queue[0] !== logId)) p.set('queue', queue.join(','));
  return `/app/log?${p.toString()}`;
}

/**
 * The candidates after `current`, in the order to try them: the rest of the
 * queue after it, then the ones before it (a user who opened the third first
 * still has the first two waiting). `current` itself is never a candidate.
 */
export function queueCandidates(queue: string[], current: string): string[] {
  const at = queue.indexOf(current);
  if (at < 0) return queue.filter((id) => id !== current);
  return [...queue.slice(at + 1), ...queue.slice(0, at)];
}

/**
 * Where Confirm / Discard / Keep mine goes next: the first candidate that is
 * still a `needs_review` row of the caller's, or the inbox when none is.
 * `stillWaiting` is what the database says now; anything missing from it
 * (deleted, confirmed elsewhere) is skipped.
 */
export function nextReviewHref(
  queue: string[],
  current: string,
  stillWaiting: ReadonlyMap<string, Pick<WorkoutLog, 'status'>>,
): string {
  const next = queueCandidates(queue, current).find((id) => stillWaiting.get(id)?.status === 'needs_review');
  return next ? reviewHref(next, queue) : '/app/inbox';
}

export type ConfirmPatch = Pick<WorkoutLog, 'status' | 'plan_id' | 'day_key' | 'week_number'>;

/** The update that confirms a review row: `done`, attached to `link` or to
 *  nothing. Always writes all three link fields so a confirm never leaves a
 *  half link behind. */
export function confirmPatch(link: PlanLink | null): ConfirmPatch {
  return {
    status: 'done',
    plan_id: link?.plan_id ?? null,
    day_key: link?.day_key ?? null,
    week_number: link?.week_number ?? null,
  };
}

/** What the same-day sheet shows: the overlap as a whole percent, and whether
 *  Use shared is allowed — not when my original carries a Garmin activity
 *  (§5.5): that row holds the device's record, which the shared copy lacks. */
export function duplicateChoice(dup: { log: Pick<WorkoutLog, 'garmin_activity_id' | 'source'>; overlap: number }): {
  percent: number;
  canUseShared: boolean;
} {
  return {
    percent: Math.round(Math.max(0, Math.min(1, dup.overlap)) * 100),
    canUseShared: !dup.log.garmin_activity_id && dup.log.source !== 'garmin',
  };
}
