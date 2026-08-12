import { mealTagColor, macroInitial } from '@/lib/tags';

// Single-letter macro chips (P / C / F). The letter carries the meaning, so the
// generated hue is reinforcement, not the only signal (per CLAUDE.md: anything
// colour-coded must survive without colour). `aria-hidden` because the meal
// row's text already states size/kind/source; these are a visual shorthand.
export function MacroChips({ tags, size = 'sm' }: { tags: string[]; size?: 'sm' | 'xs' }) {
  if (tags.length === 0) return null;
  const dimension =
    size === 'sm' ? 'h-[18px] w-[18px] text-[10px]' : 'h-[15px] w-[15px] text-[9px]';
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {tags.map((tag) => {
        const color = mealTagColor(tag);
        return (
          <span
            key={tag}
            className={`flex shrink-0 items-center justify-center rounded-chip border font-bold tabular-nums ${dimension}`}
            style={{ color, borderColor: color }}
            title={tag}
          >
            {macroInitial(tag)}
          </span>
        );
      })}
    </div>
  );
}
