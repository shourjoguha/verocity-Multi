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

  // Escape to close, Tab cycles inside the panel, focus returns to whatever
  // opened the sheet, and the page behind stops scrolling — on a phone an
  // unlocked body means the sheet drags the page with it.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
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
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Let the enter animation mount before pulling focus in.
    const raf = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
      opener?.focus?.();
    };
  }, [open, onClose]);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 p-0 backdrop-blur sm:items-center sm:p-6"
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
              className="lift pb-safe flex max-h-[85dvh] w-full max-w-lg flex-col border border-border bg-surface"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24 }}
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
