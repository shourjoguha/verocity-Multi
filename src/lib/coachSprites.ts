// The Home coach icon's characters. Each pose is a handful of vector shapes in
// a 0..1 box, rasterised to an N×N pixel grid on demand, so the art is not
// tied to one resolution: SPRITE_GRID picks it, and nothing else changes.
//
// Pure — no DOM. CoachRunner renders the grid as SVG paths in currentColor, so
// both themes come free and the icon stays monochrome chrome (CLAUDE.md). The
// palette's colour tokens exist only for the design mockups; the app reads
// `tone` alone: 1 = ink, 2 = ink at reduced opacity.

export const SPRITE_GRID = 32;

type Pt = [number, number];
export type Op =
  | { k: 'e'; c: string; x: number; y: number; rx: number; ry: number }
  | { k: 'r'; c: string; x: number; y: number; w: number; h: number }
  | { k: 'p'; c: string; pts: Pt[] }
  | { k: 'l'; c: string; a: Pt; b: Pt; w: number }
  | { k: 'g'; dx: number; ops: Op[] };

const e = (x: number, y: number, rx: number, ry: number, c: string): Op => ({ k: 'e', c, x, y, rx, ry });
const r = (x: number, y: number, w: number, h: number, c: string): Op => ({ k: 'r', c, x, y, w, h });
const p = (c: string, ...xy: number[]): Op => ({
  k: 'p',
  c,
  pts: Array.from({ length: xy.length / 2 }, (_, i) => [xy[2 * i], xy[2 * i + 1]] as Pt),
});
const l = (a: Pt, b: Pt, w: number, c: string): Op => ({ k: 'l', c, a, b, w });
const g = (dx: number, ops: Op[]): Op => ({ k: 'g', dx, ops });

// char -> [colour token for mockups, tone]. 'O' is the generated outline.
export const PALETTE: Record<string, [string, 1 | 2]> = {
  O: ['--spr-line', 1],
  K: ['--spr-fur', 1],
  F: ['--spr-face', 2],
  N: ['--spr-ink', 1],
  S: ['--spr-spark', 2],
  B: ['--spr-blue', 1],
  P: ['--spr-peach', 2],
  W: ['--spr-white', 2],
  R: ['--spr-red', 1],
  T: ['--spr-tan', 2],
  H: ['--spr-hair', 1],
  D: ['--spr-band', 1],
  L: ['--spr-pants', 1],
  G: ['--spr-gun', 1],
  Y: ['--spr-flash', 2],
};

function hit(op: Op, u: number, v: number): string | null {
  switch (op.k) {
    case 'e':
      return ((u - op.x) / op.rx) ** 2 + ((v - op.y) / op.ry) ** 2 <= 1 ? op.c : null;
    case 'r':
      return u >= op.x && u < op.x + op.w && v >= op.y && v < op.y + op.h ? op.c : null;
    case 'p': {
      let inside = false;
      const pts = op.pts;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside ? op.c : null;
    }
    case 'l': {
      const [ax, ay] = op.a;
      const [bx, by] = op.b;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(u - ax - t * dx, v - ay - t * dy) <= op.w / 2 ? op.c : null;
    }
    case 'g': {
      let out: string | null = null;
      for (const o of op.ops) out = hit(o, u - op.dx, v) ?? out;
      return out;
    }
  }
}

// Later ops paint over earlier ones; then every empty cell touching a filled
// one (4-neighbour) becomes outline, which is what keeps the silhouette legible
// against the card at small sizes.
export function rasterize(ops: Op[], n: number): string[] {
  const grid: string[][] = [];
  for (let y = 0; y < n; y++) {
    const row: string[] = [];
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      let c = '.';
      for (const op of ops) c = hit(op, u, v) ?? c;
      row.push(c);
    }
    grid.push(row);
  }
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && grid[y][x] !== '.' && grid[y][x] !== 'O';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] === '.' && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) {
        grid[y][x] = 'O';
      }
    }
  }
  return grid.map((row) => row.join(''));
}

const mirror = (rows: string[]) => rows.map((row) => [...row].reverse().join(''));

