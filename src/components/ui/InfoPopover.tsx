import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Small "!" affordance that reveals a caption bubble. Toggled from the button;
// dismissed on outside click or Escape. Anchored inline next to a label rather
// than portalled — its content is short and the parent never scrolls a section
// out from under it while it is open.
//
// The bubble is centred on the trigger, which puts half of it off-screen when
// the trigger sits near an edge — a movement name at the left edge of a card at
// 375px is exactly that case. So after it opens we measure it and shift it back
// inside the viewport, keeping the trigger's own position untouched.
export function InfoPopover({
  label = 'More info',
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const bubbleId = useId();

  // Measured once per open, before paint, so the bubble never appears clipped
  // and then jumps. `shift` resets to 0 on close, so the measurement always
  // starts from the centred position.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const el = bubbleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    if (rect.left < margin) setShift(margin - rect.left);
    else if (rect.right > window.innerWidth - margin)
      setShift(window.innerWidth - margin - rect.right);
  }, [open]);

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
          ref={bubbleRef}
          id={bubbleId}
          role="tooltip"
          className="lift-fixed absolute left-1/2 top-full z-40 mt-1 w-max max-w-[min(16rem,calc(100vw-2rem))] border border-border bg-surface px-3 py-2 text-[0.7rem] leading-snug text-muted"
          style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
