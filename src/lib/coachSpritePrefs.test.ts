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

  it('defaults to a colour hedgehog on a 48 grid in a 32px slot, always moving at half speed', () => {
    stubStorage(null);
    expect(getCoachSpritePrefs()).toEqual({
      sprite: 'hedgehog',
      ink: 'colour',
      motion: 'always',
      grid: 48,
      size: 32,
      speed: 0.5,
    });
  });

  it('keeps valid fields and replaces invalid ones field by field', () => {
    stubStorage(JSON.stringify({ sprite: 'commando', ink: 'neon', motion: 'off', grid: 64, size: 99, speed: 2 }));
    expect(getCoachSpritePrefs()).toEqual({ ...COACH_SPRITE_DEFAULTS, sprite: 'commando', motion: 'off', speed: 2 });
  });

  it('reads a value stored before the newer fields existed', () => {
    stubStorage(JSON.stringify({ sprite: 'gorilla', size: 24, speed: 1 }));
    expect(getCoachSpritePrefs()).toEqual({ ...COACH_SPRITE_DEFAULTS, sprite: 'gorilla', size: 24, speed: 1 });
  });

  it('survives a throwing or corrupt store', () => {
    stubStorage(null, true);
    expect(getCoachSpritePrefs()).toEqual(COACH_SPRITE_DEFAULTS);
    stubStorage('{not json');
    expect(getCoachSpritePrefs()).toEqual(COACH_SPRITE_DEFAULTS);
  });
});
