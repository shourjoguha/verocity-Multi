import { useCallback, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ABS_DIVIDERS,
  BODY_MUSCLE_SHAPES,
  BODY_MUSCLE_SILHOUETTE,
  BODY_VIEWBOX,
  type BodyFace,
  type RegionShape,
} from '@/lib/bodyRegions';
import {
  MUSCLES,
  MUSCLE_KEYS,
  MUSCLE_REGION_KEYS,
  type MuscleKey,
  type RegionKey,
} from '@/app.config';
import { EASE } from '@/components/anim';

// Presentational only — no data loading, no query imports. See the CSS block
// "Body map slab" in global.css for the 3D contract and the flattening trap.
// Everything below draws INSIDE a face's <svg>: SVG attributes (fill-opacity,
// stroke-dasharray, the mirror transform) are safe there. Nothing may add
// opacity/filter/clip/mask/overflow to an HTML element between the stage and
// the faces.

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

const FILL_FLOOR = 0.1; // an untrained muscle still reads as part of a body
const FILL_RANGE = 0.65; // ceiling 0.75, so labels stay legible over it

// Plates: the gaps between muscles are drawn in the card's surface colour, so
// they read as cuts through the ink rather than as outlines. User units (not
// non-scaling) so the gap scales with the figure, as in the mock-up.
const GAP_WIDTH = 0.8;
const ABS_GAP_WIDTH = 0.6;

function fillOpacity(intensity: number): number {
  return FILL_FLOOR + Math.max(0, Math.min(1, intensity)) * FILL_RANGE;
}

// Emit a shape, plus its mirrored twin when the data asks for one.
function Mirrored({ shape, children }: { shape: RegionShape; children: (d: string) => React.ReactNode }) {
  return (
    <>
      {children(shape.d)}
      {shape.mirrorX ? <g transform="translate(100,0) scale(-1,1)">{children(shape.d)}</g> : null}
    </>
  );
}