// ---- Gorilla: sits, blinks, raises both fists and thumps the chest.
type GorillaArms = 'rest' | 'up' | 'hit';
function gorilla(arms: GorillaArms, blink = false): Op[] {
  const sh: Pt = [0.28, 0.47];
  const shR: Pt = [0.72, 0.47];
  const armW = 0.11;
  const left: Op[] =
    arms === 'rest'
      ? [l(sh, [0.17, 0.88], armW, 'K'), e(0.17, 0.9, 0.065, 0.05, 'K')]
      : arms === 'up'
        ? [l(sh, [0.1, 0.6], armW, 'K'), l([0.1, 0.6], [0.33, 0.5], armW, 'K'), e(0.33, 0.5, 0.06, 0.055, 'K')]
        : [
            l(sh, [0.16, 0.66], armW, 'K'),
            l([0.16, 0.66], [0.42, 0.6], armW, 'K'),
            e(0.42, 0.6, 0.065, 0.06, 'K'),
            l([0.37, 0.49], [0.33, 0.44], 0.025, 'S'),
            l([0.47, 0.48], [0.5, 0.43], 0.025, 'S'),
            l([0.3, 0.57], [0.25, 0.55], 0.025, 'S'),
          ];
  const right: Op[] =
    arms === 'up'
      ? [l(shR, [0.9, 0.6], armW, 'K'), l([0.9, 0.6], [0.67, 0.5], armW, 'K'), e(0.67, 0.5, 0.06, 0.055, 'K')]
      : [l(shR, [0.83, 0.88], armW, 'K'), e(0.83, 0.9, 0.065, 0.05, 'K')];
  const eyes = blink
    ? [r(0.4, 0.29, 0.07, 0.015, 'N'), r(0.53, 0.29, 0.07, 0.015, 'N')]
    : [r(0.415, 0.27, 0.045, 0.045, 'N'), r(0.54, 0.27, 0.045, 0.045, 'N')];
  return [
    e(0.29, 0.86, 0.15, 0.1, 'K'),
    e(0.71, 0.86, 0.15, 0.1, 'K'),
    e(0.22, 0.935, 0.09, 0.035, 'F'),
    e(0.78, 0.935, 0.09, 0.035, 'F'),
    e(0.5, 0.66, 0.27, 0.25, 'K'),
    e(0.43, 0.6, 0.085, 0.075, 'F'),
    e(0.57, 0.6, 0.085, 0.075, 'F'),
    e(0.5, 0.13, 0.09, 0.06, 'K'),
    e(0.5, 0.27, 0.16, 0.15, 'K'),
    e(0.5, 0.32, 0.115, 0.1, 'F'),
    r(0.36, 0.225, 0.28, 0.045, 'K'),
    ...eyes,
    r(0.465, 0.335, 0.025, 0.02, 'N'),
    r(0.51, 0.335, 0.025, 0.02, 'N'),
    r(0.44, 0.385, 0.12, 0.015, 'N'),
    ...left,
    ...right,
  ];
}

// ---- Hedgehog: stands, blinks, bolts off to the right and comes back round.
type Legs = 'stand' | 'runA' | 'runB';
function hedgehog(legs: Legs, blink = false): Op[] {
  const run = legs !== 'stand';
  const lean = run ? 0.05 : 0;
  const shoe = (x: number, y: number): Op[] => [e(x, y, 0.085, 0.04, 'R'), r(x - 0.085, y + 0.025, 0.17, 0.015, 'W')];
  const legOps: Op[] =
    legs === 'stand'
      ? [l([0.44, 0.7], [0.4, 0.88], 0.055, 'B'), l([0.52, 0.7], [0.56, 0.88], 0.055, 'B'), ...shoe(0.42, 0.91), ...shoe(0.6, 0.91)]
      : legs === 'runA'
        ? [l([0.44, 0.7], [0.22, 0.84], 0.055, 'B'), l([0.52, 0.7], [0.74, 0.86], 0.055, 'B'), ...shoe(0.2, 0.86), ...shoe(0.78, 0.89)]
        : [l([0.44, 0.7], [0.5, 0.8], 0.055, 'B'), l([0.52, 0.7], [0.48, 0.9], 0.055, 'B'), ...shoe(0.54, 0.81), ...shoe(0.52, 0.92)];
  const [front, back]: [Pt, Pt] =
    legs === 'stand' ? [[0.58, 0.66], [0.42, 0.68]] : legs === 'runA' ? [[0.72, 0.56], [0.28, 0.6]] : [[0.58, 0.68], [0.4, 0.5]];
  const eye = blink
    ? [e(0.58, 0.25, 0.065, 0.085, 'B'), r(0.52, 0.26, 0.11, 0.015, 'N')]
    : [e(0.58, 0.25, 0.065, 0.085, 'W'), e(0.615, 0.26, 0.022, 0.045, 'N')];
  const speed: Op[] = run ? [r(0, 0.42, 0.14, 0.02, 'S'), r(0.03, 0.58, 0.1, 0.02, 'S'), r(0, 0.74, 0.12, 0.02, 'S')] : [];
  return [
    ...speed,
    ...legOps,
    g(lean, [
      l([0.46, 0.52], back, 0.04, 'P'),
      e(back[0], back[1], 0.04, 0.04, 'W'),
      p('B', 0.5, 0.16, 0.12, 0.08, 0.32, 0.24, 0.04, 0.3, 0.3, 0.37, 0.08, 0.52, 0.36, 0.48, 0.46, 0.52),
      p('B', 0.46, 0.14, 0.53, 0.03, 0.58, 0.15),
      e(0.5, 0.31, 0.19, 0.18, 'B'),
      e(0.48, 0.6, 0.11, 0.13, 'B'),
      e(0.52, 0.61, 0.065, 0.09, 'P'),
      e(0.65, 0.38, 0.11, 0.075, 'P'),
      e(0.765, 0.345, 0.03, 0.025, 'N'),
      ...eye,
      l([0.5, 0.52], front, 0.04, 'P'),
      e(front[0], front[1], 0.04, 0.04, 'W'),
    ]),
  ];
}

