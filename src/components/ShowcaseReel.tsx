import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SHOWCASE_REEL } from '@/lib/showcase';

// The showcase's short film, behind the hero's one interactive control.
//
// A Modal rather than a ui/Disclosure, deliberately: <details> renders its
// children whether or not it is open, so a Disclosure would mount the <video>
// (and its poster fetch) on every visit to /showcase. Modal returns null while
// closed, so the element only exists once someone asks for it.
export function ShowcaseReel() {
  const [open, setOpen] = useState(false);
  // The asset is dropped in separately from this code, so a missing file is an
  // expected state rather than a bug — and a broken player on the one public
  // page is a worse answer than a sentence.
  const [failed, setFailed] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hill-btn inline-flex min-h-11 items-center border border-border bg-surface px-4 t-control text-fg transition-colors hover:border-fg"
      >
        Watch the reel
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="The reel">
        {failed ? (
          <p className="px-4 py-12 text-center text-sm text-muted">
            The reel isn't up yet.
          </p>
        ) : (
          <video
            src={SHOWCASE_REEL.src}
            poster={SHOWCASE_REEL.poster}
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

export default ShowcaseReel;
