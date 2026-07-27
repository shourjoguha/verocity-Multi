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
    // Move focus into the panel a frame after it mounts — but on a touch device,
    // only as far as the panel itself.
    //
    // Focusing a text field here raises the software keyboard, and this fires
    // one frame after the tap rather than inside it, so the keyboard comes up
    // *while* the sheet is still sliding in. On iOS every keyboard transition
    // resizes the visual viewport, which relayouts every dvh-sized box and the
    // fixed backdrop behind the sheet — the background moving as the drawer
    // opens — and dismissing it on close overlaps the exit animation, so the
    // sheet appears to hang before it goes. It is also poor UX in its own
    // right: the keyboard covers most of the sheet you just opened.
    // Desktop keeps the convenience; touch users tap the field they want.
    const wantsKeyboard = window.matchMedia('(pointer: fine)').matches;
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      if (!wantsKeyboard) {
        // tabIndex -1 on the panel: screen readers still land inside the dialog,
        // and Tab from here walks its contents. No keyboard, no viewport resize.
        panel.focus({ preventScroll: true });
        return;
      }
      // Skip the header's Close button — it is first in DOM order, so "focus
      // the first focusable" would land there rather than on the real content.
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
          // A plain, un-animated root. overflow-hidden + overscroll-contain make
          // it a scroll container that swallows scroll chaining, which is what
          // holds the page still on touch now that nothing locks the document
          // there. See lib/scrollLock.ts.
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center overflow-hidden overscroll-contain p-0 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <ModalBehavior panelRef={panelRef} onClose={onClose} />
            {/* The scrim is a SIBLING of the panel, not its parent. As a parent
                it was an opacity-animated element covering the whole viewport,
                so every frame of the fade re-rendered the panel — border and
                shadow included — into the scrim's offscreen buffer, and churned
                the compositing layer that the fixed `.bg-backdrop` sits behind.
                Side by side, each animates on its own and neither touches the
                other. This is the structural difference between a sheet and an
                ordinary in-flow form, which never flickered. */}
            <motion.div
              data-sheet-scrim
              // will-change gives the scrim its own compositing layer for its
              // whole life, so the fade is a compositor-only operation. Without
              // it the layer is promoted when the animation starts and demoted
              // when it ends, and each of those re-composites the full-viewport
              // fixed `.bg-backdrop` sitting behind it — the background blinking
              // as the drawer opens. One layer, created once, destroyed once.
              className="absolute inset-0 bg-bg/80 will-change-[opacity] pointer-fine:backdrop-blur"
              onClick={onClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              // Same duration as the panel. At 0.2s against the panel's 0.3s the
              // wash was fully gone 100ms before the sheet had finished leaving,
              // so the drawer spent its last frames against a bright, unscrimmed
              // page — which reads as the drawer blinking as it closes.
              transition={{ duration: SHEET_EXIT_MS / 1000, ease: EASE }}
            />
            <motion.div
              ref={panelRef}
              data-sheet-panel
              tabIndex={-1}
              className="lift-fixed pb-safe relative flex max-h-[85dvh] w-full max-w-lg flex-col border border-border bg-surface outline-none"
              // Slide only — one animated property. Its own opacity animation
              // used to multiply with the scrim's: measured 12 frames mid-open
              // at overlay 0.669 x panel 0.107, an effective 0.07.
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
          </div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
