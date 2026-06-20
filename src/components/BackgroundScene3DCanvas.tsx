import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import {
  type Group,
  type Mesh,
  type PerspectiveCamera,
  MathUtils,
  PCFShadowMap,
} from 'three';

// "Monolith on paper" — on desktop, one tall ink-teal slab anchors the frame, a
// mid-teal plinth gives it scale, a hairline wire-ring is the editorial wink, and
// a static paper veil layers in front. A ground plane catches the hero's cast
// shadow — that contact shadow is the entire reason the scene reads as 3D.
//
// On a handheld / installed PWA the desktop framing falls off the narrow viewport
// (at this FOV a portrait phone only sees ≈±0.8 horizontally, but the slabs sit
// at ±1.6). So compact devices get a MINIMIZED MORPH variant: 3–4 smaller shapes
// pulled inside the visible cone, gently breathing/rotating, with the camera
// dollied back + widened (FitCamera) so they actually fit. Desktop keeps its two
// hero solids.
//
// Slow oscillations only (14–22s periods). Subtle pointer parallax on the scene
// root. Pauses on tab blur, off-screen (IntersectionObserver in the parent), or
// reduced-motion. Shapes + shadows are tuned SHARP: a crisp PCF shadow map, a
// tight light frustum, pushed-back fog, and a higher DPR ceiling.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
// Compact = narrow viewport OR an installed PWA on a touch device. Desktop PWAs
// (wide, fine pointer) keep the hero framing.
const COMPACT_QUERY = '(max-width: 768px), (display-mode: standalone) and (pointer: coarse)';

// "Depth" palette — shades of the --color-teal design token (#49F2E1), per an
// explicit owner override of the otherwise-monochrome backdrop rule. WebGL
// materials can't read CSS custom properties (and THREE's color parser wants the
// comma hsl() form), so the base is mirrored here — keep `wire` in sync with
// --color-teal in global.css. Shades run deep→bright; the cast shadow is tinted
// dark teal instead of black. Paper veil + #f2f2f2 canvas stay neutral.
const DEPTH = {
  slab: 'hsl(174, 84%, 24%)', // deep teal — the monolith
  slabAlt: 'hsl(174, 74%, 36%)', // deep-mid teal — compact accent slab
  plinth: 'hsl(174, 62%, 52%)', // mid teal — the plinth
  wire: 'hsl(174, 87%, 62%)', // = --color-teal (#49F2E1) — the hairline wire-ring
  shadow: '#0c463f', // dark teal — the ground cast shadow
} as const;

// ---- generic slow-morph solid: shared by the desktop heroes' siblings and the
// compact set. Tiny sine amplitudes on spin / bob / scale so the eye only catches
// the motion on a second glance; phase-offset so shapes never beat in unison. ----
interface ShapeConfig {
  position: [number, number, number];
  size: [number, number, number];
  rotY: number;
  color: string;
  roughness: number;
  metalness: number;
  spinPeriod: number;
  spinAmp: number;
  bobPeriod: number;
  bobAmp: number;
  scaleAmp?: number;
  phase: number;
}

function MorphShape(cfg: ShapeConfig) {
  const ref = useRef<Mesh>(null);
  const baseY = cfg.position[1];
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = cfg.rotY + Math.sin((t * Math.PI * 2) / cfg.spinPeriod + cfg.phase) * cfg.spinAmp;
    ref.current.position.y = baseY + Math.cos((t * Math.PI * 2) / cfg.bobPeriod + cfg.phase) * cfg.bobAmp;
    if (cfg.scaleAmp) {
      const s = 1 + Math.sin((t * Math.PI * 2) / (cfg.bobPeriod * 1.3) + cfg.phase) * cfg.scaleAmp;
      ref.current.scale.set(s, s, s);
    }
  });
  return (
    <mesh ref={ref} position={cfg.position} rotation={[0, cfg.rotY, 0]} castShadow receiveShadow>
      <boxGeometry args={cfg.size} />
      <meshStandardMaterial color={cfg.color} roughness={cfg.roughness} metalness={cfg.metalness} />
    </mesh>
  );
}

