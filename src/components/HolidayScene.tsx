import { useEffect, useRef } from 'react';
import type { HolidayKind } from '@/lib/types';
import {
  chainFigureX,
  drawScene,
  readScenePalette,
  type SceneInk,
  type ScenePalette,
} from '@/lib/holidayScene';
import { useHolidayInk, useHolidayMotion } from '@/lib/holidayPrefs';

// An animated holiday scene on a <canvas>. The drawing is lib/holidayScene.ts;
// this owns the clock, sizing and visibility.
//
// ONE requestAnimationFrame loop for every scene on the page, not one per
// canvas, and a scene off screen (IntersectionObserver) is not drawn at all —
// the calendar can hold several ribbon segments plus the consistency grid's
// strip. Under Still, or prefers-reduced-motion, each scene draws one frame and
// redraws only on resize, theme or ink change.
//
// `chain` splits one traveller across several canvases — a calendar ribbon
// that wraps at the week boundary. Segments of a chain share their widths here
// so the figure walks out of one row and into the next.

type Entry = { draw: (t: number) => void; visible: boolean };
const entries = new Set<Entry>();
const chains = new Map<string, number[]>();
const palettes = new Map<SceneInk, ScenePalette>();
let raf = 0;
let animate = true;
// The single frozen moment Still draws: figures mid-stride, not at a seam.
const STILL_T = 3.4;

function frame(now: number) {
  raf = 0;
  if (!animate) return;
  const t = now / 1000;
  for (const e of entries) if (e.visible) e.draw(t);
  if (entries.size > 0) raf = requestAnimationFrame(frame);
}
function kick() {
  if (!raf && animate && entries.size > 0) raf = requestAnimationFrame(frame);
}
function redrawAll() {
  const t = animate ? performance.now() / 1000 : STILL_T;
  for (const e of entries) e.draw(t);
}
function palette(ink: SceneInk): ScenePalette {
  let p = palettes.get(ink);
  if (!p) {
    p = readScenePalette(ink);
    palettes.set(ink, p);
  }
  return p;
}

// The theme lives on <html data-theme>. A switch invalidates both palettes.
let themeWatch: MutationObserver | null = null;
function watchTheme() {
  if (themeWatch || typeof MutationObserver === 'undefined') return;
  themeWatch = new MutationObserver(() => {
    palettes.clear();
    redrawAll();
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export function HolidayScene({
  kind,
  seed = 0,
  chain,
  className = '',
}: {
  kind: HolidayKind;
  seed?: number;
  chain?: { id: string; index: number };
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ink = useHolidayInk();
  const motion = useHolidayMotion();
  const chainId = chain?.id;
  const chainIndex = chain?.index ?? 0;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    watchTheme();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    animate = motion === 'on' && !reduced;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const entry: Entry = {
      visible: true,
      draw: (t) => {
        if (w <= 0 || h <= 0) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const fx = chainId ? chainFigureX(kind, chains.get(chainId) ?? [w], chainIndex, h, t) : undefined;
        drawScene(ctx, kind, palette(ink), { x: 0, y: 0, w, h }, t, { seed: seed + chainIndex, fx });
      },
    };
    const size = () => {
      const b = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = b.width;
      h = b.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      if (chainId) {
        const ws = chains.get(chainId) ?? [];
        ws[chainIndex] = w;
        chains.set(chainId, ws);
      }
      entry.draw(animate ? performance.now() / 1000 : STILL_T);
    };
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    const io = new IntersectionObserver((es) => {
      entry.visible = es[es.length - 1].isIntersecting;
    });
    io.observe(canvas);
    entries.add(entry);
    size();
    redrawAll();
    kick();
    return () => {
      ro.disconnect();
      io.disconnect();
      entries.delete(entry);
      if (chainId) {
        const ws = chains.get(chainId);
        if (ws) ws[chainIndex] = 0;
      }
    };
  }, [kind, seed, chainId, chainIndex, ink, motion]);

  return <canvas ref={ref} aria-hidden="true" className={`block h-full w-full ${className}`} />;
}

/** The holiday kinds' monochrome glyphs: what a cell too small for a scene shows. */
export function HolidayGlyph({ kind, className = 'h-4 w-4' }: { kind: HolidayKind; className?: string }) {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'hike':
      return (
        <svg {...common}>
          <path d="M1.5 13 6 5.5l3 4.5 2-2.5 3.5 5.5z" />
        </svg>
      );
    case 'dive':
      return (
        <svg {...common}>
          <path d="M1 11.5c1.3-1.4 2.7-1.4 4 0s2.7 1.4 4 0 2.7-1.4 4 0 1.5.8 2 .5" />
          <path d="M6 9.5 9.2 3.5 10.5 9.5" />
        </svg>
      );
    case 'ski':
      return (
        <svg {...common}>
          <path d="M8 2v12M2.8 5l10.4 6M2.8 11l10.4-6" />
        </svg>
      );
    case 'beach':
      return (
        <svg {...common}>
          <circle cx="8" cy="7" r="2.6" />
          <path d="M8 1.5v1.2M3 7H1.8M14.2 7H13M4.3 3.3l.8.8M11.7 3.3l-.8.8M1.5 13h13" />
        </svg>
      );
  }
}
