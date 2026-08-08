import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_STORAGE_KEY, getStoredBackground, isBackgroundKey } from '@/lib/background';

// Same shape as theme.test.ts: vitest runs in the node env, so stub the one
// surface the pure logic reads.
function stubWindow(getItem: (k: string) => string | null) {
  vi.stubGlobal('window', { localStorage: { getItem } });
}

afterEach(() => vi.unstubAllGlobals());

describe('getStoredBackground', () => {
  it('returns a valid stored key', () => {
    stubWindow((k) => (k === BACKGROUND_STORAGE_KEY ? 'dots' : null));
    expect(getStoredBackground()).toBe('dots');
  });

  it('returns null for nothing stored, and for a key that is no longer valid', () => {
    stubWindow(() => null);
    expect(getStoredBackground()).toBeNull();
    stubWindow(() => 'nonsense');
    expect(getStoredBackground()).toBeNull();
  });

  // The regression this function exists for. Reading localStorage THROWS where
  // site data is blocked, and three components hand-rolled the read without a
  // guard — two of them mounted by /app/you, which has no error boundary above
  // its island. The throw unmounted the island and the page went blank a beat
  // after painting. A null here is the difference between a degraded default
  // and an empty screen.
  it('swallows a read that throws, rather than propagating it to the caller', () => {
    stubWindow(() => {
      throw new Error('SecurityError: The operation is insecure.');
    });
    expect(() => getStoredBackground()).not.toThrow();
    expect(getStoredBackground()).toBeNull();
  });

  it('returns null with no window at all (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(getStoredBackground()).toBeNull();
  });
});

describe('isBackgroundKey', () => {
  it('accepts every shipped preset and rejects anything else', () => {
    expect(isBackgroundKey('aurora')).toBe(true);
    expect(isBackgroundKey('topography')).toBe(true);
    expect(isBackgroundKey('off')).toBe(true);
    expect(isBackgroundKey('gradient')).toBe(false);
    expect(isBackgroundKey(null)).toBe(false);
    expect(isBackgroundKey(undefined)).toBe(false);
  });
});
