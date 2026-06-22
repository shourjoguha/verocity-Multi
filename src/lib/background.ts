// Single source of truth for the toggleable backdrop. The picker writes to
// localStorage and dispatches BACKGROUND_EVENT so the live <html data-bg>
// attribute and the React island stay in sync without a reload.
//
// The "aurora" preset is the 3D depth scene — kept under the legacy key so
// existing localStorage preferences continue to resolve. UI labels reflect
// the actual scene ("Depth", "Monolith on paper").

export const BACKGROUND_STORAGE_KEY = 'verocity:bg';
export const BACKGROUND_EVENT = 'verocity:bg-change';

export const BACKGROUNDS = {
  off: { label: 'Off', description: 'No backdrop. Closest to the original editorial silence.' },
  grain: { label: 'Notebook', description: 'Horizontal ruled lines — notebook paper.' },
  dots: { label: 'Dotted', description: 'A dot grid — dotted notebook paper.' },
  hairlines: { label: 'Hairlines', description: 'A 48px grid, like a technical drawing.' },
  topography: { label: 'Topography', description: 'Concentric contour rings.' },
  aurora: { label: 'Depth', description: '3D monolith on paper. Loads on demand. Desktop default.' },
} as const;

export type BackgroundKey = keyof typeof BACKGROUNDS;
export const BACKGROUND_KEYS = Object.keys(BACKGROUNDS) as BackgroundKey[];

export function isBackgroundKey(value: string | null | undefined): value is BackgroundKey {
  return value != null && (BACKGROUND_KEYS as readonly string[]).includes(value);
}

// Device gate for the heavyweight 3D default. Touch / narrow / reduced-motion
// users fall back to the topography CSS preset — still a depth cue, no WebGL.
export function pickDeviceDefault(): BackgroundKey {
  if (typeof window === 'undefined') return 'off';
  const canBoot3D =
    window.matchMedia('(min-width: 768px) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return canBoot3D ? 'aurora' : 'topography';
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
