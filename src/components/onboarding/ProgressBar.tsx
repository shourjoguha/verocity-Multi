// Onboarding step indicator — hairline segments that fill up to the current
// step. Tokens only (bg-fg over bg-border); the fill transition is CSS. No
// wizard/progressbar primitive existed, so this is the one small new piece.
export function ProgressBar({ total, current }: { total: number; current: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label="Onboarding progress"
      className="flex gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full rounded-full bg-fg transition-[width] duration-500 ease-[cubic-bezier(0.77,0,0.175,1)]"
            style={{ width: i <= current ? '100%' : '0%' }}
          />
        </span>
      ))}
    </div>
  );
}
