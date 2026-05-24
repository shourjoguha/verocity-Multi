import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Movement } from '@/lib/types';
import { EASE } from '@/components/anim';

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
  const [q, setQ] = useState('');
  const filtered = useMemo(
    () =>
      movements
        .filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 60),
    [movements, q],
  );

  return (
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
        className="flex max-h-[80dvh] w-full max-w-lg flex-col border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-[0.7rem] uppercase tracking-[0.25em] text-muted">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
          >
            Close
          </button>
        </div>

        {suggestions.length > 0 ? (
          <div className="border-b border-border px-4 py-3">
            <div className="mb-2 text-[0.65rem] uppercase tracking-wider text-muted">
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

        <input
          autoFocus
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
                <span className="text-[0.7rem] uppercase tracking-wider text-muted">custom</span>
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
                <span className="text-[0.7rem] uppercase tracking-wider text-muted">
                  {m.category ?? (m.owner_user_id == null ? 'shared' : 'custom')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  );
}
