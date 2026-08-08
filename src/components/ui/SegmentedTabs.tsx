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
// aria-pressed is mandatory alongside role=tab/aria-selected: ui components in
// this app key their pressed state off it, and it is an accessibility contract
// independent of styling (see CLAUDE.md).
export default function SegmentedTabs({
  tabs,
  active,
  onChange,
  ariaLabel = 'Sections',
  size = 'md',
  className = '',
}: {
  tabs: SegTab[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      role="tablist"
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
            role="tab"
            aria-selected={on}
            aria-pressed={on}
            onClick={() => onChange(t.key)}
            className={`flex min-h-11 items-center justify-center truncate rounded-chip transition-colors duration-150 ${
              size === 'sm' ? 'px-1.5 text-[0.625rem]' : 'px-3'
            } ${on ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
