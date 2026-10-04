import { useEffect, useState } from 'react';
import { getMealLogs, getMealPresets, deleteMealLog } from '@/lib/queries';
import { mealPhotoUrl, deleteMealPhoto } from '@/lib/mealPhoto';
import { toDraft, type MealDraft } from '@/lib/mealDraft';
import { MEAL_FUEL_CHART, MEAL_SIZES, MEAL_SOURCES, MEAL_TAGS } from '@/app.config';
import type { MealLog, MealPreset } from '@/lib/types';
import { buildDayInsights, macroMix, summarizeTiming, tagShare, type DayInsight } from '@/lib/mealInsights';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Card, EmptyState, ListCard, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import { Disclosure } from '@/components/ui/Disclosure';
import { MealDrawer } from '@/components/meals/MealDrawer';
import { FuelTicks, FuelTrack, fuelBarPositions } from '@/components/meals/FuelBars';
import { MacroStack } from '@/components/meals/MacroStack';
import { toast } from '@/lib/toast';

// The meals page, in the Home card's language: one card for the week (a day
// per row of the same fuel chart, one line of timing, one line of macros), then
// the history with only today open. No per-tag hues, no legend: the chart
// explains itself on Home and means the same thing here.

function groupByDay(meals: MealLog[]): [string, MealLog[]][] {
  const groups = new Map<string, MealLog[]>();
  for (const m of meals) {
    const list = groups.get(m.log_date) ?? [];
    list.push(m);
    groups.set(m.log_date, list);
  }
  // getMealLogs already orders newest-first (log_date desc, eaten_time desc),
  // so Map insertion order already reflects that.
  return Array.from(groups.entries());
}

