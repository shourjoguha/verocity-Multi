import { motion, MotionConfig, type Variants } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { EchoText } from '@/components/EchoText';
import { EASE } from '@/components/anim';
import ForceField from '@/components/ForceField';
import type { TextSource } from '@/components/ForceFieldCanvas';
import { ReelDialog } from '@/components/ReelDialog';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

// Above-the-fold hero: transform-only (no opacity), so the content is painted
// at first byte — no blank-until-hydration flash, visible with JS disabled, and
// reduced-motion snaps it straight into place. Below-the-fold blocks keep the
// opacity fade (they're hidden behind the scroll until revealed).
const heroItem: Variants = {
  hidden: { y: 16 },
  show: { y: 0, transition: { duration: 0.7, ease: EASE } },
};

const heroContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.08 } },
};

const features = [
  {
    title: 'Private by default',
    body: 'Every profile reads and writes only its own rows. The database — not the UI — is the security boundary.',
  },
  {
    title: 'Public showcase',
    body: 'One read-only profile, served over an anon key with select-only access. A portfolio of the work, nothing more.',
  },
  {
    title: 'Islands, not a SPA',
    body: 'Static pages with React hydrated only where you interact. Fast, light, and direct to Supabase.',
  },
];

// The hero CTAs share the eyebrow's typographic voice — text-xs, uppercase,
// tracking-[0.45em] — matching "Strength · Training · Log" above the wordmark.
// The start padding absorbs the trailing 0.45em that letter-spacing adds after
// the final glyph, so the label reads optically centred inside the pill.
const HERO_BTN =
  'inline-flex h-12 items-center rounded-full border border-fg pl-[calc(1.75rem+0.45em)] pr-7 text-xs uppercase tracking-[0.45em] text-fg transition-colors duration-200 hover:bg-fg hover:text-bg';

// The wordmark's own type scale, shared by the DOM heading and the particle
// field so the two are never described in two places.
const WORDMARK_CLASS =
  'whitespace-nowrap font-display text-[13vw] font-bold leading-[0.9] tracking-[-0.05em] text-fg md:text-[10rem]';

// Text that fades out once the field paints. Kept in the DOM either way — it
// is the page's real copy, and it is what reduced-motion, no-JS and
// pre-hydration visitors see.
function faded(base: string, live: boolean): string {
  return `${base} transition-opacity duration-500 ${live ? 'opacity-0' : ''}`;
}

/**
 * Read the layout of every text element that becomes a particle source, in
 * canvas-host coordinates. Called on layout change; the result feeds the
 * ForceField below.
 */
function measureSources(
  hostEl: HTMLElement,
  entries: { el: HTMLElement | null; letterSpacing?: string; text?: string; multiline?: boolean }[],
): TextSource[] {
  const host = hostEl.getBoundingClientRect();
  const out: TextSource[] = [];
  for (const entry of entries) {
    const el = entry.el;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    // textContent, not innerText: innerText normalises to what the layout
    // shows and can miss child whitespace and fragments. textContent is the
    // raw string and matches what should be rendered as particles.
    const raw = entry.text ?? el.textContent ?? '';
    // The DOM applies text-transform at render time; canvas text does not.
    // Fold uppercase/lowercase into the source string so the buffer matches
    // the DOM.
    const text =
      cs.textTransform === 'uppercase'
        ? raw.toUpperCase()
        : cs.textTransform === 'lowercase'
          ? raw.toLowerCase()
          : raw;
    // Read text-align off the ELEMENT rather than threading it as a prop.
    // The DOM already carries this via `text-align: center` on the section,
    // and duplicating it in JS is exactly the drift trap the CSS-first
    // approach is meant to avoid.
    const alignRaw = cs.textAlign;
    const align: 'left' | 'center' | 'right' =
      alignRaw === 'center' || alignRaw === 'right' ? alignRaw : 'left';
    // Always pass width. p5 uses it BOTH to anchor a centred/right-aligned
    // single line (see the drawSource comment) AND to wrap a paragraph. A
    // caller marks a source `multiline` to opt into wrapping; otherwise the
    // width is anchor-only and height stays undefined.
    out.push({
      text,
      x: r.left - host.left,
      y: r.top - host.top,
      width: r.width,
      height: entry.multiline ? r.height : undefined,
      fontSize: parseFloat(cs.fontSize),
      fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      letterSpacing:
        entry.letterSpacing ?? (cs.letterSpacing !== 'normal' ? cs.letterSpacing : undefined),
      textAlign: align,
    });
  }
  return out;
}

