import { JUMP_MARK, METRICS, type MetricKey } from '@/app.config';
import { showsWeightField } from '@/lib/metrics';
import type { JumpMarkKind, SetActual } from '@/lib/types';
import { cmToIn } from '@/lib/jumpMark';
import { StepperField } from '@/components/logger/StepperField';

const snap = (step: number) => (n: number) => Math.max(0, Math.round(n / step) * step);
// A typed load is kept as entered: plates and dumbbells come in more than one
// step, and snapping 28 kg to 27.5 logged a weight nobody lifted.
const keepTyped = (n: number) => Math.max(0, Math.round(n * 100) / 100);
const whole = (n: number) => Math.max(0, Math.round(n));

// The measured fields of one set — load, the movement's primary, and a jump
// mark — as inline steppers. ONE decision of which fields a metric shows,
// shared by SetEntrySheet and the Logger's focus card, so the two surfaces
// cannot drift on it. RPE is not here: the sheet uses a stepper and the focus
// card a picker, and both write it differently on purpose (see focusSet.ts).
export function SetFields({
  metric,
  markKind = null,
  actual: a,
  onPatch,
  stepLabel = false,
}: {
  metric: MetricKey;
  markKind?: JumpMarkKind | null;
  actual: SetActual;
  onPatch: (patch: Partial<SetActual>) => void;
  stepLabel?: boolean;
}) {
  const primary = () => {
    switch (metric) {
      // Legacy `weight`-primary rows render as reps; the weight field they were
      // logged with is the always-on one below, so nothing is lost.
      case 'weight':
      case 'reps':
        return (
          <StepperField
            inline
            stepLabel={stepLabel}
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
            stepLabel={stepLabel}
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
            stepLabel={stepLabel}
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
            stepLabel={stepLabel}
            value={a.calories ?? 0}
            onChange={(v) => onPatch({ calories: v })}
            step={METRICS.cal.step}
            clamp={whole}
            label={METRICS.cal.unit}
            ariaLabel="calories"
          />
        );
      // No `rpe` case: it is not a primary any more.
      default:
        return null;
    }
  };

  return (
    <>
      {/* Weight is ALWAYS available on reps/time/distance, the same way RPE
          always is — a squat, a loaded carry and a weighted plank all take
          load. Leaving it at 0 means bodyweight, which is priced through the
          movement's bwLoad rather than as zero work. Excluded on `cal`, where
          there is no external load. */}
      {showsWeightField(metric) ? (
        <StepperField
          inline
          stepLabel={stepLabel}
          value={a.weight ?? 0}
          onChange={(v) => onPatch({ weight: v })}
          step={METRICS.weight.step}
          clamp={snap(METRICS.weight.step)}
          typed={keepTyped}
          label={METRICS.weight.unit}
          ariaLabel="weight"
        />
      ) : null}
      {primary()}
      {/* Jump mark, per set: a distance changes every jump, and a box height
          usually does not but may (set once for all sets in movement
          options). Centimetres; a box also shows inches, because that is how
          boxes are sold. */}
      {markKind ? (
        <StepperField
          inline
          stepLabel={stepLabel}
          value={a.mark ?? 0}
          onChange={(v) => onPatch({ mark: v })}
          step={JUMP_MARK.step[markKind]}
          clamp={whole}
          display={(v) => (markKind === 'height' && v ? `${v} (${cmToIn(v)}in)` : v || 0)}
          label={markKind === 'height' ? 'cm box' : 'cm jump'}
          ariaLabel={markKind === 'height' ? 'box height in centimetres' : 'jump distance in centimetres'}
        />
      ) : null}
    </>
  );
}
