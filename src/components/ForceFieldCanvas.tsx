import { useEffect, useRef } from 'react';
import type P5 from 'p5';
import { useResolvedTheme, type ResolvedTheme } from '@/lib/theme';
import { SHOWCASE_ALIAS } from '@/lib/showcase';

// The showcase hero's particle field — a port of the reference p5 "force field"
// sketch, adapted to this design system. A grid of points reads its size and
// shade from an offscreen brightness map, disperses under the cursor/finger,
// and springs back.
//
// THE HEAVY MODULE. p5 is ~250KB gzip and touches `window` at import time, so
// nothing may import this statically: ProfileView is `client:load`, which Astro
// still server-renders, and a top-level `import p5 from 'p5'` anywhere in that
// graph crashes SSR. The only entry point is the dynamic import in
// ForceField.tsx. `import type` above is erased at compile and is safe.
//
// Four deliberate departures from the reference sketch:
//
// 1. No hue/saturation palette. A hero backdrop is chrome, and chrome is
//    monochrome here (CLAUDE.md). The HSL ramp becomes a greyscale ramp
//    mirrored from the --color-* tokens.
// 2. No CDN image. The brightness map is the wordmark itself, drawn into an
//    offscreen buffer in Archivo Black — so the particle mass IS the name.
// 3. No `background(0)`. `clear()` instead, so --color-bg and whichever
//    backdrop preset is active show through, and light mode is not silently
//    black.
// 4. No p5.Vector. The reference allocates two vectors per particle per frame;
//    at ~3000 particles that is 350k allocations a second. Plain numbers.

// Greyscale ramp endpoints, as 0-255 canvas levels. MIRRORS --color-* in
// global.css and must move with it — canvas cannot read CSS custom properties
// (same constraint, and the same fix, as the DEPTH block in
// BackgroundScene3DCanvas.tsx).
//
// `dust` is where the map is black (outside the letters): --color-echo-4, the
// faintest grey that still reads. `ink` is where it is white (inside them):
// --color-fg. Both themes are authored here as equals — a ramp defined for only
// one is the silent break global.css warns about.
const RAMP: Record<ResolvedTheme, { dust: number; ink: number }> = {
  light: { dust: 217, ink: 18 }, // echo-4 85% → fg 7%
  dark: { dust: 28, ink: 255 }, // echo-4 11% → fg 100%
};

// Physics. The reference's defaults, retuned for a ~300px band rather than a
// full viewport.
const FORCE_STRENGTH = 12;
const MAGNIFIER_RADIUS = 150;
const FRICTION = 0.9;
const RESTORE_SPEED = 0.05;
// How fast the repulsion centre chases the pointer. Below 1 so a fast sweep
// drags a wake through the field instead of teleporting.
const INERTIA = 0.14;

// Grid pitch, derived from the FITTED TYPE SIZE rather than fixed in pixels.
//
// The band's height barely changes between a phone and a desktop, but its width
// halves — so the word shrinks to fit and its strokes get thinner while a fixed
// pitch does not. At a constant 12px pitch a 375px screen put barely one
// particle across a letter stroke and ZEUS was unreadable. One particle per
// (size / SPACING_RATIO) keeps the same number of particles across a stroke at
// every width; the clamp is the floor on cost and the ceiling on coarseness.
const SPACING_RATIO = 22;
const SPACING_MIN = 5;
const SPACING_MAX = 10;
// Placement jitter, so the grid reads as a field rather than as graph paper.
// The reference ships 0 here, which makes its noise lookup a constant.
const NOISE_SCALE = 0.02;

const MIN_STROKE = 1.2;
const MAX_STROKE = 5.5;

// The brightness map's floor — the level OUTSIDE the letterforms. Not zero, and
// that is the whole ambient field: at zero the band is bare everywhere the word
// isn't, so the cursor does nothing until it crosses a letter and the "force
// field" reads as a hole punched in some text. A low floor gives every point a
// faint mark, so the whole band is the interaction surface.
const FIELD_FLOOR = 26;

// Softens the letterform edges, so stroke weight ramps across the boundary
// instead of stepping. Deliberately small: p5's BLUR is a JS convolution
// (quadratic in the radius), and anything wider washes the letter interiors
// below full brightness — which is where the ink and the fattest strokes come
// from, and without them the wordmark reads as a hollow outline.
const BLUR_RADIUS = 3;

// Word height as a share of the band, and the width it may not exceed.
const WORD = SHOWCASE_ALIAS.toUpperCase();
const WORD_HEIGHT = 0.58;
const WORD_MAX_WIDTH = 0.92;

