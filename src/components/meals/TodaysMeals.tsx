import { ListCard, EmptyState, SectionHeader } from '@/components/ui/primitives';
import type { MealLog } from '@/lib/types';

// Home section, below the activity chart (docs/MEAL_LOGGING.md §1.2, §10.4).
// Purely presentational — ProfileView owns the fetch (getMealLogsInRange,
// cached under 'meals:today') alongside its other Home reads, the same SWR
// shape the rest of that screen already uses, and passes the list down so
// MealChipRail's repeat-shortcut derivation reads the same array.
export function TodaysMeals({ meals }: { meals: MealLog[] }) {
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
        Today's meals
      </SectionHeader>
      {meals.length === 0 ? (
        <EmptyState>No meals logged yet.</EmptyState>
      ) : (
        <ListCard>
          {meals.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <span className="tabular-nums text-teal">{m.eaten_time}</span>
              <span className="min-w-0 flex-1 truncate text-sm capitalize text-fg">
                {m.size} · {m.kind} · {m.source}
              </span>
            </div>
          ))}
        </ListCard>
      )}
    </section>
  );
}
