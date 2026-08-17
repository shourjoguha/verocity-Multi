import { useEffect, useRef } from 'react';
import type P5 from 'p5';
import { useResolvedTheme, type ResolvedTheme } from '@/lib/theme';

// A particle field carrying arbitrary text — a port of the reference p5 "force
// field" sketch, adapted to this design system. A grid of points reads its
// size and shade from an offscreen brightness map (arbitrary text, drawn in
// arbitrary fonts at arbitrary positions), disperses under the cursor/finger,
// and springs back.
//
// THE HEAVY MODULE. p5 is ~250KB gzip and touches `window` at import time, so
// nothing may import this statically: the landing island is `client:load`,
// which Astro still server-renders, and a top-level `import p5 from 'p5'`
// anywhere in that graph crashes SSR. The only entry point is the dynamic
// import in ForceField.tsx. `import type` above is erased at compile and is
// safe.
//
// Four deliberate departures from the reference sketch:
//
// 1. No hue/saturation palette. A hero backdrop is chrome, and chrome is
//    monochrome here (CLAUDE.md). The HSL ramp becomes a greyscale ramp
//    mirrored from the --color-* tokens.
// 2. No CDN image. The brightness map is a caller-supplied set of text
//    sources, each drawn at its own position in the offscreen buffer.
// 3. No `background(0)`. `clear()` instead, so --color-bg and whichever
//    backdrop preset is active show through, and light mode is not silently
//    black.
// 4. No p5.Vector. The reference allocates two vectors per particle per frame;
//    at ~100k particles that would be 12M allocations a second. Plain numbers.

// Greyscale ramp endpoints, as 0-255 canvas levels. MIRRORS --color-* in
// global.css and must move with it — canvas cannot read CSS custom properties
// (same constraint, and the same fix, as the DEPTH block in
// BackgroundScene3DCanvas.tsx).
//
// `dust` is where the map is at its ambient floor (outside every text source):
// --color-echo-4, the faintest grey that still reads. `ink` is where it is
// fully white (inside a letter): --color-fg. Both themes are authored here as
// equals — a ramp defined for only one is the silent break global.css warns
// about.
const RAMP: Record<ResolvedTheme, { dust: number; ink: number }> = {
  light: { dust: 217, ink: 18 }, // echo-4 85% → fg 7%
  dark: { dust: 28, ink: 255 }, // echo-4 11% → fg 100%
};

// Physics. The reference's defaults.
const FORCE_STRENGTH = 12;
const MAGNIFIER_RADIUS = 150;
const FRICTION = 0.9;
const RESTORE_SPEED = 0.05;
// How fast the repulsion centre chases the pointer. Below 1 so a fast sweep
// drags a wake through the field instead of teleporting.
const INERTIA = 0.14;

// Grid pitch, derived from the SMALLEST text source in the field.
//
// The ratio is tuned for DISPLAY type — the wordmark this field exists to
// carry. It was briefly dropped to 6 (with a 3px floor) so that 12px body copy
// could also be rendered as particles, and that was a mistake twice over: the
// particle count is quadratic in the pitch, so a full-hero canvas went from
// ~18k particles to ~108k and the loop visibly stalled, and 12px text at ANY
// pitch is unreadable as dots because the strokes are thinner than the gaps.
// Small copy belongs above the canvas as real DOM text; only display type
// belongs in the field. The clamp is the floor on cost and the ceiling on
// coarseness.
const SPACING_RATIO = 22;
const SPACING_MIN = 5;
const SPACING_MAX = 10;
// Placement jitter, so the grid reads as a field rather than as graph paper.
const NOISE_SCALE = 0.02;

// Dot size, as a share of the grid pitch — NOT in pixels.
//
// A fixed weight only works at one pitch: at a small pitch the dots overlap
// and the text turns to porridge, at a large pitch they are lost between
// letters. Proportional weights hold the same dot-to-gap ratio at every pitch.
// At the top of the ramp the dots very nearly touch, so a letter's interior
// reads as ink rather than as scattered pepper; at the bottom they stay tiny
// and the ambient dust stays a texture.
const MIN_STROKE_RATIO = 0.16;
const MAX_STROKE_RATIO = 0.85;

