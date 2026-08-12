import { useEffect, useState } from 'react';
import { getMealLogs, deleteMealLog } from '@/lib/queries';
import { mealPhotoUrl, deleteMealPhoto } from '@/lib/mealPhoto';
import { toDraft, type MealDraft } from '@/lib/mealDraft';
import type { MealLog } from '@/lib/types';
import { buildDayInsights, macroTags, summarizeTiming } from '@/lib/mealInsights';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import {
  Card,
  ListCard,
  EmptyState,
  LoadingScreen,
  SectionHeader,
  StatStrip,
  Takeaway,
} from '@/components/ui/primitives';
import { MealDrawer } from '@/components/meals/MealDrawer';
import { MacroChips } from '@/components/meals/MacroChips';
import { HungerDots } from '@/components/meals/HungerDots';
import { TimingHeatmap } from '@/components/meals/TimingHeatmap';
import { TagMix } from '@/components/meals/TagMix';
import { toast } from '@/lib/toast';

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

  useEffect(() => {
    getMealLogs().then(setMeals);
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
  const stats = [
    { label: 'First meal', value: summary.averageFirstMeal },
    { label: 'Last meal', value: summary.averageLastMeal },
    { label: 'Eating window', value: summary.averageGap },
    { label: 'Meals / day', value: summary.mealsPerDay },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      <div className="mb-6">
        <EchoText text="MEALS" as="h1" className={ECHO_APP_TITLE} />
      </div>

      {groups.length === 0 ? (
        <EmptyState>No meals logged yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {/* When eating actually happens across the week — the primary insight. */}
          <section>
            <SectionHeader>Meal timing · 7 days</SectionHeader>
            <Card flat>
              <Takeaway
                lead={`You eat between ${summary.averageFirstMeal} and ${summary.averageLastMeal} on average.`}
                detail={
                  summary.lateNights > 0
                    ? `A ${summary.averageGap} window — ${summary.lateNights} of 7 days finished after 21:00.`
                    : `A ${summary.averageGap} window — no late-night finishes this week.`
                }
              />
              <div className="mt-5">
                <TimingHeatmap days={days} />
              </div>
            </Card>
          </section>

          <section>
            <StatStrip stats={stats} />
          </section>

          {/* Share of meals carrying each tag, coloured per tag. */}
          <section>
            <SectionHeader>Tag mix · 7 days</SectionHeader>
            <Card flat>
              <p className="mb-4 text-sm text-muted">
                Share of meals carrying each tag. Hunger moves from{' '}
                {summary.hungerBefore.toFixed(1)} to {summary.hungerAfter.toFixed(1)} on average.
              </p>
              <TagMix meals={meals} />
            </Card>
          </section>

          {/* Editable history — unchanged data path, restyled rows. */}
          <section>
            <SectionHeader>History</SectionHeader>
            <div className="flex flex-col gap-6">
              {groups.map(([date, dayMeals]) => (
                <section key={date}>
                  <h3 className="mb-2 px-1 t-label text-muted">{date}</h3>
                  <ListCard>
                    {dayMeals.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openEdit(m)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          {m.photo_path && photoUrls[m.photo_path] ? (
                            <img
                              src={photoUrls[m.photo_path]}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-control border border-border object-cover"
                            />
                          ) : null}
                          <span className="shrink-0 tabular-nums text-teal">{m.eaten_time}</span>
                          <MacroChips tags={macroTags(m)} size="xs" />
                          <span className="min-w-0 flex-1 truncate text-sm capitalize text-fg">
                            {m.size} · {m.kind} · {m.source}
                          </span>
                        </button>
                        <HungerDots before={m.hunger_before} after={m.hunger_after} compact />
                        <button
                          type="button"
                          aria-label={`Delete meal at ${m.eaten_time}`}
                          onClick={() => onDelete(m)}
                          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted transition-colors hover:text-fg"
                        >
                          <span aria-hidden>🗑</span>
                        </button>
                      </div>
                    ))}
                  </ListCard>
                </section>
              ))}
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
