// /app/inbox (the retired friends plan (git show edd9f53:docs/FRIENDS_SHARING_PLAN.md; now SPEC §7C) §5.3, §12.1, §12.2, §12.4, §12.5).
// Four blocks, in this order, and the order is the point — what needs YOU
// first:
//   1. To review — your own needs_review logs (accepted, not yet confirmed).
//   2. Friend requests.
//   3. Shared with you — pending items, grouped by batch, Newer / Older pages.
//   4. Accepted by friends — the sender notice; marked seen once rendered.
// Then accepted / dismissed history behind a Disclosure, with Remove from my
// logs.
//
// Read on load only. No realtime and no polling: the bell and this page agree
// because both count on page load (getInboxCounts / these same reads).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getActivePlan,
  getInboxPage,
  getMovements,
  listAcceptances,
  listFriends,
  markAcceptancesSeen,
  removeAcceptedItems,
  setSharedItemStatus,
} from '@/lib/queries';
import { invalidateLogs, loadAllLogs } from '@/lib/logStore';
import { sameDayOverlap, validateSharedLogPayload } from '@/lib/sharedLog';
import { readSharedPlanPayload } from '@/lib/sharedPlan';
import type { Acceptance, FriendSummary, SharedItem, WorkoutLog } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Item, PageStagger } from '@/components/anim';
import { Disclosure } from '@/components/ui/Disclosure';
import { Modal } from '@/components/ui/Modal';
import { Button, EmptyState, LoadingScreen, SectionHeader, Tag } from '@/components/ui/primitives';
import { FriendRequestRow } from '@/components/friends/FriendsPanel';
import { AcceptPlanSheet, type AcceptablePlan } from '@/components/inbox/AcceptPlanSheet';
import { acceptMany, acceptSharedLog, bulkToast, type LogItem } from '@/components/inbox/acceptShared';
import { canConfirmAsIs, confirmAsIs } from '@/components/inbox/confirmReview';
import { reviewHref } from '@/lib/reviewFlow';

const TEXT_BTN =
  'inline-flex min-h-11 shrink-0 items-center px-2 t-control text-muted transition-colors hover:text-fg disabled:opacity-40';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function groupByBatch(items: SharedItem[]): { batchId: string; sender: string; items: SharedItem[] }[] {
  const out = new Map<string, { batchId: string; sender: string; items: SharedItem[] }>();
  for (const it of items) {
    const g = out.get(it.batch_id) ?? { batchId: it.batch_id, sender: it.sender_name, items: [] };
    g.items.push(it);
    out.set(it.batch_id, g);
  }
  return [...out.values()];
}

// Pick-many toggle (CLAUDE.md: aria-pressed, on = accent, off = tappable). The
// button is the 44px target; the visible box is a 20px span inside it, pulled
// back with -my so the row does not grow.
function SelectToggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className="-my-1 -ml-2 flex h-11 w-11 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden
        className={`flex h-5 w-5 items-center justify-center rounded-chip border text-xs transition-colors ${
          on ? 'border-accent bg-accent text-accent-fg' : 'border-transparent bg-tappable'
        }`}
      >
        {on ? '✓' : ''}
      </span>
    </button>
  );
}

function Pager({
  page,
  hasMore,
  onPage,
  label,
}: {
  page: number;
  hasMore: boolean;
  onPage: (p: number) => void;
  label: string;
}) {
  if (page === 0 && !hasMore) return null;
  return (
    <nav aria-label={label} className="mt-3 flex items-center justify-between gap-2">
      <Button variant="ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>
        Newer
      </Button>
      <span className="t-label tabular-nums text-muted">Page {page + 1}</span>
      <Button variant="ghost" disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Older
      </Button>
    </nav>
  );
}

export default function InboxView() {
  return (
    <ErrorBoundary>
      <Inbox />
    </ErrorBoundary>
  );
}

