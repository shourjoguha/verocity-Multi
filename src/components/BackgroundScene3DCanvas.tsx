import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Mesh } from 'three';

// Editorial paper sculpture. A handful of thin monochrome rectangles drift in
// soft directional light — references the typographic Echo Stack metaphor in
// 3D. Static frame when the user prefers reduced motion. Paused when the tab
// is hidden so we don't burn battery in the background.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

interface Slab {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  driftSeed: number;
  tone: number; // 0..1 — paper white → cream
}

const SLABS: Slab[] = [
  { position: [-1.6, 0.4, -0.5], rotation: [0.05, -0.15, 0.02], scale: [1.6, 2.2, 0.04], driftSeed: 0.1, tone: 0.98 },
  { position: [0.2, -0.3, 0.4], rotation: [-0.05, 0.1, -0.03], scale: [2.0, 1.4, 0.04], driftSeed: 0.5, tone: 0.94 },
  { position: [1.4, 0.8, -0.8], rotation: [0.02, -0.25, 0.05], scale: [1.2, 2.0, 0.04], driftSeed: 0.9, tone: 0.92 },
  { position: [-0.4, -0.9, -1.2], rotation: [0.04, 0.2, -0.02], scale: [1.8, 1.0, 0.04], driftSeed: 1.3, tone: 0.96 },
  { position: [0.7, 1.1, 0.9], rotation: [-0.02, 0.05, 0.04], scale: [1.0, 1.6, 0.04], driftSeed: 1.7, tone: 0.9 },
];

function DriftingSlab({ slab, reducedMotion }: { slab: Slab; reducedMotion: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (reducedMotion || !ref.current) return;
    const t = clock.getElapsedTime();
    const seed = slab.driftSeed;
    ref.current.position.x = slab.position[0] + Math.sin(t * 0.15 + seed) * 0.08;
    ref.current.position.y = slab.position[1] + Math.cos(t * 0.12 + seed * 1.7) * 0.06;
    ref.current.rotation.z = slab.rotation[2] + Math.sin(t * 0.08 + seed) * 0.03;
    ref.current.rotation.y = slab.rotation[1] + Math.cos(t * 0.06 + seed) * 0.04;
  });
  const tone = Math.round(slab.tone * 255);
  const color = `rgb(${tone}, ${tone}, ${tone})`;
  return (
    <mesh
      ref={ref}
      position={slab.position}
      rotation={slab.rotation}
      scale={slab.scale}
      castShadow={false}
      receiveShadow={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.85} metalness={0.04} />
    </mesh>
  );
}

function SlowOrbit({ children, reducedMotion }: { children: React.ReactNode; reducedMotion: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (reducedMotion || !group.current) return;
    group.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.04) * 0.18;
  });
  return <group ref={group}>{children}</group>;
}

export default function BackgroundScene3DCanvas() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => setReducedMotion(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    const onVis = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mql.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const frameloop = paused ? 'never' : reducedMotion ? 'demand' : 'always';
  const slabs = useMemo(() => SLABS, []);

  return (
    <Canvas
      className="bg-canvas"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 5], fov: 38 }}
      frameloop={frameloop}
      gl={{ antialias: true, alpha: true }}
    >
      <color attach="background" args={['#f2f2f2']} />
      <fog attach="fog" args={['#f2f2f2', 4, 9]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 5]} intensity={0.8} />
      <directionalLight position={[-4, -2, 2]} intensity={0.2} />
      <SlowOrbit reducedMotion={reducedMotion}>
        {slabs.map((s, i) => (
          <DriftingSlab key={i} slab={s} reducedMotion={reducedMotion} />
        ))}
      </SlowOrbit>
    </Canvas>
  );
}
