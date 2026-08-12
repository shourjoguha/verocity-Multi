import type { DayInsight } from '@/lib/mealInsights';
import { FuelBand } from '@/components/meals/FuelBand';
import { HungerDots } from '@/components/meals/HungerDots';

// The dedicated page's primary insight: when eating actually happens across the
// week, one row per day, with hunger before → after folded into the right edge.
// The 52px / 1fr / 64px columns keep the band from overflowing at 375px.
export function TimingHeatmap({ days }: { days: DayInsight[] }) {
  return (
    <div>
      <div className="hidden grid-cols-[52px_1fr_64px] items-end gap-3 pb-2 sm:grid">
        <span className="text-[9px] uppercase tracking-[0.18em] text-faint">Day</span>
        <div className="flex justify-between text-[9px] uppercase tracking-[0.18em] tabular-nums text-faint">
          <span>06</span>
          <span>10</span>
          <span>14</span>
          <span>18</span>
          <span>23</span>
        </div>
        <span className="text-right text-[9px] uppercase tracking-[0.18em] text-faint">
          Hunger
        </span>
      </div>

      <ul className="flex flex-col gap-[6px]">
        {days.map((day) => (
          <li key={day.date} className="grid grid-cols-[52px_1fr_64px] items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.16em] tabular-nums text-muted">
              {day.weekday} {day.date.slice(8)}
            </span>
            <FuelBand meals={day.meals} height="sm" showAxis={false} />
            <div className="flex justify-end">
              <HungerDots before={day.hungerBefore} after={day.hungerAfter} compact />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-soft pt-3 text-[10px] uppercase tracking-[0.16em] text-muted">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-[2px] bg-teal/20" />
          Light portion
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-[2px] bg-teal/80" />
          Heavy portion
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-teal" />
          Satisfied after
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-teal/25" />
          Hunger before
        </span>
      </div>
    </div>
  );
}
