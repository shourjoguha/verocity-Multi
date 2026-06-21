import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import {
  type Group,
  type Mesh,
  type PerspectiveCamera,
  MathUtils,
  PCFShadowMap,
} from 'three';
import { useResolvedTheme } from '@/lib/theme';

// "Floating field on paper" — a quiet, distributed set of small teal solids
// (slabs + cubes) drifting over a paper ground, with a hairline wire-ring as the
// editorial wink and a static paper veil for collage depth. A ground plane
// catches their cast shadows — that contact shadow is the entire reason the
// scene reads as 3D. Both layouts are data-driven (ShapeConfig + MorphShape):
// desktop runs ~6 opaque forms across the frame; compact / installed-PWA runs ~5
// smaller translucent forms pulled inside the narrower cone (FitCamera dollies
// the camera back + widens so they stay framed).
//
// Slow oscillations only (14–22s periods, phase-spread so nothing beats in
// unison). Subtle pointer parallax on the scene root. Pauses on tab blur,
// off-screen (IntersectionObserver in the parent), or reduced-motion. Shapes +
// shadows are tuned SHARP: a crisp PCF shadow map, a tight light frustum,
// pushed-back fog, and a higher DPR ceiling.

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
  slab: 'hsl(174, 84%, 24%)', // deep teal — anchor slab
  slabAlt: 'hsl(174, 74%, 36%)', // deep-mid teal — accent slab
  plinth: 'hsl(174, 62%, 52%)', // mid teal — cubes
  wire: 'hsl(174, 87%, 62%)', // = --color-teal (#49F2E1) — the hairline wire-ring
  shadow: '#0c463f', // dark teal — the ground cast shadow
} as const;

// ---- generic slow-morph solid, shared by both layouts. Tiny sine amplitudes on
// spin / bob / scale so the eye only catches the motion on a second glance;
// phase-offset so shapes never beat in unison. ----
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
  opacity?: number;
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
      <meshStandardMaterial
        color={cfg.color}
        roughness={cfg.roughness}
        metalness={cfg.metalness}
        transparent={cfg.opacity !== undefined && cfg.opacity < 1}
        opacity={cfg.opacity ?? 1}
      />
    </mesh>
  );
}

// ---- desktop: a field of smaller, well-distributed solids (replaces the two
// big hero blocks) on the shared MorphShape system. Spread across the frame with
// real negative space; opaque so they keep crisp cast shadows. Sizes ~0.4–1.35;
// slow periods (14–22s) with spread phases so nothing beats in unison. ----
const DESKTOP_SHAPES: ShapeConfig[] = [
  // tall slim slab, left
  { position: [-1.7, 0.15, 0.2], size: [0.55, 1.35, 0.55], rotY: -0.32, color: DEPTH.slab, roughness: 0.5, metalness: 0.12, spinPeriod: 18, spinAmp: 0.08, bobPeriod: 21, bobAmp: 0.045, scaleAmp: 0.012, phase: 0 },
  // cube, lower-left
  { position: [-0.95, -1.05, -0.3], size: [0.68, 0.68, 0.68], rotY: 0.22, color: DEPTH.plinth, roughness: 0.58, metalness: 0.06, spinPeriod: 15, spinAmp: 0.12, bobPeriod: 18, bobAmp: 0.04, scaleAmp: 0.016, phase: 1.1 },
  // small slab, upper-left
  { position: [-0.45, 1.2, -0.6], size: [0.4, 0.58, 0.4], rotY: 0.4, color: DEPTH.slabAlt, roughness: 0.5, metalness: 0.1, spinPeriod: 20, spinAmp: 0.1, bobPeriod: 16, bobAmp: 0.05, scaleAmp: 0.018, phase: 2.2 },
  // cube, centre-low
  { position: [0.4, -0.6, 0.45], size: [0.6, 0.6, 0.6], rotY: -0.18, color: DEPTH.plinth, roughness: 0.6, metalness: 0.05, spinPeriod: 16, spinAmp: 0.11, bobPeriod: 19, bobAmp: 0.04, scaleAmp: 0.015, phase: 3.4 },
  // slab, right
  { position: [1.45, 0.45, -0.2], size: [0.5, 1.15, 0.5], rotY: 0.3, color: DEPTH.slab, roughness: 0.5, metalness: 0.12, spinPeriod: 19, spinAmp: 0.09, bobPeriod: 22, bobAmp: 0.045, scaleAmp: 0.013, phase: 4.5 },
  // small slab, upper-right
  { position: [1.05, 1.25, -0.9], size: [0.42, 0.6, 0.42], rotY: -0.45, color: DEPTH.slabAlt, roughness: 0.52, metalness: 0.1, spinPeriod: 22, spinAmp: 0.1, bobPeriod: 17, bobAmp: 0.05, scaleAmp: 0.02, phase: 5.6 },
];

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

