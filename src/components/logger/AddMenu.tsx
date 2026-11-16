import { useEffect, useId, useRef, useState } from 'react';
import { PlusGlyph } from '@/components/ui/icons';

// The Logger's one "+" per section. It replaced a pair of "+ Movement" and
// "+ Subroutine" text buttons that repeated on every section header. With more
// than one section it asks WHICH section first — that is the folded row of
// empty sections, which used to be a full header each saying nothing.
//
// Same floating-layer mechanics as ui/ActionMenu (inline, outside pointerdown
// and Escape close it, visible `border-border` because nothing else separates
// it from the card beneath, anchored to the trigger's right edge so it opens
// inward at 375px). No transform, no animation.
export type AddKind = 'movement' | 'subroutine';

export function AddMenu<K extends string>({
  sections,
  labelFor,
  onPick,
  label,
}: {
  sections: K[];
  labelFor: (key: K) => string;
  onPick: (sectionKey: K, kind: AddKind) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<K | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const chosen = sections.length === 1 ? sections[0] : section;

  useEffect(() => {
    if (!open) return;
    (menuRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
    function onDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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
  }, [open, chosen]);

  const cls =
    't-control flex min-h-11 w-full items-center px-4 text-left text-fg outline-none transition-colors hover:bg-tappable focus-visible:bg-tappable';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setSection(null);
          setOpen((v) => !v);
        }}
        className="-my-2 flex h-11 w-11 items-center justify-center text-muted hover:text-fg"
      >
        <PlusGlyph className="h-[1.15rem] w-[1.15rem]" />
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-40 mt-1 w-max min-w-[12rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-border bg-surface py-1"
        >
          {chosen == null ? (
            <>
              <div className="px-4 pb-1 pt-2 t-label text-muted">Add to</div>
              {sections.map((k) => (
                <button key={k} type="button" role="menuitem" onClick={() => setSection(k)} className={cls}>
                  {labelFor(k)}
                </button>
              ))}
            </>
          ) : (
            <>
              {sections.length > 1 ? (
                <div className="px-4 pb-1 pt-2 t-label text-muted">{labelFor(chosen)}</div>
              ) : null}
              {(['movement', 'subroutine'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onPick(chosen, kind);
                  }}
                  className={cls}
                >
                  {kind === 'movement' ? 'Movement' : 'Subroutine'}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
