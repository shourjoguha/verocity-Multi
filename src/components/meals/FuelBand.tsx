import type { MealLog } from '@/lib/types';
import { DAY_HOURS, formatHour, fuelByHour, mealsInHour } from '@/lib/mealInsights';

// A single horizontal hour-of-day heatmap (06:00 → 23:00). Cell POSITION is when
// a meal was logged; cell INTENSITY is the portion size (Light/Medium/Heavy).
// The accent fill is mixed toward the surface so an empty-ish hour stays subtle;
// the token flips with the theme, so no hardcoded colour. A meal's hour also
// gets a foreground tick along its bottom edge as a discrete "logged" marker.
export function FuelBand({
  meals,
  height = 'md',
  showAxis = true,
}: {
  meals: MealLog[];
  height?: 'sm' | 'md';
  showAxis?: boolean;
}) {
  const fuel = fuelByHour(meals);
  const cellHeight = height === 'md' ? 'h-9' : 'h-5';

  return (
    <div>
      <div className="flex gap-[2px]">
        {DAY_HOURS.map((hour, index) => {
          const intensity = fuel[index];
          const marker = mealsInHour(meals, hour)[0];
          return (
            <div
              key={hour}
              className={`relative min-w-0 flex-1 rounded-[2px] ${cellHeight}`}
              style={{
                backgroundColor:
                  intensity > 0.02
                    ? `color-mix(in srgb, var(--color-teal) ${Math.round(
                        12 + intensity * 68,
                      )}%, var(--color-surface))`
                    : 'var(--color-elevated)',
              }}
              title={
                marker
                  ? `${marker.eaten_time} · ${marker.size} · ${marker.kind}`
                  : `${formatHour(hour)}:00`
              }
            >
              {marker && (
                <span
                  className="absolute inset-x-[3px] bottom-[3px] rounded-[1px] bg-fg"
                  style={{ height: height === 'md' ? 4 : 3 }}
                />
              )}
            </div>
          );
        })}
      </div>

      {showAxis && (
        <div className="mt-1.5 flex justify-between px-[1px] text-[9px] uppercase tracking-[0.18em] tabular-nums text-faint">
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
      )}
    </div>
  );
}
