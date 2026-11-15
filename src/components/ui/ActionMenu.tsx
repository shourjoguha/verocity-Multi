import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MoreGlyph } from '@/components/ui/icons';

// A "⋯" trigger that opens a short list of navigation actions — the plan
// header's Edit / Switch / Review, which used to be a row of buttons that
// squeezed the title and made replacing the plan the loudest thing on a page
// whose job is reading it.
//
// Open/close mechanics follow ui/InfoPopover: inline (not portalled), closed
// on outside pointerdown or Escape, and here also on item activation and when
// focus leaves the menu. A floating layer, so it keeps a visible
// `border-border` — with no shadows nothing else separates it from the card
// beneath. Anchored to the trigger's RIGHT edge so it opens inward and cannot
// run off a 375px screen from a top-right trigger. No transform, no animation.
//
// Callers that must not offer these actions (the showcase) do not render it.
// An item is a link (`href`) or an in-page action (`onSelect`, rendered as a
// button — the plan editor's move / change section / remove).
export type ActionMenuItem =
  | { label: string; href: string }
  | { label: string; onSelect: () => void; disabled?: boolean };

export function ActionMenu({
  label,
  items,
}: {
  label: string;
  items: ActionMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    // Focus the first item so the menu is keyboard-usable the moment it opens.
    // These are links, not fields, so on touch this raises no keyboard.
    itemRefs.current[0]?.focus();
    function onDown(e: PointerEvent) {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onMenuKey(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const els = itemRefs.current.filter(Boolean) as HTMLElement[];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? els.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length;
    els[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="hill-btn t-control inline-flex h-11 w-11 items-center justify-center border border-transparent bg-tappable text-fg hover:bg-tappable-hover"
      >
        <MoreGlyph className="h-5 w-5" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-40 mt-1 w-max min-w-[12rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-border bg-surface py-1"
        >
          {items.map((item, i) => {
            const ref = (el: HTMLElement | null) => {
              itemRefs.current[i] = el;
            };
            const cls =
              't-control flex min-h-11 w-full items-center px-4 text-left text-fg outline-none transition-colors hover:bg-tappable focus-visible:bg-tappable disabled:opacity-40 disabled:hover:bg-transparent';
            return 'href' in item ? (
              <a key={item.href + item.label} ref={ref} role="menuitem" href={item.href} onClick={() => setOpen(false)} className={cls}>
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                ref={ref}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  item.onSelect();
                }}
                className={cls}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
