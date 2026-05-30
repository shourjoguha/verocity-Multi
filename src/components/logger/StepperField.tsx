import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EditableNumber } from '@/components/logger/EditableNumber';
import { haptic } from '@/lib/haptics';

// One condensed numeric field for a set row. The value sits inline; tapping it
// opens a magnified (~2× the row) popover anchored to the field, holding the
// −/+ targets and tap-to-type entry — so the steppers no longer cost a row each.
export function StepperField({
  value,
  onChange,
  step,
  clamp,
  display,
  label,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  clamp: (n: number) => number;
  // Overrides the rendered glyph (e.g. RPE shows "—" while empty). Defaults to the number.
  display?: (v: number) => ReactNode;
  label: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const glyph = (v: number) => (display ? display(v) : v || 0);

  // Flip below the field when there isn't room above (first rows under the header).
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    setPlacement(wrapRef.current.getBoundingClientRect().top < 140 ? 'bottom' : 'top');
  }, [open]);

  // Dismiss on outside tap or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const bump = (dir: -1 | 1) => {
    haptic(8);
    onChange(clamp(value + dir * step));
  };

  return (
    <div ref={wrapRef} className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Edit ${ariaLabel}`}
        aria-expanded={open}
        className={`flex min-h-11 min-w-11 flex-col items-center justify-center px-1 transition-colors ${
          open ? 'text-fg' : 'text-fg hover:text-fg'
        }`}
      >
        <span className="font-display text-2xl leading-none tabular-nums">{glyph(value)}</span>
        <span className="mt-1 text-[0.55rem] uppercase tracking-wider text-muted">{label}</span>
      </button>

      {open ? (
        <div
          className={`absolute left-1/2 z-30 -translate-x-1/2 ${
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <div
            className="pop-in flex items-stretch border border-fg bg-surface shadow-[0_12px_40px_rgba(17,17,17,0.18)]"
            style={{ transformOrigin: placement === 'top' ? 'bottom center' : 'top center' }}
          >
            <button
              type="button"
              onClick={() => bump(-1)}
              className="flex h-20 w-14 items-center justify-center text-3xl text-fg active:bg-elevated"
              aria-label={`Decrease ${ariaLabel}`}
            >
              −
            </button>
            <div className="flex min-w-24 flex-col items-center justify-center border-x border-border px-2">
              <EditableNumber
                value={value}
                onCommit={(v) => onChange(clamp(v))}
                clampParse={clamp}
                ariaLabel={ariaLabel}
                className="font-display text-5xl leading-none tabular-nums text-fg"
              >
                {display}
              </EditableNumber>
              <span className="mt-1 text-[0.6rem] uppercase tracking-wider text-muted">{label}</span>
            </div>
            <button
              type="button"
              onClick={() => bump(1)}
              className="flex h-20 w-14 items-center justify-center text-3xl text-fg active:bg-elevated"
              aria-label={`Increase ${ariaLabel}`}
            >
              +
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
