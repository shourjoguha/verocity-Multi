// Which character stands on Home's Active plan card, how big, and how fast.
// Per-device, like the backdrop (lib/background.ts): localStorage plus an event
// so Settings and an open Home stay in sync without a reload.
import { SPRITE_KEYS, type SpriteKey } from '@/lib/coachSprites';

export const COACH_SPRITE_STORAGE_KEY = 'verocity:coach-sprite';
export const COACH_SPRITE_EVENT = 'verocity:coach-sprite-change';

export const COACH_SPRITE_SIZES = [18, 24, 32] as const;
export const COACH_SPRITE_SPEEDS = [0.5, 1, 2] as const;

export interface CoachSpritePrefs {
  sprite: SpriteKey;
  size: (typeof COACH_SPRITE_SIZES)[number];
  speed: (typeof COACH_SPRITE_SPEEDS)[number];
}

export const COACH_SPRITE_DEFAULTS: CoachSpritePrefs = { sprite: 'gorilla', size: 32, speed: 0.5 };

// Reading localStorage THROWS where site data is blocked — see getStoredBackground.
export function getCoachSpritePrefs(): CoachSpritePrefs {
  if (typeof window === 'undefined') return COACH_SPRITE_DEFAULTS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(COACH_SPRITE_STORAGE_KEY) ?? '{}');
    return {
      sprite: (SPRITE_KEYS as string[]).includes(raw.sprite) ? raw.sprite : COACH_SPRITE_DEFAULTS.sprite,
      size: (COACH_SPRITE_SIZES as readonly number[]).includes(raw.size) ? raw.size : COACH_SPRITE_DEFAULTS.size,
      speed: (COACH_SPRITE_SPEEDS as readonly number[]).includes(raw.speed) ? raw.speed : COACH_SPRITE_DEFAULTS.speed,
    };
  } catch {
    return COACH_SPRITE_DEFAULTS;
  }
}

export function setCoachSpritePrefs(next: CoachSpritePrefs): void {
  try {
    window.localStorage.setItem(COACH_SPRITE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* blocked — the event below still updates this page. */
  }
  window.dispatchEvent(new CustomEvent(COACH_SPRITE_EVENT, { detail: next }));
}
