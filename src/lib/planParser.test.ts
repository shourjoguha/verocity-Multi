import { describe, expect, it } from 'vitest';
import { parsePlanMarkdown } from '@/lib/planParser';

const SAMPLE = `# Hypertrophy Block
start: 2026-06-01
weeks: 4

## Block: Accumulation W1-2
## Block: Intensification W3-4

## Day: Monday — Lower
### Primary
- Back Squat [weight]: W1 3x5; W2 3x5; W3 4x5; W4 3x3
- Romanian Deadlift [weight]: 3x8
### Accessory
- Leg Press [weight]: 3x12

## Day: Thursday — Upper
### Main
- Bench Press [weight]: 4x5`;

describe('parsePlanMarkdown', () => {
  it('parses title and meta, derives end date', () => {
    const p = parsePlanMarkdown(SAMPLE);
    expect(p.title).toBe('Hypertrophy Block');
    expect(p.startDate).toBe('2026-06-01');
    expect(p.endDate).toBe('2026-06-28'); // start + 4 weeks - 1 day
  });

  it('parses and normalizes blocks', () => {
    const p = parsePlanMarkdown(SAMPLE);
    expect(p.blocks).toEqual([
      { type: 'accumulation', startWeek: 1, endWeek: 2 },
      { type: 'intensification', startWeek: 3, endWeek: 4 },
    ]);
  });

  it('parses days and builds weeklyTemplate from slugs', () => {
    const p = parsePlanMarkdown(SAMPLE);
    expect(p.days).toHaveLength(2);
    expect(p.weeklyTemplate).toEqual(['monday-lower', 'thursday-upper']);
  });

  it('expands explicit per-week and all-week specs across maxWeek', () => {
    const p = parsePlanMarkdown(SAMPLE);
    const squat = p.days[0].exercises[0];
    expect(squat.movement).toBe('Back Squat');
    expect(squat.plannedByWeek).toEqual({ 1: '3x5', 2: '3x5', 3: '4x5', 4: '3x3' });
    const rdl = p.days[0].exercises[1];
    expect(rdl.plannedByWeek).toEqual({ 1: '3x8', 2: '3x8', 3: '3x8', 4: '3x8' });
  });

  it('normalizes section aliases and metric', () => {
    const p = parsePlanMarkdown(SAMPLE);
    expect(p.days[0].exercises[2].section).toBe('accessory');
    expect(p.days[1].exercises[0].section).toBe('primary'); // "Main" -> primary
    expect(p.days[0].exercises[0].primaryMetric).toBe('weight');
  });

  it('falls back gracefully on empty input', () => {
    const p = parsePlanMarkdown('');
    expect(p.title).toBe('Untitled Plan');
    expect(p.days).toEqual([]);
    expect(p.blocks).toEqual([]);
  });
});