// ---- desktop hero solids (unchanged framing, crisper materials) ----

function Monolith() {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = -0.35 + Math.sin(t * (Math.PI / 8)) * 0.08;
    ref.current.position.y = 0.4 + Math.cos(t * (Math.PI / 10)) * 0.04;
  });
  return (
    <mesh ref={ref} position={[-1.6, 0.4, 0]} rotation={[0, -0.35, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.9, 3.2, 0.9]} />
      <meshStandardMaterial color={DEPTH.slab} roughness={0.5} metalness={0.12} />
    </mesh>
  );
}

function Plinth() {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = 0.18 + Math.sin(t * (Math.PI / 6.5) + Math.PI / 2) * 0.12;
  });
  return (
    <mesh ref={ref} position={[1.8, -0.6, -0.4]} rotation={[0, 0.18, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.4, 0.9, 1.4]} />
      <meshStandardMaterial color={DEPTH.plinth} roughness={0.6} metalness={0.06} />
    </mesh>
  );
}

// Wire-ring built from 4 thin boxes — `edge` scales it for desktop vs compact.
function HairlineFrame({
  edge = 2.2,
  position = [-0.4, 0.9, -1.2],
  rotation = [0.2, -0.4, 0],
}: {
  edge?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.z = Math.sin(clock.getElapsedTime() * (Math.PI / 9)) * 0.05;
  });
  const thick = 0.012;
  return (
    <group ref={group} position={position} rotation={rotation}>
      <mesh position={[0, edge / 2, 0]}>
        <boxGeometry args={[edge, thick, thick]} />
        <meshBasicMaterial color={DEPTH.wire} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, -edge / 2, 0]}>
        <boxGeometry args={[edge, thick, thick]} />
        <meshBasicMaterial color={DEPTH.wire} transparent opacity={0.6} />
      </mesh>
      <mesh position={[edge / 2, 0, 0]}>
        <boxGeometry args={[thick, edge, thick]} />
        <meshBasicMaterial color={DEPTH.wire} transparent opacity={0.6} />
      </mesh>
      <mesh position={[-edge / 2, 0, 0]}>
        <boxGeometry args={[thick, edge, thick]} />
        <meshBasicMaterial color={DEPTH.wire} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

function PaperVeil() {
  // Completely static — it's a literal sheet of paper. Half-occludes the
  // monolith's left side to create collage depth.
  return (
    <mesh position={[-2.2, 0.2, 0.6]} rotation={[0, 0.5, 0]} receiveShadow>
      <planeGeometry args={[3.6, 5]} />
      <meshStandardMaterial color="hsl(0, 0%, 97%)" roughness={1} metalness={0} transparent opacity={0.85} />
    </mesh>
  );
}

function DesktopScene() {
  return (
    <>
      <Monolith />
      <Plinth />
      <HairlineFrame />
      <PaperVeil />
    </>
  );
}

// ---- compact / PWA: 4 minimized morph shapes that fit a narrow viewport ----
const COMPACT_SHAPES: ShapeConfig[] = [
  // slim hero slab, centre-left
  { position: [-0.85, 0.35, 0], size: [0.5, 1.7, 0.5], rotY: -0.3, color: DEPTH.slab, roughness: 0.5, metalness: 0.12, spinPeriod: 17, spinAmp: 0.1, bobPeriod: 21, bobAmp: 0.05, scaleAmp: 0.015, phase: 0 },
  // cube plinth, centre-right
  { position: [0.9, -0.55, -0.3], size: [0.85, 0.85, 0.85], rotY: 0.2, color: DEPTH.plinth, roughness: 0.58, metalness: 0.06, spinPeriod: 14, spinAmp: 0.14, bobPeriod: 18, bobAmp: 0.04, scaleAmp: 0.02, phase: 1.1 },
  // small upper slab
  { position: [0.35, 0.95, -0.6], size: [0.42, 0.78, 0.42], rotY: 0.4, color: DEPTH.slabAlt, roughness: 0.5, metalness: 0.1, spinPeriod: 19, spinAmp: 0.12, bobPeriod: 16, bobAmp: 0.05, scaleAmp: 0.018, phase: 2.0 },
  // small lower cube
  { position: [-0.95, -0.85, 0.25], size: [0.55, 0.55, 0.55], rotY: -0.5, color: DEPTH.plinth, roughness: 0.6, metalness: 0.05, spinPeriod: 22, spinAmp: 0.1, bobPeriod: 20, bobAmp: 0.04, scaleAmp: 0.022, phase: 0.6 },
];

