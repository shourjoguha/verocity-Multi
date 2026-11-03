// The animated holiday scenes: pure canvas drawing, no React, no timers.
// HolidayScene.tsx owns the canvas, the clock and visibility; this file only
// answers "what does kind K look like at time t in this rectangle".
//
// Every colour comes from a ScenePalette read off CSS tokens (global.css
// --hs-* and --color-*), so dark mode and the Mono/Colour ink are token
// changes, never values in here.
import type { HolidayKind } from '@/lib/types';

export interface ScenePalette {
  ink: string;
  line: string;
  sky: string;
  far: string;
  near: string;
  tree: string;
  sun: string;
  water: string;
  waterDeep: string;
  sand: string;
  shark: string;
  weed: string;
  gear: string;
  snow: string;
  snowline: string;
  eye: string;
}

export type SceneInk = 'mono' | 'colour';

/** Read the palette for one ink from the document's resolved tokens. */
export function readScenePalette(ink: SceneInk, root: Element = document.documentElement): ScenePalette {
  const cs = getComputedStyle(root);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const fg = v('--color-fg');
  const muted = v('--color-muted');
  const subtle = v('--color-subtle');
  const surface = v('--color-surface');
  if (ink === 'colour') {
    return {
      ink: fg, line: muted, sky: v('--hs-sky'), far: v('--hs-far'), near: v('--hs-near'), tree: v('--hs-tree'),
      sun: v('--hs-sun'), water: v('--hs-water'), waterDeep: v('--hs-water-deep'), sand: v('--hs-sand'),
      shark: v('--hs-shark'), weed: v('--hs-weed'), gear: v('--hs-gear'), snow: v('--hs-snow'),
      snowline: v('--hs-snowline'), eye: surface,
    };
  }
  return {
    ink: fg, line: muted, sky: 'transparent', far: v('--hs-m-far'), near: v('--hs-m-near'), tree: subtle,
    sun: v('--hs-m-sun'), water: v('--hs-m-water'), waterDeep: v('--hs-m-water-deep'), sand: v('--hs-m-sand'),
    shark: subtle, weed: muted, gear: fg, snow: surface, snowline: muted, eye: surface,
  };
}

export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneOptions {
  /** Varies terrain and creature placement between segments. */
  seed?: number;
  /**
   * Where the figure is, in px from the rect's left edge. `undefined` lets the
   * scene move it on its own; `null` draws the scene without a figure (a
   * calendar ribbon segment the traveller is not in right now).
   */
  fx?: number | null;
}

/** Kinds whose figure travels along a multi-segment ribbon; beach just rests. */
export const TRAVELS: Record<HolidayKind, boolean> = { hike: true, dive: true, ski: true, beach: false };

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

function pen(c: Ctx, col: string, lw: number) {
  c.strokeStyle = col;
  c.lineWidth = lw;
  c.lineCap = 'round';
  c.lineJoin = 'round';
}
function line(c: Ctx, a: Pt, b: Pt) {
  c.beginPath();
  c.moveTo(a[0], a[1]);
  c.lineTo(b[0], b[1]);
  c.stroke();
}
function disc(c: Ctx, x: number, y: number, r: number, col: string) {
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}
function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  if (typeof c.roundRect === 'function') c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}
function ridge(c: Ctx, X: number, w: number, bottom: number, fn: (x: number) => number, fill: string | CanvasGradient) {
  c.beginPath();
  c.moveTo(X, bottom);
  for (let gx = X; gx <= X + w + 3; gx += 3) c.lineTo(gx, fn(gx));
  c.lineTo(X + w + 3, bottom);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}
function strokeRidge(c: Ctx, X: number, w: number, fn: (x: number) => number) {
  c.beginPath();
  for (let gx = X; gx <= X + w + 3; gx += 3) {
    if (gx === X) c.moveTo(gx, fn(gx));
    else c.lineTo(gx, fn(gx));
  }
  c.stroke();
}
function tree(c: Ctx, P: ScenePalette, x: number, y: number, s: number) {
  c.fillStyle = P.tree;
  c.beginPath();
  c.moveTo(x, y - s);
  c.lineTo(x - s * 0.36, y + 1);
  c.lineTo(x + s * 0.36, y + 1);
  c.closePath();
  c.fill();
}
function cloud(c: Ctx, x: number, y: number, s: number) {
  c.beginPath();
  c.arc(x - s * 0.7, y, s * 0.6, Math.PI, TAU);
  c.arc(x + 0.4 * s, y, s * 0.5, Math.PI, TAU);
  c.arc(x + 1.2 * s, y, s * 0.3, Math.PI, TAU);
  c.lineTo(x - s * 1.3, y);
  c.stroke();
}

