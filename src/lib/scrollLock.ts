import { useEffect } from 'react';

// Stop the page behind an open sheet from moving.
//
// Sheets used to do this with `document.body.style.overflow = 'hidden'`, taken
// and released per component. That propagates to the viewport and makes the
// document unscrollable, which on iOS WebKit is a viewport-state change: the
// collapsed toolbar expands and document scroll is clamped. Both move `dvh` —
// and every sheet panel is `max-h-[85dvh]`, `<body>` is `min-h-dvh`, and the
// backdrop is a fixed full-viewport layer. So the lock resized the panel
// mid-slide and repainted the backdrop, once on open and again on close. That
// is the flicker; see docs/LESSONS.md.
//
// Touch therefore gets no document mutation at all. The scrim carries
// `overflow-hidden overscroll-contain` instead, which makes it a scroll
// container that swallows scroll chaining — a drag on the scrim goes nowhere,
// and a drag that runs a panel's scroll body to its end stops at the scrim
// rather than continuing into the page. No viewport state changes.
//
// A fine pointer still needs the document lock: a wheel over the scrim is not
// a chained scroll, so `overscroll-behavior` does not catch it. Desktop has no
// dynamic toolbar, and `scrollbar-gutter: stable` on `html` (global.css) keeps
// removing the scrollbar from shifting the centred layout sideways.

let depth = 0;
let previousOverflow = '';

function locksDocument() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
}

// Returns the release function, so it can be used directly as an effect cleanup.
// Reference-counted because sheets nest — the Logger can have its options Modal
// and SetEntrySheet alive at once, and the old per-component snapshot/restore
// let the inner one restore 'hidden' or the outer one unlock the page while a
// sheet was still open.
export function acquireScrollLock(): () => void {
  if (!locksDocument()) return () => {};

  if (depth === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  depth += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth -= 1;
    if (depth === 0) document.body.style.overflow = previousOverflow;
  };
}

// Holds the lock for as long as the calling component is mounted. Mount it
// INSIDE the AnimatePresence subtree, not next to the `open` flag: keying the
// lock on `open` released it the instant `open` flipped false, 300ms before the
// sheet had finished sliding out.
export function useScrollLock() {
  useEffect(acquireScrollLock, []);
}
