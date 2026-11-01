import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HISTORY_SCROLL } from '@/app.config';

// A chart strip that scrolls sideways through its own history. Shared by Home's
// activity bars (ProfileView) and the Stats consistency grid.
//
// - The children are the columns, oldest first, as DIRECT children of the
//   scroller (it is the flex row). The caller sizes them so the latest
//   `visible` of them fill the width; this component never changes a column's
//   width. Columns may differ in width (Home's multi-session days are wider),
//   so the in-view range is read from where the columns actually sit — a
//   column is in view when its centre is — not from a uniform pitch, and an
//   older stretch can hold a column more or fewer than `visible`.
// - Native overflow scrolling with per-column snap — no JS drag, no transform.
//   overflow-y is hidden and touch-action left at its default, so a vertical
//   swipe that starts on the chart still scrolls the page.
// - Opens on the latest column, set in a layout effect so the first painted
//   frame is already there. That programmatic scroll is not a user scroll, so
//   it does not show the date note.
// - While the user scrolls, the in-view range (from scrollLeft and the column
//   pitch, once per frame) is reported to `onRangeChange` — only when it
//   changes — and a muted date note above the chart shows `labelFor(range)`.
//   The note fades out HISTORY_SCROLL.noteHoldMs after the last scroll: a CSS
//   opacity transition, dropped under reduced motion.
// - The note is anchored to this component's outer box, which fills its
//   parent's width even when the scroller itself is narrower (`style`).

export type HistoryRange = { start: number; end: number };

// "3 Mar – 30 Mar"; years appear only when the range leaves the current year.
// Takes YYYY-MM-DD and reads it as written, so no timezone can shift a day.
// Month names are spelled here because en-GB's locale data now says "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDateRange(from: string, to: string): string {
  const thisYear = String(new Date().getFullYear());
  const showYear = from.slice(0, 4) !== thisYear || to.slice(0, 4) !== thisYear;
  const fmt = (s: string) =>
    `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}${showYear ? ` ${s.slice(0, 4)}` : ''}`;
  return `${fmt(from)} – ${fmt(to)}`;
}

// Column centres in scroll coordinates rise monotonically, so the first and
// last centred-in-view columns are two binary searches over offsetLeft/Width
// (layout reads only, once per frame).
function rangeInView(el: HTMLElement, count: number): HistoryRange {
  const cols = el.children as HTMLCollectionOf<HTMLElement>;
  const n = Math.min(count, cols.length);
  if (n === 0) return { start: 0, end: 0 };
  const origin = cols[0].offsetLeft;
  const centre = (i: number) => cols[i].offsetLeft - origin + cols[i].offsetWidth / 2;
  const lo = el.scrollLeft;
  const hi = lo + el.clientWidth;
  // First column whose centre is at or past `x`.
  const firstAtOrAfter = (x: number) => {
    let a = 0;
    let b = n;
    while (a < b) {
      const m = (a + b) >> 1;
      if (centre(m) < x) a = m + 1;
      else b = m;
    }
    return a;
  };
  const start = Math.min(n - 1, firstAtOrAfter(lo));
  const end = Math.max(start, firstAtOrAfter(hi) - 1);
  return { start, end: Math.min(n - 1, end) };
}

export function HistoryScroller({
  count,
  visible,
  labelFor,
  onRangeChange,
  ariaLabel,
  className = '',
  style,
  children,
}: {
  count: number;
  visible: number;
  labelFor: (range: HistoryRange) => string;
  onRangeChange?: (range: HistoryRange) => void;
  ariaLabel: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [scrolling, setScrolling] = useState(false);
  // Callers pass inline arrows; reading them through refs keeps the scroll
  // listener from being torn down on every parent render.
  const labelForRef = useRef(labelFor);
  labelForRef.current = labelFor;
  const onRangeRef = useRef(onRangeChange);
  onRangeRef.current = onRangeChange;
  // Set when WE moved scrollLeft, so the scroll event it fires is ignored.
  const programmatic = useRef(false);
  // True while the latest column is in view. A width change (rotation, a late
  // font, the measured width settling) changes every column's width while
  // scrollLeft stays put, which would leave a strip that opened on today
  // showing some earlier stretch; while pinned, it is put back on the end.
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const toEnd = () => {
      const before = el.scrollLeft;
      el.scrollLeft = el.scrollWidth;
      if (el.scrollLeft !== before) programmatic.current = true;
    };
    pinned.current = true;
    toEnd();
    // Fires before paint, so a re-pin is never a visible jump.
    const ro = new ResizeObserver(() => {
      if (pinned.current) toEnd();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [count, visible]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = '';
    const measure = () => {
      frame = 0;
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      const { start, end } = rangeInView(el, count);
      pinned.current = end === count - 1;
      const key = `${start}:${end}`;
      if (key !== last) {
        last = key;
        onRangeRef.current?.({ start, end });
        setLabel(labelForRef.current({ start, end }));
      }
      setScrolling(true);
      clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), HISTORY_SCROLL.noteHoldMs);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [count, visible]);

  return (
    <div className="relative">
      <p
        aria-hidden
        data-history-note
        className={`pointer-events-none absolute bottom-full right-0 mb-1 whitespace-nowrap text-[11px] leading-none text-muted tabular-nums transition-opacity duration-300 motion-reduce:transition-none ${
          scrolling && label ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {label}
      </p>
      <div
        ref={scrollerRef}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        data-history-scroller
        className={`scrollbar-none flex snap-x snap-mandatory [&>*]:shrink-0 [&>*]:snap-start overflow-x-auto overflow-y-hidden overscroll-x-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg ${className}`}
        style={style}
      >
        {children}
      </div>
    </div>
  );
}