/** Figure height for a scene of height h. Shared with the ribbon chain. */
export const figureSize = (kind: HolidayKind, h: number) =>
  kind === 'dive' ? clamp(h * 0.4, 10, 70) : clamp(h * 0.42, 9, 54);

function walkX(r: SceneRect, t: number, fh: number, mul = 1) {
  const spd = clamp(r.h * 0.4, 12, 34) * mul;
  const L = r.w + fh * 2;
  return r.x + ((t * spd) % L) - fh;
}
function figX(o: SceneOptions, r: SceneRect, dflt: () => number): number | null {
  if (o.fx === undefined) return dflt();
  return o.fx === null ? null : r.x + o.fx;
}

function walker(c: Ctx, P: ScenePalette, x: number, y: number, fh: number, ph: number, lean: number, lw: number) {
  c.save();
  c.translate(x, y);
  c.rotate(lean);
  pen(c, P.ink, lw);
  const a = Math.sin(ph) * 0.5;
  const L = fh * 0.46;
  const hip: Pt = [0, -L];
  const sh: Pt = [fh * 0.06, -fh * 0.8];
  for (const s of [1, -1]) {
    const aa = a * s;
    const foot: Pt = [Math.sin(aa) * L, hip[1] + Math.cos(aa) * L];
    const knee: Pt = [Math.sin(aa) * L * 0.5 + (aa < 0 ? fh * 0.05 : 0), hip[1] + Math.cos(aa) * L * 0.5];
    c.beginPath();
    c.moveTo(...hip);
    c.lineTo(...knee);
    c.lineTo(...foot);
    c.stroke();
  }
  line(c, hip, sh);
  c.fillStyle = P.ink;
  rrect(c, -fh * 0.19, -fh * 0.79, fh * 0.14, fh * 0.26, fh * 0.03);
  c.fill();
  disc(c, fh * 0.11, -fh * 0.93, fh * 0.1, P.ink);
  let front: Pt = sh;
  for (const s of [1, -1]) {
    const aa = -a * s * 0.9;
    const hand: Pt = [sh[0] + Math.sin(aa) * fh * 0.3, sh[1] + Math.cos(aa) * fh * 0.3];
    line(c, sh, hand);
    if (s === 1) front = hand;
  }
  c.lineWidth = Math.max(0.8, lw * 0.7);
  line(c, front, [front[0] + fh * 0.12, 0]);
  c.restore();
}

function skier(c: Ctx, P: ScenePalette, x: number, y: number, fh: number, ang: number, t: number, lw: number) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  pen(c, P.ink, lw * 1.2);
  c.beginPath();
  c.moveTo(-fh * 0.4, 0);
  c.lineTo(fh * 0.4, 0);
  c.quadraticCurveTo(fh * 0.5, 0, fh * 0.52, -fh * 0.07);
  c.stroke();
  c.rotate(-ang * 0.6);
  pen(c, P.ink, lw);
  const bob = Math.sin(t * 3) * fh * 0.03;
  const hip: Pt = [-fh * 0.06, -fh * 0.4 + bob];
  const sh: Pt = [fh * 0.14, -fh * 0.7 + bob];
  for (const dx of [-fh * 0.05, fh * 0.05]) {
    c.beginPath();
    c.moveTo(...hip);
    c.lineTo(fh * 0.14 + dx, -fh * 0.2);
    c.lineTo(dx, -fh * 0.02);
    c.stroke();
  }
  line(c, hip, sh);
  disc(c, fh * 0.23, -fh * 0.82, fh * 0.1, P.ink);
  const hand: Pt = [fh * 0.3, -fh * 0.5 + bob];
  line(c, sh, hand);
  c.lineWidth = Math.max(0.8, lw * 0.7);
  line(c, hand, [-fh * 0.3, -fh * 0.02]);
  c.restore();
}

