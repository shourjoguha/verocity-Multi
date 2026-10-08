import type { ReactNode } from 'react';

// Collapsible section built on native <details>/<summary>. No JS state — the
// browser drives the open/close, so a section opens on the first click without
// hydration. `.disclosure summary::-webkit-details-marker { display: none }`
// hides the platform triangle in favour of the chevron rendered below.
//
// The row itself is the container, not a button, so it stays flat rather than
// carrying `.hill-btn`. Rows in a hairline grid own the depth, not their parts.
export function Disclosure({
  id,
  title,
  defaultOpen = false,
  headerRight,
  variant = 'card',
  children,
}: {
  // Set this to make the section addressable from elsewhere — You's summary
  // card opens the Profile section by id rather than lifting `open` into React
  // state, which would trade the browser-driven, works-before-hydration
  // behaviour for a controlled component and gain nothing else.
  id?: string;
  title: ReactNode;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  // 'card' is a standalone section. 'row' is a "show more" line INSIDE a card
  // that already has its own border: no box of its own, a soft divider above,
  // label type rather than display type. A card-styled disclosure nested in a
  // card read as a new section of the page, not as more of the one above it.
  variant?: 'card' | 'row';
  children: ReactNode;
}) {
  if (variant === 'row') {
    return (
      <details id={id} className="disclosure group border-t border-border-soft" open={defaultOpen}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 text-muted outline-none hover:text-fg focus-visible:ring-1 focus-visible:ring-teal">
          <span className="t-label flex-1">{title}</span>
          {headerRight ? (
            <span className="min-w-0 shrink truncate text-xs text-subtle tabular-nums">
              {headerRight}
            </span>
          ) : null}
          <span
            aria-hidden
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center transition-transform duration-200 group-open:rotate-90"
          >
            ›
          </span>
        </summary>
        <div className="px-3 pb-3">{children}</div>
      </details>
    );
  }
  return (
    <details
      id={id}
      className="disclosure group rounded-card border border-border bg-surface"
      open={defaultOpen}
    >
      <summary className="flex min-h-13 cursor-pointer list-none items-center gap-3 px-4 text-fg outline-none focus-visible:ring-1 focus-visible:ring-teal">
        <span className="flex-1 font-display text-sm uppercase tracking-[0.04em] text-fg">
          {title}
        </span>
        {/* The value preview. `truncate` + `min-w-0` on a flex child: without
            both, a long value (a full email, a share URL) pushes the chevron
            off the row instead of ellipsing. */}
        {headerRight ? (
          <span className="min-w-0 shrink truncate text-xs text-muted">{headerRight}</span>
        ) : null}
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted transition-transform duration-200 group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}
