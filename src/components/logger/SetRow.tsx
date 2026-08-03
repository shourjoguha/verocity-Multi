import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { METRICS, type MetricKey } from '@/app.config';
import type { LogSet } from '@/lib/types';
import { EASE } from '@/components/anim';
import { haptic } from '@/lib/haptics';

// One set row: a read-only summary of what was logged, plus the complete
// toggle. Tapping the summary opens SetEntrySheet, which owns all editing.
//
// Keeping the row read-only is what makes it fit a phone: the previous version
// packed three 44px stepper fields and a three-button action cluster into a
// ~283px content box and overflowed the viewport. Now it is
// [planned][summary, flex-1, truncating][✓] and cannot overflow at any width.
export function SetRow({
  metric,
  set,
  isPr = false,
  onOpen,
  onToggle,
}: {
  metric: MetricKey;
  set: LogSet;
  isPr?: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const a = set.actual;

  // One-shot teal ring-pop the moment a set is marked complete (false→true) —
  // the satisfying confirm on the core logging action. A personal record gets a
  // bigger ring + a "PR" badge + an extra haptic (easter egg). Skipped under
  // reduced-motion; the monochrome completed state below is the resting look.
  const reduce = useReducedMotion();
  const [pop, setPop] = useState(0);
  const [popPr, setPopPr] = useState(false);
  const wasComplete = useRef(a.completed);
  useEffect(() => {
    if (a.completed && !wasComplete.current && !reduce) {
      setPopPr(isPr);
      setPop((n) => n + 1);
      if (isPr) haptic(30);
    }
    wasComplete.current = a.completed;
  }, [a.completed, reduce, isPr]);

  const value = () => {
    switch (metric) {
      case 'weight': {
        const parts = [];
        if (a.weight) parts.push(`${a.weight}${METRICS.weight.unit}`);
        if (a.reps) parts.push(`× ${a.reps}`);
        return parts.join(' ');
      }
      case 'reps':
        return a.reps ? `${a.reps} reps` : '';
      case 'time':
        return a.time ? `${a.time}${METRICS.time.unit}` : '';
      case 'distance':
        return a.distance ? `${a.distance}${METRICS.distance.unit}` : '';
      case 'cal':
        return a.calories ? `${a.calories} ${METRICS.cal.unit}` : '';
      case 'rpe':
        return '';
    }
  };

  const main = value();

  return (
    <div
      className={`flex items-center gap-2 border-l-2 pl-2 ${
        a.completed ? 'border-accent' : 'border-border'
      }`}
    >
      {set.planned ? (
        <span className="flex w-9 shrink-0 items-center text-[0.6rem] uppercase leading-tight tracking-wider text-muted">
          {set.planned}
        </span>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        aria-label={main ? `Edit set — ${main}` : 'Log this set'}
        className="flex min-h-11 min-w-0 flex-1 items-baseline gap-2 text-left"
      >
        {main ? (
          <span className="truncate font-display text-2xl leading-none tabular-nums text-fg">
            {main}
          </span>
        ) : (
          <span className="t-control text-muted">Tap to log</span>
        )}
        {a.rpe != null ? (
          <span className="shrink-0 text-sm tabular-nums text-muted">@{a.rpe}</span>
        ) : null}
      </button>

      <span className="relative inline-flex shrink-0">
        {pop > 0 ? (
          <motion.span
            key={pop}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[4px] border-2 border-teal"
            initial={{ opacity: 0.85, scale: 1 }}
            animate={{ opacity: 0, scale: popPr ? 2.4 : 1.8 }}
            transition={{ duration: popPr ? 0.65 : 0.5, ease: EASE }}
          />
        ) : null}
        {pop > 0 && popPr ? (
          <motion.span
            key={`pr-${pop}`}
            aria-hidden
            className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[0.55rem] font-bold uppercase tracking-[0.2em] text-teal"
            initial={{ opacity: 0, y: 4, scale: 0.8 }}
            animate={{ opacity: [0, 1, 1, 0], y: -6, scale: 1 }}
            transition={{ duration: 1, ease: EASE }}
          >
            PR
          </motion.span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            haptic();
            onToggle();
          }}
          className={`hill-btn flex min-h-11 w-11 shrink-0 items-center justify-center border text-lg ${
            a.completed
              ? 'border-accent bg-accent text-accent-fg'
              : 'border-border bg-surface text-muted hover:text-fg'
          }`}
          aria-label="Toggle completed"
          aria-pressed={a.completed}
        >
          ✓
        </button>
      </span>
    </div>
  );
}