// ---- Commando: looks right, looks left, fires twice, runs off and back.
function commando(legs: Legs, fire = false, wave = 0): Op[] {
  // V taper: shoulders twice the waist, capped delts, thick limbs. A straight
  // torso with thin limbs read as lanky at 32px.
  const boot = (x: number, y: number): Op => e(x, y, 0.075, 0.04, 'H');
  const legW = 0.105;
  const legOps: Op[] =
    legs === 'stand'
      ? [l([0.45, 0.58], [0.39, 0.88], legW, 'L'), l([0.55, 0.58], [0.61, 0.88], legW, 'L'), boot(0.41, 0.915), boot(0.63, 0.915)]
      : legs === 'runA'
        ? [l([0.46, 0.58], [0.26, 0.85], legW, 'L'), l([0.54, 0.58], [0.71, 0.84], legW, 'L'), boot(0.24, 0.9), boot(0.75, 0.885)]
        : [
            l([0.47, 0.58], [0.5, 0.89], legW, 'L'),
            l([0.53, 0.58], [0.59, 0.73], legW, 'L'),
            l([0.59, 0.73], [0.48, 0.79], legW, 'L'),
            boot(0.53, 0.92),
            boot(0.47, 0.82),
          ];
  return [
    p('D', 0.41, 0.14, 0.25, 0.11 + wave, 0.21, 0.19 + wave, 0.41, 0.18),
    ...legOps,
    // back arm: delt, bicep, forearm up to the stock
    l([0.33, 0.34], [0.38, 0.45], 0.085, 'T'),
    l([0.38, 0.45], [0.48, 0.42], 0.075, 'T'),
    p('T', 0.29, 0.28, 0.71, 0.28, 0.6, 0.55, 0.4, 0.55),
    e(0.32, 0.32, 0.075, 0.06, 'T'),
    e(0.68, 0.32, 0.075, 0.06, 'T'),
    r(0.41, 0.54, 0.18, 0.045, 'H'),
    r(0.44, 0.23, 0.12, 0.07, 'T'),
    e(0.5, 0.165, 0.09, 0.1, 'T'),
    e(0.49, 0.095, 0.1, 0.06, 'H'),
    r(0.4, 0.125, 0.2, 0.04, 'D'),
    r(0.54, 0.16, 0.03, 0.03, 'N'),
    r(0.38, 0.36, 0.1, 0.08, 'G'),
    r(0.46, 0.365, 0.34, 0.06, 'G'),
    r(0.8, 0.375, 0.15, 0.04, 'G'),
    r(0.6, 0.42, 0.05, 0.1, 'G'),
    // front arm drawn over the gun: delt to a fist on the grip
    l([0.68, 0.34], [0.7, 0.45], 0.085, 'T'),
    l([0.7, 0.45], [0.63, 0.47], 0.075, 'T'),
    ...(fire ? [p('Y', 0.95, 0.395, 1, 0.3, 0.97, 0.395, 1, 0.49)] : []),
  ];
}

