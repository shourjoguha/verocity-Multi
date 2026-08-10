export type SegTab = { key: string; label: string };

// The app's segmented control: a bordered SHELL holding a filled THUMB, per the
// reference design. Previously this rendered detached bordered buttons in a row,
// which read as three separate controls rather than one control with three
// states — the shell is what makes "these are alternatives" legible.
//
// `size="sm"` is the in-card variant (inside the radar card, above a region
// list). It buys compactness with TYPE AND PADDING ONLY — the row stays at
// min-h-11. The reference design sets these in-card controls at ~30px, which is
// below TOUCH.minTargetPx (44) and would fail audit:mobile rule 2, which has no
// allowlist entry for them. A segmented control is a primary affordance
// wherever it appears, so it does not get an exemption.
//
// `size="compact"` (meal logging, docs/MEAL_LOGGING.md §0.1) is the same
// resolution pushed further: tighter type and padding than `sm`, but the row
// NEVER drops below `min-h-11` — the actual hit target stays 44px. This is
// the same tension CLAUDE.md's "bigger hit box, not a bigger glyph" rule
// covers; here the fix is exactly what `sm` already does, not a fabricated
// shorter box with a negative-margin hit-area bolted on.
//
// aria-pressed is mandatory alongside role=tab/aria-selected (or role=radio/
// aria-checked, see `as` below): ui components in this app key their pressed
// state off it, and it is an accessibility contract independent of styling
// (see CLAUDE.md).
export default function SegmentedTabs({
  tabs,
  active,
  onChange,
  ariaLabel = 'Sections',
  size = 'md',
  // 'tabs' (default) is unchanged behavior — role="tablist"/"tab", meaning
  // "this switches which view is showing". 'radiogroup' is the correct
  // semantic for picking a VALUE (meal size/kind/source): role="radiogroup"
  // on the shell, role="radio" + aria-checked on each button. CLAUDE.md
  // restricts role="tablist" to view-switching, which a value picker is not.
  as = 'tabs',
  className = '',
}: {
  tabs: SegTab[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md' | 'compact';
  as?: 'tabs' | 'radiogroup';
  className?: string;
}) {
  const compact = size === 'compact';
  return (
    <div
      role={as === 'radiogroup' ? 'radiogroup' : 'tablist'}
      aria-label={ariaLabel}
      className={`t-control grid gap-1 rounded-control border border-border bg-surface p-1 ${className}`}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role={as === 'radiogroup' ? 'radio' : 'tab'}
            aria-selected={as === 'radiogroup' ? undefined : on}
            aria-checked={as === 'radiogroup' ? on : undefined}
            aria-pressed={on}
            onClick={() => onChange(t.key)}
            className={`flex min-h-11 items-center justify-center truncate rounded-chip transition-colors duration-150 ${
              compact ? 'px-1 py-1 text-[0.625rem]' : size === 'sm' ? 'px-1.5 text-[0.625rem]' : 'px-3'
            } ${
              on
                ? as === 'radiogroup'
                  ? 'bg-accent text-accent-fg'
                  : 'bg-fg text-bg'
                : 'text-muted hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
