import { useCallback, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  BODY_REGION_SHAPES,
  BODY_SILHOUETTE,
  BODY_VIEWBOX,
  type BodyFace,
  type RegionShape,
} from '@/lib/bodyRegions';
import { MUSCLE_REGIONS, MUSCLE_REGION_KEYS, type RegionKey } from '@/app.config';
import { EASE } from '@/components/anim';

// Presentational only — no data loading, no query imports. See the CSS block
// "Body map slab" in global.css for the 3D contract and the flattening trap.

// Extrusion ribs between the two faces. Closely spaced so the edge reads as a
// continuous solid rather than a stack of cards — the Echo Stack wants to look
// like separate layers, a body does not.
const RIB_Z = Array.from({ length: 15 }, (_, i) => 14 - i * 2);

// The figure rests at a slight angle rather than dead-on. A head-on view of a
// flat-faced slab reads as a sprite no matter how good the extrusion is; the
// tilt is what makes it read as an object at first glance. It is a static
// resting position, not an auto-spin — nothing animates unless the user drags.
const REST_TILT = 22;

function spinFor(face: BodyFace): number {
  return face === 'back' ? 180 + REST_TILT : -REST_TILT;
}

const FILL_FLOOR = 0.1; // an unused region still reads as part of a body
const FILL_RANGE = 0.65; // ceiling 0.75, so labels stay legible over it

function fillOpacity(intensity: number): number {
  return FILL_FLOOR + Math.max(0, Math.min(1, intensity)) * FILL_RANGE;
}

function ShapePath({
  shape,
  intensity,
  selected,
  reduce,
  index,
}: {
  shape: RegionShape;
  intensity: number;
  selected: boolean;
  reduce: boolean;
  index: number;
}) {
  const target = fillOpacity(intensity);
  const common = {
    d: shape.d,
    fill: 'var(--color-fg)',
    stroke: 'var(--color-fg)',
    // Selection is a stroke change, never a colour change — the palette is
    // monochrome by house rule and dark mode is token overrides only.
    strokeOpacity: selected ? 0.55 : 0.12,
    strokeWidth: selected ? 1.2 : 0.5,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  return (
    <>
      {/* animate, not whileInView — a whileInView chart can get stuck hidden
          if the observer never fires (same note as RadarChart). */}
      <motion.path
        {...common}
        initial={reduce ? false : { fillOpacity: 0 }}
        animate={reduce ? { fillOpacity: target } : { fillOpacity: target }}
        transition={reduce ? { duration: 0 } : { duration: 0.6, ease: EASE, delay: index * 0.04 }}
      />
      {shape.mirrorX ? (
        <motion.g transform="translate(100,0) scale(-1,1)">
          <motion.path
            {...common}
            initial={reduce ? false : { fillOpacity: 0 }}
            animate={{ fillOpacity: target }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.6, ease: EASE, delay: index * 0.04 }
            }
          />
        </motion.g>
      ) : null}
    </>
  );
}

