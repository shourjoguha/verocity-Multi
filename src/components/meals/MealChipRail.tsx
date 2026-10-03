import { repeatShortcuts, type MealPreset } from '@/lib/mealDraft';
import type { MealLog } from '@/lib/types';

// Lives inside the active-plan card, directly beneath the Start row, in BOTH
// of its branches (docs/MEAL_LOGGING.md §10.3, §11.1). A 40px hairline strip:
// a fixed bowl cell that never scrolls, and segments divided by inner
// hairlines — the same gap-px grammar as the day row above — in a region that
// does scroll, and only this region, never the whole card.
//
// 40px is BELOW TOUCH.minTargetPx, on purpose and by the owner's call: the
// alternative was 35px visible with 44px boxes overlapping the Start bar, and
// a mis-tap there starts a meal instead of a workout. Do not "fix" it with a
// negative-margin hit box for that reason.
export function MealChipRail({
  meals,
  onOpen,
}: {
  meals: MealLog[];
  onOpen: (preset: MealPreset) => void;
}) {
  const shortcuts = repeatShortcuts(meals);

  return (
    <div className="flex min-h-10 gap-px border-t border-border-soft bg-border-soft">
      {/* Fixed left: never scrolls. The icon is the label. */}
      <span
        role="img"
        aria-label="Add meal"
        className="flex w-10 shrink-0 items-center justify-center bg-surface text-muted"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 11h18a9 9 0 0 1-18 0Z" />
          <path d="M9 7c0-1.5 1-2 1-3.5M13 7c0-1.5 1-2 1-3.5" />
        </svg>
      </span>
      {/* Only this region scrolls — overscroll-behavior-x: contain (via
          overscroll-x-contain) stops it chaining to the page underneath. */}
      <div
        className="scrollbar-none flex min-w-0 flex-1 gap-px overflow-x-auto overscroll-x-contain"
      >
        <Segment label="Custom" icon="+" onClick={() => onOpen({ kind: 'custom' })} />
        {shortcuts.map((tag) => (
          <Segment key={tag} label={tag} onClick={() => onOpen({ kind: 'repeat', tag })} />
        ))}
        <Segment label="Meal" onClick={() => onOpen({ kind: 'meal' })} />
        <Segment label="Snack" onClick={() => onOpen({ kind: 'snack' })} />
      </div>
    </div>
  );
}

function Segment({ label, icon, onClick }: { label: string; icon?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // "Add meal: …" names the action for AT, and is the prefix the mobile
      // audit's ALLOW list keys this strip's deliberate 40px height on.
      aria-label={`Add meal: ${label}`}
      className="flex min-h-10 shrink-0 grow items-center justify-center gap-1 bg-surface px-3.5 t-control text-fg transition-colors hover:bg-elevated"
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      <span className="truncate capitalize">{label}</span>
    </button>
  );
}
