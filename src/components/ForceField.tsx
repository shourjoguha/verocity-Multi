import { useEffect, useState, type ComponentType } from 'react';

// The gate in front of the showcase hero's particle field, modelled on
// LoginHero.tsx and BackgroundScene3D.tsx: a ~1KB island that hydrates with the
// page and then decides whether to pay for p5 at all.
//
// The split is the whole point. p5 is ~250KB gzip — larger than the three.js
// chunk CLAUDE.md device-gates — so it is reached only through the dynamic
// import below, after this component has mounted. Vite gives it its own chunk
// (verify: `p5.min.*.js` in dist/_astro), which keeps it off the initial
// /showcase payload: the hero's typographic wordmark and the stat strip paint
// first, and the field arrives over the top.
//
// Under prefers-reduced-motion nothing is fetched and nothing is mounted, and
// the hero keeps its EchoText wordmark for good.
export default function ForceField({ onReady }: { onReady: () => void }) {
  const [Canvas, setCanvas] = useState<ComponentType<{ onReady?: () => void }> | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    import('./ForceFieldCanvas').then((mod) => {
      if (!cancelled) setCanvas(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Canvas) return null;
  // `onReady` fires on the canvas's FIRST PAINTED FRAME, not when the module
  // resolves — the hero hides its typographic wordmark on that signal, and
  // hiding it any earlier would leave the band empty for however long p5 spends
  // in setup building the brightness map.
  return <Canvas onReady={onReady} />;
}