// Parked far outside the canvas: the resting state of the repulsion centre when
// the pointer is elsewhere. Snapped to, never lerped to — lerping out would
// sweep the force across the whole field on the way.
const PARKED = -10000;

type Particle = {
  x: number;
  y: number;
  // Where it springs back to.
  ox: number;
  oy: number;
  vx: number;
  vy: number;
};

export default function ForceFieldCanvas({ onReady }: { onReady?: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const theme = useResolvedTheme();

  // Live theme for the draw loop. The sketch is instantiated once and reads
  // this every frame, so a theme flip repaints without tearing down p5.
  const themeRef = useRef(theme);
  themeRef.current = theme;

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
      // Wait for Archivo Black before drawing the map. Canvas text takes the
      // font from the document's loaded set, so racing this paints the wordmark
      // in the fallback sans and bakes it into the particle positions — where,
      // unlike DOM text, it never re-lays-out once the real font arrives.
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
        // Set by buildField() from the fitted type size — the grid and the map
        // are rebuilt together, in that order, on setup and on every resize.
        let spacing = SPACING_MAX;

        // Repulsion centre, and whether the pointer is actually driving it.
        // `engaged` exists because p5 initialises mouseX/mouseY to 0,0 — which
        // is INSIDE the canvas, so the reference sketch shoves the field out
        // from its top-left corner on load, before anyone has moved anything.
        let cx = PARKED;
        let cy = PARKED;
        let engaged = false;
        let announced = false;

        // The brightness map: the wordmark, white on black, blurred. Every
        // downstream mapping (shade, stroke weight, the threshold test) reads
        // it exactly as the reference read its photo.
        function buildField() {
          field?.remove();
          const g = p.createGraphics(p.width, p.height);
          // 1:1 with the point grid — the pixel index arithmetic below assumes
          // it, and a retina buffer would quadruple a one-shot cost for nothing.
          g.pixelDensity(1);
          g.background(FIELD_FLOOR);
          g.noStroke();
          g.fill(255);
          g.textFont('Archivo Black');
          g.textAlign(p.CENTER, p.CENTER);

          let size = p.height * WORD_HEIGHT;
          g.textSize(size);
          const maxWidth = p.width * WORD_MAX_WIDTH;
          // Shrink to fit rather than letting the word run off the band on a
          // narrow screen.
          while (size > 8 && g.textWidth(WORD) > maxWidth) {
            size -= 2;
            g.textSize(size);
          }
          g.text(WORD, p.width / 2, p.height / 2);
          g.filter(p.BLUR, BLUR_RADIUS);
          g.loadPixels();

          field = g;
          fieldPixels = g.pixels;
          spacing = p.constrain(size / SPACING_RATIO, SPACING_MIN, SPACING_MAX);
        }

        function generatePoints() {
          points = [];
          for (let y = 0; y < p.height; y += spacing) {
            for (let x = 0; x < p.width; x += spacing) {
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
          p.noFill();
          buildField();
          generatePoints();
        };

        // p5 prevents the default touch action unless the handler returns true,
        // which would make the band swallow vertical scrolling on a phone.
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
          if (points.length === 0) return;

          // p5 tracks the pointer window-wide and reports it relative to the
          // canvas, so "outside" is a bounds test rather than a mouseleave
          // listener — and it covers leaving via any edge, including the one
          // under the overlay text.
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

            const px = p.constrain(Math.floor(pt.x), 0, w - 1);
            const py = p.constrain(Math.floor(pt.y), 0, p.height - 1);
            // Greyscale buffer, so the red channel is the brightness.
            const brightness = fieldPixels[(px + py * w) * 4];
            if (brightness === undefined) continue;

            const t = brightness / 255;
            let weight = MIN_STROKE + t * (MAX_STROKE - MIN_STROKE);
            // Under the cursor everything swells — the "magnifier" half of the
            // reference's effect, and what stops the dispersal reading as a
            // hole punched in the field.
            if (d < MAGNIFIER_RADIUS) weight *= p.map(d, 0, MAGNIFIER_RADIUS, 2, 1);

            p.stroke(dust + t * (ink - dust));
            p.strokeWeight(weight);
            p.point(pt.x, pt.y);
          }

          if (!announced) {
            announced = true;
            onReadyRef.current?.();
          }
        };

        // Resize is debounced and rebuilds both the map and the grid: the map
        // is 1:1 with the canvas, so a stale one would map particles to the
        // wrong letters. p5's own windowResized would miss a container that
        // changes width without the window doing so (the sm: gutter step).
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
      // touch-pan-y so a vertical flick over the band still scrolls the page.
      className="absolute inset-0 touch-pan-y [&>canvas]:block"
    />
  );
}