function shark(c: Ctx, P: ScenePalette, x: number, y: number, s: number, dir: number, t: number) {
  c.save();
  c.translate(x, y);
  c.scale(dir, 1);
  const w = Math.sin(t * 5) * s * 0.07;
  c.fillStyle = P.shark;
  c.beginPath();
  c.moveTo(s * 0.62, s * 0.02);
  c.quadraticCurveTo(s * 0.4, -s * 0.2, -s * 0.42, -s * 0.05);
  c.lineTo(-s * 0.72, -s * 0.27 + w);
  c.lineTo(-s * 0.6, w * 0.5);
  c.lineTo(-s * 0.72, s * 0.2 + w);
  c.lineTo(-s * 0.42, s * 0.05);
  c.quadraticCurveTo(s * 0.3, s * 0.18, s * 0.62, s * 0.02);
  c.fill();
  c.beginPath();
  c.moveTo(s * 0.08, -s * 0.15);
  c.lineTo(-s * 0.1, -s * 0.42);
  c.lineTo(-s * 0.2, -s * 0.11);
  c.fill();
  c.beginPath();
  c.moveTo(s * 0.16, s * 0.1);
  c.lineTo(0, s * 0.3);
  c.lineTo(-s * 0.03, s * 0.1);
  c.fill();
  disc(c, s * 0.42, -s * 0.04, Math.max(0.6, s * 0.025), P.eye);
  c.restore();
}

function fish(c: Ctx, P: ScenePalette, x: number, y: number, s: number) {
  c.fillStyle = P.line;
  c.beginPath();
  c.ellipse(x, y, s, s * 0.5, 0, 0, TAU);
  c.fill();
  c.beginPath();
  c.moveTo(x + s * 0.8, y);
  c.lineTo(x + s * 1.6, y - s * 0.5);
  c.lineTo(x + s * 1.6, y + s * 0.5);
  c.closePath();
  c.fill();
}

/** Scuba diver face-down at depth: tank on the back, hose to the mouthpiece. */
function diver(c: Ctx, P: ScenePalette, x: number, y: number, s: number, dir: number, pitch: number, t: number, lw: number) {
  c.save();
  c.translate(x, y);
  c.scale(dir, 1);
  c.rotate(pitch);
  const sh: Pt = [s * 0.22, 0];
  const hip: Pt = [-s * 0.2, s * 0.02];
  c.fillStyle = P.gear;
  rrect(c, -s * 0.2, -s * 0.15, s * 0.4, s * 0.1, s * 0.05);
  c.fill();
  pen(c, P.ink, Math.max(0.8, lw * 0.7));
  rrect(c, -s * 0.2, -s * 0.15, s * 0.4, s * 0.1, s * 0.05);
  c.stroke();
  line(c, [s * 0.2, -s * 0.1], [s * 0.25, -s * 0.13]);
  c.beginPath();
  c.moveTo(s * 0.25, -s * 0.13);
  c.quadraticCurveTo(s * 0.42, -s * 0.2, s * 0.42, s * 0.02);
  c.stroke();
  pen(c, P.ink, lw);
  line(c, sh, hip);
  const k = Math.sin(t * 4) * s * 0.08;
  for (const kk of [k, -k]) {
    const knee: Pt = [-s * 0.38, s * 0.04 + kk * 0.4];
    const foot: Pt = [-s * 0.55, s * 0.03 + kk];
    c.beginPath();
    c.moveTo(...hip);
    c.lineTo(...knee);
    c.lineTo(...foot);
    c.stroke();
    c.save();
    c.lineWidth = lw * 2.4;
    c.lineCap = 'butt';
    line(c, foot, [foot[0] - s * 0.16, foot[1] + kk * 0.7]);
    c.restore();
  }
  const sw = Math.sin(t * 1.2) * s * 0.04;
  c.beginPath();
  c.moveTo(...sh);
  c.lineTo(s * 0.12, s * 0.1);
  c.lineTo(s * 0.02 + sw, s * 0.1);
  c.stroke();
  disc(c, s * 0.34, -s * 0.01, s * 0.09, P.ink);
  c.fillStyle = P.gear;
  rrect(c, s * 0.37, -s * 0.07, s * 0.08, s * 0.06, s * 0.015);
  c.fill();
  c.restore();
}