function Face({
  face,
  intensity,
  selected,
  systemic,
  reduce,
}: {
  face: BodyFace;
  intensity: Record<RegionKey, number>;
  selected: RegionKey | null;
  systemic: number;
  reduce: boolean;
}) {
  const shapes = BODY_REGION_SHAPES[face];
  return (
    <svg className="bodymap-face" data-face={face} viewBox={BODY_VIEWBOX} aria-hidden="true">
      {/* base silhouette */}
      <path
        d={BODY_SILHOUETTE[face]}
        fill="var(--color-fg)"
        fillOpacity={0.06}
        stroke="var(--color-fg)"
        strokeOpacity={0.25}
        strokeWidth={0.6}
        vectorEffect="non-scaling-stroke"
      />
      {MUSCLE_REGION_KEYS.map((region, i) =>
        (shapes[region] ?? []).map((shape, j) => (
          <ShapePath
            key={`${region}-${j}`}
            shape={shape}
            intensity={intensity[region] ?? 0}
            selected={selected === region}
            reduce={reduce}
            index={i}
          />
        )),
      )}
      {/* Systemic work is the one genuinely whole-body quantity, so it reads
          as an aura around the whole figure rather than as a region. */}
      {systemic > 0 ? (
        <path
          d={BODY_SILHOUETTE[face]}
          fill="none"
          stroke="var(--color-fg)"
          strokeOpacity={0.15 + Math.min(1, systemic) * 0.45}
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

export function BodyMap({
  intensity,
  systemic,
  face,
  onFaceChange,
  selected,
}: {
  intensity: Record<RegionKey, number>;
  // 0..1 share of minutes that were systemic
  systemic: number;
  face: BodyFace;
  onFaceChange: (face: BodyFace) => void;
  selected: RegionKey | null;
}) {
  const reduce = useReducedMotion() ?? false;
  const slabRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startSpin: number; id: number } | null>(null);
  const spin = useRef(0);

  // Keep --spin in sync when the face is changed by the discrete control
  // (and on mount). Writing the property rather than re-rendering keeps the
  // drag path free of React state entirely.
  useEffect(() => {
    const el = slabRef.current;
    if (!el) return;
    const target = spinFor(face);
    spin.current = target;
    el.classList.add('bodymap-snapping');
    el.style.setProperty('--spin', `${target}deg`);
  }, [face]);

  const settle = useCallback(() => {
    const el = slabRef.current;
    if (!el) return;
    const normalized = ((spin.current % 360) + 360) % 360;
    const toBack = normalized > 90 && normalized < 270;
    const target = spinFor(toBack ? 'back' : 'front');
    spin.current = target;
    el.classList.add('bodymap-snapping');
    el.style.setProperty('--spin', `${target}deg`);
    onFaceChange(toBack ? 'back' : 'front');
  }, [onFaceChange]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const el = slabRef.current;
    if (!el) return;
    el.classList.remove('bodymap-snapping');
    drag.current = { startX: e.clientX, startSpin: spin.current, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = slabRef.current;
    if (!d || !el || d.id !== e.pointerId) return;
    const next = d.startSpin + (e.clientX - d.startX) * 0.6;
    spin.current = next;
    el.style.setProperty('--spin', `${next}deg`);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    settle();
  };

  const top = MUSCLE_REGION_KEYS.filter((k) => (intensity[k] ?? 0) > 0)
    .sort((a, b) => (intensity[b] ?? 0) - (intensity[a] ?? 0))
    .slice(0, 3)
    .map((k) => MUSCLE_REGIONS[k].label);

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="bodymap-stage mx-auto w-full max-w-[200px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="img"
        aria-label={
          top.length > 0
            ? `Body map, ${face} view. Most-worked regions: ${top.join(', ')}.`
            : `Body map, ${face} view. No work logged in this window.`
        }
      >
        <div ref={slabRef} className="bodymap-slab">
          {/* Sizer establishes the 100:220 aspect box; faces and ribs are
              absolutely positioned over it. */}
          <div className="bodymap-sizer" style={{ aspectRatio: '100 / 220' }} />
          <Face
            face="front"
            intensity={intensity}
            selected={selected}
            systemic={systemic}
            reduce={reduce}
          />
          {RIB_Z.map((z) => (
            <svg
              key={z}
              className="bodymap-rib"
              viewBox={BODY_VIEWBOX}
              aria-hidden="true"
              style={{ transform: `translateZ(${z}px)` }}
            >
              <path d={BODY_SILHOUETTE.front} fill="var(--color-fg)" fillOpacity={0.055} />
            </svg>
          ))}
          <Face
            face="back"
            intensity={intensity}
            selected={selected}
            systemic={systemic}
            reduce={reduce}
          />
        </div>
      </div>

      {/* The discrete control ships always: it is the keyboard path, the
          screen-reader path, and the only path under reduced motion. */}
      <div className="t-label flex gap-1">
        {(['front', 'back'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFaceChange(f)}
            aria-pressed={face === f}
            className={`hill-btn flex min-h-11 items-center border bg-surface px-4 transition-colors ${
              face === f ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
            }`}
          >
            {f === 'front' ? 'Front' : 'Back'}
          </button>
        ))}
      </div>
    </div>
  );
}