function Inbox() {
  const [ready, setReady] = useState(false);
  const [myLogs, setMyLogs] = useState<WorkoutLog[]>([]);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<{ items: SharedItem[]; hasMore: boolean }>({ items: [], hasMore: false });
  const [histPage, setHistPage] = useState(0);
  const [history, setHistory] = useState<{ items: SharedItem[]; hasMore: boolean }>({ items: [], hasMore: false });
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  // Selection is local and per page; it never persists (§12.2).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [removal, setRemoval] = useState<{ ids: string[]; total: number; edited: number } | null>(null);

  const loadLogs = useCallback(async () => {
    invalidateLogs();
    setMyLogs(await loadAllLogs());
  }, []);
  const loadPending = useCallback(async (p: number) => {
    setPending(await getInboxPage(p, ['pending']));
  }, []);
  const loadHistory = useCallback(async (p: number) => {
    setHistory(await getInboxPage(p, ['accepted', 'dismissed', 'removed']));
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const [logs, fr, pend, hist, acc] = await Promise.all([
        loadAllLogs(),
        listFriends(),
        getInboxPage(0, ['pending']),
        getInboxPage(0, ['accepted', 'dismissed', 'removed']),
        listAcceptances(),
      ]);
      setMyLogs(logs);
      setFriends(fr);
      setPending(pend);
      setHistory(hist);
      setAcceptances(acc);
      setReady(true);
    })();
  }, []);

  // §12.4: the notice is seen once the inbox has rendered it. The "New" tags
  // stay for this visit (the local rows keep `seen: false`).
  useEffect(() => {
    if (!ready) return;
    const unseen = acceptances.filter((a) => !a.seen).map((a) => a.batch_id);
    if (unseen.length) void markAcceptancesSeen(unseen);
  }, [ready, acceptances]);

  const toReview = useMemo(
    () => myLogs.filter((l) => l.status === 'needs_review').sort((a, b) => b.log_date.localeCompare(a.log_date)),
    [myLogs],
  );
  const incoming = friends.filter((f) => f.status === 'pending' && f.direction === 'incoming');
  const senderByLog = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of history.items) if (it.accepted_log_id) m.set(it.accepted_log_id, it.sender_name);
    return m;
  }, [history.items]);

  // Validated once per row: the payload is another user's, so nothing below
  // reads it raw. A row that fails can only be dismissed.
  const parsed = useMemo(() => {
    const m = new Map<string, ReturnType<typeof validateSharedLogPayload>>();
    for (const it of pending.items) if (it.kind === 'log') m.set(it.id, validateSharedLogPayload(it.payload));
    return m;
  }, [pending.items]);
  const parsedPlans = useMemo(() => {
    const m = new Map<string, ReturnType<typeof readSharedPlanPayload>>();
    for (const it of pending.items) if (it.kind === 'plan') m.set(it.id, readSharedPlanPayload(it.payload));
    return m;
  }, [pending.items]);
  const [planTarget, setPlanTarget] = useState<AcceptablePlan | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function refreshAfterAccept() {
    setSelected(new Set());
    await Promise.all([loadLogs(), loadPending(page), loadHistory(histPage)]);
  }

  async function reviewOne(item: LogItem) {
    if (busy) return;
    setBusy(true);
    const library = await getMovements();
    const res = await acceptSharedLog(item, 'needs_review', null, library, [...myLogs]);
    if (!res.ok) {
      setBusy(false);
      toast(res.error, 'error');
      return;
    }
    window.location.href = reviewHref(res.log.id);
  }

  // §5.4.5: the receiver did exactly what the sender did. Same Confirm as the
  // Logger's, plan link by choosePlanDay, without opening the editor.
  async function confirmOne(log: WorkoutLog) {
    if (busy) return;
    setBusy(true);
    const ok = await confirmAsIs(log, await getActivePlan(), myLogs);
    setBusy(false);
    toast(ok ? 'Confirmed' : "Couldn't confirm. Check your connection and try again.", ok ? 'success' : 'error');
    if (ok) await loadLogs();
  }

  async function dismiss(ids: string[]) {
    if (busy || ids.length === 0) return;
    setBusy(true);
    let failed = 0;
    for (const id of ids) if (!(await setSharedItemStatus(id, 'dismissed'))) failed += 1;
    setBusy(false);
    toast(failed ? `${failed} couldn't be dismissed` : `Dismissed ${plural(ids.length, 'item')}`, failed ? 'error' : 'success');
    setSelected(new Set());
    await Promise.all([loadPending(page), loadHistory(histPage)]);
  }

  async function bulk(items: LogItem[], review: boolean) {
    if (busy || items.length === 0) return;
    setBusy(true);
    const [plan, library] = await Promise.all([getActivePlan(), getMovements()]);
    const res = await acceptMany(items, { review, plan, library, myLogs: [...myLogs] });
    setBusy(false);
    toast(bulkToast(res, review), res.failed.length ? 'error' : 'success');
    // Review all / selected opens the first and hands the Logger the reviewed
    // subset, in inbox order; Confirm steps through it (§5.4.3, §12.2).
    if (review && res.needReview[0]) {
      window.location.href = reviewHref(
        res.needReview[0].id,
        res.needReview.map((l) => l.id),
      );
      return;
    }
    await refreshAfterAccept();
  }

  async function askRemove(ids: string[]) {
    if (busy || ids.length === 0) return;
    setBusy(true);
    const dry = await removeAcceptedItems(ids, true);
    setBusy(false);
    if (!dry) {
      toast("Couldn't check those logs. Try again.", 'error');
      return;
    }
    if (dry.total === 0) {
      toast('None of those are in your logs any more', 'info');
      return;
    }
    setRemoval({ ids, ...dry });
  }

  async function confirmRemove() {
    if (!removal || busy) return;
    setBusy(true);
    const res = await removeAcceptedItems(removal.ids, false);
    setBusy(false);
    setRemoval(null);
    if (!res) {
      toast("Couldn't remove those logs. Try again.", 'error');
      return;
    }
    toast(`Removed ${plural(res.total, 'log')}`, 'success');
    setSelected(new Set());
    await Promise.all([loadLogs(), loadHistory(histPage)]);
  }

  if (!ready) return <LoadingScreen />;

  const pendingGroups = groupByBatch(pending.items);
  const historyGroups = groupByBatch(history.items);
  const nothing =
    toReview.length === 0 && incoming.length === 0 && pending.items.length === 0 && page === 0 && acceptances.length === 0;

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Item>
        <EchoText text="INBOX" as="h1" className={`mb-6 ${ECHO_APP_TITLE}`} />
      </Item>

      {nothing ? (
        <Item>
          <div className="mb-6">
            <EmptyState>
              Nothing waiting. Workouts friends send you land here.{' '}
              <a href="/app/you#friends" className="inline-flex min-h-11 items-center text-fg underline underline-offset-2">
                Friends
              </a>
            </EmptyState>
          </div>
        </Item>
      ) : null}

      {toReview.length > 0 ? (
        <Item>
          <section className="mb-6">
            <SectionHeader
              action={
                toReview.length > 1 ? (
                  <a
                    href={reviewHref(toReview[0].id, toReview.map((l) => l.id))}
                    className="inline-flex min-h-11 items-center t-control text-fg"
                  >
                    Review all {toReview.length}
                  </a>
                ) : (
                  <span className="t-label tabular-nums text-muted">{toReview.length}</span>
                )
              }
            >
              To review
            </SectionHeader>
            <ul className="overflow-hidden rounded-card border border-outline bg-surface [&>li+li]:border-t [&>li+li]:border-border-soft">
              {toReview.map((l) => {
                const asIs = canConfirmAsIs(l, myLogs);
                return (
                  <li key={l.id} className="flex items-center">
                    <a
                      href={reviewHref(l.id, toReview.map((x) => x.id))}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pl-3 pr-2 transition-colors hover:bg-tappable"
                    >
                      <span className="w-14 shrink-0 text-xs tabular-nums text-subtle">{formatDate(l.log_date)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {l.activity_type ?? 'Workout'}
                        {senderByLog.get(l.id) ? (
                          <span className="text-muted"> · from {senderByLog.get(l.id)}</span>
                        ) : null}
                      </span>
                      <span className="t-control shrink-0 text-muted">{asIs ? '›' : 'Review ›'}</span>
                    </a>
                    {/* Not offered over a same-day log of mine: that needs the
                        duplicates sheet, which only the Logger opens. */}
                    {asIs ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => confirmOne(l)}
                        aria-label={`Confirm as is: ${l.activity_type ?? 'Workout'} ${l.log_date}`}
                        className={`${TEXT_BTN} pr-3`}
                      >
                        Confirm as is
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              These are a friend's numbers until you confirm them. They count nowhere yet.
            </p>
          </section>
        </Item>
      ) : null}

      {incoming.length > 0 ? (
        <Item>
          <section className="mb-6">
            <SectionHeader>Friend requests</SectionHeader>
            <ul className="overflow-hidden rounded-card border border-outline bg-surface [&>li+li]:border-t [&>li+li]:border-border-soft">
              {incoming.map((f) => (
                <FriendRequestRow
                  key={f.friendship_id}
                  friend={f}
                  onDone={() => listFriends().then(setFriends)}
                />
              ))}
            </ul>
          </section>
        </Item>
      ) : null}

      {pending.items.length > 0 || page > 0 ? (
        <Item>
          <section className="mb-6">
            <SectionHeader>Shared with you</SectionHeader>
            <div className="flex flex-col gap-3">
              {pendingGroups.map((g) => {
                const logs = g.items.filter((i): i is LogItem => i.kind === 'log');
                const picked = logs.filter((i) => selected.has(i.id));
                const target = picked.length ? picked : logs;
                const suffix = picked.length ? 'selected' : 'all';
                const multi = g.items.length > 1;
                return (
                  <div key={g.batchId} className="rounded-card border border-outline bg-surface">
                    <div className="border-b border-border-soft px-3 pb-2 pt-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-sm text-fg">From {g.sender}</span>
                        <span className="t-label shrink-0 tabular-nums text-muted">
                          {multi && picked.length ? `${picked.length} of ${g.items.length}` : plural(g.items.length, g.items[0]?.kind === 'plan' ? 'plan' : 'workout')}
                        </span>
                      </div>
                      {multi ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button disabled={busy || target.length === 0} onClick={() => bulk(target, false)}>
                            Accept {suffix}
                          </Button>
                          <Button variant="ghost" disabled={busy || target.length === 0} onClick={() => bulk(target, true)}>
                            Review {suffix}
                          </Button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => dismiss((picked.length ? picked : g.items).map((i) => i.id))}
                            className={TEXT_BTN}
                          >
                            Dismiss {suffix}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <ul className="[&>li+li]:border-t [&>li+li]:border-border-soft">
                      {g.items.map((it) => {
                        const v = parsed.get(it.id);
                        const valid = it.kind === 'log' && v?.ok ? v.value : null;
                        const moves = valid
                          ? new Set(
                              valid.data.sections.flatMap((s) =>
                                s.groups.flatMap((gr) =>
                                  gr.items.filter((x) => x.kind !== 'subroutine').map((x) => x.movement.trim().toLowerCase()),
                                ),
                              ),
                            ).size
                          : 0;
                        const planRead = it.kind === 'plan' ? parsedPlans.get(it.id) : undefined;
                        const planOk = planRead?.ok ? planRead : null;
                        const overlap = valid ? sameDayOverlap(valid.data, valid.log_date, myLogs) : null;
                        return (
                          <li key={it.id} className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {multi ? (
                                <SelectToggle
                                  on={selected.has(it.id)}
                                  onClick={() => toggle(it.id)}
                                  label={`Select ${it.title ?? 'workout'} ${it.item_date ?? ''}`.trim()}
                                />
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-fg">{it.title ?? (it.kind === 'plan' ? 'Plan' : 'Workout')}</div>
                                <div className="text-xs tabular-nums text-muted">
                                  {it.item_date ? formatDate(it.item_date) : it.kind === 'plan' ? '' : '—'}
                                  {valid ? ` · ${plural(moves, 'movement')}` : ''}
                                  {planOk ? `${it.item_date ? ' · ' : ''}${plural(planOk.dayCount, 'day')}` : ''}
                                </div>
                                {overlap ? (
                                  <div className="mt-1">
                                    <Tag
                                      label={
                                        overlap.overlap > 0
                                          ? `${Math.round(overlap.overlap * 100)}% overlaps your log`
                                          : 'Same day as your log'
                                      }
                                    />
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                              {it.kind === 'plan' ? (
                                <span className="mr-auto t-label text-muted">{planOk ? 'Plan' : "Can't be read"}</span>
                              ) : !valid ? (
                                <span className="mr-auto t-label text-muted">Can't be read</span>
                              ) : null}
                              <button type="button" disabled={busy} onClick={() => dismiss([it.id])} className={TEXT_BTN}>
                                Dismiss
                              </button>
                              {it.kind === 'log' && valid ? (
                                <Button
                                  variant={multi ? 'ghost' : 'primary'}
                                  disabled={busy}
                                  onClick={() => reviewOne(it)}
                                >
                                  Accept &amp; review
                                </Button>
                              ) : null}
                              {planOk ? (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    setPlanTarget({ itemId: it.id, sender: it.sender_name, plan: planOk.value, dayCount: planOk.dayCount })
                                  }
                                >
                                  Accept &amp; review
                                </Button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
            <Pager
              page={page}
              hasMore={pending.hasMore}
              label="Shared with you pages"
              onPage={(p) => {
                setPage(p);
                setSelected(new Set());
                void loadPending(p);
              }}
            />
          </section>
        </Item>
      ) : null}

      {acceptances.length > 0 ? (
        <Item>
          <section className="mb-6">
            <SectionHeader>Accepted by friends</SectionHeader>
            <ul className="overflow-hidden rounded-card border border-outline bg-surface [&>li+li]:border-t [&>li+li]:border-border-soft">
              {acceptances.slice(0, 5).map((a) => (
                <li key={`${a.batch_id}:${a.recipient_id}`} className="flex min-h-11 items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm text-fg">
                    {a.recipient_name} accepted {a.accepted_count} of your {a.kind === 'plan' ? 'plans' : 'logs'}
                  </span>
                  {!a.seen ? <Tag label="New" selected /> : null}
                  {a.last_acted_at ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted">{formatDate(a.last_acted_at)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </Item>
      ) : null}

      <Item>
        <Disclosure id="inbox-history" title="Earlier" headerRight={history.items.length ? undefined : 'Nothing yet'}>
          {historyGroups.length === 0 ? (
            <p className="text-sm text-muted">Accepted and dismissed items appear here.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {historyGroups.map((g) => {
                const removable = g.items.filter((i) => i.status === 'accepted' && i.accepted_log_id);
                const picked = removable.filter((i) => selected.has(i.id));
                const target = picked.length ? picked : removable;
                const multi = removable.length > 1;
                return (
                  <div key={g.batchId} className="rounded-control bg-bg">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2">
                      <span className="min-w-0 truncate text-sm text-fg">From {g.sender}</span>
                      {removable.length > 0 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => askRemove(target.map((i) => i.id))}
                          className={TEXT_BTN}
                        >
                          {picked.length ? 'Remove selected' : multi ? 'Remove all' : 'Remove'} from my logs
                        </button>
                      ) : null}
                    </div>
                    <ul className="[&>li+li]:border-t [&>li+li]:border-border-soft">
                      {g.items.map((it) => {
                        const canRemove = it.status === 'accepted' && !!it.accepted_log_id;
                        return (
                          <li key={it.id} className="flex min-h-11 items-center gap-2 px-3 py-1">
                            {multi && canRemove ? (
                              <SelectToggle
                                on={selected.has(it.id)}
                                onClick={() => toggle(it.id)}
                                label={`Select ${it.title ?? 'workout'} ${it.item_date ?? ''}`.trim()}
                              />
                            ) : null}
                            <span className="w-14 shrink-0 text-xs tabular-nums text-subtle">
                              {it.item_date ? formatDate(it.item_date) : '—'}
                            </span>
                            {canRemove ? (
                              <a
                                href={`/app/session?id=${it.accepted_log_id}`}
                                className="flex min-h-11 min-w-0 flex-1 items-center text-sm text-fg hover:underline"
                              >
                                <span className="truncate">{it.title ?? 'Workout'}</span>
                              </a>
                            ) : (
                              <span className="min-w-0 flex-1 truncate text-sm text-muted">{it.title ?? 'Workout'}</span>
                            )}
                            <span className="t-label shrink-0 text-muted">
                              {it.status === 'accepted'
                                ? it.accepted_log_id
                                  ? 'Added'
                                  : 'Combined into your log'
                                : it.status === 'removed'
                                  ? 'Removed'
                                  : 'Dismissed'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
          <Pager
            page={histPage}
            hasMore={history.hasMore}
            label="Earlier pages"
            onPage={(p) => {
              setHistPage(p);
              setSelected(new Set());
              void loadHistory(p);
            }}
          />
        </Disclosure>
      </Item>

      <AcceptPlanSheet
        target={planTarget}
        onClose={() => setPlanTarget(null)}
        onDone={() => {
          setPlanTarget(null);
          void refreshAfterAccept();
        }}
      />

      <Modal open={removal !== null} onClose={() => setRemoval(null)} title="Remove from my logs">
        {removal ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="text-base text-fg">
                Delete {plural(removal.total, 'log')}?
                {removal.edited > 0 ? ` ${removal.edited} of them you edited.` : ''}
              </p>
              <p className="mt-2 text-sm text-muted">This removes them from your history, stats and body map. It can't be undone.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border-soft p-4">
              <Button variant="ghost" onClick={() => setRemoval(null)}>
                Keep
              </Button>
              <Button onClick={confirmRemove} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </>
        ) : null}
      </Modal>
    </PageStagger>
  );
}