export default function MealsView() {
  const [meals, setMeals] = useState<MealLog[] | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<MealLog | null>(null);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [presets, setPresets] = useState<MealPreset[]>([]);

  useEffect(() => {
    getMealLogs().then(setMeals);
    getMealPresets().then(setPresets);
  }, []);

  // Thumbnails are resolved async, off the render path — mealPhotoUrl mints a
  // short-lived signed URL and cannot be called inline during render.
  useEffect(() => {
    if (!meals) return;
    const withPhoto = meals.filter((m) => m.photo_path && !photoUrls[m.photo_path]);
    if (withPhoto.length === 0) return;
    let active = true;
    (async () => {
      const entries = await Promise.all(
        withPhoto.map(async (m) => [m.photo_path as string, await mealPhotoUrl(m.photo_path as string)] as const),
      );
      if (!active) return;
      setPhotoUrls((prev) => {
        const next = { ...prev };
        for (const [path, url] of entries) if (url) next[path] = url;
        return next;
      });
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meals]);

  const openEdit = (m: MealLog) => {
    setEditing(m);
    setDraft(toDraft(m));
  };

  const onSaved = async () => {
    // Simplest correct thing after an edit or a delete: re-read the list. This
    // is the history page, not a hot path, and it also picks up any
    // server-side normalisation.
    setMeals(await getMealLogs());
  };

  const onDelete = async (m: MealLog) => {
    const ok = await deleteMealLog(m.id);
    if (!ok) {
      toast('Could not delete the meal.', 'error');
      return;
    }
    if (m.photo_path) await deleteMealPhoto(m.photo_path);
    setMeals((cur) => (cur ? cur.filter((x) => x.id !== m.id) : cur));
    toast('Meal deleted');
  };

  if (meals === null) return <LoadingScreen />;

  const groups = groupByDay(meals);
  const days = buildDayInsights(meals, 7);
  const summary = summarizeTiming(days);
  const weekMeals = days.flatMap((d) => d.meals);
  const shares = tagShare(
    weekMeals,
    MEAL_TAGS.map((t) => t.key),
  ).filter((r) => r.count > 0);
  const abbr = (key: string) =>
    ({ protein: 'P', carbs: 'C', fat: 'F' })[key] ?? MEAL_TAGS.find((t) => t.key === key)?.label ?? key;
  const presetName = (id: string | null) => (id ? presets.find((p) => p.id === id)?.name : undefined);
  // One day's meals under a quiet date label; `boxed` puts them in a card.
  // A render helper, not a component: defined in render, a component would
  // remount every row on each parent render.
  const dayRows = (date: string, dayMeals: MealLog[], boxed = false) => {
    const rows = (
      <div className="divide-y divide-border-soft">
        {dayMeals.map((m) => (
          <MealRow
            key={m.id}
            meal={m}
            name={presetName(m.preset_id)}
            photoUrl={m.photo_path ? photoUrls[m.photo_path] : undefined}
            onOpen={() => openEdit(m)}
            onDelete={() => onDelete(m)}
          />
        ))}
      </div>
    );
    return (
      <div key={date}>
        <div className="mb-1 px-1 t-label text-muted">{dayLabel(date)}</div>
        {boxed ? <ListCard>{rows}</ListCard> : rows}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      <div className="mb-6">
        <EchoText text="MEALS" as="h1" className={ECHO_APP_TITLE} />
      </div>

      {groups.length === 0 ? (
        <EmptyState>No meals logged yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader className="mb-1!">Last {days.length} days</SectionHeader>
            <Card flat className="px-3 pb-2 pt-3">
              <p className="mb-2 text-sm tabular-nums text-muted">
                <span className="font-display text-base text-fg">
                  {summary.averageFirstMeal}–{summary.averageLastMeal}
                </span>{' '}
                · {summary.averageGap} · {summary.mealsPerDay}/d ·{' '}
                <span aria-label={`hunger ${summary.hungerBefore.toFixed(1)} before, ${summary.hungerAfter.toFixed(1)} after`}>
                  H {summary.hungerBefore.toFixed(1)}→{summary.hungerAfter.toFixed(1)}
                </span>
              </p>
              <WeekChart days={days} />
              {shares.length > 0 ? (
                <p className="mt-2 border-t border-border-soft pt-2 text-xs tabular-nums text-muted">
                  {shares.map((r, i) => (
                    <span key={r.tag}>
                      {i > 0 ? ' · ' : ''}
                      <span className="text-fg">{abbr(r.tag)}</span> {Math.round(r.share * 100)}%
                    </span>
                  ))}
                  <span className="text-faint"> of meals</span>
                </p>
              ) : null}
            </Card>
          </section>

          {/* History. The latest day stays open; every earlier day folds into
              ONE disclosure with a count — a box per day was eight boxes. */}
          <section>
            <SectionHeader className="mb-1!">History</SectionHeader>
            <div className="flex flex-col gap-2">
              {dayRows(groups[0][0], groups[0][1], true)}
              {groups.length > 1 ? (
                <Disclosure
                  title="Earlier"
                  headerRight={`${groups.length - 1} days · ${groups.slice(1).reduce((n, [, m]) => n + m.length, 0)} meals`}
                >
                  <div className="flex flex-col gap-3">
                    {groups.slice(1).map(([date, dayMeals]) => dayRows(date, dayMeals))}
                  </div>
                </Disclosure>
              ) : null}
            </div>
          </section>
        </div>
      )}

      <MealDrawer
        draft={draft}
        onDraftChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
        onClose={() => {
          setDraft(null);
          setEditing(null);
        }}
        editingId={editing?.id ?? null}
        onSaved={onSaved}
      />
    </div>
  );
}

// One row per day, newest first, of the Home fuel chart at a smaller size; the
// axis is drawn once underneath.
function WeekChart({ days }: { days: DayInsight[] }) {
  return (
    <div>
      <ul className="flex flex-col gap-1">
        {days.map((day) => (
          <li key={day.date} className="grid grid-cols-[44px_1fr] items-end gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] tabular-nums text-muted">
              {day.weekday.slice(0, 2)} {Number(day.date.slice(8))}
            </span>
            <div className="relative h-5">
              <FuelTrack meals={day.meals} xs={fuelBarPositions(day.meals)} barMaxPx={MEAL_FUEL_CHART.dayRowBarMaxPx} thin />
            </div>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[44px_1fr] gap-2">
        <span />
        <FuelTicks />
      </div>
    </div>
  );
}

const sizeLabel = (size: string) => MEAL_SIZES[size as keyof typeof MEAL_SIZES]?.label ?? size;

// A history row: time, the split as a mini bar, what it was, hunger as two
// digits. Kind and source show only when they are the exception (a snack,
// eaten out), not on every row.
function MealRow({
  meal,
  name,
  photoUrl,
  onOpen,
  onDelete,
}: {
  meal: MealLog;
  name: string | undefined;
  photoUrl: string | undefined;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const mix = macroMix(meal.tags, meal.tag_mix);
  const hasMacros = meal.tags.some((t) => t === 'protein' || t === 'carbs' || t === 'fat');
  const extras = [
    meal.kind === 'snack' ? 'snack' : null,
    meal.source !== 'home' ? (MEAL_SOURCES[meal.source as keyof typeof MEAL_SOURCES]?.label ?? meal.source).toLowerCase() : null,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-3 pl-4">
      <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 text-left">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="h-8 w-8 shrink-0 rounded-control border border-border object-cover" />
        ) : null}
        <span className="w-11 shrink-0 text-sm tabular-nums text-fg">{meal.eaten_time}</span>
        <span aria-hidden className={`inline-flex h-1.5 w-9 shrink-0 overflow-hidden rounded-[1px] ${mix ? '' : hasMacros ? 'border border-dashed border-muted' : ''}`}>
          {mix ? <MacroStack mix={mix} fibrePct={meal.carb_fibre_pct} direction="right" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-fg">
          {name ?? sizeLabel(meal.size)}
          {extras.length ? <span className="text-muted"> · {extras.join(' · ')}</span> : null}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-faint" aria-label={`Hunger ${meal.hunger_before} before, ${meal.hunger_after} after`}>
          {meal.hunger_before}→{meal.hunger_after}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete meal at ${meal.eaten_time}`}
        onClick={onDelete}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-faint transition-colors hover:text-fg"
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}

// 'YYYY-MM-DD' -> "Today", "Yesterday" or "Sat 3 Oct", in local time.
function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
