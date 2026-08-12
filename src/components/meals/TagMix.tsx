import { MEAL_TAGS } from '@/app.config';
import type { MealLog } from '@/lib/types';
import { tagShare } from '@/lib/mealInsights';
import { mealTagColor } from '@/lib/tags';

// Share of meals carrying each tag, as a labelled bar row. The label and the
// percentage carry the reading; the generated hue only distinguishes the bars,
// so this is legible without colour. Driven off MEAL_TAGS, so a newly-added tag
// (e.g. Fat) appears here with its own colour automatically.
export function TagMix({ meals }: { meals: MealLog[] }) {
  const rows = tagShare(
    meals,
    MEAL_TAGS.map((t) => t.key),
  );
  const label = (key: string) => MEAL_TAGS.find((t) => t.key === key)?.label ?? key;

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map(({ tag, count, share }) => (
        <li key={tag} className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-[10px] uppercase tracking-[0.16em] text-muted">
            {label(tag)}
          </span>
          <div className="h-1.5 min-w-0 flex-1 rounded-[2px] bg-elevated">
            <div
              className="h-full rounded-[2px]"
              style={{ width: `${Math.max(share * 100, 3)}%`, backgroundColor: mealTagColor(tag) }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">
            {Math.round(share * 100)}%
          </span>
          <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-faint">
            {count}
          </span>
        </li>
      ))}
    </ul>
  );
}
