import { afterEach, describe, expect, it } from 'vitest';
import { clearQueryCache, getCached, setCached } from '@/lib/queryCache';

afterEach(() => clearQueryCache());

describe('queryCache', () => {
  it('returns undefined for a missing key', () => {
    expect(getCached('nope')).toBeUndefined();
  });

  it('round-trips a stored value', () => {
    setCached('k', [1, 2, 3]);
    expect(getCached<number[]>('k')).toEqual([1, 2, 3]);
  });

  it('distinguishes a stored null from a miss', () => {
    setCached('k', null);
    expect(getCached('k')).toBeNull();
    expect(getCached('k')).not.toBeUndefined();
  });

  it('clear() empties the cache', () => {
    setCached('a', 1);
    setCached('b', 2);
    clearQueryCache();
    expect(getCached('a')).toBeUndefined();
    expect(getCached('b')).toBeUndefined();
  });
});
