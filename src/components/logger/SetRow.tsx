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
  index,
  showPlanned,
  isPr = false,
  onOpen,
  onToggle,
}: {
  metric: MetricKey;
  set: LogSet;
  // 0-based position in the movement, rendered 1-based as the ordinal gutter.
  index: number;
  // True when ANY set in this movement has a planned target. The column is then
  // reserved on EVERY row, empty ones included, so the value below it starts at
  // one x down the whole card instead of stepping left on the rows that happen
  // to have no target. False for ad-hoc movements, where reserving it would
  // just indent every row past 48px of nothing.
  showPlanned: boolean;
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
    // The completed rule is `--color-teal`, the app's one signal colour and the
    // same token the ring-pop above already fires in — so the resting state of a
    // logged set matches the flash that confirmed it. It is theme-adaptive
    // (burnt orange on paper, cyan on carbon), and it is never the only cue:
    // the ✓ fill and the summary text both change with it.
    // Owns its own horizontal padding rather than sitting inside a padded
    // wrapper, so the 2px rule lands FLUSH on the card's left border the way
    // the reference draws it. Inside a `px-4` band it floated 16px in and read
    // as a stray tick beside the row instead of the row's own edge.
    <div
      className={`flex items-center gap-2 border-l-2 pl-3 pr-2 ${
        a.completed ? 'border-teal' : 'border-border'
      }`}
    >
      {/* Ordinal gutter. Fixed width and tabular so the summaries beside it
          line up into a column rather than stepping right at set 10 — but
          LEFT-aligned within it, which is where the reference puts the digit
          and 12px closer to the rule than right-aligning it was. */}
      <span className="w-4 shrink-0 text-[0.6rem] leading-none tabular-nums text-faint">
        {index + 1}
      </span>

      {/* Planned target. Fixed width and single-line: it used to be `w-9` with
          `leading-tight`, so "5 @70%" wrapped to two lines and pushed the row
          taller than its neighbours. Truncated with the full value on `title`
          — a target that spills is worse than one you hover to read. */}
      {showPlanned ? (
        <span
          title={set.planned || undefined}
          className="ml-1 w-12 shrink-0 truncate text-[0.6rem] uppercase leading-tight tracking-wider text-muted"
        >
          {set.planned}
        </span>
      ) : null}

      {/* Two nested boxes on purpose. The BUTTON centres its content in the
          44px row, so the value lines up with the ordinal and planned columns
          beside it; the inner span keeps value and RPE on a shared BASELINE,
          which is what "142.5kg × 5 @8" needs to read as one phrase. Doing
          both on one element is what misaligned it: `items-baseline` on the
          button pinned the value near the top of the row while its siblings
          centred, so every row's numbers sat visibly high. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={main ? `Edit set — ${main}` : 'Log this set'}
        className="flex min-h-11 min-w-0 flex-1 items-center text-left"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          {main ? (
            // `leading-tight`, NOT `leading-none`: `truncate` is
            // `overflow: hidden`, and at line-height 1 Archivo Black's descender
            // falls outside the line box — so the tail of the "g" in "kg" was
            // sheared off. The line box has to contain the descender before the
            // overflow rule can be safe. Anywhere `truncate` meets
            // `leading-none` on a face with descenders has the same bug.
            <span className="truncate font-display text-xl leading-tight tabular-nums text-fg">
              {main}
            </span>
          ) : (
            <span className="t-control text-muted">Tap to log</span>
          )}
          {a.rpe != null ? (
            <span className="shrink-0 text-sm tabular-nums text-muted">@{a.rpe}</span>
          ) : null}
        </span>
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
