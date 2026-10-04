import { useState } from 'react';
import { MEAL_CARB_FIBRE_LABELS, MEAL_SIZES, type MealSizeKey } from '@/app.config';
import type { MealLog, MealPreset } from '@/lib/types';
import { macroMix } from '@/lib/mealInsights';
import { macrosIn } from '@/lib/mealDraft';
import { Card, EmptyState, SectionHeader } from '@/components/ui/primitives';
import { FuelBars } from '@/components/meals/FuelBars';

// Home "Fuel" card. Purely presentational — ProfileView owns the fetch
// (getMealLogsInRange, cached under 'meals:today') and passes today's list
// down. Just the chart: it carries time, portion and split. There is no
// readout row — by the owner's call the bars are the summary, and the exact
// numbers live one tap away at /app/meals. The chart's slider still announces
// each meal in words (aria-valuetext), so nothing is lost to a screen reader.
const sizeLabel = (size: string) => MEAL_SIZES[size as MealSizeKey]?.label ?? size;

function fibreText(pct: number): string {
  if (pct === 0) return 'starchy';
  if (pct === 100) return 'all fibrous';
  return `${MEAL_CARB_FIBRE_LABELS[pct as keyof typeof MEAL_CARB_FIBRE_LABELS] ?? `${pct}%`} fibrous`;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function TodaysMeals({ meals, presets = [] }: { meals: MealLog[]; presets?: MealPreset[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Ascending by time so the chart and "latest" read chronologically.
  const ordered = [...meals].sort((a, b) => (a.eaten_time < b.eaten_time ? -1 : 1));
  const selected = ordered.find((m) => m.id === selectedId) ?? ordered[ordered.length - 1];

  return (
    <section>
      {/* Tight to the card: the link keeps its 44px hit box, pulled back to
          the label's line height by the negative margin. */}
      <SectionHeader
        className="mb-1!"
        action={
          <a
            href="/app/meals"
            className="t-eyebrow -my-3.5 inline-flex min-h-11 items-center text-muted transition-colors hover:text-fg"
          >
            All →
          </a>
        }
      >
        Fuel
      </SectionHeader>

      {ordered.length === 0 || !selected ? (
        <EmptyState>Nothing logged yet today.</EmptyState>
      ) : (
        <Card flat className="px-3 pb-1.5 pt-2.5">
          <FuelBars
            meals={ordered}
            selectedId={selected.id}
            onSelect={setSelectedId}
            nowMinutes={nowMinutes()}
            valueText={readoutText(selected, presets)}
          />
        </Card>
      )}
    </section>
  );
}

function readoutText(meal: MealLog, presets: MealPreset[]): string {
  const mix = macroMix(meal.tags, meal.tag_mix);
  const macros = macrosIn(meal.tags);
  const name = presets.find((p) => p.id === meal.preset_id)?.name ?? sizeLabel(meal.size);
  const split = macros.length === 0 ? 'no macros' : mix ? macros.map((k) => `${k} ${mix[k]}%`).join(', ') : 'split not set';
  const fibre = macros.includes('carbs') && meal.carb_fibre_pct !== null ? `, carbs ${fibreText(meal.carb_fibre_pct)}` : '';
  return `${meal.eaten_time}, ${name}, ${split}${fibre}`;
}
