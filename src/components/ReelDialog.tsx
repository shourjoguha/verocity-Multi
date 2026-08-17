import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { REEL } from '@/lib/reel';

// The landing hero's short film, behind its one non-navigational control.
//
// A Modal rather than a ui/Disclosure, deliberately: <details> renders its
// children whether or not it is open, so a Disclosure would mount the iframe
// (and its YouTube fetch) on every visit to the home page. Modal returns null
// while closed, so the iframe only exists once someone asks for it — which
// also means autoplay is legal, because it lands inside the click that opened
// the dialog.
//
// `className` so the trigger can wear the calling surface's button treatment —
// on the landing hero it is a pill matching "View showcase", not the app's
// `.hill-btn`.
export function ReelDialog({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Watch the reel
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="The reel">
        {/* Vertical 9:16 for a Shorts video: `aspect-[9/16]` capped at 70dvh
            so tall desktops don't stretch it into a strip. The iframe is
            mounted only inside the open branch, which is what keeps the
            autoplay legal (see the file header) and stops the YouTube fetch
            firing on every page load. */}
        <div className="mx-auto flex max-h-[70dvh] w-full max-w-md items-center justify-center bg-bg">
          <div className="aspect-[9/16] w-full max-h-[70dvh]">
            <iframe
              src={REEL.embed}
              title={REEL.title}
              // A minimum feature set: no clipboard, no fullscreen prompt,
              // no picture-in-picture — just play the muted video inline.
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
              // referrer stripping and sandboxing: the iframe is third-party
              // and we don't need it to know the exact referrer or to
              // navigate the top-level page.
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full border-0 bg-black"
            />
          </div>
        </div>
        {/* One line of copy under the video for the case where the browser or
            an extension refuses the embed (uBlock Origin, corporate proxies).
            A plain `<a>` opens the same video on YouTube in a new tab. */}
        <p className="border-t border-border px-4 py-3 text-center text-xs text-muted">
          Trouble seeing the video?{' '}
          <a
            href={REEL.href}
            target="_blank"
            rel="noreferrer"
            className="text-fg underline transition-colors hover:text-muted"
          >
            Open on YouTube
          </a>
          .
        </p>
      </Modal>
    </>
  );
}

export default ReelDialog;
