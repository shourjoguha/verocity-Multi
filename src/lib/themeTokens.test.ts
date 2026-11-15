import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reads the palette straight out of src/styles/global.css — no hand-copied
// values, so a token change is measured the moment it lands. Light is the
// `@theme` block; dark is every `html[data-theme='dark']` block in the file.

const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function blocks(selector: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at < 0) return out;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    out += css.slice(open + 1, close) + '\n';
    from = close;
  }
}

function colorTokens(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  return map;
}

const light = colorTokens(blocks('@theme {'));
const dark = colorTokens(blocks("html[data-theme='dark'] {"));
const THEMES = { light, dark } as const;

type Rgb = [number, number, number];
function parseHsl(value: string): Rgb {
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(value);
  if (!m) throw new Error(`not an opaque hsl(): ${value}`);
  const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
function ratio(theme: keyof typeof THEMES, a: string, b: string): number {
  const get = (name: string) => {
    const v = THEMES[theme].get(`--color-${name}`);
    if (!v) throw new Error(`--color-${name} missing in ${theme}`);
    return parseHsl(v);
  };
  const [x, y] = [lum(get(a)), lum(get(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('theme tokens (parsed from global.css)', () => {
  it('found both theme blocks', () => {
    expect(light.size).toBeGreaterThan(10);
    expect(dark.size).toBeGreaterThan(10);
  });

  it('defines every @theme --color-* in the dark block too', () => {
    const missing = [...light.keys()].filter((k) => !dark.has(k));
    expect(missing).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    describe(theme, () => {
      for (const text of ['muted', 'fg']) {
        for (const ground of ['bg', 'surface', 'tappable']) {
          it(`${text} on ${ground} >= 4.5:1`, () => {
            expect(ratio(theme, text, ground)).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
      it('accent-fg on accent >= 4.5:1', () => {
        expect(ratio(theme, 'accent-fg', 'accent')).toBeGreaterThanOrEqual(4.5);
      });
      it('tappable reads against surface (>= 1.15:1)', () => {
        expect(ratio(theme, 'tappable', 'surface')).toBeGreaterThanOrEqual(1.15);
      });
    });
  }
});