function palm(c: Ctx, P: ScenePalette, x: number, y: number, s: number, t: number) {
  const sway = Math.sin(t * 0.9) * s * 0.05;
  const top: Pt = [x + s * 0.16 + sway, y - s];
  pen(c, P.tree, Math.max(1.2, s * 0.05));
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(x + s * 0.02, y - s * 0.55, top[0], top[1]);
  c.stroke();
  c.lineWidth = Math.max(1, s * 0.035);
  for (const [dx, dy] of [[-0.4, 0.14], [-0.28, -0.06], [0.02, -0.16], [0.3, -0.05], [0.42, 0.16]]) {
    c.beginPath();
    c.moveTo(...top);
    c.quadraticCurveTo(top[0] + dx * s * 0.5, top[1] - s * 0.14, top[0] + dx * s + sway * 0.5, top[1] + dy * s);
    c.stroke();
  }
}

type SceneFn = (c: Ctx, P: ScenePalette, r: SceneRect, t: number, o: Required<Pick<SceneOptions, 'seed'>> & SceneOptions) => void;

const hike: SceneFn = (c, P, r, t, o) => {
  const { x: X, y: Y, w, h } = r;
  const lw = clamp(h / 60, 1, 2);
  const sd = o.seed * 137;
  const g = (gx: number) =>
    Y + h * 0.9 - h * 0.24 * (0.5 + 0.5 * Math.sin((gx + sd) / (h * 1.05))) - h * 0.06 * Math.sin((gx + sd) / (h * 0.33) + 1);
  c.fillStyle = P.sky;
  c.fillRect(X, Y, w, h);
  disc(c, X + w - h * 0.42, Y + h * 0.26, h * 0.11, P.sun);
  ridge(c, X, w, Y + h, (gx) => Y + h * 0.6 - h * 0.2 * (0.5 + 0.5 * Math.sin((gx + sd) / (h * 0.7) + 2)) - h * 0.05 * Math.sin((gx + sd) / (h * 0.21)), P.far);
  pen(c, P.line, lw * 0.8);
  const n = Math.max(1, Math.ceil(w / (h * 2.6)));
  const span = w + h * 1.2;
  for (let i = 0; i < n; i++) {
    cloud(c, X + ((i * span) / n + t * h * 0.06 + hash(i + o.seed) * h) % span - h * 0.6, Y + h * (0.14 + 0.12 * hash(i * 3 + o.seed)), h * 0.07);
  }
  ridge(c, X, w, Y + h, g, P.near);
  pen(c, P.line, lw);
  strokeRidge(c, X, w, g);
  const step = h * 0.5;
  for (let k = Math.floor(X / step); k * step < X + w + step; k++) {
    if (hash(k + o.seed * 7) > 0.6) {
      const tx = k * step + step * 0.5;
      tree(c, P, tx, g(tx), h * 0.17);
    }
  }
  const fh = figureSize('hike', h);
  const fx = figX(o, r, () => walkX(r, t, fh));
  if (fx !== null) {
    const sl = (g(fx + 2) - g(fx - 2)) / 4;
    walker(c, P, fx, g(fx), fh, fx / (fh * 0.16), -Math.atan(sl) * 0.55, lw * 1.15);
  }
};

