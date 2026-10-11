// How the Body map is drawn. Per-device, like the coach icon
// (lib/coachSpritePrefs.ts): localStorage plus an event so Settings and an open
// Body view stay in sync without a reload.
import { useEffect, useState } from 'react';

export const BODY_MAP_STORAGE_KEY = 'verocity:body-map-style';
export const BODY_MAP_EVENT = 'verocity:body-map-style-change';

export const BODY_MAP_STYLES = ['plates', 'engraved', 'thermal'] as const;
export type BodyMapStyle = (typeof BODY_MAP_STYLES)[number];
export const BODY_MAP_DEFAULT: BodyMapStyle = 'plates';

// Reading localStorage THROWS where site data is blocked — see getStoredBackground.
export function getBodyMapStyle(): BodyMapStyle {
  if (typeof window === 'undefined') return BODY_MAP_DEFAULT;
  try {
    const raw = window.localStorage.getItem(BODY_MAP_STORAGE_KEY);
    return (BODY_MAP_STYLES as readonly (string | null)[]).includes(raw) ? (raw as BodyMapStyle) : BODY_MAP_DEFAULT;
  } catch {
    return BODY_MAP_DEFAULT;
  }
}

export function setBodyMapStyle(next: BodyMapStyle): void {
  try {
    window.localStorage.setItem(BODY_MAP_STORAGE_KEY, next);
  } catch {
    /* blocked — the event below still updates this page. */
  }
  window.dispatchEvent(new CustomEvent(BODY_MAP_EVENT, { detail: next }));
}

export function useBodyMapStyle(): BodyMapStyle {
  const [style, setStyle] = useState<BodyMapStyle>(BODY_MAP_DEFAULT);
  useEffect(() => {
    setStyle(getBodyMapStyle());
    const on = () => setStyle(getBodyMapStyle());
    window.addEventListener(BODY_MAP_EVENT, on);
    return () => window.removeEventListener(BODY_MAP_EVENT, on);
  }, []);
  return style;
}