function CompactScene() {
  return (
    <>
      {COMPACT_SHAPES.map((cfg, i) => (
        <MorphShape key={i} {...cfg} />
      ))}
      <HairlineFrame edge={1.3} position={[0.1, 0.2, -1]} rotation={[0.2, -0.3, 0]} />
    </>
  );
}

function Parallax({ children }: { children: React.ReactNode }) {
  const group = useRef<Group>(null);
  const target = useRef({ x: 0, y: 0 });
  const { size } = useThree();
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
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
    group.current.rotation.y = MathUtils.damp(group.current.rotation.y, desiredY, 6, delta);
    group.current.rotation.x = MathUtils.damp(group.current.rotation.x, desiredX, 6, delta);
  });
  return <group ref={group}>{children}</group>;
}

// Dolly the camera so the active scene fills the viewport: desktop keeps the hero
// framing; compact pulls back (further still on portrait, where the horizontal
// cone is tightest) and widens so all 4 minimized shapes stay on-screen.
function FitCamera({ compact }: { compact: boolean }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    const aspect = size.width / size.height;
    if (compact) {
      cam.position.set(0, 0.1, aspect < 0.8 ? 8.5 : 6.5);
      cam.fov = 42;
    } else {
      cam.position.set(0, 0.2, 5);
      cam.fov = 38;
    }
    cam.updateProjectionMatrix();
  }, [compact, size.width, size.height, camera]);
  return null;
}

function GroundShadow() {
  // ShadowMaterial only renders the projected shadow — invisible everywhere else.
  // Stronger + darker than before so the contact shadow reads crisp.
  return (
    <mesh position={[0, -1.4, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[18, 18]} />
      <shadowMaterial transparent opacity={0.3} color={DEPTH.shadow} />
    </mesh>
  );
}

export default function BackgroundScene3DCanvas() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const motionMql = window.matchMedia(REDUCED_MOTION_QUERY);
    const compactMql = window.matchMedia(COMPACT_QUERY);
    const syncMotion = () => setReducedMotion(motionMql.matches);
    const syncCompact = () => setCompact(compactMql.matches);
    syncMotion();
    syncCompact();
    motionMql.addEventListener('change', syncMotion);
    compactMql.addEventListener('change', syncCompact);
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      motionMql.removeEventListener('change', syncMotion);
      compactMql.removeEventListener('change', syncCompact);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const frozen = tabHidden;
  const frameloop = frozen || reducedMotion ? 'never' : 'always';
  const [didFreeze, setDidFreeze] = useState(false);
  useEffect(() => {
    if (reducedMotion) setDidFreeze(false);
  }, [reducedMotion]);

  return (
    <Canvas
      className="bg-canvas"
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.2, 5], fov: 38 }}
      frameloop={frameloop}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      onCreated={({ gl, invalidate }) => {
        gl.shadowMap.type = PCFShadowMap;
        if (reducedMotion && !didFreeze) {
          invalidate();
          setDidFreeze(true);
        }
      }}
    >
      <color attach="background" args={['#f2f2f2']} />
      {/* Fog pushed back so the shapes stay crisp; it only fades the far ground. */}
      <fog attach="fog" args={['#f2f2f2', 9, 20]} />
      <ambientLight intensity={0.32} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.3}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={12}
        shadow-camera-left={-2.8}
        shadow-camera-right={2.8}
        shadow-camera-top={2.8}
        shadow-camera-bottom={-2.8}
      />
      <directionalLight position={[-5, 2, -2]} intensity={0.25} />
      <FitCamera compact={compact} />
      <Parallax>{compact ? <CompactScene /> : <DesktopScene />}</Parallax>
      <GroundShadow />
    </Canvas>
  );
}
