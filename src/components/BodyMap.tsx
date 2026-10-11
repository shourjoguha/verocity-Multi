import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ABS_DIVIDERS,
  BODY_MUSCLE_SHAPES,
  BODY_MUSCLE_SILHOUETTE,
  BODY_VIEWBOX,
  type BodyFace,
  type RegionShape,
} from '@/lib/bodyRegions';
import { MUSCLES, MUSCLE_KEYS, MUSCLE_REGION_KEYS, type MuscleKey, type RegionKey } from '@/app.config';
import { EASE } from '@/components/anim';
import type { BodyMapInkPref, BodyMapStyle } from '@/lib/bodyMapPrefs';
import {
  BODY_SHADE_BANDS,
  BODY_SHADE_LABELS,
  PLATE_BASE_TINT,
  plateOpacity,
  shadeBand,
  shadePosition,
} from '@/lib/bodyMapShade';

// Presentational only — no data loading, no query imports. See the CSS block
// "Body map slab" in global.css for the 3D contract and the flattening trap.
// Everything below draws INSIDE a face's <svg>: SVG attributes (fill-opacity,
// stroke-dasharray, the mirror transform) are safe there. Nothing may add
// opacity/filter/clip/mask/overflow to an HTML element between the stage and
// the faces.

// Extrusion ribs between the two faces. Closely spaced so the edge reads as a
// continuous solid rather than a stack of cards — the Echo Stack wants to look
// like separate layers, a body does not. Each rib is nearly transparent: the 15
// layers stack to ~6% ink, a hairline-weight edge at the rest tilt rather than
// a cast shadow (depth is retired). The faces are opaque, so no rib ever shows
// through a muscle.
const RIB_OPACITY = 0.004; // 0.0085 (~12%) still read as a halo on dark cards
const RIB_Z = Array.from({ length: 15 }, (_, i) => 14 - i * 2);

// The figure rests at a slight angle rather than dead-on. A head-on view of a
// flat-faced slab reads as a sprite no matter how good the extrusion is; the
// tilt is what makes it read as an object at first glance. It is a static
// resting position, not an auto-spin — nothing animates unless the user drags.
const REST_TILT = 22;

function spinFor(face: BodyFace): number {
  return face === 'back' ? 180 + REST_TILT : -REST_TILT;
}

// Silhouette outline (Plates, Engraved): dotted, so it stays distinct from the
// per-muscle ESTIMATED outline (dashed "2 2", 0.3) drawn further down.
const OUTLINE_DASH = '1 1.8';
const OUTLINE_O = 0.4;

// Plates inks. Mono is the chrome ink; colour is a DATA colour (--bm-mango).
const INK_VAR: Record<BodyMapInkPref, string> = {
  mono: 'var(--color-fg)',
  colour: 'var(--bm-mango)',
};

// Plates: the gaps between muscles are drawn in the card's surface colour, so
// they read as cuts through the ink rather than as outlines. User units (not
// non-scaling) so the gap scales with the figure, as in the mock-up.
const GAP_WIDTH = 0.8;
const ABS_GAP_WIDTH = 0.6;

// Engraved: a hatch per muscle piece, rotated to the fibre direction. Spacing
// stays >= 1.5 units so it still reads at 375px; weight and opacity carry the
// intensity, with a floor so an untrained muscle still reads as anatomy.
const HATCH_PITCH = 2;
const HATCH_W_FLOOR = 0.2;
const HATCH_W_RANGE = 0.9;
const HATCH_O_FLOOR = 0.4;
const HATCH_O_RANGE = 0.6;
const DEFAULT_ANGLE = 90;

