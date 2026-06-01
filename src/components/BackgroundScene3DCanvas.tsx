import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Group,
  type Mesh,
  MathUtils,
  PCFSoftShadowMap,
} from 'three';

// "Monolith on paper" — one tall ink-grey slab anchors the frame, a mid-grey
// plinth gives it scale, a hairline wire-ring is the editorial wink, and a
// static near-white paper veil layers in front. A ground plane catches the
// hero's cast shadow — that contact shadow is the entire reason the scene
// reads as 3D against #f2f2f2.
//
// Slow oscillations only (16-20s periods). Subtle pointer parallax on the
// scene root group so it feels alive without ever being busy. Pauses on tab
// blur, when off-screen (IntersectionObserver in the parent), or when the
// user prefers reduced motion.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function Monolith() {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // Period 16s rotation; 20s breath. Tiny amplitudes — the eye should only
    // catch the motion on a second glance.
    ref.current.rotation.y = -0.35 + Math.sin(t * (Math.PI / 8)) * 0.08;
    ref.current.position.y = 0.4 + Math.cos(t * (Math.PI / 10)) * 0.04;
  });
  return (
    <mesh ref={ref} position={[-1.6, 0.4, 0]} rotation={[0, -0.35, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.9, 3.2, 0.9]} />
      <meshStandardMaterial color="hsl(0, 0%, 22%)" roughness={0.65} metalness={0.08} />
    </mesh>
  );
}

function Plinth() {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // Period 13s — phase-offset from monolith so they never beat in unison.
    ref.current.rotation.y = 0.18 + Math.sin(t * (Math.PI / 6.5) + Math.PI / 2) * 0.12;
  });
  return (
    <mesh ref={ref} position={[1.8, -0.6, -0.4]} rotation={[0, 0.18, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.4, 0.9, 1.4]} />
      <meshStandardMaterial color="hsl(0, 0%, 58%)" roughness={0.78} metalness={0.04} />
    </mesh>
  );
}

function HairlineFrame() {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    // Period 18s pendulum on z. Wire-thin — reads as slow needle, not motion.
    group.current.rotation.z = Math.sin(t * (Math.PI / 9)) * 0.05;
  });
  // Built from 4 thin boxes so it shows on every renderer without a custom
  // wireframe pipeline. Position centered, scaled to ~2.2 across.
  const edge = 2.2;
  const thick = 0.012;
  return (
    <group ref={group} position={[-0.4, 0.9, -1.2]} rotation={[0.2, -0.4, 0]}>
      <mesh position={[0, edge / 2, 0]}>
        <boxGeometry args={[edge, thick, thick]} />
        <meshBasicMaterial color="hsl(0, 0%, 7%)" transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, -edge / 2, 0]}>
        <boxGeometry args={[edge, thick, thick]} />
        <meshBasicMaterial color="hsl(0, 0%, 7%)" transparent opacity={0.6} />
      </mesh>
      <mesh position={[edge / 2, 0, 0]}>
        <boxGeometry args={[thick, edge, thick]} />
        <meshBasicMaterial color="hsl(0, 0%, 7%)" transparent opacity={0.6} />
      </mesh>
      <mesh position={[-edge / 2, 0, 0]}>
        <boxGeometry args={[thick, edge, thick]} />
        <meshBasicMaterial color="hsl(0, 0%, 7%)" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

function PaperVeil() {
  // Completely static — it's a literal sheet of paper. Stillness is the point.
  // Half-occludes the monolith left side to create collage depth.
  return (
    <mesh position={[-2.2, 0.2, 0.6]} rotation={[0, 0.5, 0]} receiveShadow>
      <planeGeometry args={[3.6, 5]} />
      <meshStandardMaterial color="hsl(0, 0%, 97%)" roughness={1} metalness={0} transparent opacity={0.85} />
    </mesh>
  );
}

function Parallax({ children }: { children: React.ReactNode }) {
  const group = useRef<Group>(null);
  const target = useRef({ x: 0, y: 0 });
  const { size } = useThree();
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      // Normalize to -1..1 across the viewport. Backdrop is full-viewport.
      target.current.x = (e.clientX / size.width) * 2 - 1;
      target.current.y = (e.clientY / size.height) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => window.removeEventListener('pointermove', onPointer);
  }, [size.width, size.height]);
  useFrame((_, delta) => {
    if (!group.current) return;
    const desiredY = target.current.x * 0.06; // ≈3.4°
    const desiredX = target.current.y * -0.035; // ≈2°
    // Critically-damped 400ms settle.
    group.current.rotation.y = MathUtils.damp(group.current.rotation.y, desiredY, 6, delta);
    group.current.rotation.x = MathUtils.damp(group.current.rotation.x, desiredX, 6, delta);
  });
  return <group ref={group}>{children}</group>;
}

function GroundShadow() {
  // ShadowMaterial only renders the projected shadow — invisible everywhere
  // else. The single most important element for "this reads as 3D."
  return (
    <mesh position={[0, -1.4, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[18, 18]} />
      <shadowMaterial transparent opacity={0.18} />
    </mesh>
  );
}

export default function BackgroundScene3DCanvas() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => setReducedMotion(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mql.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const frozen = tabHidden;
  // 'demand' is wrong for our drift — we need continuous frames when visible.
  // Stop rendering entirely when off-screen / tab-hidden / reduced-motion.
  const frameloop = frozen || reducedMotion ? 'never' : 'always';
  // On reduced-motion, render exactly one frame to capture the static scene.
  const [didFreeze, setDidFreeze] = useState(false);
  useEffect(() => {
    if (reducedMotion) setDidFreeze(false);
  }, [reducedMotion]);

  return (
    <Canvas
      className="bg-canvas"
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.2, 5], fov: 38 }}
      frameloop={frameloop}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      onCreated={({ gl, invalidate }) => {
        gl.shadowMap.type = PCFSoftShadowMap;
        if (reducedMotion && !didFreeze) {
          invalidate();
          setDidFreeze(true);
        }
      }}
    >
      <color attach="background" args={['#f2f2f2']} />
      <fog attach="fog" args={['#f2f2f2', 6, 12]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={12}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      <directionalLight position={[-5, 2, -2]} intensity={0.25} />
      <Parallax>
        <Monolith />
        <Plinth />
        <HairlineFrame />
        <PaperVeil />
      </Parallax>
      <GroundShadow />
    </Canvas>
  );
}
