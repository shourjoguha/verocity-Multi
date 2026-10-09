import { useEffect, useState } from 'react';
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

  // CSS entrance (`toast-in` in global.css), instant removal — the same
  // contract as the sheets. This island is on every page via Base.astro, so a
  // Motion import here put the whole library in every page's first load.
  return (
    // Clears the bottom tab bar (App.astro) and the home indicator, so a toast
    // never lands under either.
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 p-4">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`toast-in pointer-events-auto max-w-sm px-4 py-2 text-sm shadow-sm ${
            t.type === 'error'
              ? 'bg-fg text-bg'
              : 'border border-border border-l-2 border-l-teal bg-surface text-fg'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
