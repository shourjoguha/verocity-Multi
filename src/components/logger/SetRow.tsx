import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { METRICS, RPE, type MetricKey } from '@/app.config';
import type { LogSet, SetActual } from '@/lib/types';
import { StepperField } from '@/components/logger/StepperField';
import { EASE } from '@/components/anim';
import { haptic } from '@/lib/haptics';

const snap = (step: number) => (n: number) => Math.max(0, Math.round(n / step) * step);
const whole = (n: number) => Math.max(0, Math.round(n));
const snapRpe = (n: number) => Math.min(RPE.max, Math.max(RPE.min, Math.round(n / RPE.step) * RPE.step));

// One condensed set row: every metric is a tap-to-magnify field (see StepperField),
// followed by delete + complete. The fields shown follow the item's primary metric,
// with RPE always available as a secondary (and primary when the metric is RPE).
export function SetRow({
  metric,
  set,
  isPr = false,
  onPatch,
  onToggle,
  onRemove,
  onCloneForward,
}: {
  metric: MetricKey;
  set: LogSet;
  isPr?: boolean;
  onPatch: (patch: Partial<SetActual>) => void;
  onToggle: () => void;
  onRemove: () => void;
  onCloneForward?: () => void;
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

  const fields = () => {
    switch (metric) {
      case 'weight':
        return (
          <>
            <StepperField
              value={a.weight ?? 0}
              onChange={(v) => onPatch({ weight: v })}
              step={METRICS.weight.step}
              clamp={snap(METRICS.weight.step)}
              label={METRICS.weight.unit}
              ariaLabel="weight"
            />
            <StepperField
              value={a.reps ?? 0}
              onChange={(v) => onPatch({ reps: v })}
              step={METRICS.reps.step}
              clamp={whole}
              label="reps"
              ariaLabel="reps"
            />
          </>
        );
      case 'reps':
        return (
          <StepperField
            value={a.reps ?? 0}
            onChange={(v) => onPatch({ reps: v })}
            step={METRICS.reps.step}
            clamp={whole}
            label="reps"
            ariaLabel="reps"
          />
        );
      case 'time':
        return (
          <StepperField
            value={a.time ?? 0}
            onChange={(v) => onPatch({ time: v })}
            step={METRICS.time.step}
            clamp={snap(METRICS.time.step)}
            label={METRICS.time.unit}
            ariaLabel="time"
          />
        );
      case 'distance':
        return (
          <StepperField
            value={a.distance ?? 0}
            onChange={(v) => onPatch({ distance: v })}
            step={METRICS.distance.step}
            clamp={snap(METRICS.distance.step)}
            label={METRICS.distance.unit}
            ariaLabel="distance"
          />
        );
      case 'rpe':
        return null;
    }
  };

  return (
    <div
      className={`flex items-center gap-1 border-l-2 pl-2 ${
        a.completed ? 'border-accent' : 'border-border'
      }`}
    >
      {set.planned ? (
        <span className="flex w-9 shrink-0 items-center text-[0.6rem] uppercase leading-tight tracking-wider text-muted">
          {set.planned}
        </span>
      ) : null}

      <div className="flex min-w-0 items-center gap-0.5">
        {fields()}
        <StepperField
          value={a.rpe ?? RPE.min}
          onChange={(v) => onPatch({ rpe: v })}
          step={RPE.step}
          clamp={snapRpe}
          display={() => a.rpe ?? '—'}
          label="rpe"
          ariaLabel="RPE"
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {a.completed && onCloneForward ? (
          <button
            type="button"
            onClick={() => {
              haptic(15);
              onCloneForward?.();
            }}
            className="flex min-h-11 w-8 items-center justify-center text-lg text-muted hover:text-fg"
            aria-label="Copy to next set"
            title="Copy to next set"
          >
            ↓
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            haptic(15);
            onRemove();
          }}
          className="flex min-h-11 w-8 items-center justify-center text-lg text-muted hover:text-fg"
          aria-label="Delete set"
          title="Delete set"
        >
          ×
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
            className={`hill-btn flex min-h-11 w-10 shrink-0 items-center justify-center border text-lg ${
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
    </div>
  );
}
