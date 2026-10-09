import { useEffect, useState } from 'react';
import { TrashGlyph } from '@/components/ui/icons';

// Shared pieces of a detail sheet's footer: destructive on the left behind a
// confirm, the item's own actions on the right. Used by the session sheet and
// the Library's movement sheet so the trash sits in the same corner in both.

export const SHEET_ICON_BTN =
  'hill-btn flex h-11 w-11 shrink-0 items-center justify-center border border-border bg-surface transition-colors';
export const SHEET_GLYPH = 'h-[1.15rem] w-[1.15rem]';

// How long the armed trash waits for its second tap before disarming.
const CONFIRM_MS = 4000;

// A red trash that arms on the first tap ("Delete? [Delete]") and acts on the
// second; it disarms by itself. Replaces window.confirm, which the sheet's own
// footer can do without leaving the page. `onConfirm` resolves true when the
// item is gone — the caller closes the sheet, which unmounts this.
export function ArmedDelete({
  label,
  name,
  onConfirm,
}: {
  label: string;
  name: string;
  onConfirm: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => window.clearTimeout(t);
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`${SHEET_ICON_BTN} text-danger hover:border-danger`}
        aria-label={label}
        title={label}
      >
        <TrashGlyph className={SHEET_GLYPH} />
      </button>
    );
  }
  return (
    <>
      <span className="t-control text-muted">Delete?</span>
      <button
        type="button"
        disabled={deleting}
        onClick={async () => {
          setDeleting(true);
          const ok = await onConfirm();
          if (!ok) {
            setDeleting(false);
            setConfirming(false);
          }
        }}
        className="hill-btn flex h-11 items-center border border-danger bg-surface px-3 t-control text-danger transition-colors disabled:opacity-40"
        aria-label={`Confirm delete ${name}`}
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
    </>
  );
}
