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

// The stored preference, or null if there isn't a valid one.
//
// READING localStorage THROWS. Not "returns null" — throws a SecurityError, on
// Safari with site data blocked, in some private-browsing configurations, and
// behind content blockers. `applyBackground` below has always guarded its
// WRITE; the read was hand-rolled unguarded in three places instead
// (BackgroundPicker, BackgroundScene3D, YouView), and two of those three are
// mounted by /app/you. A throw inside a React effect with no error boundary
// above it unmounts the whole island, so that page painted its server-rendered
// markup and then went blank a beat later — see docs/LESSONS.md.
// `getStoredPref` in lib/theme.ts is the same function for the theme key; this
// is deliberately its twin.
export function getStoredBackground(): BackgroundKey | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BACKGROUND_STORAGE_KEY);
    return isBackgroundKey(raw) ? raw : null;
  } catch {
    return null;
  }
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
