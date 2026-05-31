import { useEffect, useState } from 'react';

// Defers three.js off the login LCP path. Hydrates idle, then dynamic-imports
// the canvas; until then the page is a static editorial frame.

export default function LoginHero() {
  const [Scene, setScene] = useState<React.ComponentType | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mql.matches);
    if (mql.matches) return; // honor the user — leave the frame static
    let cancelled = false;
    import('./LoginHeroScene').then((mod) => {
      if (!cancelled) setScene(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (reducedMotion || !Scene) return null;
  return <Scene />;
}
