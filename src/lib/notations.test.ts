import { describe, expect, it } from 'vitest';
import { hasNotation, isHeld, isVariant, trackName } from '@/lib/notations';

describe('notations', () => {
  it('reads both the parenthesised and the bare spelling', () => {
    expect(hasNotation(['(p)'], 'p')).toBe(true);
    expect(hasNotation(['p', '/side'], 'p')).toBe(true);
    expect(hasNotation(['/side'], 'p')).toBe(false);
    expect(hasNotation(undefined, 'v')).toBe(false);
  });

  it('treats paused and tempo alike, and a variation apart', () => {
    expect(isHeld(['(t)'])).toBe(true);
    expect(isHeld(['t'])).toBe(true);
    expect(isHeld(['(v)'])).toBe(false);
    expect(isVariant(['v'])).toBe(true);
  });

  it('keeps a variation under its own name', () => {
    expect(trackName('Back Squat', ['(v)'])).toBe('Back Squat (v)');
    expect(trackName('Back Squat', ['(p)'])).toBe('Back Squat');
  });
});
