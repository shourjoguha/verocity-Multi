import { afterEach, describe, expect, it, vi } from 'vitest';
import { COACH_SPRITE_DEFAULTS, COACH_SPRITE_STORAGE_KEY, getCoachSpritePrefs } from '@/lib/coachSpritePrefs';

function stubStorage(value: string | null, throws = false) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => {
        if (throws) throw new Error('SecurityError');
        return k === COACH_SPRITE_STORAGE_KEY ? value : null;
      },
    },
  });
}

describe('getCoachSpritePrefs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to the gorilla at 32px and half speed', () => {
    stubStorage(null);
    expect(getCoachSpritePrefs()).toEqual({ sprite: 'gorilla', size: 32, speed: 0.5 });
  });

  it('keeps valid fields and replaces invalid ones field by field', () => {
    stubStorage(JSON.stringify({ sprite: 'commando', size: 99, speed: 2 }));
    expect(getCoachSpritePrefs()).toEqual({ sprite: 'commando', size: 32, speed: 2 });
  });

  it('survives a throwing or corrupt store', () => {
    stubStorage(null, true);
    expect(getCoachSpritePrefs()).toEqual(COACH_SPRITE_DEFAULTS);
    stubStorage('{not json');
    expect(getCoachSpritePrefs()).toEqual(COACH_SPRITE_DEFAULTS);
  });
});
