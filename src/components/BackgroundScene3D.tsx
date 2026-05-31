import { useEffect, useState } from 'react';
import { BACKGROUND_EVENT, BACKGROUND_STORAGE_KEY, type BackgroundKey } from '@/lib/background';

// Hydrates once via client:idle. Stays a ~1KB no-op unless the user picks
// the 3D preset, at which point it dynamic-imports three + r3f and mounts
// the Canvas. Switching back to a CSS preset unmounts the scene.

function readPreference(): BackgroundKey {
  if (typeof window === 'undefined') return 'off';
  const raw = window.localStorage.getItem(BACKGROUND_STORAGE_KEY);
  return (raw as BackgroundKey | null) ?? 'off';
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