const dive: SceneFn = (c, P, r, t, o) => {
  const { x: X, y: Y, w, h } = r;
  const lw = clamp(h / 60, 1, 2);
  const surf = Y + h * 0.1;
  const wave = (gx: number) => surf + Math.sin(gx / (h * 0.14) + t * 1.8) * h * 0.014 + Math.sin(gx / (h * 0.37) - t) * h * 0.01;
  const floor = (gx: number) => Y + h * 0.94 - h * 0.035 * Math.sin((gx + o.seed * 50) / (h * 0.28));
  const s = figureSize('dive', h);
  type Pose = { x: number; y: number; dir: number; vx: number; vy: number };
  // A pure function of time, so each bubble can start where the diver WAS.
  const path = (tt: number): Pose | null =>
    o.fx === undefined
      ? {
          x: X + w * 0.5 + Math.sin(tt * 0.3) * w * 0.3,
          y: Y + h * 0.5 + Math.sin(tt * 0.47) * h * 0.1,
          dir: Math.cos(tt * 0.3) >= 0 ? 1 : -1,
          vx: Math.cos(tt * 0.3) * 0.3 * w * 0.3,
          vy: Math.cos(tt * 0.47) * 0.47 * h * 0.1,
        }
      : o.fx === null
        ? null
        : { x: X + o.fx, y: Y + h * 0.52 + Math.sin(tt * 0.47) * h * 0.06, dir: 1, vx: 1, vy: 0 };

  c.fillStyle = P.sky;
  c.fillRect(X, Y, w, h);
  const gr = c.createLinearGradient(0, surf, 0, Y + h);
  gr.addColorStop(0, P.water);
  gr.addColorStop(1, P.waterDeep);
  ridge(c, X, w, Y + h, wave, gr);
  pen(c, P.line, lw);
  strokeRidge(c, X, w, wave);
  c.save();
  c.globalAlpha = 0.08;
  c.fillStyle = P.line;
  for (let k = 0; k < Math.max(2, Math.round(w / (h * 0.9))); k++) {
    const sx = X + (k + 0.3) * h * 0.9 + Math.sin(t * 0.3 + k) * h * 0.05;
    c.beginPath();
    c.moveTo(sx, surf);
    c.lineTo(sx + h * 0.08, surf);
    c.lineTo(sx + h * 0.3, Y + h);
    c.lineTo(sx + h * 0.12, Y + h);
    c.fill();
  }
  c.restore();
  ridge(c, X, w, Y + h, floor, P.sand);
  const step = h * 0.33;
  for (let k = Math.floor(X / step); k * step < X + w + step; k++) {
    if (hash(k * 1.7 + o.seed) > 0.5) {
      const bx = k * step + step * 0.5;
      const by = floor(bx);
      const hh = h * (0.12 + 0.2 * hash(k + 2));
      const sw = Math.sin(t * 1.3 + k) * h * 0.05;
      pen(c, P.weed, lw * 1.3);
      c.beginPath();
      c.moveTo(bx, by);
      c.quadraticCurveTo(bx - sw * 0.5, by - hh * 0.5, bx + sw, by - hh);
      c.stroke();
    }
  }
  const fspan = w + h;
  const fx0 = X + w - ((t * h * 0.3 + o.seed * 80) % fspan) + h * 0.5;
  for (let i = 0; i < 4; i++) fish(c, P, fx0 + i * h * 0.09, Y + h * 0.76 + Math.sin(i * 2.1) * h * 0.04, Math.max(1.2, h * 0.03));

  const n = Math.max(1, Math.round(w / (h * 2.2)));
  for (let i = 0; i < n; i++) {
    const dir = (i + o.seed) % 2 ? -1 : 1;
    const sp = h * (0.22 + 0.12 * hash(i + o.seed));
    const ss = h * (0.22 + 0.08 * hash(i + 5));
    const span = w + ss * 3;
    const base = (hash(i * 9 + o.seed) * span + t * sp) % span;
    const sx = dir > 0 ? X - ss * 1.5 + base : X + w + ss * 1.5 - base;
    shark(c, P, sx, Y + h * (0.3 + 0.45 * hash(i * 4 + 1 + o.seed)) + Math.sin(t * 0.9 + i) * h * 0.03, ss, dir, t + i);
  }
  const p = path(t);
  if (!p) return;
  for (let k = 0; k < 6; k++) {
    const age = (t * 0.55 + k / 6) % 1;
    const born = path(t - age / 0.55) ?? p;
    const mx = born.x + born.dir * s * 0.42;
    const my = born.y - s * 0.03;
    const by = my - age * (my - surf - h * 0.02);
    const bx = mx + Math.sin(age * 10 + k) * s * 0.05;
    if (by <= surf) continue;
    pen(c, P.line, Math.max(0.7, lw * 0.7));
    c.globalAlpha = 1 - age * 0.7;
    c.beginPath();
    c.arc(bx, by, Math.max(0.8, s * 0.025 * (1 + age * 1.6)), 0, TAU);
    c.stroke();
    c.globalAlpha = 1;
  }
  const pitch = clamp(Math.atan2(p.vy, Math.abs(p.vx) + 1e-3) * 0.5, -0.25, 0.25);
  diver(c, P, p.x, p.y, s, p.dir, pitch, t, lw * 1.1);
};

