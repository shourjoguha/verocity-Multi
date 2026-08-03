import { describe, expect, it } from 'vitest';
import { resolveMovement } from '@/lib/queries';
import type { Movement } from '@/lib/types';

function mkMovement(name: string, overrides: Partial<Movement> = {}): Movement {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    category: null,
    tags: [],
    default_metrics: ['reps'],
    primary_metric: 'reps',
    default_rest_seconds: 60,
    notes: null,
    owner_user_id: null,
    kind: 'movement',
    url: null,
    ...overrides,
  };
}

const LIBRARY: Movement[] = [
  mkMovement('Pull-up'),
  mkMovement('Kettlebell Swing'),
  mkMovement('Thruster'),
  mkMovement('Front Squat'),
];

describe('resolveMovement', () => {
  it('matches a case-insensitive exact name first', () => {
    const match = resolveMovement('thruster', LIBRARY);
    expect(match).not.toBeNull();
    expect(match!.canonical_name).toBe('Thruster');
    expect(match!.match_confidence).toBe('exact');
  });

  it('resolves a plural variant to the library row via normalization', () => {
    const match = resolveMovement('Pull-ups', LIBRARY);
    expect(match).not.toBeNull();
    expect(match!.canonical_name).toBe('Pull-up');
    expect(match!.match_confidence).toBe('normalized');
    expect(match!.movement).toBe(LIBRARY[0]);
  });

  it('resolves an abbreviated name to the library row via normalization', () => {
    const match = resolveMovement('KB Swing', LIBRARY);
    expect(match).not.toBeNull();
    expect(match!.canonical_name).toBe('Kettlebell Swing');
    expect(match!.match_confidence).toBe('normalized');
  });

  it('does not collapse a genuinely different movement — returns null', () => {
    expect(resolveMovement('Zercher Squat', LIBRARY)).toBeNull();
    expect(resolveMovement('Banana Split', LIBRARY)).toBeNull();
  });

  it('returns null against an empty library', () => {
    expect(resolveMovement('Thruster', [])).toBeNull();
  });
});
