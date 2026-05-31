// Single source of truth for the toggleable backdrop. The picker writes to
// localStorage and dispatches BACKGROUND_EVENT so the live <html data-bg>
// attribute and the React island stay in sync without a reload.

export const BACKGROUND_STORAGE_KEY = 'verocity:bg';
export const BACKGROUND_EVENT = 'verocity:bg-change';

export const BACKGROUNDS = {
  off: { label: 'Off', description: 'No backdrop. Closest to the original editorial silence.' },
  grain: { label: 'Grain', description: 'Faint film grain — paper texture.' },
  hairlines: { label: 'Hairlines', description: 'A 48px grid, like a technical drawing.' },
  topography: { label: 'Topography', description: 'Concentric contour rings.' },
  aurora: { label: 'Aurora', description: 'A drifting 3D paper sculpture. Loads on demand.' },
} as const;

export type BackgroundKey = keyof typeof BACKGROUNDS;
export const BACKGROUND_KEYS = Object.keys(BACKGROUNDS) as BackgroundKey[];

export function isBackgroundKey(value: string | null | undefined): value is BackgroundKey {
  return value != null && (BACKGROUND_KEYS as readonly string[]).includes(value);
}

export function applyBackground(key: BackgroundKey): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-bg', key);
  try {
    window.localStorage.setItem(BACKGROUND_STORAGE_KEY, key);
  } catch {
    /* localStorage blocked — runtime change still applies via attribute. */
  }
  window.dispatchEvent(new CustomEvent(BACKGROUND_EVENT, { detail: { value: key } }));
}
