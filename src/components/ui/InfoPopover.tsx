import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// Small "!" affordance that reveals a caption bubble. Toggled from the button;
// dismissed on outside click or Escape. Anchored inline next to a label rather
// than portalled — its content is short and the parent never scrolls a section
// out from under it while it is open.
export function InfoPopover({
  label = 'More info',
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const bubbleId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={bubbleId}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        // The GLYPH stays 20px; the TARGET is 44. A bare h-5 w-5 button was
        // 20×20 and is what put ~6 sub-44px targets on /app/you (TOUCH.minTargetPx,
        // audit:mobile rule 2). The negative margins keep the larger hit box from
        // pushing the label it sits beside out of line — the box grows, the
        // layout does not. Same pattern as FitnessProfile's explainer trigger.
        className="-m-3 inline-flex h-11 w-11 items-center justify-center text-muted transition-colors hover:text-fg"
      >
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-chip border border-current text-[0.7rem] font-semibold leading-none"
        >
          !
        </span>
      </button>
      {open ? (
        <span
          id={bubbleId}
          role="tooltip"
          className="lift-fixed absolute left-1/2 top-full z-40 mt-1 w-max max-w-[16rem] -translate-x-1/2 border border-border bg-surface px-3 py-2 text-[0.7rem] leading-snug text-muted"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
