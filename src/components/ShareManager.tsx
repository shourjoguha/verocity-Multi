import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { createShare, getAllPlans, getShares, revokeShare } from '@/lib/queries';
import { loadAllLogs, newestLogs } from '@/lib/logStore';
import { randomToken, sha256Hex, shareUrl } from '@/lib/share';
import type { Plan, Share, ShareScope, WorkoutLog } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { track } from '@/lib/analytics';
import { Button, EmptyState, FIELD, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { InfoPopover } from '@/components/ui/InfoPopover';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

const SCOPES: { key: ShareScope; label: string }[] = [
  { key: 'profile', label: 'Whole profile' },
  { key: 'plan', label: 'A plan' },
  { key: 'log', label: 'A workout' },
];

function shareStatus(s: Share): 'revoked' | 'expired' | 'active' {
  if (s.revoked) return 'revoked';
  if (s.expires_at && new Date(s.expires_at) < new Date()) return 'expired';
  return 'active';
}

// `embedded` drops the outer PageStagger + big header so the same component
// can live inside a Disclosure on /app/you without doubling the chrome. The
// standalone /app/shares route calls with defaults and still renders its own
// header + shell.
//
// Embedded is the short version: a "New share link" primary that opens the
// create form IN FLOW (not a sheet — it holds text fields, which raise the iOS
// keyboard, and it shows a link that is displayed exactly once, which a stray
// scrim tap must not be able to dismiss), then ACTIVE links only, then a row to
// /app/shares, which shows everything: active first, then expired / revoked.
export default function ShareManager({ embedded = false }: { embedded?: boolean } = {}) {
  const [ready, setReady] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);

  const [scope, setScope] = useState<ShareScope>('profile');
  const [resourceId, setResourceId] = useState('');
  const [label, setLabel] = useState('');
  const [expiryDays, setExpiryDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Embedded only: the create form is folded behind "New share link".
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const [sh, pl, lg] = await Promise.all([
        getShares(),
        getAllPlans(),
        // A needs_review row is a friend's numbers awaiting confirmation; it is
        // never offered as a public link (share-read refuses it too).
        loadAllLogs().then((all) => newestLogs(all.filter((l) => l.status !== 'needs_review'), 30)),
      ]);
      setShares(sh);
      setPlans(pl);
      setLogs(lg);
      setReady(true);
    })();
  }, []);

  function changeScope(next: ShareScope) {
    setScope(next);
    setResourceId('');
    setCreated(null);
  }

  async function handleCreate() {
    if (busy) return;
    if (scope !== 'profile' && !resourceId) return;
    setBusy(true);
    const token = randomToken();
    const token_hash = await sha256Hex(token);
    const expires_at =
      expiryDays > 0 ? new Date(Date.now() + expiryDays * 86_400_000).toISOString() : null;
    const row = await createShare({
      token_hash,
      scope,
      resource_id: scope === 'profile' ? null : resourceId,
      label: label.trim() || null,
      expires_at,
    });
    setBusy(false);
    if (row) {
      setShares((prev) => [row, ...prev]);
      setCreated(shareUrl(token));
      setCopied(false);
      setLabel('');
      track('share_link_created', { scope, expiry_days: expiryDays, has_label: !!label.trim() });
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this link? Anyone holding it loses access immediately.')) return;
    const ok = await revokeShare(id);
    if (ok) {
      setShares((prev) => prev.map((s) => (s.id === id ? { ...s, revoked: true } : s)));
      track('share_link_revoked');
    }
  }

  if (!ready) return <LoadingScreen />;

  const header = embedded ? null : (
    <Item>
      <header className="mb-8">
        <EchoText
          text="SHARES"
          as="h1"
          className={ECHO_APP_TITLE}
        />
      </header>
    </Item>
  );

  const wrap = (children: ReactNode) =>
    embedded ? (
      <div className="flex flex-col gap-4">{children}</div>
    ) : (
      <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 py-10">{children}</PageStagger>
    );

  const active = shares.filter((s) => shareStatus(s) === 'active');
  const inactive = shares.filter((s) => shareStatus(s) !== 'active');

  // Embedded, the form sits inside the Sharing card, so it is an inset well;
  // standalone it is a card of its own on the page.
  const form = (
    <section
      className={`flex flex-col gap-3 ${
        embedded ? 'rounded-control bg-bg p-3' : 'mb-8 rounded-card border border-outline bg-surface p-4'
      }`}
    >
      {embedded ? null : (
        <SectionHeader>
          <span className="inline-flex items-center gap-2">
            Create a link
            <InfoPopover>
              A read-only link to your profile, a plan, or one workout. Holders can view, never
              edit. The full link is shown once; revoke any time.
            </InfoPopover>
          </span>
        </SectionHeader>
      )}
      <SegmentedTabs
        as="radiogroup"
        size="sm"
        ariaLabel="What to share"
        tabs={SCOPES}
        active={scope}
        onChange={(k) => changeScope(k as ShareScope)}
      />

      {scope === 'plan' ? (
        <select
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          className={FIELD}
          aria-label="Plan to share"
        >
          <option value="">Select a plan…</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.is_active ? ' (active)' : ''}
            </option>
          ))}
        </select>
      ) : null}

      {scope === 'log' ? (
        <select
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          className={FIELD}
          aria-label="Workout to share"
        >
          <option value="">Select a workout…</option>
          {logs.map((l) => (
            <option key={l.id} value={l.id}>
              {formatDate(l.log_date)}
              {l.day_key ? ` · Day ${l.day_key}` : ''} ·{' '}
              {l.activity_type ?? (l.tags.length ? l.tags.join(', ') : 'Session')}
            </option>
          ))}
        </select>
      ) : null}

      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (optional)"
        className={FIELD}
        aria-label="Label"
      />
      <label className="flex items-center gap-2 text-sm text-muted">
        Expires in
        <span className="w-24 shrink-0">
          <input
            type="number"
            min={0}
            value={expiryDays}
            onChange={(e) => setExpiryDays(Math.max(0, Number(e.target.value)))}
            className={`${FIELD} tabular-nums`}
            aria-label="Expiry in days"
          />
        </span>
        days (0 = never)
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleCreate}
          disabled={busy || (scope !== 'profile' && !resourceId)}
        >
          {busy ? 'Creating…' : 'Create link'}
        </Button>
        {embedded ? (
          <Button
            variant="ghost"
            onClick={() => {
              setCreating(false);
              setCreated(null);
            }}
          >
            {created ? 'Done' : 'Cancel'}
          </Button>
        ) : null}
      </div>

      {created ? (
        <div
          className={`flex flex-col gap-2 rounded-control p-3 ${embedded ? 'bg-surface' : 'bg-bg'}`}
        >
          <span className="t-control text-muted">
            Copy this now — it won't be shown again
          </span>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={created}
              onFocus={(e) => e.currentTarget.select()}
              className={`${FIELD} min-w-0 flex-1`}
              aria-label="Share link"
            />
            <Button variant="ghost" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );

  const list = (items: Share[]) => (
    <ul
      className={
        embedded
          ? 'divide-y divide-border-soft'
          : 'divide-y divide-border-soft overflow-hidden rounded-card border border-outline bg-surface'
      }
    >
      {items.map((s) => {
        const status = shareStatus(s);
        return (
          <li key={s.id} className={`flex items-center gap-3 py-2 ${embedded ? '' : 'px-4'}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-fg">{s.label ?? s.scope}</div>
              <div className="t-control text-muted">
                {s.scope} · {formatDate(s.created_at)}
                {s.expires_at ? ` · expires ${formatDate(s.expires_at)}` : ''}
              </div>
            </div>
            <span className={`t-control ${status === 'active' ? 'text-subtle' : 'text-muted'}`}>
              {status}
            </span>
            {status === 'active' ? (
              <Button variant="ghost" onClick={() => handleRevoke(s.id)} className="px-3">
                Revoke
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  if (embedded) {
    return wrap(
      <>
        {creating ? (
          form
        ) : (
          <div>
            <Button onClick={() => setCreating(true)}>New share link</Button>
          </div>
        )}
        <section>
          <SectionHeader>Active links</SectionHeader>
          {active.length === 0 ? (
            <p className="text-sm text-muted">
              {shares.length === 0 ? 'No share links yet.' : 'No active links.'}
            </p>
          ) : (
            list(active)
          )}
        </section>
        <a
          href="/app/shares"
          className="-mx-4 -mb-4 flex min-h-11 items-center justify-between gap-3 border-t border-border-soft px-4 t-control text-fg transition-colors hover:bg-tappable-hover"
        >
          <span>
            Expired &amp; revoked · <span className="tabular-nums">{inactive.length}</span>
          </span>
          <span aria-hidden="true">→</span>
        </a>
      </>,
    );
  }

  return wrap(
    <>
      {header}

      <Item>{form}</Item>

      <Item>
        <section className="mb-8">
          <SectionHeader>Active links</SectionHeader>
          {active.length === 0 ? (
            <EmptyState>{shares.length === 0 ? 'No share links yet.' : 'No active links.'}</EmptyState>
          ) : (
            list(active)
          )}
        </section>
      </Item>

      {inactive.length > 0 ? (
        <Item>
          <section>
            <SectionHeader>Expired &amp; revoked</SectionHeader>
            {list(inactive)}
          </section>
        </Item>
      ) : null}
    </>,
  );
}
