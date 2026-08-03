export type SegTab = { key: string; label: string };

// The app's segmented control — the BodyView window-switcher idiom
// (hill-btn + aria-pressed + border-fg/border-border) lifted into one place.
// aria-pressed is mandatory so the pillow's pressed-in state lands (see the
// button rules in CLAUDE.md); role=tab/aria-selected carries the semantics.
export default function SegmentedTabs({
  tabs,
  active,
  onChange,
  ariaLabel = 'Sections',
}: {
  tabs: SegTab[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="t-control flex gap-1">
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
            className={`hill-btn flex min-h-11 flex-1 items-center justify-center border bg-surface px-3 transition-colors ${
              on ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
