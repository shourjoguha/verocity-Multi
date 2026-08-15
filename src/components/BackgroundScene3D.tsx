import { useEffect, useState } from 'react';
import { BACKGROUND_EVENT, getStoredBackground, type BackgroundKey } from '@/lib/background';

// Hydrates once via client:idle. Stays a ~1KB no-op unless the user is on the
// 3D preset, at which point it dynamic-imports three + r3f and mounts the
// Canvas. Pause is handled inside the canvas (tab visibility + reduced motion).
// An IntersectionObserver pause would be a no-op here — the .bg-backdrop is
// fixed-positioned full-viewport, so it's always "in view" by construction.

function readPreference(): BackgroundKey {
  if (typeof window === 'undefined') return 'off';
  // The `data-bg` attribute is authoritative: the FOUC-prevention script in
  // Base.astro is the single place that decides the backdrop, and it can decide
  // something the stored preference does NOT say — the showcase is pinned to
  // `dots` there regardless of what localStorage holds. Reading localStorage
  // first (as this once did) re-booted the 3D scene on the showcase for any
  // visitor whose stored preference was `aurora`, stacking WebGL over the pin.
  // On an ordinary page the attribute already mirrors the stored value, so this
  // only changes behaviour where the two intentionally differ.
  const attr = document.documentElement.getAttribute('data-bg') as BackgroundKey | null;
  // getStoredBackground swallows the SecurityError a blocked localStorage read
  // throws; it's the fallback for the (browser-only) case where the attribute
  // somehow isn't set yet.
  return attr ?? getStoredBackground() ?? 'off';
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
