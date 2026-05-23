// Integer stepper for reps (and other count metrics).
export function RepsStepper({
  value,
  onChange,
  label = 'reps',
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  const clamp = (v: number) => Math.max(0, Math.round(v));
  return (
    <div className="flex select-none items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        className="flex h-11 w-11 items-center justify-center border border-border text-fg hover:border-subtle"
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <div className="min-w-14 text-center">
        <span className="font-display text-3xl tabular-nums text-fg">{value || 0}</span>
        <div className="text-[0.6rem] uppercase tracking-wider text-muted">{label}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        className="flex h-11 w-11 items-center justify-center border border-border text-fg hover:border-subtle"
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}
