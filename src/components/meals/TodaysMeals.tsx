import { useState } from 'react';
import { MEAL_CARB_FIBRE_LABELS, MEAL_SIZES, type MealSizeKey } from '@/app.config';
import type { MealLog, MealPreset } from '@/lib/types';
import { macroMix, type MacroKey } from '@/lib/mealInsights';
import { macrosIn } from '@/lib/mealDraft';
import { Card, EmptyState, SectionHeader } from '@/components/ui/primitives';
import { FuelBars } from '@/components/meals/FuelBars';
import { MACRO_FILL } from '@/components/meals/MacroStack';

// Home "Fuel" card. Purely presentational — ProfileView owns the fetch
// (getMealLogsInRange, cached under 'meals:today') and passes today's list
// down. One chart and one line: the chart carries time, portion and split; the
// line under it says the count and reads out ONE meal — the one tapped, the
// latest by default. No legend, no chips, no list: the readout replaces all
// three, and the full history lives one tap away at /app/meals.
const sizeLabel = (size: string) => MEAL_SIZES[size as MealSizeKey]?.label ?? size;
const ABBR: Record<MacroKey, string> = { protein: 'P', carbs: 'C', fat: 'F' };

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

      {ordered.length === 0 || !selected ? (
        <EmptyState>Nothing logged yet today.</EmptyState>
      ) : (
        <Card flat className="px-3 pb-2 pt-2.5">
          <FuelBars
            meals={ordered}
            selectedId={selected.id}
            onSelect={setSelectedId}
            nowMinutes={nowMinutes()}
            valueText={readoutText(selected, presets)}
          />
          <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-border-soft pt-1.5 text-xs tabular-nums text-muted">
            <span className="shrink-0">
              <span className="font-display text-sm text-fg">{ordered.length}</span>{' '}
              {ordered.length === 1 ? 'meal' : 'meals'}
            </span>
            <Readout meal={selected} presets={presets} />
          </div>
        </Card>
      )}
    </section>
  );
}

function Readout({ meal, presets }: { meal: MealLog; presets: MealPreset[] }) {
  const mix = macroMix(meal.tags, meal.tag_mix);
  const macros = macrosIn(meal.tags);
  const name = presets.find((p) => p.id === meal.preset_id)?.name ?? sizeLabel(meal.size);
  return (
    <span aria-live="polite" className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
      <span className="text-fg">{meal.eaten_time}</span>
      <span className="truncate">{name}</span>
      {macros.length === 0 ? (
        <span>no macros</span>
      ) : mix ? (
        macros.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <i aria-hidden className={`inline-block h-[7px] w-[7px] rounded-[1px] ${MACRO_FILL[k]}`} />
            {ABBR[k]}
            {mix[k]}
          </span>
        ))
      ) : (
        <span className="inline-flex items-center gap-1">
          <i aria-hidden className="inline-block h-[7px] w-[7px] rounded-[1px] border border-dashed border-muted" />
          {macros.map((k) => ABBR[k]).join(' ')} · split not set
        </span>
      )}
      {macros.includes('carbs') && meal.carb_fibre_pct !== null ? (
        <span className="inline-flex items-center gap-1">
          <i aria-hidden className="macro-hatch inline-block h-[7px] w-[7px] rounded-[1px]" />
          {fibreText(meal.carb_fibre_pct)}
        </span>
      ) : null}
    </span>
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
