import { describe, expect, it } from 'vitest';
import {
  formatStepped,
  parseStepped,
  setLoadKind,
  stepQual,
  stepReps,
  stepSets,
} from '@/lib/plannedStepper';

// Real strings: planParser.test.ts, planTemplate.ts's worked example and
// authoring prompt, logBuilder.test.ts, and the forms the brief names.
const ACCEPTED = [
  '3x5',
  '5x5',
  '3x8',
  '3x12',
  '4x5',
  '1x300',
  '6x500',
  '2x60',
  '5×3',
  '3 x 5',
  '4X10',
  '5x5 @75%',
  '4x8 @70%',
  '5x3 @70%',
  '5x5 @RPE7',
  '4x6 @RPE8',
  '3x8 @7',
  '4x8 @10kg',
  '4x8 @27.5kg RPE8',
  '3x10 @77.5%',
  '5x5@75%',
  '3x8 @ 7',
  '3x8 RPE8',
  '3x8 @RPE 7.5',
  '3x8 @rpe7',
  '3x8 @20 kg',
  '3x8 @75% RPE8',
];

const REJECTED = [
  '',
  '3x',
  '3x12/s',
  '6x5/side',
  '12/side',
  '6x20 m',
  '1x40s',
  'AMRAP',
  '2xAMRAP',
  '3x8-10',
  '8-10',
  '3x5 tempo 3-1-1',
  '3x5 @RPE 7-8',
  '3x5 @75',
  ' 3x5',
  '3x5 ',
  '03x5',
  '3x5 @27.50kg',
  '3x5 @75% @80%',
  '3x5 @RPE7 @8',
  '3x5 @',
  '3x5 @75%RPE8',
  'https://example.com/box-breathing',
  '0x5',
];

describe('parseStepped / formatStepped', () => {
  it.each(ACCEPTED)('round-trips %j exactly', (s) => {
    const p = parseStepped(s);
    expect(p).not.toBeNull();
    expect(formatStepped(p!)).toBe(s);
  });

  it.each(REJECTED)('falls back to text for %j', (s) => {
    expect(parseStepped(s)).toBeNull();
  });

  it('reads a bare "@N" as an effort only on the RPE scale', () => {
    expect(parseStepped('3x8 @7')!.quals[0].kind).toBe('rpe');
    // "@75" most likely meant 75%; guessing would rewrite it on the first step.
    expect(parseStepped('3x5 @75')).toBeNull();
    expect(parseStepped('3x5 @RPE12')).toBeNull();
  });

  it('reads the parts', () => {
    expect(parseStepped('4x8 @27.5kg RPE8')).toMatchObject({
      sets: 4,
      reps: 8,
      quals: [
        { kind: 'kg', value: 27.5 },
        { kind: 'rpe', value: 8 },
      ],
    });
  });
});

describe('stepping keeps the written form', () => {
  it('steps sets and reps', () => {
    expect(formatStepped(stepSets(parseStepped('5×3')!, 1))).toBe('6×3');
    expect(formatStepped(stepSets(parseStepped('1x5')!, -1))).toBe('1x5');
    expect(formatStepped(stepReps(parseStepped('3 x 8 @7')!, 1, 'reps'))).toBe('3 x 9 @7');
    expect(formatStepped(stepReps(parseStepped('6x500')!, -1, 'distance'))).toBe('6x490');
  });

  it('steps a load by its own unit', () => {
    expect(formatStepped(stepQual(parseStepped('5x5 @75%')!, 0, 1))).toBe('5x5 @77.5%');
    expect(formatStepped(stepQual(parseStepped('4x8 @27.5kg RPE8')!, 0, 1))).toBe('4x8 @30kg RPE8');
    expect(formatStepped(stepQual(parseStepped('4x8 @27.5kg RPE8')!, 1, -1))).toBe('4x8 @27.5kg RPE7.5');
    expect(formatStepped(stepQual(parseStepped('3x8 @RPE10')!, 0, 1))).toBe('3x8 @RPE10');
    expect(formatStepped(stepQual(parseStepped('3x8 @0kg')!, 0, -1))).toBe('3x8 @0kg');
  });

  it('adds, changes and removes a single load', () => {
    expect(formatStepped(setLoadKind(parseStepped('3x8')!, 'pct'))).toBe('3x8 @70%');
    expect(formatStepped(setLoadKind(parseStepped('3x8')!, 'rpe'))).toBe('3x8 @RPE7');
    expect(formatStepped(setLoadKind(parseStepped('3x8 @75%')!, 'kg'))).toBe('3x8 @20kg');
    expect(formatStepped(setLoadKind(parseStepped('3x8 @75%')!, null))).toBe('3x8');
    // Two qualifiers: left to the text field.
    expect(formatStepped(setLoadKind(parseStepped('4x8 @27.5kg RPE8')!, null))).toBe('4x8 @27.5kg RPE8');
  });
});
