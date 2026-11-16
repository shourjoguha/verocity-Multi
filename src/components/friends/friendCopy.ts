// Human copy for the friends / send-to RPC error codes (migration 0052), and
// the one label for a log's status. The RPCs raise bare codes on purpose —
// request_friend in particular raises ONE code for every refusal so a friend
// code cannot be probed — so the UI must not invent a more specific reason.
import { FRIENDS } from '@/app.config';
import type { LogStatus } from '@/lib/types';

export function friendRequestError(code: string): string {
  if (code === 'request_cap')
    return `You already have ${FRIENDS.pendingRequestCap} requests waiting. Cancel one, or wait for a reply.`;
  if (code === 'friend_request_failed') return "That code didn't work. Check it with your friend and try again.";
  return "Couldn't send the request. Check your connection and try again.";
}

export function sendError(code: string, name?: string, kind: 'log' | 'plan' = 'log'): string {
  switch (code) {
    case 'not_friends':
      return `${name ?? 'That person'} isn't on your friends list any more.`;
    case 'not_owned':
      return kind === 'plan' ? "That plan isn't yours to send." : 'Only finished workouts of yours can be sent.';
    case 'batch_size':
      return `Send at most ${FRIENDS.batchMaxItems} workouts at once.`;
    case 'daily_cap':
      return `You've reached today's limit of ${FRIENDS.dailySendCap} sent items. Try again tomorrow.`;
    case 'payload_too_large':
      return kind === 'plan' ? 'That plan is too large to send.' : 'One of those workouts is too large to send.';
    default:
      return "Couldn't send. Check your connection and try again.";
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
