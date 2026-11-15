import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EditableNumber } from '@/components/logger/EditableNumber';
import { haptic } from '@/lib/haptics';

// One numeric field, in two shapes:
//
// - `inline` — a full-width −/value/+ cluster with nothing hidden behind a tap.
//   Used inside SetEntrySheet, where there is room to spend and the whole point
//   is that every target is already on screen.
// - default — a condensed field for a dense row: the value sits inline and
//   tapping it opens a magnified popover holding the same −/+ and tap-to-type.
export function StepperField({
  value,
  onChange,
  step,
  clamp,
  typed = clamp,
  display,
  label,
  ariaLabel,
  inline = false,
  stepLabel = false,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  clamp: (n: number) => number;
  // What a typed value becomes. Defaults to `clamp`; pass a looser one where
  // the step is only a convenience for −/+ and an off-step value is real
  // (28 kg on a 2.5 kg step).
  typed?: (n: number) => number;
  // Overrides the rendered glyph (e.g. RPE shows "—" while empty). Defaults to the number.
  display?: (v: number) => ReactNode;
  label: string;
  ariaLabel: string;
  inline?: boolean;
  // Inline only: the keys read "−2.5" / "+2.5" (the real step, from the
  // caller) instead of a bare −/+. The focus card uses it so a tap says what
  // it will do; the sheet keeps the glyphs.
  stepLabel?: boolean;
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

  if (inline) {
    return (
      // An inset well inside the sheet (rule 2: no visible border, `bg-bg`),
      // holding two tappable keys. The 1px border stays, transparent, so the
      // cluster measures what it did when it was outlined.
      <div className="flex items-stretch rounded-control border border-transparent bg-bg">
        <button
          type="button"
          onClick={() => bump(-1)}
          className={`hill-btn-flush flex h-16 w-16 shrink-0 items-center justify-center bg-tappable text-fg active:bg-tappable-hover ${
            stepLabel ? 'text-base tabular-nums' : 'text-3xl'
          }`}
          aria-label={`Decrease ${ariaLabel}`}
        >
          {stepLabel ? `−${step}` : '−'}
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center border-x border-border-soft px-2">
          {/* min-h-11: the tap-to-type value is a control too. At text-4xl
              leading-none it measured 36px; 44 + the label still fits the
              64px keys beside it, so nothing moves. Only measured once the
              Logger's focus card put these on the page, not in a sheet. */}
          <EditableNumber
            value={value}
            onCommit={(v) => onChange(typed(v))}
            clampParse={typed}
            ariaLabel={ariaLabel}
            className="min-h-11 font-display text-4xl leading-none tabular-nums text-fg"
          >
            {display}
          </EditableNumber>
          <span className="t-label mt-1 text-muted">{label}</span>
        </div>
        <button
          type="button"
          onClick={() => bump(1)}
          className={`hill-btn-flush flex h-16 w-16 shrink-0 items-center justify-center bg-tappable text-fg active:bg-tappable-hover ${
            stepLabel ? 'text-base tabular-nums' : 'text-3xl'
          }`}
          aria-label={`Increase ${ariaLabel}`}
        >
          {stepLabel ? `+${step}` : '+'}
        </button>
      </div>
    );
  }

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
            // A floating layer: the ink border and the radius are its whole
            // separation. No shadow — depth is retired, and a raw rgba here was
            // the one untokened colour in the Logger.
            className="pop-in flex items-stretch rounded-control border border-fg bg-surface"
            style={{ transformOrigin: placement === 'top' ? 'bottom center' : 'top center' }}
          >
            <button
              type="button"
              onClick={() => bump(-1)}
              className="hill-btn-flush flex h-20 w-14 items-center justify-center bg-tappable text-3xl text-fg active:bg-tappable-hover"
              aria-label={`Decrease ${ariaLabel}`}
            >
              −
            </button>
            <div className="flex min-w-24 flex-col items-center justify-center border-x border-border-soft px-2">
              <EditableNumber
                value={value}
                onCommit={(v) => onChange(typed(v))}
                clampParse={typed}
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
              className="hill-btn-flush flex h-20 w-14 items-center justify-center bg-tappable text-3xl text-fg active:bg-tappable-hover"
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
