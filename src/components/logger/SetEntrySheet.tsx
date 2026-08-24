import { useEffect, useRef, useState, type ReactNode } from 'react';
import { METRICS, RPE, type MetricKey } from '@/app.config';
import { showsWeightField } from '@/lib/metrics';
import type { LogSet, SetActual } from '@/lib/types';
import { StepperField } from '@/components/logger/StepperField';
import { haptic } from '@/lib/haptics';
import { useScrollLock } from '@/lib/scrollLock';

const snap = (step: number) => (n: number) => Math.max(0, Math.round(n / step) * step);
const whole = (n: number) => Math.max(0, Math.round(n));
const snapRpe = (n: number) => Math.min(RPE.max, Math.max(RPE.min, Math.round(n / RPE.step) * RPE.step));

// How far the software keyboard currently intrudes. A `fixed` element is
// anchored to the layout viewport, so when iOS opens the keyboard it shrinks
// the *visual* viewport and the sheet ends up underneath it. Tracking
// visualViewport lets us lift the panel by exactly the occluded height.
//
// The inset is applied to the SCRIM's padding, never the panel's margin: the
// panel is the element Motion drives `y` on, and changing its layout box while
// that animation runs is the same class of bug as the `.lift` transform fight
// in docs/LESSONS.md. Nor does this reset to 0 on teardown — it used to, which
// fired at the *start* of the exit and snapped the panel up by the keyboard
// height before it slid down.
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, []);
  return inset;
}

// The overlay itself, split out so that everything scoped to "the sheet is on
// screen" — the scroll lock, Escape, the keyboard tracker — mounts and unmounts
// with the DOM rather than with the `open` flag.
function EntryOverlay({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useScrollLock();
  const keyboardInset = useKeyboardInset();

  // See Modal: onClose is an inline arrow at the call site, so depending on it
  // would re-run this on every Logger render — and the Logger re-renders on
  // every tap of +/− in this very sheet.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    // overflow-hidden + overscroll-contain hold the page still on touch; see
    // lib/scrollLock.ts. The keyboard inset is padding HERE rather than a
    // margin on the panel, so it never disturbs the panel's own box.
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-hidden overscroll-contain"
      style={{ paddingBottom: keyboardInset }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* Static scrim, CSS-only panel entrance — see ui/Modal.tsx. */}
      <div
        data-sheet-scrim
        className="absolute inset-0 bg-bg/80 pointer-fine:backdrop-blur"
        onClick={onClose}
      />
      <div
        data-sheet-panel
        className="sheet-panel-full lift-fixed pb-safe relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-y-auto border border-border bg-surface"
      >
        {children}
      </div>
    </div>
  );
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
  const a = set?.actual;

  const fields = () => {
    if (!a) return null;
    switch (metric) {
      // Legacy `weight`-primary rows render as reps; the weight field they were
      // logged with is the always-on one below, so nothing is lost.
      case 'weight':
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
      case 'cal':
        return (
          <StepperField
            inline
            value={a.calories ?? 0}
            onChange={(v) => onPatch({ calories: v })}
            step={METRICS.cal.step}
            clamp={whole}
            label={METRICS.cal.unit}
            ariaLabel="calories"
          />
        );
      // No `rpe` case: it is not a primary any more, and the RPE stepper below
      // renders for every metric regardless.
      default:
        return null;
    }
  };

  const secondary =
    'hill-btn flex min-h-11 flex-1 items-center justify-center border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg';

  if (!open || !a) return null;

  return (
    <EntryOverlay label={`Set ${setIndex + 1} — ${movement}`} onClose={onClose}>
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
                {/* Weight is ALWAYS available on reps/time/distance, the same way
                    RPE always is below — a squat, a loaded carry and a weighted
                    plank all take load. Leaving it at 0 means bodyweight, which
                    is priced through the movement's bwLoad rather than as zero
                    work. Excluded on `cal`, where there is no external load. */}
                {showsWeightField(metric) ? (
                  <StepperField
                    inline
                    value={a.weight ?? 0}
                    onChange={(v) => onPatch({ weight: v })}
                    step={METRICS.weight.step}
                    clamp={snap(METRICS.weight.step)}
                    label={METRICS.weight.unit}
                    ariaLabel="weight"
                  />
                ) : null}
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
    </EntryOverlay>
  );
}
