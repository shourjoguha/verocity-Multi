import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { EASE } from '@/components/anim';

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
              className="lift flex max-h-[85dvh] w-full max-w-lg flex-col border border-border bg-surface"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {title ? (
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-[0.7rem] uppercase tracking-[0.25em] text-muted">{title}</span>
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-fg"
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
