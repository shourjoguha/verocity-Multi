// Human copy for the friends / send-to RPC error codes (migrations 0052,
// 0053), and the one label for a log's status. request_friend returns ONE code
// for every refusal about the code itself, so a friend code cannot be probed —
// the UI must not invent a more specific reason. send_shared_items is the
// opposite: every refusal is specific, and names the item(s) it refused via the
// error detail, which the caller maps back to a date or title.
//
// The two lists below are every code the RPCs can produce for a signed-in
// caller. friendCopy.test.ts checks both against the SQL and that each has its
// own copy, so a new refusal cannot reach the user as "check your connection".
import { FRIENDS } from '@/app.config';
import type { LogStatus } from '@/lib/types';

export const FRIEND_REQUEST_ERRORS = ['friend_request_failed', 'request_cap', 'too_many_attempts'] as const;
export const SEND_ERRORS = [
  'invalid_kind',
  'batch_size',
  'not_friends',
  'daily_cap',
  'not_owned',
  'not_done',
  'payload_too_large',
] as const;

const NETWORK = "Check your connection and try again.";

export function friendRequestError(code: string): string {
  if (code === 'too_many_attempts')
    return `Too many codes that didn't work today. Try again tomorrow.`;
  if (code === 'request_cap')
    return `You already have ${FRIENDS.pendingRequestCap} requests waiting. Cancel one, or wait for a reply.`;
  if (code === 'friend_request_failed') return "That code didn't work. Check it with your friend and try again.";
  return `Couldn't send the request. ${NETWORK}`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "Mon 3 Jun, Tue 4 Jun and 3 more" from the ids in an error detail. */
function nameIds(detail: string | undefined, describe: (id: string) => string): string {
  const ids = (detail ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (ids.length === 0) return '';
  const shown = ids.slice(0, 3).map(describe);
  return ids.length > 3 ? `${shown.join(', ')} and ${ids.length - 3} more` : shown.join(', ');
}

export type SendErrorContext = {
  /** The friend the send was addressed to. */
  name?: string;
  kind?: 'log' | 'plan';
  /** The RPC's error detail: ids, or a number for batch_size / daily_cap. */
  detail?: string;
  /** Maps a refused id to what the user knows it by (a date, a plan title). */
  describe?: (id: string) => string;
};

export function sendError(code: string, ctx: SendErrorContext = {}): string {
  const kind = ctx.kind ?? 'log';
  const noun = kind === 'plan' ? 'plan' : 'workout';
  const describe = ctx.describe ?? (() => (kind === 'plan' ? 'that plan' : 'a workout'));
  const named = nameIds(ctx.detail, describe);
  switch (code) {
    case 'not_friends':
      return `${ctx.name ?? 'That person'} isn't on your friends list any more.`;
    case 'not_owned':
      return kind === 'plan'
        ? "That plan isn't yours to send, or was deleted."
        : `Not yours to send, or deleted: ${named || 'one of those workouts'}.`;
    case 'not_done':
      return `Only finished workouts can be sent. Not finished: ${named || 'one of those workouts'}.`;
    case 'batch_size':
      return `Send at most ${plural(Number(ctx.detail) || FRIENDS.batchMaxItems, noun)} at once.`;
    case 'daily_cap': {
      const left = Number(ctx.detail);
      return Number.isFinite(left) && left > 0
        ? `Only ${plural(left, 'more item')} can go today (the limit is ${FRIENDS.dailySendCap} a day). Send fewer, or try again tomorrow.`
        : `You've reached today's limit of ${FRIENDS.dailySendCap} sent items. Try again tomorrow.`;
    }
    case 'payload_too_large':
      return kind === 'plan'
        ? `${named || 'That plan'} is too large to send (over ${Math.round(FRIENDS.maxPlanPayloadBytes / 1_048_576)} MB).`
        : `Too large to send: ${named || 'one of those workouts'}. Leave it out and try again.`;
    case 'invalid_kind':
      return "Couldn't send: that isn't a workout or a plan.";
    default:
      return `Couldn't send. ${NETWORK}`;
  }
}

// What every surface prints for a status. `done` says nothing — it is the
// normal case — and the raw `needs_review` never reaches the screen.
export const LOG_STATUS_LABEL: Record<LogStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  paused: 'Paused',
  done: 'Done',
  cancelled: 'Cancelled',
  needs_review: 'Needs review',
};

/** The short marker for a history row whose log is a friend's, unconfirmed. */
export const REVIEW_MARK = 'Review';
