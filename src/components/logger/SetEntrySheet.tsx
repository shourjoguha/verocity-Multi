import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { METRICS, RPE, type MetricKey } from '@/app.config';
import type { LogSet, SetActual } from '@/lib/types';
import { StepperField } from '@/components/logger/StepperField';
import { EASE } from '@/components/anim';
import { haptic } from '@/lib/haptics';

const snap = (step: number) => (n: number) => Math.max(0, Math.round(n / step) * step);
const whole = (n: number) => Math.max(0, Math.round(n));
const snapRpe = (n: number) => Math.min(RPE.max, Math.max(RPE.min, Math.round(n / RPE.step) * RPE.step));

// How far the software keyboard currently intrudes. A `fixed` element is
// anchored to the layout viewport, so when iOS opens the keyboard it shrinks
// the *visual* viewport and the sheet ends up underneath it. Tracking
// visualViewport lets us lift the panel by exactly the occluded height.
function useKeyboardInset(active: boolean) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const measure = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
      setInset(0);
    };
  }, [active]);
  return inset;
}

// Full-width entry sheet for one set — the in-gym editing surface.
//
// The set row itself is a read-only summary (see SetRow); all editing happens
// here, where there is room for real targets and where the panel can lift clear
// of the keyboard. Every metric for the movement is on screen at once, so
// logging a set is: tap the row, adjust, "Log set".
export function SetEntrySheet({
  open,
  metric,
  movement,
  setIndex,
  setCount,
  set,
  onPatch,
  onLog,
  onRemove,
  onCloneForward,
  onClose,
}: {
  open: boolean;
  metric: MetricKey;
  movement: string;
  setIndex: number;
  setCount: number;
  set: LogSet | null;
  onPatch: (patch: Partial<SetActual>) => void;
  onLog: () => void;
  onRemove: () => void;
  onCloneForward: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset(open);

  // See Modal: onClose is an inline arrow at the call site, so depending on it
  // would re-run this on every Logger render — and the Logger re-renders on
  // every tap of +/− in this very sheet, releasing and re-taking the scroll
  // lock each time.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const a = set?.actual;

  const fields = () => {
    if (!a) return null;
    switch (metric) {
      case 'weight':
        return (
          <>
            <StepperField
              inline
              value={a.weight ?? 0}
              onChange={(v) => onPatch({ weight: v })}
              step={METRICS.weight.step}
              clamp={snap(METRICS.weight.step)}
              label={METRICS.weight.unit}
              ariaLabel="weight"
            />
            <StepperField
              inline
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
            inline
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
            inline
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
            inline
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

  const secondary =
    'hill-btn flex min-h-11 flex-1 items-center justify-center border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg';

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && a ? (
          <motion.div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/80 pointer-fine:backdrop-blur"
            role="dialog"
            aria-modal="true"
            aria-label={`Set ${setIndex + 1} — ${movement}`}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              ref={panelRef}
              className="lift-fixed pb-safe flex max-h-[85dvh] w-full max-w-lg flex-col overflow-y-auto border border-border bg-surface"
              style={{ marginBottom: keyboardInset }}
              onClick={(e) => e.stopPropagation()}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-fg">{movement}</div>
                  <div className="t-control text-muted">
                    Set {setIndex + 1} of {setCount}
                    {set?.planned ? ` · target ${set.planned}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex min-h-11 shrink-0 items-center px-2 t-control text-muted transition-colors hover:text-fg"
                >
                  Close
                </button>
              </div>

              <div className="flex flex-col gap-2 p-4">
                {fields()}
                <StepperField
                  inline
                  value={a.rpe ?? RPE.default}
                  onChange={(v) => onPatch({ rpe: v })}
                  step={RPE.step}
                  clamp={snapRpe}
                  display={() => a.rpe ?? '—'}
                  label="rpe"
                  ariaLabel="RPE"
                />

                <button
                  type="button"
                  onClick={() => {
                    haptic();
                    onLog();
                  }}
                  className="hill-btn mt-2 flex min-h-14 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
                >
                  {a.completed ? 'Update set' : 'Log set'}
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      haptic(15);
                      onCloneForward();
                    }}
                    className={secondary}
                  >
                    Copy to next
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      haptic(15);
                      onRemove();
                    }}
                    className={secondary}
                  >
                    Delete set
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
