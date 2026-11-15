import { useEffect, useRef } from 'react';
import { useResolvedTheme } from '@/lib/theme';

// Login-only backdrop: a chronophotograph. A stick-figure squat is drawn as a
// stroboscopic row of exposures across the band above the wordmark — each
// figure a later instant of the same rep, the way 1880s motion studies laid
// time out in space — and the row drifts left so the sequence keeps running.
// Older exposures fade toward the left edge.
//
// Canvas 2D, not three.js: the crystal this replaced shipped ~170KB gzip of
// WebGL to every phone that opened /login. This is a few hundred lines of
// arithmetic per frame. Ink comes from --color-fg / --color-muted, re-read on
// every theme change, so it is monochrome and token-derived in both themes.
// Pauses while the tab is hidden; `still` draws one frame and never animates
// (LoginHero passes it under prefers-reduced-motion).

const SPEED = 22; // px/s the row drifts left
const PHASE_STEP = 0.11; // fraction of a rep between neighbouring exposures
const DPR_CAP = 2;

type Ink = { fg: string; muted: string };

function readInk(): Ink {
  const s = getComputedStyle(document.documentElement);
  return {
    fg: s.getPropertyValue('--color-fg').trim(),
    muted: s.getPropertyValue('--color-muted').trim(),
  };
}

const MIN_BAND = 100; // px — below this there is no room above the copy

function draw(ctx: CanvasRenderingContext2D, w: number, ground: number, t: number, ink: Ink) {
  ctx.clearRect(0, 0, w, ctx.canvas.height);
  // The band fills the empty top of the page and stands on a line just above
  // the "Verocity" eyebrow, so it never runs under the copy. Too short (a
  // landscape phone) → draw nothing rather than squeeze the figures.
  if (ground < MIN_BAND) return;
  const unit = Math.min(ground * 0.2, 52); // thigh/shin length
  const L1 = unit;
  const L2 = unit * 0.96;
  const L3 = unit * 1.08;
  const sp = unit * 0.78; // spacing between exposures
  const head = unit * 0.13;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = ink.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, ground + 2);
  ctx.lineTo(w, ground + 2);
  ctx.stroke();

  const travel = t * SPEED;
  const off = travel % sp;
  const base = Math.floor(travel / sp);
  const count = Math.ceil(w / sp) + 2;
  ctx.strokeStyle = ink.fg;
  ctx.fillStyle = ink.fg;
  ctx.lineWidth = Math.max(1.2, unit * 0.035);

  for (let i = -1; i < count; i++) {
    const ax = i * sp - off + sp * 0.3;
    const phase = ((i + base) * PHASE_STEP) % 1;
    const d = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0 standing → 1 in the hole
    const shin = 0.55 * d;
    const thigh = 1.35 * d;
    const torso = 0.55 * d;
    const kx = ax + Math.sin(shin) * L2;
    const ky = ground - Math.cos(shin) * L2;
    const hx = kx - Math.sin(thigh) * L1;
    const hy = ky - Math.cos(thigh) * L1;
    const sx = hx + Math.sin(torso) * L3;
    const sy = hy - Math.cos(torso) * L3;

    const fade = Math.min(1, Math.max(0, ax / w));
    ctx.globalAlpha = 0.04 + 0.24 * fade;
    ctx.beginPath();
    ctx.moveTo(ax, ground);
    ctx.lineTo(kx, ky);
    ctx.lineTo(hx, hy);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx + head * 0.5, sy - head * 2, head, 0, Math.PI * 2);
    ctx.stroke();
    // The bar, end-on, across the shoulders.
    ctx.beginPath();
    ctx.arc(sx, sy + head * 0.6, head * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export default function LoginHeroScene({ still = false }: { still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const ink = readInk();
    let w = 0;
    let ground = 0;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      const anchor = document.querySelector('[data-login-anchor]');
      w = r.width;
      ground = anchor ? Math.round(anchor.getBoundingClientRect().top - r.top - 28) : 0;
      const h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      draw(ctx, w, ground, (now - t0) / 1000, ink);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onResize = () => {
      size();
      if (still) draw(ctx, w, ground, 0, ink);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    window.addEventListener('resize', onResize);
    if (still) {
      draw(ctx, w, ground, 0, ink);
    } else {
      document.addEventListener('visibilitychange', onVisibility);
      if (!document.hidden) start();
    }
    return () => {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [theme, still]);

  return <canvas ref={ref} aria-hidden="true" className="block h-full w-full" />;
}
