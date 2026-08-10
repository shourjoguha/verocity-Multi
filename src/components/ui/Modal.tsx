import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '@/lib/scrollLock';

// Ported from `logger/SetEntrySheet.tsx` — see its comment for why the inset
// is applied as padding on the scrim/overlay region and never as a
// margin/transform on the panel: the panel is what CSS drives the entrance
// animation on, and disturbing its own box while that runs is the same class
// of bug as the `.lift` transform fight in docs/LESSONS.md. Opt-in only
// (`keyboardInset`), so the five existing sheets see no behavior change.
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, []);
  return inset;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keyboard, focus and the scroll lock, as a null-rendering child of the sheet,
// so they mount and unmount with the DOM rather than with the `open` flag.
function ModalBehavior({
  panelRef,
  onClose,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  useScrollLock();

  // Every caller passes an inline arrow for onClose, so depending on it here
  // would re-run this effect on EVERY render of the parent — bouncing focus out
  // to the trigger and back each time. Hold it in a ref instead.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape to close, Tab cycles inside the panel, focus returns to whatever
  // opened the sheet.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    window.addEventListener('keydown', onKey);
    // Move focus into the panel a frame after it mounts — but on a touch device,
    // only as far as the panel itself.
    //
    // Focusing a text field here raises the software keyboard, and this fires
    // one frame after the tap rather than inside it, so the keyboard comes up
    // *while* the sheet is still sliding in. On iOS every keyboard transition
    // resizes the visual viewport, which relayouts every dvh-sized box and the
    // fixed backdrop behind the sheet — the background moving as the drawer
    // opens — and dismissing it on close overlaps the exit animation, so the
    // sheet appears to hang before it goes. It is also poor UX in its own
    // right: the keyboard covers most of the sheet you just opened.
    // Desktop keeps the convenience; touch users tap the field they want.
    const wantsKeyboard = window.matchMedia('(pointer: fine)').matches;
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      if (!wantsKeyboard) {
        // tabIndex -1 on the panel: screen readers still land inside the dialog,
        // and Tab from here walks its contents. No keyboard, no viewport resize.
        panel.focus({ preventScroll: true });
        return;
      }
      // Skip the header's Close button — it is first in DOM order, so "focus
      // the first focusable" would land there rather than on the real content.
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const target = items.find((el) => !el.hasAttribute('data-modal-close')) ?? items[0];
      target?.focus({ preventScroll: true });
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      opener?.focus?.({ preventScroll: true });
    };
  }, [panelRef]);

  return null;
}

// One consistent modal/sheet for the app: bottom sheet on mobile, centered card
// on desktop, backdrop + Escape to close, reduced-motion-safe. The panel is a
// flex column capped at 85dvh — callers add their own scroll body and pinned
// footer.
//
// Open and close work exactly like the in-flow forms elsewhere in the app:
// mounted while `open`, a CSS keyframe on entrance, removed immediately on
// close. No JS-driven animation and no deferred unmount — see the `sheet-rise`
// block in global.css for why.
export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  keyboardInset = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  // The dialog's accessible name defaults to `title`, which renders as the
  // header — but a caller that renders its own header in `children` (the meal
  // drawer) leaves `title` unset, which would leave the dialog with no
  // accessible name at all. Falls back to `title` when omitted, so none of
  // the five existing callers change behavior.
  ariaLabel?: string;
  // Opt-in only — defaults false so the five existing sheets render exactly as
  // before. Only the meal drawer (a form, in a drawer, with a software
  // keyboard) passes true. See docs/MEAL_LOGGING.md §0.3.
  keyboardInset?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Called unconditionally (component instance keeps a stable hook order
  // whether or not `open` or `keyboardInset` are true) — only its RESULT is
  // conditional, applied as scrim padding below.
  const measuredInset = useKeyboardInset();

  if (!open) return null;

  const scrimPaddingBottom = keyboardInset ? measuredInset : undefined;

  // Portalled to <body>, and that is load-bearing rather than tidiness.
  //
  // `position: fixed` resolves against the nearest ancestor with a transform,
  // and `.stagger-item` runs `stagger-in` with `animation-fill-mode: both` — a
  // filling animation ON the transform property, which keeps the element a
  // containing block forever after. Its computed transform reads
  // `matrix(1, 0, 0, 1, 0, 0)`: an identity matrix, visually nothing, but enough.
  // The keyframe's `to { transform: none }` does not save it.
  //
  // So any sheet rendered inside a PageStagger Item was being positioned against
  // that item instead of the viewport — measured at top: -304px on /app/stats,
  // header and Close button off-screen above the fold. Portalling puts the
  // overlay outside every stagger wrapper on the page at once.
  return createPortal(
    // overflow-hidden + overscroll-contain make this a scroll container that
    // swallows scroll chaining, which is what holds the page still on touch
    // now that nothing locks the document there. See lib/scrollLock.ts.
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-hidden overscroll-contain p-0 sm:items-center sm:p-6"
      // The keyboard inset lands here — on the flex region the panel is
      // bottom-aligned within — rather than on the panel itself. `data-sheet-scrim`
      // below is `absolute inset-0` with no content, so padding on it is inert;
      // this wrapper is the box that actually controls where `items-end` puts
      // the panel, exactly what SetEntrySheet's EntryOverlay pads.
      style={scrimPaddingBottom ? { paddingBottom: scrimPaddingBottom } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <ModalBehavior panelRef={panelRef} onClose={onClose} />
      {/* The scrim does not animate. A full-viewport element changing opacity
          is the one thing an in-flow form never does, and it was the last
          structural difference between a sheet and the forms on the same
          screens that never flickered. It appears and goes with the sheet. */}
      <div
        data-sheet-scrim
        className="absolute inset-0 bg-bg/80 pointer-fine:backdrop-blur"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        data-sheet-panel
        tabIndex={-1}
        className="sheet-panel lift-fixed pb-safe relative flex max-h-[85dvh] w-full max-w-lg flex-col border border-border bg-surface outline-none"
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="t-eyebrow text-muted">{title}</span>
            <button
              type="button"
              data-modal-close
              onClick={onClose}
              className="t-control text-muted transition-colors hover:text-fg"
            >
              Close
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
