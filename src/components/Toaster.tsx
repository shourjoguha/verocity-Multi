import { useEffect, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { EASE } from '@/components/anim';
import type { ToastType } from '@/lib/toast';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let counter = 0;

// Single listener for the toast bus; rendered once per page via Base.astro.
export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; type: ToastType }>).detail;
      const id = ++counter;
      setItems((prev) => [...prev, { id, message: detail.message, type: detail.type }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
    };
    window.addEventListener('verocity:toast', onToast as EventListener);
    return () => window.removeEventListener('verocity:toast', onToast as EventListener);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.25, ease: EASE }}
              role="status"
              className={`pointer-events-auto max-w-sm px-4 py-2 text-sm shadow-sm ${
                t.type === 'error'
                  ? 'bg-fg text-bg'
                  : 'border border-border border-l-2 border-l-teal bg-surface text-fg'
              }`}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