// The brightness map's floor — the level BETWEEN text sources. Not zero, and
// that is the whole ambient field: at zero the canvas is bare everywhere the
// text isn't, so the cursor does nothing until it crosses a glyph and the
// "force field" reads as a hole punched in some text. A low floor gives every
// point a faint mark, so the whole canvas is the interaction surface.
const FIELD_FLOOR = 26;

// Anything at or below this brightness is ambient dust rather than picture, and
// gets sampled every DUST_STRIDE cells instead of every cell (see
// generatePoints). Sits a little above FIELD_FLOOR so the blur's outermost
// falloff — which is still structure — stays at full density.
const DUST_CEILING = FIELD_FLOOR + 10;
const DUST_STRIDE = 2;

// Edge softening, also a share of the pitch and for the same reason. It ramps
// stroke weight across a letter's boundary instead of stepping — but a radius
// wide relative to the stroke washes the letter INTERIORS below full
// brightness, and interiors are where the ink and the fattest dots come from.
// Capped because p5's BLUR is a JS convolution, quadratic in the radius.
const BLUR_RATIO = 0.42;
const BLUR_MAX = 4;

// Parked far outside the canvas: the resting state of the repulsion centre when
// the pointer is elsewhere. Snapped to, never lerped to — lerping out would
// sweep the force across the whole field on the way.
const PARKED = -10000;

// BUCKETS — the difference between this running at 60fps and at 22.
//
// The reference sketch draws every particle with its own `stroke()` +
// `strokeWeight()` + `point()`. Each of those is a canvas state change, and
// state changes are what a 2D context is slow at: at ~18k particles that is
// ~54k of them per frame. Measured in headless Chromium, disabling the draw
// calls while leaving the physics intact took the loop from 22fps to 60 — so
// the entire cost was here, not in the maths.
//
// So quantise instead. Shade and radius are both continuous functions of the
// sampled brightness (and, near the cursor, of distance), but the eye cannot
// resolve 18k distinct greys and radii on a field of soft dots. Snapping to a
// 16×16 grid of (shade, radius) pairs lets every particle in a bucket be drawn
// as one path with a single fillStyle — a couple of hundred state changes a
// frame regardless of particle count.
//
// The step counts are the visible-banding floor: 16 shades across the
// dust→ink ramp is ~12 levels apart, below the JND on these soft edges, and 16
// radii across a ~1–12px span is sub-pixel. Raising them costs almost nothing
// (a few more state changes); lowering them starts to band.
const SHADE_STEPS = 16;
const WEIGHT_STEPS = 16;
const TAU = Math.PI * 2;

type Particle = {
  x: number;
  y: number;
  // Where it springs back to.
  ox: number;
  oy: number;
  vx: number;
  vy: number;
};

/**
 * One piece of text to render into the brightness map at an explicit position.
 *
 * `x, y` are the top-left of the text's bounding box in canvas coordinates —
 * usually a `getBoundingClientRect()` relative to the canvas host. The buffer
 * draws with `textBaseline = 'top'` so this stays intuitive.
 *
 * `width` (optional) enables word-wrapping via p5's `text(str, x, y, w, h)`.
 * Callers passing a paragraph must pass a width; single-word sources can omit
 * it.
 */
export type TextSource = {
  text: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize: number;
  fontFamily?: string;
  letterSpacing?: string;
  textAlign?: 'left' | 'center' | 'right';
};

export type ForceFieldProps = {
  sources: TextSource[];
  onReady?: () => void;
};

const DEFAULT_FONT = 'Archivo Black';

