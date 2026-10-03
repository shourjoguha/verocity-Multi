import type { KeyboardEvent, PointerEvent } from 'react';
import { MEAL_FUEL_CHART } from '@/app.config';
import type { MealLog } from '@/lib/types';
import { layoutFuelBars, macroMix, sizeWeight, toHours } from '@/lib/mealInsights';
import { MacroStack } from '@/components/meals/MacroStack';

const START = MEAL_FUEL_CHART.startHour * 60;
const END = MEAL_FUEL_CHART.endHour * 60;
const minutesOf = (time: string) => Math.round(toHours(time) * 60);
const xOf = (minutes: number) => Math.min(100, Math.max(0, ((minutes - START) / (END - START)) * 100));

// Home's fuel chart: one bar per meal. POSITION is the minute it was eaten,
// HEIGHT is the portion, SEGMENTS are the macro split (MacroStack). A dashed
// bar has macros but no recorded split — drawn as "unknown", never as an even
// guess. Meals closer than the scale can separate sit side by side
// (layoutFuelBars), so adjacency itself says "these were close".
//
// The chart is ONE focusable slider rather than a button per bar: bars can sit
// 13px apart, and a 44px hit box each would overlap its neighbours. A tap picks
// the nearest bar; arrow keys step through them. The readout under the chart
// (TodaysMeals) is the text equivalent, announced via aria-valuetext.
export function FuelBars({
  meals,
  selectedId,
  onSelect,
  nowMinutes,
  valueText,
}: {
  meals: MealLog[]; // ascending by eaten_time
  selectedId: string | null;
  onSelect: (id: string) => void;
  nowMinutes: number | null;
  valueText: string;
}) {
  const xs = layoutFuelBars(meals.map((m) => minutesOf(m.eaten_time)), START, END, MEAL_FUEL_CHART.minGapPct);
  const selectedIndex = Math.max(0, meals.findIndex((m) => m.id === selectedId));

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    let best = 0;
    xs.forEach((bx, i) => {
      if (Math.abs(bx - x) < Math.abs(xs[best] - x)) best = i;
    });
    if (meals[best]) onSelect(meals[best].id);
  };
  const step = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = meals[Math.min(meals.length - 1, Math.max(0, selectedIndex + delta))];
    if (next) onSelect(next.id);
  };

  return (
    <div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Today's meals"
        aria-valuemin={1}
        aria-valuemax={meals.length}
        aria-valuenow={selectedIndex + 1}
        aria-valuetext={valueText}
        onPointerDown={pick}
        onKeyDown={step}
        className="relative h-[46px] cursor-pointer touch-manipulation rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
      >
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-border" />
        {nowMinutes !== null && nowMinutes >= START && nowMinutes <= END ? (
          <span
            aria-hidden
            className="absolute bottom-0 top-1 w-0 border-l border-dashed border-faint"
            style={{ left: `${xOf(nowMinutes)}%` }}
          />
        ) : null}
        {meals.map((m, i) => {
          const mix = macroMix(m.tags, m.tag_mix);
          const on = i === selectedIndex;
          return (
            <span
              key={m.id}
              aria-hidden
              className={`absolute bottom-0 -ml-[5px] flex w-2.5 flex-col-reverse overflow-hidden rounded-t-[1px] transition-opacity ${
                mix ? '' : 'border border-b-0 border-dashed border-muted'
              } ${on ? '' : 'opacity-40'}`}
              style={{ left: `${xs[i]}%`, height: Math.round(sizeWeight(m.size) * MEAL_FUEL_CHART.barMaxPx) }}
            >
              {mix ? <MacroStack mix={mix} fibrePct={m.carb_fibre_pct} direction="up" /> : null}
            </span>
          );
        })}
      </div>
      <div aria-hidden className="relative mt-1 h-3 text-[9px] tracking-[0.12em] tabular-nums text-faint">
        {MEAL_FUEL_CHART.ticks.map((h, i, all) => (
          <span
            key={h}
            className={`absolute ${i === 0 ? '' : i === all.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
            style={{ left: `${xOf(h * 60)}%` }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}
