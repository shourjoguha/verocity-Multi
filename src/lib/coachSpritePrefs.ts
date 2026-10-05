// How Home's coach icon looks and moves: character, ink, motion, grid
// resolution, slot size and speed. Per-device, like the backdrop
// (lib/background.ts): localStorage plus an event so Settings and an open Home
// stay in sync without a reload.
import { useEffect, useState } from 'react';
import { SPRITE_GRIDS, SPRITE_KEYS, type SpriteGrid, type SpriteKey } from '@/lib/coachSprites';

export const COACH_SPRITE_STORAGE_KEY = 'verocity:coach-sprite';
export const COACH_SPRITE_EVENT = 'verocity:coach-sprite-change';

export const COACH_SPRITE_SIZES = [18, 24, 32] as const;
export const COACH_SPRITE_SPEEDS = [0.5, 1, 2] as const;
export const COACH_SPRITE_INKS = ['mono', 'colour'] as const;
// 'always' and 'off' are explicit choices and win over the OS Reduce Motion
// setting — the owner asked for motion on a phone that has it on. 'new' moves
// only while a coach finding is unseen (lib/coachSignal.ts).
export const COACH_SPRITE_MOTIONS = ['always', 'new', 'off'] as const;

export interface CoachSpritePrefs {
  sprite: SpriteKey;
  ink: (typeof COACH_SPRITE_INKS)[number];
  motion: (typeof COACH_SPRITE_MOTIONS)[number];
  grid: SpriteGrid;
  size: (typeof COACH_SPRITE_SIZES)[number];
  speed: (typeof COACH_SPRITE_SPEEDS)[number];
}

export const COACH_SPRITE_DEFAULTS: CoachSpritePrefs = {
  sprite: 'hedgehog',
  ink: 'colour',
  motion: 'always',
  grid: 48,
  size: 32,
  speed: 0.5,
};

const pick = <T>(allowed: readonly T[], v: unknown, fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

// Reading localStorage THROWS where site data is blocked — see getStoredBackground.
export function getCoachSpritePrefs(): CoachSpritePrefs {
  if (typeof window === 'undefined') return COACH_SPRITE_DEFAULTS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(COACH_SPRITE_STORAGE_KEY) ?? '{}');
    const d = COACH_SPRITE_DEFAULTS;
    return {
      sprite: pick(SPRITE_KEYS, raw.sprite, d.sprite),
      ink: pick(COACH_SPRITE_INKS, raw.ink, d.ink),
      motion: pick(COACH_SPRITE_MOTIONS, raw.motion, d.motion),
      grid: pick(SPRITE_GRIDS, raw.grid, d.grid),
      size: pick(COACH_SPRITE_SIZES, raw.size, d.size),
      speed: pick(COACH_SPRITE_SPEEDS, raw.speed, d.speed),
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

// Settings and Home both read through this, so a change in one shows in the other.
export function useCoachSpritePrefs(): CoachSpritePrefs {
  const [prefs, setPrefs] = useState<CoachSpritePrefs>(COACH_SPRITE_DEFAULTS);
  useEffect(() => {
    setPrefs(getCoachSpritePrefs());
    const on = () => setPrefs(getCoachSpritePrefs());
    window.addEventListener(COACH_SPRITE_EVENT, on);
    return () => window.removeEventListener(COACH_SPRITE_EVENT, on);
  }, []);
  return prefs;
}
