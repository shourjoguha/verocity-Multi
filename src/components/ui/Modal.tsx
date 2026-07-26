import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { EASE } from '@/components/anim';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// One consistent modal/sheet for the app: bottom sheet on mobile, centered card
// on desktop, Motion enter/exit, backdrop + Escape to close, reduced-motion-safe.
// The panel is a flex column capped at 85dvh — callers add their own scroll body
// and pinned footer.
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Every caller passes an inline arrow for onClose, so depending on it here
  // would re-run this effect on EVERY render of the parent — releasing and
  // re-taking the scroll lock and bouncing focus out to the trigger and back
  // each time. That thrash is visible as a flicker. Hold it in a ref instead
  // and key the effect purely on `open`.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape to close, Tab cycles inside the panel, focus returns to whatever
  // opened the sheet, and the page behind stops scrolling — on a phone an
  // unlocked body means the sheet drags the page with it.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Let the enter animation mount before pulling focus in.
    const raf = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
      opener?.focus?.({ preventScroll: true });
    };
  }, [open]);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/80 p-0 pointer-fine:backdrop-blur sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              ref={panelRef}
              className="lift-fixed pb-safe flex max-h-[85dvh] w-full max-w-lg flex-col border border-border bg-surface"
              onClick={(e) => e.stopPropagation()}
              // Slide only. The panel is a child of the scrim, so it already
              // fades with it — animating its own opacity as well meant the two
              // multiplied: measured 12 frames mid-open at overlay 0.669 x panel
              // 0.107, an effective 0.07. Nested opacity forces the panel onto
              // its own offscreen layer, and the scale re-rasterised its border
              // and shadow every frame on top of that. That combination is the
              // flicker when the sheet appears. One animated property, no
              // nesting — matching SetEntrySheet, which does not do this.
              initial={{ y: 24 }}
              animate={{ y: 0 }}
              exit={{ y: 24 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {title ? (
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="t-eyebrow text-muted">{title}</span>
                  <button
                    type="button"
                    onClick={onClose}
                    className="t-control text-muted transition-colors hover:text-fg"
                  >
                    Close
                  </button>
                </div>
              ) : null}
              {children}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
