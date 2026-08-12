import { MEAL_SIZES, type MealSizeKey } from '@/app.config';
import type { MealLog } from '@/lib/types';
import { macroTags } from '@/lib/mealInsights';
import { Card, EmptyState, SectionHeader } from '@/components/ui/primitives';
import { FuelBand } from '@/components/meals/FuelBand';
import { MacroChips } from '@/components/meals/MacroChips';

// Home "Fuel" card (docs/MEAL_LOGGING.md §1.2, §10.4). Purely presentational —
// ProfileView owns the fetch (getMealLogsInRange, cached under 'meals:today')
// and passes today's list down. Compressed summary of the design's fuel view:
// count + portions, the hour-of-day heatmap band, then each meal with its macro
// chips. Sits UNDER the stats strip on Home.
const PORTIONS: MealSizeKey[] = ['light', 'medium', 'heavy'];
const sizeLabel = (size: string) => MEAL_SIZES[size as MealSizeKey]?.label ?? size;

export function TodaysMeals({ meals }: { meals: MealLog[] }) {
  // Ascending by time so "last" and the reversed list read chronologically.
  const ordered = [...meals].sort((a, b) => (a.eaten_time < b.eaten_time ? -1 : 1));
  const portions = PORTIONS.map((size) => ({
    size,
    count: ordered.filter((m) => m.size === size).length,
  })).filter(({ count }) => count > 0);
  const lastMeal = ordered[ordered.length - 1];

  return (
    <section>
      <SectionHeader
        action={
          <a
            href="/app/meals"
            className="t-eyebrow -my-2 inline-flex min-h-11 items-center text-muted transition-colors hover:text-fg"
          >
            All →
          </a>
        }
      >
        Fuel
      </SectionHeader>

      {ordered.length === 0 ? (
        <EmptyState>Nothing logged yet today.</EmptyState>
      ) : (
        <Card flat>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm tabular-nums text-muted">
              <span className="font-display text-base text-fg">{ordered.length}</span> meals{' '}
              <span className="text-faint">/</span>{' '}
              <span className="text-subtle">
                {portions.map(({ size, count }) => `${count} ${sizeLabel(size).toLowerCase()}`).join(' · ')}
              </span>
            </p>
            {lastMeal && (
              <p className="t-label tabular-nums text-muted">Last {lastMeal.eaten_time}</p>
            )}
          </div>

          <FuelBand meals={ordered} />

          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border-soft pt-3">
            {[...ordered].reverse().map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-teal">{m.eaten_time}</span>
                <span className="text-xs capitalize text-muted">{sizeLabel(m.size)}</span>
                <MacroChips tags={macroTags(m)} size="xs" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
