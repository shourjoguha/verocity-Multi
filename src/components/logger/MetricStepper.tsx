// Generic +/- stepper for count-like metrics (time, distance). Weight uses the
// drag WeightWheel and reps uses RepsStepper; this covers the rest.
export function MetricStepper({
  value,
  onChange,
  step,
  label,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  label: string;
  unit?: string;
}) {
  const clamp = (v: number) => Math.max(0, Math.round(v / step) * step);
  return (
    <div className="flex select-none items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        className="flex h-11 w-11 items-center justify-center border border-border text-fg hover:border-subtle"
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <div className="min-w-16 text-center">
        <span className="font-display text-3xl tabular-nums text-fg">{value || 0}</span>
        {unit ? <span className="ml-1 text-sm text-muted">{unit}</span> : null}
        <div className="text-[0.6rem] uppercase tracking-wider text-muted">{label}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        className="flex h-11 w-11 items-center justify-center border border-border text-fg hover:border-subtle"
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}
