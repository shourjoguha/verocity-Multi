import { useEffect, useState } from 'react';

// Keeps the backdrop off the login LCP path: hydrates idle, then
// dynamic-imports the canvas; until then the page is a static editorial frame.
// Under prefers-reduced-motion the scene still mounts, but draws one still
// frame and never animates.

export default function LoginHero() {
  const [Scene, setScene] = useState<React.ComponentType<{ still?: boolean }> | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let cancelled = false;
    import('./LoginHeroScene').then((mod) => {
      if (!cancelled) setScene(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Scene) return null;
  return <Scene still={reducedMotion} />;
}
