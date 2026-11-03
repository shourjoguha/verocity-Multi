// How holiday scenes are drawn. Per-device, like the body map and the coach
// icon (lib/bodyMapPrefs.ts): localStorage plus an event so Settings and an
// open calendar stay in sync without a reload.
//
// Ink: Mono is the default — monochrome chrome — and Colour is opt-in.
// Motion: Auto (default) follows the device's reduced-motion setting; On
// animates regardless, because the athlete asked for it here, explicitly; Still
// draws one frame. Auto used to be the only behaviour, which made "On" a lie on
// any phone with Reduce Motion turned on — the button did nothing visible.
// A stored 'on' predates Auto and was always a deliberate tap, so it keeps
// meaning "animate".
import { useEffect, useState } from 'react';

function makePref<T extends string>(storageKey: string, event: string, values: readonly T[], fallback: T) {
  const read = (): T => {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return (values as readonly (string | null)[]).includes(raw) ? (raw as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (next: T): void => {
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* blocked — the event below still updates this page. */
    }
    window.dispatchEvent(new CustomEvent(event, { detail: next }));
  };
  const use = (): T => {
    const [v, setV] = useState<T>(fallback);
    useEffect(() => {
      setV(read());
      // Prefer the event's detail: with storage blocked, re-reading would fall
      // back to the default and the pick would never apply.
      const on = (e: Event) => {
        const next = (e as CustomEvent<unknown>).detail;
        setV((values as readonly unknown[]).includes(next) ? (next as T) : read());
      };
      window.addEventListener(event, on);
      return () => window.removeEventListener(event, on);
    }, []);
    return v;
  };
  return { read, write, use };
}

export const HOLIDAY_INKS = ['mono', 'colour'] as const;
export type HolidayInk = (typeof HOLIDAY_INKS)[number];
const ink = makePref<HolidayInk>('verocity:holiday-ink', 'verocity:holiday-ink-change', HOLIDAY_INKS, 'mono');
export const getHolidayInk = ink.read;
export const setHolidayInk = ink.write;
export const useHolidayInk = ink.use;

export const HOLIDAY_MOTIONS = ['auto', 'on', 'still'] as const;
export type HolidayMotion = (typeof HOLIDAY_MOTIONS)[number];
const motion = makePref<HolidayMotion>('verocity:holiday-motion', 'verocity:holiday-motion-change', HOLIDAY_MOTIONS, 'auto');

/** Whether scenes animate, given the pref and the device's reduced-motion ask. */
export function holidayAnimates(pref: HolidayMotion, reducedMotion: boolean): boolean {
  return pref === 'on' || (pref === 'auto' && !reducedMotion);
}
export const getHolidayMotion = motion.read;
export const setHolidayMotion = motion.write;
export const useHolidayMotion = motion.use;
