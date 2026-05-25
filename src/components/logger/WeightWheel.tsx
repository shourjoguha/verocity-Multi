import { METRICS, UNITS } from '@/app.config';
import { EditableNumber } from '@/components/logger/EditableNumber';

const STEP = METRICS.weight.step;

// Weight picker: large value with −/+ targets and tap-to-type. kg-only for v1.
export function WeightWheel({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(0, Math.round(v / STEP) * STEP);
  return (
    <div className="flex select-none items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(clamp(value - STEP))}
        className="flex h-11 w-11 items-center justify-center border border-border text-fg hover:border-subtle"
        aria-label="Decrease weight"
      >
        −
      </button>
      <div className="min-w-24 text-center">
        <EditableNumber
          value={value}
          onCommit={(v) => onChange(clamp(v))}
          clampParse={clamp}
          ariaLabel="weight"
          className="font-display text-3xl tabular-nums text-fg"
        >
          {(v) => (
            <>
              {v || 0}
              <span className="ml-1 text-sm text-muted">{UNITS.weight}</span>
            </>
          )}
        </EditableNumber>
      </div>
      <button
        type="button"
        onClick={() => onChange(clamp(value + STEP))}
        className="flex h-11 w-11 items-center justify-center border border-border text-fg hover:border-subtle"
        aria-label="Increase weight"
      >
        +
      </button>
    </div>
  );
}
