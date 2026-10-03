import type { MacroKey } from '@/lib/mealInsights';

// One meal's macro split as stacked segments, darkest to lightest P → C → F.
// The fibrous share of the carbs is a hatched slice of the carbs segment. Used
// vertically for the Home fuel chart's bars and horizontally for the saved-meal
// list's mini bars. Purely visual: every caller states the same numbers in
// text, so this is aria-hidden and colour is never the only signal.
export const MACRO_FILL: Record<MacroKey, string> = {
  protein: 'bg-macro-p',
  carbs: 'bg-macro-c',
  fat: 'bg-macro-f',
};

const ORDER: MacroKey[] = ['protein', 'carbs', 'fat'];

export function MacroStack({
  mix,
  fibrePct,
  direction,
}: {
  mix: Partial<Record<MacroKey, number>>;
  fibrePct: number | null;
  direction: 'up' | 'right';
}) {
  const flow = direction === 'up' ? 'flex-col-reverse' : 'flex-row';
  return (
    <>
      {ORDER.filter((k) => (mix[k] ?? 0) > 0).map((k) =>
        k === 'carbs' && fibrePct ? (
          <span key={k} className={`flex ${flow}`} style={{ flex: mix[k] }}>
            <span className={MACRO_FILL.carbs} style={{ flex: 100 - fibrePct }} />
            <span className="macro-hatch" style={{ flex: fibrePct }} />
          </span>
        ) : (
          <span key={k} className={MACRO_FILL[k]} style={{ flex: mix[k] }} />
        ),
      )}
    </>
  );
}
