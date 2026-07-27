import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { Movement } from '@/lib/types';
import { isSubroutine } from '@/lib/subroutine';
import { EASE } from '@/components/anim';
import { SHEET_EXIT_MS } from '@/components/ui/Modal';
import { useScrollLock } from '@/lib/scrollLock';

export interface Suggestion {
  id: string;
  replacement: string;
  count: number;
}

// Modal movement chooser, reused for "add to section" and "swap movement".
// Optional substitution suggestions (from movement_subs) appear as quick picks.
export function MovementPicker({
  movements,
  title,
  suggestions = [],
  onPick,
  onDismiss,
  onClose,
}: {
  movements: Movement[];
  title: string;
  suggestions?: Suggestion[];
  onPick: (movement: Movement | { name: string }) => void;
  onDismiss?: (id: string) => void;
  onClose: () => void;
}) {
  // This component IS the overlay — callers mount it inside an AnimatePresence,
  // so being mounted means being on screen and the lock spans the exit too.
  useScrollLock();

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Desktop only — see ui/Modal.tsx. Focusing the search field a frame after
    // the tap raises the iOS keyboard mid-animation, which resizes the visual
    // viewport and relayouts the fixed backdrop behind the sheet. On a phone
    // the keyboard would also cover the list you opened this to browse.
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const raf = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, []);

  const [q, setQ] = useState('');
  const filtered = useMemo(
    () =>
      movements
        .filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 60),
    [movements, q],
  );

  return (
    // A plain, un-animated root. overflow-hidden + overscroll-contain hold the
    // page still on touch — see lib/scrollLock.ts.
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-hidden overscroll-contain p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Scrim as a SIBLING of the panel, never its parent — see ui/Modal.tsx. */}
      <motion.div
        data-sheet-scrim
        // will-change: one compositing layer for the scrim's whole life, so the
        // fade never promotes/demotes a full-viewport layer over the fixed
        // backdrop. See ui/Modal.tsx.
        className="absolute inset-0 bg-bg/80 will-change-[opacity] pointer-fine:backdrop-blur"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: SHEET_EXIT_MS / 1000, ease: EASE }}
      />
      <motion.div
        data-sheet-panel
        className="relative flex max-h-[80dvh] w-full max-w-lg flex-col border border-border bg-surface"
        // Slide only — one animated property.
        initial={{ y: 24 }}
        animate={{ y: 0 }}
        exit={{ y: 24 }}
        transition={{ duration: SHEET_EXIT_MS / 1000, ease: EASE }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="t-eyebrow text-muted">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="t-control text-muted hover:text-fg"
          >
            Close
          </button>
        </div>

        {suggestions.length > 0 ? (
          <div className="border-b border-border px-4 py-3">
            <div className="mb-2 t-control text-muted">
              You usually swap to
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center border border-accent text-accent"
                >
                  <button
                    type="button"
                    onClick={() => onPick({ name: s.replacement })}
                    className="px-2 py-1 text-xs capitalize"
                  >
                    {s.replacement}
                    <span className="ml-1 text-muted">×{s.count}</span>
                  </button>
                  {onDismiss ? (
                    <button
                      type="button"
                      onClick={() => onDismiss(s.id)}
                      className="border-l border-accent px-1.5 py-1 text-xs text-muted hover:text-fg"
                      aria-label={`Dismiss ${s.replacement} suggestion`}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Focused via ref rather than autoFocus: React's autoFocus calls
            focus() without `preventScroll`, which scrolls the page behind this
            `fixed` sheet. This picker has no Modal wrapper to do it for it. */}
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search movements"
          className="m-4 min-h-11 border border-border bg-bg px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle"
        />

        <ul className="flex-1 divide-y divide-border overflow-y-auto border-t border-border">
          {q.trim() && !filtered.some((m) => m.name.toLowerCase() === q.trim().toLowerCase()) ? (
            <li>
              <button
                type="button"
                onClick={() => onPick({ name: q.trim() })}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-elevated"
              >
                <span className="text-fg">Add “{q.trim()}”</span>
                <span className="t-control text-muted">custom</span>
              </button>
            </li>
          ) : null}
          {filtered.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(m)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-elevated"
              >
                <span className="capitalize text-fg">{m.name}</span>
                <span className="t-control text-muted">
                  {isSubroutine(m)
                    ? 'subroutine'
                    : (m.category ?? (m.owner_user_id == null ? 'shared' : 'custom'))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}