// Thermal: a sequential ramp between the --heat-lo/--heat-hi tokens (both
// themes, lightness monotonic so it reads in greyscale), blurred and clipped to
// the silhouette, hairline muscle outlines on top. The numbers live in the
// callouts beside the figure, so the hue is never the only carrier.
// The blur is STATIC: nothing inside the filtered group animates, so a slab
// drag only changes the CSS transform on .bodymap-slab and the filtered layer
// can be reused rather than re-rasterised. Modest deviation on the 100x220 grid.
const HEAT_BLUR = 2.5;
// Touch fallback (no <filter>): each fill is stroked in its own colour at low
// opacity, so edges bleed slightly into their neighbours without a filter.
const HEAT_FEATHER_W = 2.5;
const HEAT_FEATHER_O = 0.45;
const HEAT_OUTLINE_O = 0.18;

function heatFill(intensity: number): string {
  return `color-mix(in oklab, var(--heat-hi) ${Math.round(clamp01(intensity) * 100)}%, var(--heat-lo))`;
}

// Blur only under a fine pointer. CLAUDE.md gates every backdrop blur to
// pointer-fine because touch Safari re-samples filtered content aggressively;
// an SVG filter on a face that rotates in 3D is the same class of cost, so
// touch gets the unfiltered fallback. Read once at mount — BodyMap only ever
// renders client-side, after the body summary loads, so there is no SSR pass
// to disagree with.
function useFinePointer(): boolean {
  const [fine] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches,
  );
  return fine;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
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
  variant,
  blur,
  ink,
}: {
  variant: BodyMapStyle;
  ink: BodyMapInkPref;
  blur: boolean;
  face: BodyFace;
  intensity: Record<MuscleKey, number>;
  estimated: Record<MuscleKey, boolean>;
  selected: RegionKey | null;
  systemic: number;
  reduce: boolean;
}) {
  const shapes = BODY_MUSCLE_SHAPES[face];
  const pieces = MUSCLE_KEYS.flatMap((m) => (shapes[m] ?? []).map((shape, j) => ({ m, j, shape })));
  // Unique per BodyMap instance and face; the piece suffix is appended below.
  const uid = useId().replace(/:/g, '');
  const engraved = variant === 'engraved';
  const thermal = variant === 'thermal';
  const clipId = `${uid}-${face}-clip`;
  const blurId = `${uid}-${face}-blur`;
  return (
    <svg className="bodymap-face" data-face={face} viewBox={BODY_VIEWBOX} aria-hidden="true">
      {/* Opaque backing, first and in every style: the faces are translucent
          layers over the ribs, and without this the ribs show through every
          muscle and flatten the ramp. */}
      <path d={BODY_MUSCLE_SILHOUETTE[face]} fill="var(--color-surface)" />
      {/* base silhouette. Thermal fills via `style` because color-mix and the
          heat tokens are CSS values, not presentation-attribute values. */}
      <path
        d={BODY_MUSCLE_SILHOUETTE[face]}
        fill={engraved ? 'none' : thermal ? undefined : 'var(--color-fg)'}
        fillOpacity={engraved || thermal ? undefined : PLATE_BASE_TINT}
        style={thermal ? { fill: 'var(--heat-lo)' } : undefined}
        stroke="var(--color-fg)"
        strokeOpacity={thermal ? 0.25 : OUTLINE_O}
        strokeWidth={0.6}
        strokeDasharray={thermal ? undefined : OUTLINE_DASH}
        strokeLinecap={thermal ? undefined : 'round'}
        vectorEffect="non-scaling-stroke"
      />
      {/* Thermal: heat fills clipped to the silhouette, blurred under a fine
          pointer, then unblurred hairline outlines. Static — no motion inside
          the filtered group. */}
      {thermal ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <path d={BODY_MUSCLE_SILHOUETTE[face]} />
            </clipPath>
            {blur ? (
              <filter id={blurId} x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur stdDeviation={HEAT_BLUR} />
              </filter>
            ) : null}
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <g filter={blur ? `url(#${blurId})` : undefined}>
              {pieces.map(({ m, j, shape }) => {
                const fill = heatFill(shadePosition(shadeBand(intensity[m] ?? 0)));
                return (
                  <Mirrored key={`${m}-${j}`} shape={shape}>
                    {(d) => (
                      <path
                        d={d}
                        strokeLinejoin="round"
                        strokeWidth={blur ? undefined : HEAT_FEATHER_W}
                        strokeOpacity={blur ? undefined : HEAT_FEATHER_O}
                        style={blur ? { fill } : { fill, stroke: fill }}
                      />
                    )}
                  </Mirrored>
                );
              })}
            </g>
          </g>
          <g fill="none" stroke="var(--color-fg)" strokeOpacity={HEAT_OUTLINE_O} strokeWidth={0.5}>
            {pieces.map(({ m, j, shape }) => (
              <Mirrored key={`ol-${m}-${j}`} shape={shape}>
                {(d) => <path d={d} vectorEffect="non-scaling-stroke" />}
              </Mirrored>
            ))}
          </g>
        </>
      ) : null}
      {/* Engraved: one hatch pattern per piece. The twin of a mirrored piece sits
          inside the mirror transform, so its pattern mirrors with it. */}
      {engraved
        ? pieces.map(({ m, j, shape }) => {
            const i = shadePosition(shadeBand(intensity[m] ?? 0));
            const pid = `${uid}-${face}-${m}-${j}`;
            return (
              <g key={`${m}-${j}`}>
                <defs>
                  <pattern
                    id={pid}
                    width={HATCH_PITCH}
                    height={HATCH_PITCH}
                    patternUnits="userSpaceOnUse"
                    patternTransform={`rotate(${(shape.angle ?? DEFAULT_ANGLE) - 90})`}
                  >
                    {/* Centred in the tile: at x=0 half the stroke is clipped by
                        the tile edge and every weight draws at half width. */}
                    <line
                      x1={HATCH_PITCH / 2}
                      y1={0}
                      x2={HATCH_PITCH / 2}
                      y2={HATCH_PITCH}
                      stroke="var(--color-fg)"
                      strokeWidth={HATCH_W_FLOOR + i * HATCH_W_RANGE}
                      strokeOpacity={HATCH_O_FLOOR + i * HATCH_O_RANGE}
                    />
                  </pattern>
                </defs>
                <Mirrored shape={shape}>
                  {(d) => (
                    <path
                      d={d}
                      fill={`url(#${pid})`}
                      stroke="var(--color-fg)"
                      // An estimated muscle drops its solid outline so the
                      // dashed estimate outline drawn later stays visible.
                      strokeOpacity={estimated[m] ? 0 : 0.45}
                      strokeWidth={0.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </Mirrored>
              </g>
            );
          })
        : null}
      {/* Plates: one fill per muscle piece, gap stroke in the surface colour. */}
      {(engraved || thermal ? [] : pieces).map(({ m, j, shape }) => {
        const target = plateOpacity(shadeBand(intensity[m] ?? 0), ink);
        const delay = MUSCLE_REGION_KEYS.indexOf(MUSCLES[m].region) * 0.04;
        return (
          <Mirrored key={`${m}-${j}`} shape={shape}>
            {(d) => (
              // animate, not whileInView — a whileInView chart can get stuck
              // hidden if the observer never fires (same note as RadarChart).
              <motion.path
                d={d}
                fill={INK_VAR[ink]}
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
      {face === 'front' && !engraved && !thermal ? (
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
  style = 'plates',
  ink = 'mono',
}: {
  style?: BodyMapStyle;
  ink?: BodyMapInkPref;
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
  const blur = useFinePointer();
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
    drag.current = {
      startX: e.clientX,
      startSpin: spin.current,
      id: e.pointerId,
    };
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
      {/* Relative wrapper carries no grouping property; the legend is a SIBLING
          of the stage, never inside it (see global.css "Body map slab"). */}
      <div className="relative mx-auto w-full max-w-[200px]">
        <div
          className="bodymap-stage w-full"
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
              variant={style}
              blur={blur}
              ink={ink}
            />
            {RIB_Z.map((z) => (
              <svg
                key={z}
                className="bodymap-rib"
                viewBox={BODY_VIEWBOX}
                aria-hidden="true"
                style={{ transform: `translateZ(${z}px)` }}
              >
                <path d={BODY_MUSCLE_SILHOUETTE.front} fill="var(--color-fg)" fillOpacity={RIB_OPACITY} />
              </svg>
            ))}
            <Face
              face="back"
              intensity={intensity}
              estimated={estimated}
              selected={selected}
              systemic={systemic}
              reduce={reduce}
              variant={style}
              blur={blur}
              ink={ink}
            />
          </div>
        </div>
        <ShadeLegend style={style} ink={ink} />
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

const LEGEND_CELL = 10; // px per band; labels sit on the band edges

// Thin vertical key beside the figure: one cell per shade band, heaviest on
// top, each painted with exactly what the map paints for that band in the
// active style + ink. Static — nothing animates here.
function ShadeLegend({ style, ink }: { style: BodyMapStyle; ink: BodyMapInkPref }) {
  const uid = useId().replace(/:/g, '');
  const h = BODY_SHADE_BANDS * LEGEND_CELL;
  const bands = Array.from({ length: BODY_SHADE_BANDS }, (_, k) => BODY_SHADE_BANDS - 1 - k); // top-down
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-1 left-full -ml-5 flex items-start gap-1"
    >
      <div className="relative" style={{ width: 6, height: h }}>
        <svg width={6} height={h} className="block">
          {bands.map((band, row) => {
            const y = row * LEGEND_CELL;
            const pos = shadePosition(band);
            return (
              <g key={band}>
                {style === 'thermal' ? (
                  <rect x={0} y={y} width={6} height={LEGEND_CELL} style={{ fill: heatFill(pos) }} />
                ) : (
                  <>
                    <rect x={0} y={y} width={6} height={LEGEND_CELL} fill="var(--color-surface)" />
                    {style === 'engraved' ? (
                      <>
                        <defs>
                          <pattern
                            id={`${uid}-${band}`}
                            width={HATCH_PITCH}
                            height={HATCH_PITCH}
                            patternUnits="userSpaceOnUse"
                          >
                            <line
                              x1={HATCH_PITCH / 2}
                              y1={0}
                              x2={HATCH_PITCH / 2}
                              y2={HATCH_PITCH}
                              stroke="var(--color-fg)"
                              strokeWidth={HATCH_W_FLOOR + pos * HATCH_W_RANGE}
                              strokeOpacity={HATCH_O_FLOOR + pos * HATCH_O_RANGE}
                            />
                          </pattern>
                        </defs>
                        <rect x={0} y={y} width={6} height={LEGEND_CELL} fill={`url(#${uid}-${band})`} />
                      </>
                    ) : (
                      <>
                        <rect
                          x={0}
                          y={y}
                          width={6}
                          height={LEGEND_CELL}
                          fill="var(--color-fg)"
                          fillOpacity={PLATE_BASE_TINT}
                        />
                        <rect
                          x={0}
                          y={y}
                          width={6}
                          height={LEGEND_CELL}
                          fill={INK_VAR[ink]}
                          fillOpacity={plateOpacity(band, ink)}
                        />
                      </>
                    )}
                  </>
                )}
              </g>
            );
          })}
        </svg>
        <div className="absolute inset-0 border border-border" />
        {/* tick labels: BODY_SHADE_LABELS runs 0..100 bottom-up; label k sits on
            the edge below band k+1 (the last one tops the bar). */}
        {BODY_SHADE_LABELS.map((label, k) => (
          <span
            key={label}
            className="absolute left-2 text-[8px] leading-none tabular-nums text-muted"
            style={{ top: h - (k + 1) * LEGEND_CELL - 3 }}
          >
            {label}
          </span>
        ))}
      </div>
      <span className="absolute left-0 w-14 text-[8px] leading-tight text-muted" style={{ top: h + 3 }}>
        % of top muscle
      </span>
    </div>
  );
}
