import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { REEL } from '@/lib/reel';

// The landing hero's short film, behind its one non-navigational control.
//
// A Modal rather than a ui/Disclosure, deliberately: <details> renders its
// children whether or not it is open, so a Disclosure would mount the <video>
// (and its poster fetch) on every visit to the home page. Modal returns null
// while closed, so the element only exists once someone asks for it.
//
// `className` so the trigger can wear the calling surface's button treatment —
// on the landing hero it is a third pill matching "Log in" and "View showcase",
// not the app's `.hill-btn`.
export function ReelDialog({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  // The asset is dropped in separately from this code, so a missing file is an
  // expected state rather than a bug — and a broken player on the page everyone
  // lands on is a worse answer than a sentence.
  const [failed, setFailed] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Watch the reel
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="The reel">
        {failed ? (
          <p className="px-4 py-12 text-center text-sm text-muted">The reel isn't up yet.</p>
        ) : (
          <video
            src={REEL.src}
            poster={REEL.poster}
            controls
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
            className="max-h-[70dvh] w-full bg-bg object-contain"
          />
        )}
      </Modal>
    </>
  );
}

export default ReelDialog;
