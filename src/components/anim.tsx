import { useEffect, useRef, useState, type ReactNode } from 'react';

// Shared motion helpers for the React islands, and deliberately free of the
// `motion` library: this module is imported by nearly every island (StatCard
// pulls AnimatedNumber through ui/primitives), so anything it imports lands in
// the first load of every page. Motion is ~43KB gzip; Home needs none of it.
// The editorial easing curve from the design spec drives all of it.

export const EASE: [number, number, number, number] = [0.77, 0, 0.175, 1];

// Screen-entrance stagger — CSS-driven, deliberately.
//
// Astro server-renders this content, so a JS-driven entrance can only start
// AFTER hydration. That meant painting the page fully, then snapping every
// block to opacity 0 / y 18 the moment Motion mounted and fading it back in:
// measured at t=735ms on a fast machine, later on a phone. That is the "flicker
// about a second after load, on every page" — the entrance was fighting SSR.
//
// CSS animates from the very first painted frame instead (fill-mode `both`), so
// there is no visible state to yank. It also runs without waiting on JS.
// See docs/LESSONS.md.
export function PageStagger({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`stagger ${className ?? ''}`}>{children}</div>;
}

// Staggered child — fades + rises in sequence inside a PageStagger. Its delay
// comes from nth-child in global.css, so no index has to be threaded through.
export function Item({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`stagger-item ${className ?? ''}`}>{children}</div>;
}

// Count-up numeral — rolls from 0 to `value` once it scrolls into view, on the
// editorial easing, with tabular figures so the width never jitters. Honors
// reduced-motion (snaps straight to the value). The delight vocabulary the data
// surfaces reuse (StatCard, Stats, etc.).
export function AnimatedNumber({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 0.9,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // Starts at 0 on the server and the client alike, so hydration matches; the
  // effect decides whether to roll or snap.
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setInView(true);
        io.disconnect();
      },
      { rootMargin: '-8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const set = (n: number) => {
      current.current = n;
      setShown(n);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      set(value);
      return;
    }
    if (!inView) return;
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      set(from + (value - from) * cubicBezier(EASE, t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {format(shown)}
    </span>
  );
}

// CSS `cubic-bezier(x1, y1, x2, y2)` evaluated at progress `t`: solve x(u) = t
// for u by Newton's method (falling back to bisection), then return y(u).
export function cubicBezier([x1, y1, x2, y2]: [number, number, number, number], t: number): number {
  if (t <= 0 || t >= 1) return t;
  const bez = (u: number, a: number, b: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = bez(u, x1, x2) - t;
    const dx = 3 * x1 * (1 - u) ** 2 + 6 * (x2 - x1) * u * (1 - u) + 3 * (1 - x2) * u ** 2;
    if (Math.abs(x) < 1e-5) return bez(u, y1, y2);
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  let lo = 0;
  let hi = 1;
  u = t;
  for (let i = 0; i < 30; i++) {
    const x = bez(u, x1, x2);
    if (Math.abs(x - t) < 1e-5) break;
    if (x < t) lo = u;
    else hi = u;
    u = (lo + hi) / 2;
  }
  return bez(u, y1, y2);
}
