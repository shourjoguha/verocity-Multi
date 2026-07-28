// Body-map geometry. DATA ONLY — no JSX, so a future renderer (e.g. three.js
// ExtrudeGeometry) can consume exactly these paths without touching the
// component layer.
//
// Coarse hand-authored polygons on a 100×220 grid, deliberately not a traced
// anatomical asset: the taxonomy is region-level, so region-level shapes are
// the honest granularity, and there is no third-party licence to worry about.
//
// LIMBS ARE AUTHORED ONCE. `mirrorX` makes the component emit a second copy
// under `translate(100,0) scale(-1,1)`, which halves the data and makes
// left/right symmetry structural rather than something to keep in sync.
//
// REGION IDS ARE THE TAXONOMY KEYS. bodyRegions.test.ts asserts the two sets
// match in BOTH directions — a region with no geometry is a hole in the
// silhouette, and geometry with no region is a dead path. Neither throws at
// runtime, which is why the check is mechanical.

import type { RegionKey } from '@/app.config';

export const BODY_VIEWBOX = '0 0 100 220';

export type BodyFace = 'front' | 'back';

export const BODY_FACES: readonly BodyFace[] = ['front', 'back'];

export interface RegionShape {
  d: string;
  // Emit a second, mirrored copy for the other side of the body.
  mirrorX?: boolean;
}

// One union outline per face. Used by the base layer AND by every extrusion
// rib, so the slab's edge always matches the figure exactly.
const OUTLINE =
  'M50 3.5a13.5 13.5 0 1 0 0.01 0z ' +
  'M44 29L43 37L28 41L21 50L18 74L15 110L13 133L21 134L24 110L27 76L32 56' +
  'L33 80L31 102L30 116L32 150L34 172L33 200L34 212L44 213L44 175L45 150L47 124' +
  'L50 126L53 124L55 150L56 175L56 213L66 212L67 200L66 172L68 150L70 116L69 102' +
  'L67 80L68 56L73 76L76 110L79 134L87 133L85 110L82 74L79 50L72 41L57 37L56 29Z';

export const BODY_SILHOUETTE: Record<BodyFace, string> = {
  front: OUTLINE,
  back: OUTLINE,
};

// Shapes track the silhouette edges rather than being axis-aligned boxes —
// a rectangle over a tapered limb reads as a mannequin, not a body.
const DELT: RegionShape = { d: 'M33 39L28 41L22 48L20 57L26 60L31 52L34 47Z', mirrorX: true };
const ARM: RegionShape = {
  d: 'M20 58L27 62L25 90L24 110L22 131L14 130L16 108L18 82Z',
  mirrorX: true,
};

export const BODY_REGION_SHAPES: Record<BodyFace, Partial<Record<RegionKey, RegionShape[]>>> = {
  front: {
    shoulders: [DELT],
    chest: [{ d: 'M34 48L50 47L50 71L37 69L33 62L32 54Z', mirrorX: true }],
    arms: [ARM],
    core: [{ d: 'M34 72L50 73L50 117L34 113L32 100L33 86Z', mirrorX: true }],
    quads: [{ d: 'M31 120L46 123L45 150L44 168L34 167L32 148Z', mirrorX: true }],
  },
  back: {
    shoulders: [DELT],
    back: [{ d: 'M34 38L50 38L50 95L34 91L31 72L32 55Z', mirrorX: true }],
    arms: [ARM],
    posteriorChain: [{ d: 'M30 110L47 113L46 140L45 167L34 166L32 140Z', mirrorX: true }],
    calves: [{ d: 'M35 171L45 171L44 190L43 205L36 204L34 188Z', mirrorX: true }],
  },
};

// Which face a region is drawn on. Derived, never hand-maintained — a region
// added to BODY_REGION_SHAPES shows up here automatically.
export function facesForRegion(region: RegionKey): BodyFace[] {
  return BODY_FACES.filter((f) => (BODY_REGION_SHAPES[f][region]?.length ?? 0) > 0);
}
