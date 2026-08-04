import type { ReactNode } from 'react';

// Collapsible section built on native <details>/<summary>. No JS state — the
// browser drives the open/close, so a section opens on the first click without
// hydration. `.disclosure summary::-webkit-details-marker { display: none }`
// hides the platform triangle in favour of the chevron rendered below.
//
// The row itself is the container, not a button, so it stays flat rather than
// carrying `.hill-btn`. Rows in a hairline grid own the depth, not their parts.
export function Disclosure({
  title,
  defaultOpen = false,
  headerRight,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="disclosure group border border-border bg-surface" open={defaultOpen}>
      <summary className="flex min-h-13 cursor-pointer list-none items-center gap-3 px-4 text-fg outline-none focus-visible:ring-1 focus-visible:ring-teal">
        <span className="flex-1 font-display text-sm font-semibold uppercase tracking-[0.04em] text-fg">
          {title}
        </span>
        {headerRight}
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
