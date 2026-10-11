import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BODY_MAP_INK_STORAGE_KEY,
  BODY_MAP_STORAGE_KEY,
  getBodyMapInk,
  getBodyMapStyle,
} from '@/lib/bodyMapPrefs';

function stubStorage(value: string | null, throws = false) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => {
        if (throws) throw new Error('SecurityError');
        return k === BODY_MAP_STORAGE_KEY ? value : null;
      },
    },
  });
}

describe('getBodyMapStyle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to plates', () => {
    stubStorage(null);
    expect(getBodyMapStyle()).toBe('plates');
  });

  it('reads a valid stored style', () => {
    stubStorage('engraved');
    expect(getBodyMapStyle()).toBe('engraved');
    stubStorage('thermal');
    expect(getBodyMapStyle()).toBe('thermal');
  });

  it('falls back to plates on an unknown value', () => {
    stubStorage('neon');
    expect(getBodyMapStyle()).toBe('plates');
  });

  it('survives a throwing store', () => {
    stubStorage(null, true);
    expect(getBodyMapStyle()).toBe('plates');
  });
});

describe('getBodyMapInk', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (value: string | null, throws = false) =>
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => {
          if (throws) throw new Error('SecurityError');
          return k === BODY_MAP_INK_STORAGE_KEY ? value : null;
        },
      },
    });

  it('defaults to mono', () => {
    stub(null);
    expect(getBodyMapInk()).toBe('mono');
  });
  it('reads a valid stored ink', () => {
    stub('colour');
    expect(getBodyMapInk()).toBe('colour');
  });
  it('falls back to mono on an unknown value', () => {
    stub('neon');
    expect(getBodyMapInk()).toBe('mono');
  });
  it('survives a throwing store', () => {
    stub(null, true);
    expect(getBodyMapInk()).toBe('mono');
  });
  it('does not share a key with the style pref', () => {
    expect(BODY_MAP_INK_STORAGE_KEY).not.toBe(BODY_MAP_STORAGE_KEY);
  });
});