function PaperVeil({ dark }: { dark: boolean }) {
  // Completely static — it's a literal sheet of paper layered to the left for
  // collage depth. Goes to a dark sheet on carbon so it doesn't punch a white
  // hole in the dark backdrop.
  return (
    <mesh position={[-2.2, 0.2, 0.6]} rotation={[0, 0.5, 0]} receiveShadow>
      <planeGeometry args={[3.6, 5]} />
      <meshStandardMaterial
        color={dark ? 'hsl(0, 0%, 11%)' : 'hsl(0, 0%, 97%)'}
        roughness={1}
        metalness={0}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

function DesktopScene({ dark }: { dark: boolean }) {
  return (
    <>
      {DESKTOP_SHAPES.map((cfg, i) => (
        <MorphShape key={i} {...cfg} />
      ))}
      <HairlineFrame />
      <PaperVeil dark={dark} />
    </>
  );
}

// ---- compact / PWA: 5 minimized morph shapes, spread across the frame and
// translucent so they read as a quiet backdrop behind the UI, not a foreground
// busy-pattern. Positions fan toward the corners (FitCamera dollies back to keep
// them on a narrow viewport); opacity ~0.55 lets the paper show through. ----
const COMPACT_OPACITY = 0.55;
const COMPACT_SHAPES: ShapeConfig[] = [
  // slim slab, far left
  { position: [-1.3, 0.5, 0.1], size: [0.44, 1.45, 0.44], rotY: -0.3, color: DEPTH.slab, roughness: 0.5, metalness: 0.12, spinPeriod: 17, spinAmp: 0.1, bobPeriod: 21, bobAmp: 0.05, scaleAmp: 0.015, opacity: COMPACT_OPACITY, phase: 0 },
  // cube, far right
  { position: [1.25, -0.6, -0.5], size: [0.72, 0.72, 0.72], rotY: 0.2, color: DEPTH.plinth, roughness: 0.58, metalness: 0.06, spinPeriod: 14, spinAmp: 0.14, bobPeriod: 18, bobAmp: 0.04, scaleAmp: 0.02, opacity: COMPACT_OPACITY, phase: 1.3 },
  // small slab, upper right
  { position: [0.6, 1.15, -0.8], size: [0.38, 0.7, 0.38], rotY: 0.4, color: DEPTH.slabAlt, roughness: 0.5, metalness: 0.1, spinPeriod: 19, spinAmp: 0.12, bobPeriod: 16, bobAmp: 0.05, scaleAmp: 0.018, opacity: COMPACT_OPACITY, phase: 2.6 },
  // small cube, lower left
  { position: [-1.05, -0.95, 0.45], size: [0.5, 0.5, 0.5], rotY: -0.5, color: DEPTH.plinth, roughness: 0.6, metalness: 0.05, spinPeriod: 22, spinAmp: 0.1, bobPeriod: 20, bobAmp: 0.04, scaleAmp: 0.022, opacity: COMPACT_OPACITY, phase: 3.9 },
  // small cube, centre-back (fills the middle so coverage is even)
  { position: [0.15, 0.1, -1.2], size: [0.46, 0.46, 0.46], rotY: 0.15, color: DEPTH.slabAlt, roughness: 0.55, metalness: 0.08, spinPeriod: 16, spinAmp: 0.11, bobPeriod: 19, bobAmp: 0.04, scaleAmp: 0.02, opacity: COMPACT_OPACITY, phase: 5.0 },
];

function CompactScene() {
  return (
    <>
      {COMPACT_SHAPES.map((cfg, i) => (
        <MorphShape key={i} {...cfg} />
      ))}
      <HairlineFrame edge={1.5} position={[0.1, 0.1, -1.1]} rotation={[0.2, -0.3, 0]} />
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

// Dolly the camera so the active scene fills the viewport: desktop frames the
// whole distributed field; compact pulls back further (further still on portrait,
// where the horizontal cone is tightest) and widens so every shape stays on-screen.
function FitCamera({ compact }: { compact: boolean }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    const aspect = size.width / size.height;
    if (compact) {
      cam.position.set(0, 0.1, aspect < 0.8 ? 9.5 : 7);
      cam.fov = 42;
    } else {
      // Pulled back vs the old hero framing so the wider distributed field stays
      // on-screen even on a narrower (near-square) desktop window.
      cam.position.set(0, 0.2, 5.8);
      cam.fov = 38;
    }
    cam.updateProjectionMatrix();
  }, [compact, size.width, size.height, camera]);
  return null;
}

function GroundShadow({ opacity }: { opacity: number }) {
  // ShadowMaterial only renders the projected shadow — invisible everywhere else.
  // Desktop runs it strong + dark (crisp contact); compact dials it back so the
  // translucent, spread shapes stay a quiet backdrop.
  return (
    <mesh position={[0, -1.4, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[18, 18]} />
      <shadowMaterial transparent opacity={opacity} color={DEPTH.shadow} />
    </mesh>
  );
}

export default function BackgroundScene3DCanvas() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [compact, setCompact] = useState(false);
  const dark = useResolvedTheme() === 'dark';
  const bgColor = dark ? '#0d0d0d' : '#f2f2f2';

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
      camera={{ position: [0, 0.2, 5.8], fov: 38 }}
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
      <color attach="background" args={[bgColor]} />
      {/* Fog pushed back so the shapes stay crisp; it only fades the far ground. */}
      <fog attach="fog" args={[bgColor, 9, 20]} />
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
      <Parallax>{compact ? <CompactScene /> : <DesktopScene dark={dark} />}</Parallax>
      <GroundShadow opacity={compact ? 0.16 : 0.3} />
    </Canvas>
  );
}
