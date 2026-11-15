export type SegTab = { key: string; label: string };

// The app's segmented control: a filled SHELL (the tappable track) holding an
// accent THUMB. Previously this rendered detached bordered buttons in a row,
// which read as three separate controls rather than one control with three
// states — the shell is what makes "these are alternatives" legible. The shell
// keeps a 1px TRANSPARENT border so it still measures 36px (26 thumb + 2×4
// padding + 2×1 border) and lines up with anything sized against it.
//
// SLIM BY DEFAULT, at EVERY size. The visible thumb is a ~26px inner row
// (`min-h-[26px]`) so the whole control reads slim per the reference design —
// this is the standard, not a per-caller override (a `[&_button]:min-h-[26px]`
// override on one instance is what this replaces). `size` only changes TYPE AND
// PADDING: `md` (default) is the top-level nav scale, `sm` the in-card scale,
// `compact` (meal logging, docs/MEAL_LOGGING.md §0.1) tighter still. Font size
// never shrinks to buy height — the slimness comes entirely from the thumb.
//
// The <button> itself STAYS min-h-11 (44px = TOUCH.minTargetPx) so audit:mobile
// rule 2 holds and the tap target is real; a negative -my collapses that 44px
// box down to the 26px thumb in layout flow, so the control LOOKS slim while the
// hit box does not. This is exactly CLAUDE.md's "bigger hit box, not a bigger
// glyph" applied in reverse: never shrink the button below 44px to get a slim
// look. Keeping the thumb on an inner span (not the button) is what lets the
// fill/focus ring hug the 26px visual instead of the 44px hit box. The button
// carries no `hill-btn`, so the global aria-pressed fills never reach it; the
// thumb's own classes paint the state.
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
      className={`t-control grid gap-1 rounded-control border border-transparent bg-tappable p-1 ${className}`}
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
            // Hit target stays 44px; -my collapses it to the 26px thumb in flow,
            // so the control reads slim without a sub-44px tap target. Focus ring
            // moves to the thumb so it hugs the 26px visual, not the 44px box.
            className="group -my-[9px] flex min-h-11 items-center justify-center focus-visible:outline-none"
          >
            <span
              className={`flex min-h-[26px] w-full items-center justify-center truncate rounded-chip transition-colors duration-150 group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:[outline-color:var(--color-focus)] ${
                compact ? 'px-1 text-[0.625rem]' : size === 'sm' ? 'px-1.5 text-[0.625rem]' : 'px-3'
              } ${
                on ? 'bg-accent text-accent-fg' : 'text-muted group-hover:text-fg'
              }`}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
