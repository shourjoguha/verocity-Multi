import { useEffect, useLayoutEffect, useRef } from 'react';
import { TOUCH } from '@/app.config';

// One row per tap target, three rows visible: the middle one is the value.
const ROW = TOUCH.minTargetPx;
const VISIBLE = 3;
// How long the column must sit still before a scroll commits its value.
const SETTLE_MS = 90;
// A looping column renders its options this many times and is re-centred on
// the middle copy after every gesture, so either direction always has room.
const LOOP_COPIES = 5;
const MID = Math.floor(LOOP_COPIES / 2);

// A vertical scroll-snap column — the iOS-style wheel. The value commits once
// per gesture (after the scroll settles), never per frame: see docs/LESSONS.md
// § "Something repaints constantly while scrolling". The centre band is a
// static hairline overlay, so nothing re-renders while the column moves.
//
// `value` may be null — nothing chosen yet. The column then rests on `rest`
// with no row marked selected, and the first scroll or tap commits a value.
export function WheelPicker<T>({
  options,
  value,
  rest,
  onChange,
  format,
  label,
  loop = false,
}: {
  options: readonly T[];
  value: T | null;
  rest?: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
  label: string;
  loop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const len = options.length;
  const copies = loop ? LOOP_COPIES : 1;
  const rows = loop ? Array.from({ length: len * copies }, (_, i) => options[i % len]) : options;
  const chosen = value === null ? -1 : options.indexOf(value);
  // Where the column sits: the value, else where it rests while unset.
  const target = Math.max(0, chosen >= 0 ? chosen : rest !== undefined ? options.indexOf(rest) : 0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Set while the column moves itself. Those scrolls fire `scroll` like a
  // finger does, and must not commit: an unset column resting on `rest` would
  // otherwise choose it on mount, and Clear would undo itself. Any touch,
  // wheel or pointer hands control back to the user.
  const quiet = useRef(false);
  const release = () => {
    quiet.current = false;
  };

  function place(el: HTMLDivElement, top: number, smooth = false) {
    if (Math.abs(el.scrollTop - top) < 1) return;
    quiet.current = true;
    if (smooth) el.scrollTo({ top, behavior: 'smooth' });
    else el.scrollTop = top;
  }

  // Seed the position before paint, so the column never shows row 0 first.
  useLayoutEffect(() => {
    if (ref.current) place(ref.current, ((loop ? MID * len : 0) + target) * ROW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A value set from outside the scroll (a tap, the keyboard) moves the column
  // — to the nearest row showing it, which in a loop may be in another copy.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const at = Math.round(el.scrollTop / ROW);
    if (at % len === target) return;
    let to = at - (at % len) + target;
    if (loop && to - at > len / 2) to -= len;
    if (loop && at - to > len / 2) to += len;
    place(el, to * ROW, true);
  }, [target, len, loop]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function onScroll() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const at = Math.min(rows.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
      const self = quiet.current;
      quiet.current = false;
      // Jump back to the same row in the middle copy. Only once the column
      // has settled — moving scrollTop mid-fling would kill the momentum —
      // and it shows the same rows, so it is invisible.
      if (loop && Math.floor(at / len) !== MID) place(el, (MID * len + (at % len)) * ROW);
      if (!self && at % len !== chosen) onChangeRef.current(options[at % len]);
    }, SETTLE_MS);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = loop ? (target + step + len) % len : Math.min(len - 1, Math.max(0, target + step));
    onChange(options[i]);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 border-y border-border"
        style={{ top: ROW, height: ROW }}
      />
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPointerDown={release}
        onTouchStart={release}
        onWheel={release}
        className="scrollbar-none snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-fg"
        style={{ height: ROW * VISIBLE, paddingBlock: ROW }}
      >
        {rows.map((o, i) => {
          const selected = i % len === chosen;
          // The row an unset column rests on reads a step above the others,
          // but never as chosen.
          const resting = chosen < 0 && i % len === target;
          return (
            <div
              key={i}
              role="option"
              // Every copy of a looping column paints the value; only the
              // middle one claims it, so a screen reader hears one selection.
              aria-selected={selected && (!loop || Math.floor(i / len) === MID)}
              onClick={() => onChange(o)}
              className={`flex snap-center items-center justify-center text-lg tabular-nums ${
                selected ? 'text-fg' : resting ? 'text-muted' : 'text-faint'
              }`}
              style={{ height: ROW }}
            >
              {format(o)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
