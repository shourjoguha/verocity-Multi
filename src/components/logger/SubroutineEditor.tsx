import { useRef, useState } from 'react';
import { SUBROUTINE } from '@/app.config';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/primitives';

// Add / edit a subroutine: a short title, a capped free-text description, and an
// optional link. Shared by the "+ Subroutine" flow and the ⋯ options edit action.
export function SubroutineEditor({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: { title: string; description: string; url: string };
  onSave: (values: { title: string; description: string; url: string }) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(initial);

  // The sheet stays mounted between opens so Modal's exit animation can play —
  // callers used to unmount it, which destroys the AnimatePresence along with
  // the child it was meant to animate out, and the sheet vanished in one frame.
  // Staying mounted means `initial` can no longer be a first-mount-only seed:
  // re-seed on each closed -> open transition instead, or the second subroutine
  // you edit shows the first one's text. (Deliberate set-during-render — the
  // "adjusting state when a prop changes" pattern.)
  const wasOpen = useRef(open);
  if (open && !wasOpen.current) setValues(initial);
  wasOpen.current = open;

  const { title, description, url } = values;
  const setTitle = (v: string) => setValues((s) => ({ ...s, title: v }));
  const setDescription = (v: string) => setValues((s) => ({ ...s, description: v }));
  const setUrl = (v: string) => setValues((s) => ({ ...s, url: v }));

  const inputClass =
    'min-h-11 w-full border border-border bg-bg px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle';

  return (
    <Modal open={open} onClose={onClose} title="Subroutine">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <label className="mb-2 block t-control text-muted">Title</label>
          {/* No autoFocus: React calls focus() without `preventScroll`, and
              focusing an input inside a `fixed` sheet scrolled the page behind
              it to the top — measured 300px -> 0 on open. Modal focuses the
              first non-Close control itself, with the flag set. */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Box breathing"
            className={inputClass}
            aria-label="Subroutine title"
          />
        </div>
        <div>
          <label className="mb-2 block t-control text-muted">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={SUBROUTINE.maxDescriptionChars}
            rows={4}
            placeholder="What to do…"
            className={`${inputClass} py-3 italic`}
            aria-label="Subroutine description"
          />
          <div className="mt-1 text-right t-control text-muted tabular-nums">
            {description.length}/{SUBROUTINE.maxDescriptionChars}
          </div>
        </div>
        <div>
          <label className="mb-2 block t-control text-muted">Insert link</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            placeholder="https://… (optional)"
            className={inputClass}
            aria-label="Subroutine link"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border p-4">
        <Button
          onClick={() => onSave({ title: title.trim(), description: description.trim(), url: url.trim() })}
          disabled={!title.trim()}
          className="flex-1"
        >
          Save
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