export default function Landing() {
  // The canvas host — a wrapper around the hero that the canvas fills. Every
  // measurement is relative to this so the sources land where the DOM does.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const eyebrowRef = useRef<HTMLParagraphElement | null>(null);
  const wordmarkRef = useRef<HTMLDivElement | null>(null);
  const descRef = useRef<HTMLParagraphElement | null>(null);
  const [sources, setSources] = useState<TextSource[]>([]);
  // Flipped by the field's first painted frame, not by p5 resolving. Every
  // measured text element crossfades to opacity 0 in step so the swap reads
  // as one motion.
  const [fieldLive, setFieldLive] = useState(false);

  // Re-measure on any layout shift. ResizeObserver on the stage covers viewport
  // resizes and font swaps; the observer callback runs synchronously with
  // layout so the sources always match what's on screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const remeasure = () => {
      // The wordmark ref points at the outer motion.div that contains
      // EchoText — the h1 is what actually carries the type scale, so read it
      // out here rather than depending on the outer wrapper's box.
      const h1 = wordmarkRef.current?.querySelector('h1') ?? null;
      setSources(
        measureSources(stage, [
          { el: eyebrowRef.current, textAlign: 'center' },
          {
            el: h1,
            textAlign: 'center',
            // The DOM h1 carries tracking-[-0.05em]; g.text() ignores that.
            // Pass it explicitly so the particle word matches the type's width.
            letterSpacing: '-0.05em',
            text: 'VEROCITY',
          },
          {
            el: descRef.current,
            textAlign: 'center',
            multiline: true,
          },
        ]),
      );
    };
    remeasure();
    const ro = new ResizeObserver(remeasure);
    ro.observe(stage);
    if (eyebrowRef.current) ro.observe(eyebrowRef.current);
    if (wordmarkRef.current) ro.observe(wordmarkRef.current);
    if (descRef.current) ro.observe(descRef.current);
    // Fonts landing after first render change every element's box. `fonts.ready`
    // resolves once; re-measure after it fires so the sources match the
    // rendered type rather than the fallback.
    let cancelled = false;
    document.fonts?.ready?.then(() => {
      if (!cancelled) remeasure();
    });
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main id="main">
        {/* The stage is where the canvas lives. `relative` so the canvas can
            `absolute inset-0` inside it; `overflow-hidden` so particles
            dispersed near the edges cannot leak into the page below. The hero
            covers the entire visible section: eyebrow, wordmark, description
            and the CTA row all live inside this box, and all except the CTAs
            crossfade out once the field paints.

            Below-the-fold philosophy content is deliberately NOT inside this
            stage — a single canvas that tall exceeds ~350k particles at a
            small pitch and thrashes on a phone. If that content should also
            become particles, it needs its own stage below (a second field
            instance), not one covering the whole page. */}
        <div ref={stageRef} className="relative isolate overflow-hidden">
          {/* The field. `pointer-events-auto` inherited from the browser
              default lets the cursor drive the repulsion; the overlay above
              is pointer-events-none except on the buttons. */}
          <ForceField sources={sources} onReady={() => setFieldLive(true)} />

          {/* Content overlay. `pointer-events-none` at the section level so
              the canvas beneath receives the cursor everywhere except the
              button row, which opts back in below. `relative z-10` so the
              text and CTAs paint on top of the canvas. */}
          <motion.section
            className="pointer-events-none relative z-10 flex min-h-[86vh] flex-col items-center justify-center px-6 text-center"
            variants={heroContainer}
            initial="hidden"
            animate="show"
          >
            <motion.p
              variants={heroItem}
              ref={eyebrowRef}
              className={faded('mb-7 text-xs uppercase tracking-[0.45em] text-subtle', fieldLive)}
            >
              Strength · Training · Log
            </motion.p>
            <motion.div variants={heroItem} ref={wordmarkRef} className="relative w-full">
              <EchoText
                text="VEROCITY"
                as="h1"
                className={faded(WORDMARK_CLASS, fieldLive)}
              />
            </motion.div>
            <motion.p
              variants={heroItem}
              ref={descRef}
              className={faded('mt-8 max-w-xl text-balance text-base text-subtle md:text-lg', fieldLive)}
            >
              A faster, multi-profile training logger. Private by default, with a read-only public
              showcase. Built on Astro islands and Supabase.
            </motion.p>
            {/* The two buttons stay opaque and receive the cursor. `pointer-
                events-auto` opts this row back in from the section's
                `pointer-events-none`; the buttons themselves sit above the
                field visually because their parent carries z-10. */}
            <motion.div
              variants={heroItem}
              className="pointer-events-auto mt-10 flex flex-wrap items-center justify-center gap-3"
            >
              <a href="/showcase" className={HERO_BTN}>
                View showcase
              </a>
              {/* Wears its neighbour's pill treatment rather than the app's
                  `.hill-btn` — this row is two equals. */}
              <ReelDialog className={HERO_BTN} />
            </motion.div>
          </motion.section>
        </div>

        {/* Philosophy / narrative — scroll-revealed via Motion. Deliberately
            outside the particle stage above; see the comment there for why. */}
        <section className="mx-auto max-w-5xl px-4 sm:px-6 pb-32">
          <motion.div
            className="mx-auto mb-14 h-16 w-px bg-fg/15"
            aria-hidden="true"
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.8, ease: EASE }}
            style={{ transformOrigin: 'top' }}
          />
          <motion.blockquote
            className="mx-auto max-w-3xl text-center font-display text-3xl font-semibold leading-[1.05] tracking-tight text-fg md:text-5xl"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            Log the <span className="font-serif font-normal italic">work</span>. Watch the{' '}
            <span className="font-serif font-normal italic">trend</span>.
          </motion.blockquote>

          <motion.div
            className="mt-20 grid gap-10 md:grid-cols-3 md:gap-8"
            variants={heroContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-10% 0px' }}
          >
            {features.map((f) => (
              <motion.div key={f.title} variants={fadeUp}>
                <h3 className="font-display text-xl font-semibold uppercase tracking-tight text-fg">
                  {f.title}
                </h3>
                <p className="mt-3 text-subtle">{f.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </section>
      </main>
    </MotionConfig>
  );
}
