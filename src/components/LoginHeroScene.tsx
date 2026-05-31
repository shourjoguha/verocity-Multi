import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Mesh,
  type Points,
} from 'three';

// Login-only hero. A faceted ink crystal at center spins explosively for the
// first ~2s then settles into a slow drift; a faint particle dust bursts
// outward at the same time and decays into near-stillness. A real shadow on a
// ghost plane below the crystal twists with rotation. Monochrome,
// token-derived. Honors prefers-reduced-motion (LoginHero won't even mount the
// canvas in that case) and pauses on tab blur.

const BURST_DURATION = 2.0; // seconds of spin / outward burst
const BURST_ROTATION = Math.PI * 4; // ~2 turns over BURST_DURATION (≈half the earlier angular speed)
const PARTICLE_COUNT = 240;
const PARTICLE_BURST_RADIUS = 7;
const SLOW_ROTATION_RATE = 0.06; // rad/s after burst

// 1 - (1 - t)^4 — sharp acceleration, eased landing.
function easeOutQuart(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u * u;
}

function Crystal() {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // Burst contributes ~2 turns over BURST_DURATION; the slow phase keeps
    // a quiet rotation forever.
    const burst = easeOutQuart(t / BURST_DURATION) * BURST_ROTATION;
    const slow = SLOW_ROTATION_RATE * Math.max(0, t - BURST_DURATION);
    ref.current.rotation.y = burst + slow;
    ref.current.rotation.x = burst * 0.35 + slow * 0.5;
    ref.current.rotation.z = burst * 0.1;
  });
  return (
    <mesh ref={ref} scale={1.6} castShadow>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial
        color="#f7f7f5"
        roughness={0.32}
        metalness={0.1}
        flatShading
      />
    </mesh>
  );
}

function Dust() {
  const ref = useRef<Points>(null);

  const { geometry, directions, basePositions } = useMemo(() => {
    const dirs = new Float32Array(PARTICLE_COUNT * 3);
    const base = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Even spherical distribution via the Marsaglia trick.
      let x: number, y: number, z: number, s: number;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        s = x * x + y * y + z * z;
      } while (s > 1 || s === 0);
      const inv = 1 / Math.sqrt(s);
      dirs[i * 3 + 0] = x * inv;
      dirs[i * 3 + 1] = y * inv;
      dirs[i * 3 + 2] = z * inv;
      // Start very close to the crystal so the burst reads as an explosion.
      const r = 0.6 + Math.random() * 0.4;
      base[i * 3 + 0] = dirs[i * 3 + 0] * r;
      base[i * 3 + 1] = dirs[i * 3 + 1] * r;
      base[i * 3 + 2] = dirs[i * 3 + 2] * r;
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(base.slice(), 3));
    return { geometry: geom, directions: dirs, basePositions: base };
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const burst = easeOutQuart(t / BURST_DURATION);
    const drift = Math.max(0, t - BURST_DURATION) * 0.04;
    const attr = ref.current.geometry.getAttribute('position') as BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const dx = directions[i * 3 + 0];
      const dy = directions[i * 3 + 1];
      const dz = directions[i * 3 + 2];
      // Each particle picks up an individual phase from its base position so
      // the bob doesn't pulse in unison.
      const phase = basePositions[i * 3 + 0] * 4 + basePositions[i * 3 + 1] * 2;
      const wobble = Math.sin(t * 0.4 + phase) * 0.08;
      const radius =
        basePositions[i * 3 + 0] * dx +
        basePositions[i * 3 + 1] * dy +
        basePositions[i * 3 + 2] * dz +
        burst * PARTICLE_BURST_RADIUS +
        drift +
        wobble;
      arr[i * 3 + 0] = dx * radius;
      arr[i * 3 + 1] = dy * radius;
      arr[i * 3 + 2] = dz * radius;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        color={new Color('#1a1a1a')}
        size={0.025}
        sizeAttenuation
        transparent
        opacity={0.55}
      />
    </points>
  );
}

export default function LoginHeroScene() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return (
    <Canvas
      className="bg-canvas"
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.4, 5.5], fov: 38 }}
      frameloop={paused ? 'never' : 'always'}
      gl={{ antialias: true, alpha: true }}
    >
      <color attach="background" args={['#f2f2f2']} />
      <fog attach="fog" args={['#f2f2f2', 5, 11]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[4, 5, 6]}
        intensity={0.9}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={20}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />
      <directionalLight position={[-5, -2, 3]} intensity={0.25} />
      <Crystal />
      <Dust />
      {/* Ghost plane that only renders the crystal's shadow — twists with rotation. */}
      <mesh position={[0, -1.9, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <shadowMaterial transparent opacity={0.22} />
      </mesh>
    </Canvas>
  );
}
