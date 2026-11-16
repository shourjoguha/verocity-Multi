// You → Friends (docs/FRIENDS_SHARING_PLAN.md §5.1). An address book and
// nothing more: a friendship lets either side SEND the other a workout. It
// grants no read of anything, so there is no profile, no search and no list
// of other users here — only your code, the people you have paired with, and
// requests either way.
//
// Mounted inside a <Disclosure>, which renders its children whether or not it
// is open. my_friend_code CREATES a code row on first call, so nothing is
// fetched until the section is actually opened (or arrives open via
// `/app/you#friends`) — a code exists only for people who came looking.
import { useEffect, useRef, useState } from 'react';
import {
  getMyFriendCode,
  listFriends,
  removeFriend,
  requestFriend,
  respondFriend,
} from '@/lib/queries';
import type { FriendSummary } from '@/lib/types';
import { toast } from '@/lib/toast';
import { Button, FIELD } from '@/components/ui/primitives';
import { friendRequestError } from '@/components/friends/friendCopy';

const TEXT_BTN =
  'inline-flex min-h-11 shrink-0 items-center px-2 t-control text-muted transition-colors hover:text-fg disabled:opacity-40';

export function friendLink(code: string): string {
  return `${window.location.origin}/app/you?friend=${encodeURIComponent(code)}#friends`;
}