const ski: SceneFn = (c, P, r, t, o) => {
  const { x: X, y: Y, w, h } = r;
  const lw = clamp(h / 60, 1, 2);
  const sd = o.seed * 91;
  const g = (gx: number) => Y + h * 0.72 - h * 0.16 * Math.sin((gx + sd) / (h * 1.4)) - h * 0.04 * Math.sin((gx + sd) / (h * 0.4));
  c.fillStyle = P.sky;
  c.fillRect(X, Y, w, h);
  const pk = h * 0.8;
  const peaks = (gx: number) => {
    const k = Math.floor((gx + sd) / pk);
    const f = (gx + sd) / pk - k;
    const ht = h * (0.22 + 0.28 * hash(k));
    return Y + h * 0.62 - ht * (1 - Math.abs(f - 0.5) * 2);
  };
  ridge(c, X, w, Y + h, peaks, P.far);
  pen(c, P.line, lw * 0.8);
  strokeRidge(c, X, w, peaks);
  ridge(c, X, w, Y + h, g, P.snow);
  pen(c, P.snowline, lw);
  strokeRidge(c, X, w, g);
  const step = h * 0.55;
  for (let k = Math.floor(X / step); k * step < X + w + step; k++) {
    if (hash(k * 2.3 + o.seed) > 0.62) {
      const tx = k * step + step * 0.5;
      tree(c, P, tx, g(tx), h * 0.2);
    }
  }
  const n = clamp(Math.round((w * h) / 700), 6, 90);
  for (let i = 0; i < n; i++) {
    disc(c, X + hash(i) * w + Math.sin(t * 0.8 + i) * h * 0.04, Y + ((hash(i + 50) * h + t * h * 0.16) % h), Math.max(0.7, h * 0.008 * (0.5 + hash(i + 9))), P.line);
  }
  const fh = figureSize('ski', h);
  const fx = figX(o, r, () => walkX(r, t, fh, 1.7));
  if (fx === null) return;
  const ang = Math.atan((g(fx + 2) - g(fx - 2)) / 4);
  for (let k = 1; k < 5; k++) {
    const sx = fx - fh * (0.35 + k * 0.12);
    disc(c, sx, g(sx) - fh * 0.08 * hash(k + Math.floor(t * 6)), Math.max(0.6, fh * 0.025), P.snowline);
  }
  skier(c, P, fx, g(fx), fh, ang, t, lw * 1.1);
};