// A hash the sketch compares against to decide whether to rebuild the map.
// The `sources` array is mutated by the caller (`ResizeObserver` re-measures
// on every layout change), so the reference alone doesn't tell us anything.
function sourceSignature(sources: TextSource[]): string {
  return sources
    .map(
      (s) =>
        `${s.text}|${Math.round(s.x)}|${Math.round(s.y)}|${Math.round(s.width ?? 0)}|` +
        `${Math.round(s.height ?? 0)}|${Math.round(s.fontSize)}|${s.fontFamily ?? ''}|` +
        `${s.letterSpacing ?? ''}|${s.textAlign ?? 'left'}`,
    )
    .join('#');
}

export default function ForceFieldCanvas({ sources, onReady }: ForceFieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const theme = useResolvedTheme();

  // Live values for the draw loop and the map rebuild. The sketch is
  // instantiated once and reads these rather than closing over them, so a theme
  // flip or a layout change repaints without tearing down p5.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  // Held in a ref for the same reason Modal holds onClose in one: the caller
  // passes an inline arrow, and depending on it here would tear down and
  // re-create the whole sketch on every parent render.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let instance: P5 | null = null;
    let detach: (() => void) | null = null;

    (async () => {
      // Wait for fonts before drawing the map. Canvas text takes the font from
      // the document's loaded set, so racing this paints the text in the
      // fallback sans and bakes it into the particle positions — where, unlike
      // DOM text, it never re-lays-out once the real font arrives.
      try {
        await document.fonts.ready;
      } catch {
        /* Fonts API unavailable — fall through and draw with whatever is there. */
      }
      const { default: p5 } = await import('p5');
      if (cancelled) return;

      const sketch = (p: P5) => {
        let field: P5.Graphics | null = null;
        let fieldPixels: number[] | Uint8ClampedArray = [];
        let points: Particle[] = [];
        // All set by buildField() from the caller-supplied sources.
        let spacing = SPACING_MAX;
        let minStroke = SPACING_MAX * MIN_STROKE_RATIO;
        let maxStroke = SPACING_MAX * MAX_STROKE_RATIO;
        // The full radius range a particle can land in: base weight runs
        // minStroke→maxStroke, and the magnifier doubles it at the cursor.
        // Bucket indices are computed against this span, so it has to move
        // with the pitch.
        let weightSpan = maxStroke * 2 - minStroke;
        // Reused across frames — cleared with `length = 0` rather than
        // reallocated, so a 60fps loop allocates nothing.
        const buckets: number[][] = Array.from(
          { length: SHADE_STEPS * WEIGHT_STEPS },
          () => [],
        );

        // Repulsion centre, and whether the pointer is actually driving it.
        // `engaged` exists because p5 initialises mouseX/mouseY to 0,0 — which
        // is INSIDE the canvas, so the reference sketch shoves the field out
        // from its top-left corner on load, before anyone has moved anything.
        let cx = PARKED;
        let cy = PARKED;
        let engaged = false;
        let announced = false;
        // Signature of the sources the current map was built from. Compared on
        // every draw so a layout change (viewport resize, font swap) forces a
        // rebuild without depending on ResizeObserver alone.
        let builtFrom = '';

        // The brightness map: every text source drawn where it lives, white on
        // an ambient floor, blurred. The particle draw then samples this.
        function buildField() {
          const list = sourcesRef.current;

          field?.remove();
          const g = p.createGraphics(p.width, p.height);
          // 1:1 with the point grid — the pixel index arithmetic below assumes
          // it, and a retina buffer would quadruple a one-shot cost for nothing.
          g.pixelDensity(1);
          g.background(FIELD_FLOOR);
          g.noStroke();
          g.fill(255);

          // Pitch is derived FROM THE SMALLEST source. A pitch tuned to the
          // largest one would leave every smaller heading as a handful of
          // fat dots; deriving from the smallest keeps everything at least
          // readable, and the clamp bounds cost either way.
          const smallest =
            list.length > 0 ? Math.min(...list.map((s) => s.fontSize)) : SPACING_MAX * 6;
          spacing = p.constrain(smallest / SPACING_RATIO, SPACING_MIN, SPACING_MAX);
          minStroke = spacing * MIN_STROKE_RATIO;
          maxStroke = spacing * MAX_STROKE_RATIO;
          weightSpan = maxStroke * 2 - minStroke;

          for (const src of list) drawSource(g, src);

          g.filter(p.BLUR, Math.min(BLUR_MAX, Math.max(1, spacing * BLUR_RATIO)));
          g.loadPixels();

          field = g;
          fieldPixels = g.pixels;
          builtFrom = sourceSignature(list);
        }

        function drawSource(g: P5.Graphics, src: TextSource) {
          g.push();
          g.textFont(src.fontFamily ?? DEFAULT_FONT);
          g.textSize(src.fontSize);
          g.textAlign(
            src.textAlign === 'center' ? p.CENTER : src.textAlign === 'right' ? p.RIGHT : p.LEFT,
            p.TOP,
          );
          // Canvas letterSpacing is Chromium 99+ / Safari 16.4+ / Firefox 128+.
          // Where it is missing the assignment is inert and the text is simply
          // a little wider than the DOM it stands in for — a graceful loss,
          // not a broken render, so no feature test.
          if (src.letterSpacing) {
            (g.drawingContext as CanvasRenderingContext2D).letterSpacing = src.letterSpacing;
          }
          // p5's two `text()` signatures anchor DIFFERENTLY, and this trips.
          //
          // - text(str, x, y, w, h) — the WRAPPING form. (x, y) is the box's
          //   top-left; textAlign controls how each wrapped line sits WITHIN
          //   that box, not where the box itself sits. So for a centred
          //   paragraph we pass the DOM rect's left/top verbatim.
          //
          // - text(str, x, y) — the anchor form. textAlign moves the anchor
          //   point: CENTER means (x, y) is the string's centre. Passing the
          //   DOM rect's left edge here with textAlign CENTER draws the string
          //   centred on the left edge — half of it off-canvas.
          //
          // Wrapping intent is signalled by `height`, not `width`: a caller
          // passes width on both so a single-line source can compute its
          // anchor without wrapping (a heading with whitespace-nowrap would
          // otherwise wrap below its container width).
          if (src.height !== undefined) {
            g.text(src.text, src.x, src.y, src.width!, src.height);
          } else {
            const w = src.width ?? 0;
            const anchorX =
              w === 0
                ? src.x
                : src.textAlign === 'center'
                  ? src.x + w / 2
                  : src.textAlign === 'right'
                    ? src.x + w
                    : src.x;
            g.text(src.text, anchorX, src.y);
          }
          g.pop();
        }

        // Sample density follows INFORMATION density.
        //
        // A uniform grid over the whole canvas spends most of itself on the
        // ambient floor: the wordmark covers ~15% of a full-hero stage, so
        // ~85% of a uniform field is dust that renders as a ~1px dot nobody
        // can resolve — and costs exactly as much to draw as an ink dot. At
        // full-hero size that was 18k particles for 2.8k-worth of picture, and
        // the loop could not hold 60fps.
        //
        // So the letters keep the full grid and the dust is sampled every
        // DUST_STRIDE cells. The ambient field survives — it is what makes the
        // whole canvas an interaction surface rather than a hole punched in
        // some text (see FIELD_FLOOR) — it is just no denser than it needs to
        // be. Thinning is a regular lattice rather than random so the dust
        // stays even; the per-point noise jitter below is what stops that
        // lattice reading as graph paper.
        function generatePoints() {
          points = [];
          const w = p.width;
          const h = p.height;
          let ix = 0;
          for (let y = 0; y < h; y += spacing, ix++) {
            let jx = 0;
            for (let x = 0; x < w; x += spacing, jx++) {
              // Sample the map at the cell's origin. `field` is always built
              // before this runs (both callers do buildField() first), so the
              // brightness is the one this particle would render at.
              const sx = x < 0 ? 0 : x > w - 1 ? w - 1 : x | 0;
              const sy = y < 0 ? 0 : y > h - 1 ? h - 1 : y | 0;
              const brightness = fieldPixels[(sx + sy * w) * 4] ?? 0;
              if (brightness <= DUST_CEILING && (ix % DUST_STRIDE || jx % DUST_STRIDE)) continue;

              const nx = p.noise(x * NOISE_SCALE, y * NOISE_SCALE) - 0.5;
              const ny = p.noise((x + 500) * NOISE_SCALE, (y + 500) * NOISE_SCALE) - 0.5;
              const px = x + nx * spacing;
              const py = y + ny * spacing;
              points.push({ x: px, y: py, ox: px, oy: py, vx: 0, vy: 0 });
            }
          }
        }

        function sizeToHost() {
          const { clientWidth, clientHeight } = host!;
          return { w: Math.max(1, clientWidth), h: Math.max(1, clientHeight) };
        }

        p.setup = () => {
          const { w, h } = sizeToHost();
          p.createCanvas(w, h);
          // Devices with a coarse pointer are also the ones with the highest
          // device pixel ratios; rendering at 1x here is the single biggest
          // saving available and is invisible on a field of soft points.
          if (window.matchMedia('(pointer: coarse)').matches) p.pixelDensity(1);
          // Particles are FILLED arcs now, not stroked points (see BUCKETS),
          // so the p5-level stroke would only paint an unwanted outline.
          p.noStroke();
          buildField();
          generatePoints();
        };

        // p5 prevents the default touch action unless the handler returns true,
        // which would make the field swallow vertical scrolling on a phone.
        p.touchMoved = () => {
          engaged = true;
          return true;
        };
        // The finger's last position stays in mouseX/mouseY after it lifts, so
        // without this the field would hold its dent until the next touch.
        p.touchEnded = () => {
          engaged = false;
          return true;
        };
        p.mouseMoved = () => {
          engaged = true;
        };

        p.draw = () => {
          p.clear();

          const sig = sourceSignature(sourcesRef.current);
          if (sig !== builtFrom) {
            buildField();
            generatePoints();
          }
          if (points.length === 0) return;

          // p5 tracks the pointer window-wide and reports it relative to the
          // canvas, so "outside" is a bounds test rather than a mouseleave
          // listener — and it covers leaving via any edge, including under an
          // overlay button.
          const inside =
            p.mouseX >= 0 && p.mouseX <= p.width && p.mouseY >= 0 && p.mouseY <= p.height;

          if (engaged && inside) {
            // Snap on first contact, chase afterwards. Lerping in from PARKED
            // would drag the repulsion across the whole field to reach the
            // cursor.
            if (cx === PARKED) {
              cx = p.mouseX;
              cy = p.mouseY;
            } else {
              cx = p.lerp(cx, p.mouseX, INERTIA);
              cy = p.lerp(cy, p.mouseY, INERTIA);
            }
          } else {
            cx = PARKED;
            cy = PARKED;
          }

          const { dust, ink } = RAMP[themeRef.current];
          const w = p.width;
          const h = p.height;

          for (const bucket of buckets) bucket.length = 0;

          for (const pt of points) {
            // Repel, damp, spring back — the reference's three forces, in
            // scalars.
            const dx = pt.x - cx;
            const dy = pt.y - cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < MAGNIFIER_RADIUS && d > 0) {
              const force = FORCE_STRENGTH / Math.max(1, d);
              pt.vx += (dx / d) * force;
              pt.vy += (dy / d) * force;
            }
            pt.vx *= FRICTION;
            pt.vy *= FRICTION;
            pt.vx += (pt.ox - pt.x) * RESTORE_SPEED;
            pt.vy += (pt.oy - pt.y) * RESTORE_SPEED;
            pt.x += pt.vx;
            pt.y += pt.vy;

            const px = pt.x < 0 ? 0 : pt.x > w - 1 ? w - 1 : pt.x | 0;
            const py = pt.y < 0 ? 0 : pt.y > h - 1 ? h - 1 : pt.y | 0;
            // Greyscale buffer, so the red channel is the brightness.
            const brightness = fieldPixels[(px + py * w) * 4];
            if (brightness === undefined) continue;

            const t = brightness / 255;
            let weight = minStroke + t * (maxStroke - minStroke);
            // Under the cursor everything swells — the "magnifier" half of the
            // reference's effect, and what stops the dispersal reading as a
            // hole punched in the field.
            if (d < MAGNIFIER_RADIUS) weight *= 2 - d / MAGNIFIER_RADIUS;

            // Bucket rather than draw. See the BUCKET comment above the
            // declarations for why this is not just micro-optimisation.
            let si = (t * SHADE_STEPS) | 0;
            if (si >= SHADE_STEPS) si = SHADE_STEPS - 1;
            let wi = (((weight - minStroke) / weightSpan) * (WEIGHT_STEPS - 1) + 0.5) | 0;
            if (wi < 0) wi = 0;
            else if (wi >= WEIGHT_STEPS) wi = WEIGHT_STEPS - 1;
            const bucket = buckets[si * WEIGHT_STEPS + wi];
            bucket.push(pt.x, pt.y);
          }

          // One fillStyle assignment and one fill() per populated bucket,
          // instead of a stroke + strokeWeight + point per particle. At ~18k
          // particles that is ~54k canvas state changes a frame collapsing to
          // a couple of hundred.
          const ctx = p.drawingContext as CanvasRenderingContext2D;
          for (let si = 0; si < SHADE_STEPS; si++) {
            // Bucket centre, so quantisation does not bias the ramp darker or
            // lighter — the same reason a histogram plots bin midpoints.
            const t = (si + 0.5) / SHADE_STEPS;
            const level = Math.round(dust + t * (ink - dust));
            let styled = false;
            for (let wi = 0; wi < WEIGHT_STEPS; wi++) {
              const bucket = buckets[si * WEIGHT_STEPS + wi];
              if (bucket.length === 0) continue;
              if (!styled) {
                ctx.fillStyle = `rgb(${level},${level},${level})`;
                styled = true;
              }
              const radius = (minStroke + (wi / (WEIGHT_STEPS - 1)) * weightSpan) / 2;
              ctx.beginPath();
              for (let i = 0; i < bucket.length; i += 2) {
                const x = bucket[i];
                const y = bucket[i + 1];
                // moveTo before arc, or every dot is joined to the last by a
                // straight line — one continuous subpath instead of N circles.
                ctx.moveTo(x + radius, y);
                ctx.arc(x, y, radius, 0, TAU);
              }
              ctx.fill();
            }
          }

          if (!announced) {
            announced = true;
            onReadyRef.current?.();
          }
        };

        // Resize is debounced and rebuilds both the map and the grid. The
        // sources move with layout too, and the caller updates them via its
        // own ResizeObserver — the signature check in draw() covers that path.
        let resizeTimer: number | undefined;
        const ro = new ResizeObserver(() => {
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            const { w, h } = sizeToHost();
            if (w === p.width && h === p.height) return;
            p.resizeCanvas(w, h);
            buildField();
            generatePoints();
          }, 150);
        });
        ro.observe(host!);

        // Stop the loop entirely on a hidden tab — the same discipline as
        // `frameloop='never'` in BackgroundScene3DCanvas.tsx. This is the first
        // rAF loop in the codebase and it must not run against a tab nobody is
        // looking at.
        const onVisibility = () => {
          if (document.hidden) p.noLoop();
          else p.loop();
        };
        document.addEventListener('visibilitychange', onVisibility);

        detach = () => {
          window.clearTimeout(resizeTimer);
          ro.disconnect();
          document.removeEventListener('visibilitychange', onVisibility);
          field?.remove();
          field = null;
        };
      };

      instance = new p5(sketch, host);
    })();

    return () => {
      cancelled = true;
      detach?.();
      instance?.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      // touch-pan-y so a vertical flick over the canvas still scrolls the page.
      className="absolute inset-0 touch-pan-y [&>canvas]:block"
    />
  );
}
