import { useEffect, useLayoutEffect, useRef } from 'react';
import { TOUCH } from '@/app.config';

// One row per tap target, three rows visible: the middle one is the value.
const ROW = TOUCH.minTargetPx;
const VISIBLE = 3;
// How long the column must sit still before a scroll commits its value.
const SETTLE_MS = 90;

// A vertical scroll-snap column — the iOS-style wheel. The value commits once
// per gesture (after the scroll settles), never per frame: see docs/LESSONS.md
// § "Something repaints constantly while scrolling". The centre band is a
// static hairline overlay, so nothing re-renders while the column moves.
export function WheelPicker<T>({
  options,
  value,
  onChange,
  format,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const index = Math.max(0, options.indexOf(value));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Seed the position before paint, so the column never shows row 0 first.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = index * ROW;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A value set from outside the scroll (a tap, the keyboard) moves the column.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ROW) !== index) {
      el.scrollTo({ top: index * ROW, behavior: 'smooth' });
    }
  }, [index]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function onScroll() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
      if (options[i] !== value) onChangeRef.current(options[i]);
    }, SETTLE_MS);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = Math.min(options.length - 1, Math.max(0, index + step));
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
        className="scrollbar-none snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-fg"
        style={{ height: ROW * VISIBLE, paddingBlock: ROW }}
      >
        {options.map((o, i) => (
          <div
            key={i}
            role="option"
            aria-selected={i === index}
            onClick={() => onChange(o)}
            className={`flex snap-center items-center justify-center text-lg tabular-nums ${
              i === index ? 'text-fg' : 'text-faint'
            }`}
            style={{ height: ROW }}
          >
            {format(o)}
          </div>
        ))}
      </div>
    </div>
  );
}
