// Hunger before → after as a 5-dot scale: a filled teal dot for the "after"
// level, a dimmed teal dot for the "before" level it fell from, and an elevated
// track dot for the rest. The title carries the exact readout for anyone who
// cannot read the fill. `role="img"` + label so it is not just decorative dots.
export function HungerDots({
  before,
  after,
  compact = false,
}: {
  before: number;
  after: number;
  compact?: boolean;
}) {
  const dot = compact ? 'h-[5px] w-[5px]' : 'h-1.5 w-1.5';
  const b = Math.round(before);
  const a = Math.round(after);
  return (
    <div
      className="flex shrink-0 items-center gap-[3px]"
      role="img"
      aria-label={`Hunger ${b} before, ${a} after`}
      title={`Hunger ${b} → ${a}`}
    >
      {[1, 2, 3, 4, 5].map((step) => (
        <span
          key={step}
          className={`rounded-full ${dot} ${
            step <= a ? 'bg-teal' : step <= b ? 'bg-teal/25' : 'bg-elevated'
          }`}
        />
      ))}
    </div>
  );
}
