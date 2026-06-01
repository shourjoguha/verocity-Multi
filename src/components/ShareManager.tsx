import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createShare, getAllPlans, getRecentLogs, getShares, revokeShare } from '@/lib/queries';
import { randomToken, sha256Hex, shareUrl } from '@/lib/share';
import type { Plan, Share, ShareScope, WorkoutLog } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { Button, EmptyState, SectionHeader } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

const SCOPES: { key: ShareScope; label: string }[] = [
  { key: 'profile', label: 'Whole profile' },
  { key: 'plan', label: 'A plan' },
  { key: 'log', label: 'A workout' },
];

const inputClass =
  'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle';

function shareStatus(s: Share): 'revoked' | 'expired' | 'active' {
  if (s.revoked) return 'revoked';
  if (s.expires_at && new Date(s.expires_at) < new Date()) return 'expired';
  return 'active';
}

export default function ShareManager() {
  const [ready, setReady] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);

  const [scope, setScope] = useState<ShareScope>('profile');
  const [resourceId, setResourceId] = useState('');
  const [label, setLabel] = useState('');
  const [expiryDays, setExpiryDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const [sh, pl, lg] = await Promise.all([getShares(), getAllPlans(), getRecentLogs(30)]);
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
    if (ok) setShares((prev) => prev.map((s) => (s.id === id ? { ...s, revoked: true } : s)));
  }

  if (!ready) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  return (
    <PageStagger className="mx-auto max-w-3xl px-6 py-10">
      <Item>
        <header className="mb-8">
          <EchoText
            text="SHARES"
            as="h1"
            className="font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
          />
          <p className="mt-4 text-sm text-muted">
            Mint a read-only link to your profile, a plan, or a single workout. Holders can view but
            never edit. The full link is shown once on creation; revoke any time.
          </p>
        </header>
      </Item>

      <Item>
        <section className="mb-8 flex flex-col gap-3 border border-border bg-surface p-4">
        <SectionHeader>Create a link</SectionHeader>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => changeScope(s.key)}
              aria-pressed={scope === s.key}
              className={`hill-btn min-h-9 border bg-surface px-3 text-[0.7rem] uppercase tracking-wider transition-colors ${
                scope === s.key ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {scope === 'plan' ? (
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            className={inputClass}
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
            className={inputClass}
            aria-label="Workout to share"
          >
            <option value="">Select a workout…</option>
            {logs.map((l) => (
              <option key={l.id} value={l.id}>
                {formatDate(l.log_date)} ·{' '}
                {l.activity_type ?? (l.tags.length ? l.tags.join(', ') : 'Session')}
              </option>
            ))}
          </select>
        ) : null}

        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className={inputClass}
          aria-label="Label"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          Expires in
          <input
            type="number"
            min={0}
            value={expiryDays}
            onChange={(e) => setExpiryDays(Math.max(0, Number(e.target.value)))}
            className={`${inputClass} w-24 tabular-nums`}
            aria-label="Expiry in days"
          />
          days (0 = never)
        </label>

        <div>
          <Button
            onClick={handleCreate}
            disabled={busy || (scope !== 'profile' && !resourceId)}
          >
            {busy ? 'Creating…' : 'Create link'}
          </Button>
        </div>

        {created ? (
          <div className="flex flex-col gap-2 border border-border bg-bg p-3">
            <span className="text-[0.7rem] uppercase tracking-wider text-muted">
              Copy this now — it won't be shown again
            </span>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={created}
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputClass} flex-1 text-sm`}
                aria-label="Share link"
              />
              <Button variant="ghost" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        ) : null}
        </section>
      </Item>

      <Item>
        <section>
          <SectionHeader>Your links</SectionHeader>
          {shares.length === 0 ? (
            <EmptyState>No share links yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-border border border-border">
              {shares.map((s) => {
                const status = shareStatus(s);
                return (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1">
                      <div className="text-fg">{s.label ?? s.scope}</div>
                      <div className="text-[0.7rem] uppercase tracking-wider text-muted">
                        {s.scope} · {formatDate(s.created_at)}
                        {s.expires_at ? ` · expires ${formatDate(s.expires_at)}` : ''}
                      </div>
                    </div>
                    <span
                      className={`text-[0.7rem] uppercase tracking-wider ${
                        status === 'active' ? 'text-subtle' : 'text-muted'
                      }`}
                    >
                      {status}
                    </span>
                    {status === 'active' ? (
                      <button
                        onClick={() => handleRevoke(s.id)}
                        className="px-2 text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-accent"
                      >
                        Revoke
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Item>
    </PageStagger>
  );
}
