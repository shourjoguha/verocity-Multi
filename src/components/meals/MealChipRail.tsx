import { repeatShortcuts, type MealPreset } from '@/lib/mealDraft';
import type { MealLog } from '@/lib/types';

// Lives inside the active-plan card, directly beneath the Start row, in BOTH
// of its branches (docs/MEAL_LOGGING.md §10.3, §11.1). ~48px row: a fixed
// "Add meal" label that never scrolls, and a chip region that does — only
// this region, never the whole card.
export function MealChipRail({
  meals,
  onOpen,
}: {
  meals: MealLog[];
  onOpen: (preset: MealPreset) => void;
}) {
  const shortcuts = repeatShortcuts(meals);

  return (
    <div className="flex min-h-12 items-center gap-2 border-t border-border-soft bg-surface px-2">
      {/* Fixed left: never scrolls. */}
      <div className="flex shrink-0 items-center gap-1.5 pl-1 text-muted">
        <span aria-hidden className="text-sm leading-none">🍽</span>
        <span className="t-label">Add meal</span>
      </div>
      {/* Only this region scrolls — overscroll-behavior-x: contain (via
          overscroll-x-contain) stops it chaining to the page underneath. */}
      <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain">
        <Chip
          label="Custom"
          icon="+"
          onClick={() => onOpen({ kind: 'custom' })}
        />
        {shortcuts.map((tag) => (
          <Chip key={tag} label={tag} onClick={() => onOpen({ kind: 'repeat', tag })} />
        ))}
        <Chip label="Meal" onClick={() => onOpen({ kind: 'meal' })} />
        <Chip label="Snack" onClick={() => onOpen({ kind: 'snack' })} />
      </div>
    </div>
  );
}

function Chip({ label, icon, onClick }: { label: string; icon?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hill-btn flex min-h-11 shrink-0 items-center gap-1 rounded-chip border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg"
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      <span className="truncate capitalize">{label}</span>
    </button>
  );
}