const beach: SceneFn = (c, P, r, t, o) => {
  const { x: X, y: Y, w, h } = r;
  const lw = clamp(h / 60, 1, 2);
  const hor = Y + h * 0.5;
  const shore = Y + h * 0.7;
  const shoreFn = (gx: number) => shore + Math.sin(gx / (h * 0.2) + t * 1.5) * h * 0.015;
  c.fillStyle = P.sky;
  c.fillRect(X, Y, w, h);
  const sx = X + Math.max(w * 0.55, w - h * 0.45);
  const sy = Y + h * 0.24;
  const sr = h * 0.1;
  disc(c, sx, sy, sr, P.sun);
  pen(c, P.sun, lw);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + t * 0.3;
    line(c, [sx + Math.cos(a) * sr * 1.4, sy + Math.sin(a) * sr * 1.4], [sx + Math.cos(a) * sr * 1.85, sy + Math.sin(a) * sr * 1.85]);
  }
  c.fillStyle = P.water;
  c.fillRect(X, hor, w, shore - hor + h * 0.05);
  pen(c, P.line, lw * 0.8);
  line(c, [X, hor], [X + w, hor]);
  const step = h * 0.38;
  for (let row = 0; row < 2; row++) {
    const yy = hor + (shore - hor) * (0.35 + row * 0.35);
    const off = (t * h * 0.08 * (row ? 1 : -0.6)) % step;
    for (let gx = X - step + off + row * step * 0.5; gx < X + w + step; gx += step) {
      c.beginPath();
      c.arc(gx, yy, h * 0.03, Math.PI * 1.1, Math.PI * 1.9);
      c.stroke();
    }
  }
  ridge(c, X, w, Y + h, shoreFn, P.sand);
  pen(c, P.line, lw);
  strokeRidge(c, X, w, shoreFn);
  const pstep = h * 2.4;
  for (let k = 0; X + h * 0.55 + k * pstep < X + w + h; k++) {
    if (k === 0 || hash(k + o.seed) > 0.4) palm(c, P, X + h * 0.55 + k * pstep, Y + h * 0.88, h * 0.58, t + k);
  }
  const fh = figureSize('beach', h);
  const lx = figX(o, r, () => X + Math.min(w * 0.3, h * 1.1));
  if (lx === null) return;
  const ly = Y + h * 0.86;
  c.fillStyle = P.gear;
  c.globalAlpha = 0.55;
  rrect(c, lx - fh * 0.08, ly - fh * 0.03, fh * 1.15, fh * 0.07, fh * 0.02);
  c.fill();
  c.globalAlpha = 1;
  pen(c, P.ink, lw * 1.1);
  const head: Pt = [lx + fh * 0.08, ly - fh * 0.13];
  const sh: Pt = [lx + fh * 0.22, ly - fh * 0.08];
  const hip: Pt = [lx + fh * 0.62, ly - fh * 0.07];
  disc(c, head[0], head[1], fh * 0.1, P.ink);
  line(c, sh, hip);
  c.beginPath();
  c.moveTo(...hip);
  c.lineTo(lx + fh * 0.82, ly - fh * 0.3);
  c.lineTo(lx + fh * 1.02, ly - fh * 0.06);
  c.stroke();
  line(c, hip, [lx + fh * 1.05, ly - fh * 0.07]);
  c.beginPath();
  c.moveTo(...sh);
  c.lineTo(lx + fh * 0.1, ly - fh * 0.32);
  c.lineTo(head[0] - fh * 0.04, head[1] - fh * 0.06);
  c.stroke();
  c.fillStyle = P.ink;
  for (let k = 0; k < 3; k++) {
    const p = (t * 0.35 + k / 3) % 1;
    c.globalAlpha = 1 - p;
    c.font = `600 ${Math.max(7, fh * 0.3 * (0.7 + p * 0.5))}px "Space Grotesk", sans-serif`;
    c.fillText('z', head[0] + fh * 0.1 + p * fh * 0.4, head[1] - fh * 0.2 - p * fh * 0.7);
  }
  c.globalAlpha = 1;
};

const SCENES: Record<HolidayKind, SceneFn> = { hike, dive, ski, beach };

/** Draw one frame of `kind` into `r`, clipped to it. */
export function drawScene(c: Ctx, kind: HolidayKind, P: ScenePalette, r: SceneRect, t: number, o: SceneOptions = {}): void {
  c.save();
  c.beginPath();
  c.rect(r.x, r.y, r.w, r.h);
  c.clip();
  SCENES[kind](c, P, r, t, { seed: 0, ...o });
  c.restore();
}

/**
 * Where the traveller is inside segment `i` of a ribbon split across rows
 * (the calendar wraps a holiday at the week boundary). One figure walks the
 * whole stretch in order; `null` means "not in this segment right now".
 */
export function chainFigureX(kind: HolidayKind, widths: readonly number[], i: number, h: number, t: number): number | null {
  if (!TRAVELS[kind]) return i === 0 ? Math.min(widths[0] * 0.3, h * 1.1) : null;
  const total = widths.reduce((a, b) => a + b, 0);
  const fh = kind === 'dive' ? figureSize(kind, h) * 0.6 : figureSize(kind, h);
  const spd = clamp(h * 0.9, 14, 40) * (kind === 'ski' ? 1.6 : 1);
  const pos = ((t * spd) % (total + fh * 2)) - fh;
  const loc = pos - widths.slice(0, i).reduce((a, b) => a + b, 0);
  return loc > -fh && loc < widths[i] + fh ? loc : null;
}