/** Incoming request: Accept / Decline. Shared with the inbox's Friend requests block. */
export function FriendRequestRow({ friend, onDone }: { friend: FriendSummary; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function answer(accept: boolean) {
    setBusy(true);
    const ok = await respondFriend(friend.friendship_id, accept);
    setBusy(false);
    if (!ok) {
      toast("Couldn't answer that request. Try again.", 'error');
      return;
    }
    toast(accept ? `You and ${friend.display_name} are now friends` : 'Request declined', 'success');
    onDone();
  }
  return (
    <li className="flex items-center gap-2 px-3 py-1">
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{friend.display_name}</span>
      <button type="button" disabled={busy} onClick={() => answer(false)} className={TEXT_BTN}>
        Decline
      </button>
      <Button variant="ghost" disabled={busy} onClick={() => answer(true)}>
        Accept
      </Button>
    </li>
  );
}

type Pending = { id: string; action: 'remove' | 'block' | 'cancel' | 'unblock' } | null;

const ACTION_LABEL = { remove: 'Remove', block: 'Block', cancel: 'Cancel request', unblock: 'Unblock' } as const;
const ACTION_QUESTION = {
  remove: 'Remove',
  block: 'Block',
  cancel: 'Cancel request to',
  unblock: 'Unblock',
} as const;

export function FriendsPanel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [addCode, setAddCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending>(null);
  const [acting, setActing] = useState(false);

  async function refresh() {
    setFriends(await listFriends());
  }

  // `?friend=CODE` is the copied link's payload: prefill the field, never
  // auto-send. A request goes out only when the owner taps.
  useEffect(() => {
    const prefill = new URLSearchParams(window.location.search).get('friend');
    if (prefill) setAddCode(prefill.slice(0, 32));
  }, []);

  useEffect(() => {
    const details = rootRef.current?.closest('details');
    let started = false;
    const load = async () => {
      if (started) return;
      started = true;
      const [c, f] = await Promise.all([getMyFriendCode(), listFriends()]);
      setCode(c);
      setFriends(f);
      setLoaded(true);
    };
    if (!details || details.open) {
      void load();
      return;
    }
    const onToggle = () => {
      if (details.open) void load();
    };
    details.addEventListener('toggle', onToggle);
    return () => details.removeEventListener('toggle', onToggle);
  }, []);

  async function copyLink() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(friendLink(code));
      toast('Link copied', 'success');
    } catch {
      toast(`Couldn't copy — your code is ${code}`, 'error');
    }
  }

  async function sendRequest() {
    const trimmed = addCode.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setAddError(null);
    const res = await requestFriend(trimmed);
    setAdding(false);
    if (!res.ok) {
      setAddError(friendRequestError(res.error));
      return;
    }
    setAddCode('');
    toast('Request sent', 'success');
    await refresh();
  }

  async function runConfirmed() {
    if (!confirm || acting) return;
    setActing(true);
    const ok = await removeFriend(confirm.id, confirm.action === 'block');
    setActing(false);
    setConfirm(null);
    if (!ok) {
      toast("Couldn't update. Try again.", 'error');
      return;
    }
    await refresh();
  }

  const incoming = friends.filter((f) => f.status === 'pending' && f.direction === 'incoming');
  const outgoing = friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing');
  const accepted = friends.filter((f) => f.status === 'accepted');
  const blocked = friends.filter((f) => f.status === 'blocked');

  // One row with an inline confirm: tapping Remove / Block turns the row into
  // the question, so a mis-tap on a 375px row costs nothing.
  const managedRow = (f: FriendSummary, actions: Exclude<Pending, null>['action'][], note?: string) => (
    <li key={f.friendship_id} className="flex min-h-11 items-center gap-2 px-3 py-1">
      {confirm?.id === f.friendship_id ? (
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-fg">
            {ACTION_QUESTION[confirm.action]} {f.display_name}?
          </span>
          <button type="button" onClick={() => setConfirm(null)} className={TEXT_BTN}>
            Keep
          </button>
          <Button variant="ghost" disabled={acting} onClick={runConfirmed}>
            {ACTION_LABEL[confirm.action]}
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-fg">
            {f.display_name}
            {note ? <span className="ml-2 t-label text-muted">{note}</span> : null}
          </span>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setConfirm({ id: f.friendship_id, action: a })}
              className={TEXT_BTN}
            >
              {a === 'cancel' ? 'Cancel' : ACTION_LABEL[a]}
            </button>
          ))}
        </>
      )}
    </li>
  );

  const list = (label: string, children: React.ReactNode) => (
    <div>
      <div className="t-label mb-1 text-muted">{label}</div>
      <ul className="rounded-control bg-bg [&>li+li]:border-t [&>li+li]:border-border-soft">{children}</ul>
    </div>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <div>
        <div className="t-label mb-1 text-muted">Your code</div>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate font-display text-xl tabular-nums tracking-[0.08em] text-fg">
            {code ?? (loaded ? 'Unavailable' : '········')}
          </span>
          <Button variant="ghost" onClick={copyLink} disabled={!code}>
            Copy link
          </Button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Friends can send each other workouts. Nobody can see your logs.
        </p>
      </div>

      <div>
        <label htmlFor="friend-code" className="t-label mb-1 block text-muted">
          Add by code
        </label>
        <div className="flex items-center gap-2">
          <input
            id="friend-code"
            value={addCode}
            onChange={(e) => {
              setAddCode(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendRequest();
            }}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. K7MX2QPA"
            className={`${FIELD} min-w-0 flex-1 uppercase tracking-[0.08em]`}
          />
          <Button onClick={sendRequest} disabled={adding || !addCode.trim()}>
            {adding ? 'Sending…' : 'Add'}
          </Button>
        </div>
        {addError ? (
          <p role="alert" className="mt-1 text-xs text-fg">
            {addError}
          </p>
        ) : null}
      </div>

      {incoming.length > 0
        ? list(
            'Requests',
            incoming.map((f) => <FriendRequestRow key={f.friendship_id} friend={f} onDone={refresh} />),
          )
        : null}

      {list(
        'Friends',
        accepted.length > 0 ? (
          accepted.map((f) => managedRow(f, ['remove', 'block']))
        ) : (
          <li className="px-3 py-3 text-sm text-muted">
            {loaded ? 'No friends yet. Share your code to pair up.' : 'Loading…'}
          </li>
        ),
      )}

      {outgoing.length > 0 ? list('Waiting for a reply', outgoing.map((f) => managedRow(f, ['cancel']))) : null}
      {blocked.length > 0 ? list('Blocked', blocked.map((f) => managedRow(f, ['unblock']))) : null}
    </div>
  );
}