// A frame is a pose key plus a horizontal offset (fraction of the box) and a
// duration at 1× speed. The offset wraps, so a sprite that runs off the right
// edge re-enters from the left.
export interface Beat {
  pose: string;
  ms: number;
  dx?: number;
}
export interface SpriteDef {
  label: string;
  poses: Record<string, { ops: Op[]; mirror?: boolean }>;
  beats: Beat[];
}

const run = (a: string, b: string, ms: number, dx16: number[]): Beat[] =>
  dx16.map((d, i) => ({ pose: i % 2 ? b : a, ms, dx: d / 16 }));

export const SPRITES = {
  gorilla: {
    label: 'Gorilla',
    poses: {
      sit: { ops: gorilla('rest') },
      blink: { ops: gorilla('rest', true) },
      up: { ops: gorilla('up') },
      hitL: { ops: gorilla('hit') },
      hitR: { ops: gorilla('hit'), mirror: true },
    },
    beats: [
      { pose: 'sit', ms: 900 },
      { pose: 'blink', ms: 120 },
      { pose: 'sit', ms: 600 },
      { pose: 'up', ms: 150 },
      { pose: 'hitL', ms: 130 },
      { pose: 'up', ms: 90 },
      { pose: 'hitR', ms: 130 },
      { pose: 'up', ms: 90 },
      { pose: 'hitL', ms: 130 },
      { pose: 'up', ms: 90 },
      { pose: 'hitR', ms: 130 },
      { pose: 'up', ms: 220 },
      { pose: 'sit', ms: 500 },
    ],
  },
  hedgehog: {
    label: 'Hedgehog',
    poses: {
      stand: { ops: hedgehog('stand') },
      blink: { ops: hedgehog('stand', true) },
      runA: { ops: hedgehog('runA') },
      runB: { ops: hedgehog('runB') },
    },
    beats: [
      { pose: 'stand', ms: 900 },
      { pose: 'blink', ms: 110 },
      { pose: 'stand', ms: 700 },
      ...run('runA', 'runB', 70, [0, 0, 1, 2, 3, 5, 7, 9, 11, 13, 14, 16]),
      { pose: 'stand', ms: 400 },
    ],
  },
  commando: {
    label: 'Commando',
    poses: {
      right: { ops: commando('stand') },
      left: { ops: commando('stand', false, 0.03), mirror: true },
      fire: { ops: commando('stand', true, 0.02) },
      runA: { ops: commando('runA', false, 0.04) },
      runB: { ops: commando('runB', false, -0.02) },
    },
    beats: [
      { pose: 'right', ms: 700 },
      { pose: 'left', ms: 550 },
      { pose: 'right', ms: 400 },
      { pose: 'fire', ms: 70 },
      { pose: 'right', ms: 80 },
      { pose: 'fire', ms: 70 },
      { pose: 'right', ms: 300 },
      ...run('runA', 'runB', 90, [0, 1, 3, 5, 7, 9, 11, 13, 15, 16]),
      { pose: 'right', ms: 400 },
    ],
  },
} satisfies Record<string, SpriteDef>;

export type SpriteKey = keyof typeof SPRITES;
export const SPRITE_KEYS = Object.keys(SPRITES) as SpriteKey[];

const cache = new Map<string, string[]>();

// The pose as rows of palette chars, shifted by `dx` with wrap-around.
export function spriteFrame(key: SpriteKey, beat: Beat, n: number = SPRITE_GRID): string[] {
  const id = `${key}:${beat.pose}:${beat.dx ?? 0}:${n}`;
  const hitCache = cache.get(id);
  if (hitCache) return hitCache;
  const pose = (SPRITES[key].poses as Record<string, { ops: Op[]; mirror?: boolean }>)[beat.pose];
  let rows = rasterize(pose.ops, n);
  if (pose.mirror) rows = mirror(rows);
  const shift = Math.round((beat.dx ?? 0) * n) % n;
  if (shift) rows = rows.map((row) => row.slice(n - shift) + row.slice(0, n - shift));
  cache.set(id, rows);
  return rows;
}

// SVG path data for one tone, horizontal runs merged — a rect per pixel at
// 32×32 would be ~1000 subpaths a frame.
export function tonePath(rows: string[], tone: 1 | 2): string {
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const on = (c: string) => c !== '.' && PALETTE[c]?.[1] === tone;
      if (!on(row[x])) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && on(row[x])) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return d;
}
