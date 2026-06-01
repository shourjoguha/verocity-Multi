import { useEffect, useState } from 'react';
import { BACKGROUND_EVENT, BACKGROUND_STORAGE_KEY, type BackgroundKey } from '@/lib/background';

// Hydrates once via client:idle. Stays a ~1KB no-op unless the user is on the
// 3D preset, at which point it dynamic-imports three + r3f and mounts the
// Canvas. Pause is handled inside the canvas (tab visibility + reduced motion).
// An IntersectionObserver pause would be a no-op here — the .bg-backdrop is
// fixed-positioned full-viewport, so it's always "in view" by construction.

function readPreference(): BackgroundKey {
  if (typeof window === 'undefined') return 'off';
  const raw = window.localStorage.getItem(BACKGROUND_STORAGE_KEY) as BackgroundKey | null;
  // Read whatever the FOUC-prevention script in Base.astro decided; it's the
  // authoritative pre-paint default and we don't want to second-guess it here.
  const attr = document.documentElement.getAttribute('data-bg') as BackgroundKey | null;
  return raw ?? attr ?? 'off';
}

export default function BackgroundScene3D() {
  const [mode, setMode] = useState<BackgroundKey>('off');
  const [Scene, setScene] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    setMode(readPreference());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ value: BackgroundKey }>).detail;
      setMode(detail?.value ?? readPreference());
    };
    window.addEventListener(BACKGROUND_EVENT, onChange);
    return () => window.removeEventListener(BACKGROUND_EVENT, onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (mode !== 'aurora') {
      setScene(null);
      return;
    }
    import('./BackgroundScene3DCanvas').then((mod) => {
      if (!cancelled) setScene(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  if (mode !== 'aurora' || !Scene) return null;
  return <Scene />;
}
