import { describe, expect, it } from 'vitest';
import { layoutCallouts, type CalloutInput } from './bodyCallouts';

const MIN_GAP = 11;

function row(key: string, top: number): CalloutInput {
  return { key, label: key.toUpperCase(), pct: 10, top };
}

function assertNoOverlap(placed: ReturnType<typeof layoutCallouts>) {
  for (const side of ['left', 'right'] as const) {
    const column = placed
      .filter((c) => c.side === side)
      .map((c) => c.top)
      .sort((a, b) => a - b);
    for (let i = 1; i < column.length; i++) {
      expect(column[i] - column[i - 1]).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    }
  }
}

describe('layoutCallouts', () => {
  // The strength screenshot: back and chest are both at 26% and were ranked 0
  // and 2, which put them on the same edge at the same height.
  it('separates two regions that share a nominal height', () => {
    const placed = layoutCallouts([row('back', 26), row('quads', 58), row('chest', 26), row('arms', 38)]);
    const back = placed.find((c) => c.key === 'back')!;
    const chest = placed.find((c) => c.key === 'chest')!;
    expect(back.side).not.toBe(chest.side);
    assertNoOverlap(placed);
  });

  // The mobility screenshot: glutes 54% and quads 58% shared the left edge.
  it('spreads same-edge neighbours that sit within a label height', () => {
    const placed = layoutCallouts([row('glutes', 54), row('core', 40), row('quads', 58), row('hamstrings', 62)]);
    assertNoOverlap(placed);
  });

  it('alternates edges going down the figure', () => {
    const placed = layoutCallouts([row('calves', 78), row('shoulders', 18), row('core', 40), row('quads', 58)]);
    const order = placed.slice().sort((a, b) => a.top - b.top);
    expect(order.map((c) => c.key)).toEqual(['shoulders', 'core', 'quads', 'calves']);
    expect(order.map((c) => c.side)).toEqual(['left', 'right', 'left', 'right']);
  });

  it('keeps every callout inside the stage', () => {
    const placed = layoutCallouts([row('a', 78), row('b', 78), row('c', 78), row('d', 78)]);
    for (const c of placed) {
      expect(c.top).toBeGreaterThanOrEqual(2);
      expect(c.top).toBeLessThanOrEqual(80);
    }
    assertNoOverlap(placed);
  });

  it('leaves a well-spread set where it was', () => {
    const rows = [row('shoulders', 18), row('core', 40), row('glutes', 54), row('calves', 78)];
    const placed = layoutCallouts(rows);
    for (const r of rows) {
      expect(placed.find((c) => c.key === r.key)!.top).toBe(r.top);
    }
  });

  it('preserves every input row', () => {
    const placed = layoutCallouts([row('a', 10), row('b', 20), row('c', 30)]);
    expect(placed.map((c) => c.key).sort()).toEqual(['a', 'b', 'c']);
  });
});
