import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { EASE } from '@/components/anim';
import { useScrollLock } from '@/lib/scrollLock';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// How long the panel takes to slide out. Exported so a caller handing off from
// one sheet to another can wait for this one to leave instead of stacking two
// scrims — see Logger's `handoff`.
export const SHEET_EXIT_MS = 300;

// Keyboard, focus and the scroll lock, as a null-rendering child of the scrim.
// It lives inside AnimatePresence deliberately: mounted means "the sheet is on
// screen", which is 300ms longer than `open` is true. The previous version keyed
// this on `open`, so closing released the page and threw focus back to the
// trigger while the panel was still sliding out.
function ModalBehavior({
  panelRef,
  onClose,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  useScrollLock();

  // Every caller passes an inline arrow for onClose, so depending on it here
  // would re-run this effect on EVERY render of the parent — bouncing focus out
  // to the trigger and back each time. Hold it in a ref instead.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape to close, Tab cycles inside the panel, focus returns to whatever
  // opened the sheet.
  useEffect(() => {
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
    // Let the enter animation mount before pulling focus in — and leave focus
    // alone if a child with autoFocus already has it. Skipping the header's
    // Close button matters: it is the first focusable in DOM order, so
    // "focus the first focusable" used to yank focus off an autoFocus input one
    // frame after it landed, which on iOS is the keyboard opening and
    // immediately closing again — a visualViewport resize, i.e. every dvh box
    // and the fixed backdrop repainting.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const target = items.find((el) => !el.hasAttribute('data-modal-close')) ?? items[0];
      target?.focus({ preventScroll: true });
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      opener?.focus?.({ preventScroll: true });
    };
  }, [panelRef]);

  return null;
}

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

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open ? (
          <motion.div
            // overflow-hidden + overscroll-contain make the scrim a scroll
            // container that swallows scroll chaining, which is what holds the
            // page still on touch now that nothing locks the document there.
            // See lib/scrollLock.ts.
            className="fixed inset-0 z-[80] flex items-end justify-center overflow-hidden overscroll-contain bg-bg/80 p-0 pointer-fine:backdrop-blur sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ModalBehavior panelRef={panelRef} onClose={onClose} />
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
              transition={{ duration: SHEET_EXIT_MS / 1000, ease: EASE }}
            >
              {title ? (
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="t-eyebrow text-muted">{title}</span>
                  <button
                    type="button"
                    data-modal-close
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