function Face({
  face,
  intensity,
  estimated,
  selected,
  systemic,
  reduce,
}: {
  face: BodyFace;
  intensity: Record<MuscleKey, number>;
  estimated: Record<MuscleKey, boolean>;
  selected: RegionKey | null;
  systemic: number;
  reduce: boolean;
}) {
  const shapes = BODY_MUSCLE_SHAPES[face];
  const pieces = MUSCLE_KEYS.flatMap((m) => (shapes[m] ?? []).map((shape, j) => ({ m, j, shape })));
  return (
    <svg className="bodymap-face" data-face={face} viewBox={BODY_VIEWBOX} aria-hidden="true">
      {/* base silhouette */}
      <path
        d={BODY_MUSCLE_SILHOUETTE[face]}
        fill="var(--color-fg)"
        fillOpacity={0.06}
        stroke="var(--color-fg)"
        strokeOpacity={0.25}
        strokeWidth={0.6}
        vectorEffect="non-scaling-stroke"
      />
      {/* Plates: one fill per muscle piece, gap stroke in the surface colour. */}
      {pieces.map(({ m, j, shape }) => {
        const target = fillOpacity(intensity[m] ?? 0);
        const delay = MUSCLE_REGION_KEYS.indexOf(MUSCLES[m].region) * 0.04;
        return (
          <Mirrored key={`${m}-${j}`} shape={shape}>
            {(d) => (
              // animate, not whileInView — a whileInView chart can get stuck
              // hidden if the observer never fires (same note as RadarChart).
              <motion.path
                d={d}
                fill="var(--color-fg)"
                stroke="var(--color-surface)"
                strokeWidth={GAP_WIDTH}
                strokeLinejoin="round"
                initial={reduce ? false : { fillOpacity: 0 }}
                animate={{ fillOpacity: target }}
                transition={reduce ? { duration: 0 } : { duration: 0.6, ease: EASE, delay }}
              />
            )}
          </Mirrored>
        );
      })}
      {face === 'front' ? (
        <g stroke="var(--color-surface)" strokeWidth={ABS_GAP_WIDTH}>
          {ABS_DIVIDERS.lines.map((l) => (
            <line key={l.y} x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} />
          ))}
          <line
            x1={ABS_DIVIDERS.midline.x}
            x2={ABS_DIVIDERS.midline.x}
            y1={ABS_DIVIDERS.midline.y1}
            y2={ABS_DIVIDERS.midline.y2}
          />
        </g>
      ) : null}
      {/* Estimated muscles (decision D4): minutes that came wholly or partly
          from the default region split get a fine dashed outline. */}
      {pieces
        .filter(({ m }) => estimated[m])
        .map(({ m, j, shape }) => (
          <Mirrored key={`est-${m}-${j}`} shape={shape}>
            {(d) => (
              <path
                d={d}
                fill="none"
                stroke="var(--color-fg)"
                strokeOpacity={0.3}
                strokeWidth={0.6}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </Mirrored>
        ))}
      {/* Selection is a stroke change, never a colour change — the palette is
          monochrome by house rule and dark mode is token overrides only. Drawn
          last so a selected region's muscles sit over every other stroke. */}
      {selected
        ? pieces
            .filter(({ m }) => MUSCLES[m].region === selected)
            .map(({ m, j, shape }) => (
              <Mirrored key={`sel-${m}-${j}`} shape={shape}>
                {(d) => (
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--color-fg)"
                    strokeOpacity={0.85}
                    strokeWidth={1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </Mirrored>
            ))
        : null}
      {/* Systemic work is the one genuinely whole-body quantity, so it reads
          as an aura around the whole figure rather than as a muscle. */}
      {systemic > 0 ? (
        <path
          d={BODY_MUSCLE_SILHOUETTE[face]}
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
  estimated,
  systemic,
  face,
  onFaceChange,
  selected,
}: {
  // Per MUSCLE, 0..1 against the busiest muscle (muscleIntensities).
  intensity: Record<MuscleKey, number>;
  // Muscles whose minutes came wholly or partly from the default split (D4).
  estimated: Record<MuscleKey, boolean>;
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

  const top = MUSCLE_KEYS.filter((k) => (intensity[k] ?? 0) > 0)
    .sort((a, b) => (intensity[b] ?? 0) - (intensity[a] ?? 0))
    .slice(0, 3)
    .map((k) => MUSCLES[k].label);

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
            ? `Body map, ${face} view. Most-worked muscles: ${top.join(', ')}.`
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
            estimated={estimated}
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
              <path d={BODY_MUSCLE_SILHOUETTE.front} fill="var(--color-fg)" fillOpacity={0.055} />
            </svg>
          ))}
          <Face
            face="back"
            intensity={intensity}
            estimated={estimated}
            selected={selected}
            systemic={systemic}
            reduce={reduce}
          />
        </div>
      </div>

      {/* The discrete control ships always: it is the keyboard path, the
          screen-reader path, and the only path under reduced motion. Drawn as a
          turntable — the floor shadow under the feet with an arrow riding its
          rim — so it reads as part of the figure rather than a second control
          row. The negative margin tucks it under the feet; the 44px hit box
          stays whole. */}
      <button
        type="button"
        onClick={() => onFaceChange(face === 'front' ? 'back' : 'front')}
        aria-label={`Turn to the ${face === 'front' ? 'back' : 'front'}`}
        className="-mt-7 flex min-h-11 w-36 flex-col items-center rounded-control text-muted outline-none transition-colors hover:text-fg focus-visible:ring-1 focus-visible:ring-teal"
      >
        <svg viewBox="0 0 132 30" className="h-[30px] w-[132px]" aria-hidden="true">
          <ellipse cx="66" cy="12" rx="44" ry="8" fill="var(--color-fg)" fillOpacity={0.1} />
          <path
            d="M 26 14 A 40 10 0 0 0 100 19"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <path
            d="M 95 15.5 L 101 19 L 95 22.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="t-label leading-none">{face}</span>
      </button>
    </div>
  );
}
