import { useState } from 'react';
import { deleteLog } from '@/lib/queries';
import { toast } from '@/lib/toast';

// Subtle destructive action with an inline confirm step (no separate dialog).
// onDeleted fires after a successful delete so the caller can redirect or drop
// the row from its list. Shared by the session detail page and quick-view popup.
export function DeleteLogButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    const ok = await deleteLog(id);
    if (!ok) {
      setDeleting(false);
      toast('Could not delete session', 'error');
      return;
    }
    toast('Session deleted', 'success');
    onDeleted();
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="t-control text-muted transition-colors hover:text-fg"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 t-control">
      <span className="text-muted">Delete?</span>
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="text-fg underline underline-offset-2 disabled:opacity-40"
      >
        {deleting ? 'Deleting…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-muted transition-colors hover:text-fg"
      >
        Cancel
      </button>
    </span>
  );
}
