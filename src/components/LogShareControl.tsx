import { useState } from 'react';
import { createShare } from '@/lib/queries';
import { randomToken, sha256Hex, shareUrl } from '@/lib/share';
import { track } from '@/lib/analytics';
import { Button } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';

// Inline, per-workout share control. Collapsed it is a single "Share" text
// button; the validity/label panel is only mounted once opened, so the drawer
// and the session page stay compact until the owner asks to share. Reuses the
// same mint-token → createShare path as ShareManager; there is no new backend.
//
// Owner-only: minting a token writes a `shares` row, so callers render this only
// when !readOnly (the showcase never sees it).

const VALIDITY: { key: string; label: string; days: number }[] = [
  { key: '7', label: '7d', days: 7 },
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
  { key: '0', label: '∞', days: 0 },
];

const inputClass =
  'min-h-11 w-full border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-muted focus:border-subtle';

export function LogShareControl({
  logId,
  defaultLabel = '',
}: {
  logId: string;
  defaultLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  // Default validity is 7 days.
  const [validity, setValidity] = useState('7');
  const [label, setLabel] = useState(defaultLabel);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    const days = VALIDITY.find((v) => v.key === validity)?.days ?? 7;
    const token = randomToken();
    const token_hash = await sha256Hex(token);
    const expires_at = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    const row = await createShare({
      token_hash,
      scope: 'log',
      resource_id: logId,
      label: label.trim() || null,
      expires_at,
    });
    setBusy(false);
    if (row) {
      setUrl(shareUrl(token));
      setCopied(false);
      track('share_link_created', {
        scope: 'log',
        expiry_days: days,
        has_label: !!label.trim(),
        inline: true,
      });
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 items-center gap-1 self-start t-control text-muted transition-colors hover:text-fg"
      >
        Share
        <span aria-hidden className={`text-[0.7rem] transition-transform ${open ? 'rotate-90' : ''}`}>
          ▸
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border border-border bg-bg p-3">
          {url ? (
            <>
              <span className="t-control text-muted">Copy this now — it won't be shown again</span>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${inputClass} flex-1`}
                  aria-label="Share link"
                />
                <Button variant="ghost" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="t-control text-muted">Valid for</span>
                <SegmentedTabs
                  as="radiogroup"
                  size="compact"
                  ariaLabel="Link validity"
                  tabs={VALIDITY.map((v) => ({ key: v.key, label: v.label }))}
                  active={validity}
                  onChange={setValidity}
                />
              </div>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className={inputClass}
                aria-label="Share label"
              />
              <Button onClick={create} disabled={busy}>
                {busy ? 'Creating…' : 'Create link'}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
