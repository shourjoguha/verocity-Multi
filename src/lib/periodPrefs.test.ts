import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD, TRAINING_PERIODS } from '@/app.config';
import { PERIOD_EVENT, PERIOD_STORAGE_KEY, getPeriod, setPeriod } from '@/lib/periodPrefs';

function stubStorage(value: string | null, throws = false) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => {
        if (throws) throw new Error('SecurityError');
        return k === PERIOD_STORAGE_KEY ? value : null;
      },
    },
  });
}

describe('getPeriod', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to 8w', () => {
    stubStorage(null);
    expect(DEFAULT_PERIOD).toBe('8w');
    expect(getPeriod()).toBe('8w');
  });

  it('reads every valid stored period', () => {
    for (const p of TRAINING_PERIODS) {
      stubStorage(p.key);
      expect(getPeriod()).toBe(p.key);
    }
  });

  it('falls back to the default on an unknown value (e.g. an old 60d)', () => {
    stubStorage('60d');
    expect(getPeriod()).toBe('8w');
  });

  it('survives a throwing store', () => {
    stubStorage(null, true);
    expect(getPeriod()).toBe('8w');
  });
});

describe('setPeriod', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('still dispatches the event when storage throws', () => {
    const dispatched: Event[] = [];
    vi.stubGlobal('window', {
      localStorage: {
        setItem: () => {
          throw new Error('SecurityError');
        },
      },
      dispatchEvent: (e: Event) => dispatched.push(e),
    });
    vi.stubGlobal(
      'CustomEvent',
      class {
        type: string;
        detail: unknown;
        constructor(type: string, init: { detail: unknown }) {
          this.type = type;
          this.detail = init.detail;
        }
      },
    );
    expect(() => setPeriod('12w')).not.toThrow();
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as CustomEvent).type).toBe(PERIOD_EVENT);
    expect((dispatched[0] as CustomEvent).detail).toBe('12w');
    vi.unstubAllGlobals();
  });
});

describe('TRAINING_PERIODS', () => {
  it('is 28/42/56/84/182 days, ascending, with unique keys', () => {
    expect(TRAINING_PERIODS.map((p) => p.days)).toEqual([28, 42, 56, 84, 182]);
    expect(new Set(TRAINING_PERIODS.map((p) => p.key)).size).toBe(5);
  });
});
