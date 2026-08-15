import { motion, MotionConfig, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { EchoText } from '@/components/EchoText';
import { EASE } from '@/components/anim';
import ForceField from '@/components/ForceField';
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

// The wordmark's own type scale, shared by the DOM heading and the particle
// field so the two are never described in two places.
const WORDMARK_CLASS =
  'whitespace-nowrap font-display text-[13vw] font-bold leading-[0.9] tracking-[-0.05em] text-fg md:text-[10rem]';
const WORDMARK_TRACKING = '-0.05em';
// Breathing room above and below the heading's own box, so dispersed particles
// have somewhere to go instead of piling against the canvas edge.
//
// The stage reserves exactly this much margin, because the plate is absolutely
// positioned: without the margin its negative insets paint straight over the
// eyebrow above and the first line of the paragraph below, which is what it did
// on the first pass.
const FIELD_BLEED = '-inset-y-10 sm:-inset-y-16';
const FIELD_RESERVE = 'my-10 sm:my-16';

// The plate is opaque because the canvas never paints its own ground and this
// page mounts the shared BackgroundLayer — a transparent field over the dots or
// the 3D preset is two textures fighting. But a hard-edged opaque rectangle
// sitting on the backdrop is its own eyesore, so the plate dissolves at top and
// bottom instead of ending on a cut. Same device as the activity strip's edge
// fade in ProfileView.
const plateFade: CSSProperties = {
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 18%, #000 82%, transparent 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0, #000 18%, #000 82%, transparent 100%)',
};

// The heading and the particle word have to coincide exactly — the two
// crossfade in the same place, and any difference in size, tracking or position
// reads as a pop at the swap. Position comes from wrapping the heading (the
// word is drawn at the canvas centre, so the canvas IS the alignment). Tracking
// is a constant above. Size has to be measured: `13vw` changes with the
// viewport, so this reports the heading's live computed font-size.
function useMeasuredFontSize(ref: RefObject<HTMLElement | null>): number | undefined {
  const [size, setSize] = useState<number | undefined>(undefined);
  useEffect(() => {
    // The type scale sits on the heading EchoText renders, not on the wrapper
    // this ref is attached to — EchoText forwards no ref, and measuring the
    // wrapper would read the inherited body size.
    const el = ref.current?.querySelector('h1');
    if (!el) return;
    const read = () => setSize(parseFloat(getComputedStyle(el).fontSize) || undefined);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function Landing() {
  const wordmarkRef = useRef<HTMLDivElement | null>(null);
  const fontSize = useMeasuredFontSize(wordmarkRef);
  // Flipped by the field's first painted frame, not by p5 resolving.
  const [fieldLive, setFieldLive] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <main id="main">
        {/* Hero: typographic Echo Stack, entrance driven by Motion */}
        <motion.section
          className="flex min-h-[86vh] flex-col items-center justify-center overflow-x-hidden px-6 text-center"
          variants={heroContainer}
          initial="hidden"
          animate="show"
        >
          <motion.p
            variants={heroItem}
            className="mb-7 text-xs uppercase tracking-[0.45em] text-subtle"
          >
            Strength · Training · Log
          </motion.p>
          {/* The wordmark stage. `relative` so the canvas wraps the heading —
              that IS the alignment between the type and the particle word, and
              it is why nothing has to measure the heading against the section.
              The margin reserves the space the plate bleeds into. */}
          <motion.div
            variants={heroItem}
            ref={wordmarkRef}
            className={`relative w-full ${FIELD_RESERVE}`}
          >
            <div
              className={`absolute ${FIELD_BLEED} inset-x-0 overflow-hidden bg-bg`}
              style={plateFade}
            >
              <ForceField
                word="VEROCITY"
                fontSize={fontSize}
                letterSpacing={WORDMARK_TRACKING}
                onReady={() => setFieldLive(true)}
              />
            </div>
            {/* Always in the DOM — it is the page's heading, it is what a
                reduced-motion visitor sees, and it is what everyone else sees
                until p5 has loaded and built its map. It crossfades out rather
                than being pulled from the layout, so the stage never resizes.
                Opacity, not `hidden`: it stays in the accessibility tree. */}
            <EchoText
              text="VEROCITY"
              as="h1"
              className={`relative ${WORDMARK_CLASS} transition-opacity duration-500 ${
                fieldLive ? 'opacity-0' : ''
              }`}
            />
          </motion.div>
          <motion.p
            variants={heroItem}
            className="mt-8 max-w-xl text-balance text-base text-subtle md:text-lg"
          >
            A faster, multi-profile training logger. Private by default, with a read-only public
            showcase. Built on Astro islands and Supabase.
          </motion.p>
          <motion.div
            variants={heroItem}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <a
              href="/login"
              className="inline-flex h-12 items-center rounded-full border border-fg px-7 text-sm uppercase tracking-wider text-fg transition-colors duration-200 hover:bg-fg hover:text-bg"
            >
              Log in
            </a>
            <a
              href="/showcase"
              className="inline-flex h-12 items-center rounded-full border border-fg px-7 text-sm uppercase tracking-wider text-fg transition-colors duration-200 hover:bg-fg hover:text-bg"
            >
              View showcase
            </a>
            {/* Wears its neighbours' pill treatment rather than the app's
                `.hill-btn` — this row is three equals. */}
            <ReelDialog className="inline-flex h-12 items-center rounded-full border border-fg px-7 text-sm uppercase tracking-wider text-fg transition-colors duration-200 hover:bg-fg hover:text-bg" />
          </motion.div>
          <motion.p variants={heroItem} className="mt-5 text-xs text-subtle">
            Have an invite code?{' '}
            <a href="/signup" className="text-fg underline hover:text-subtle">
              Sign up
            </a>
            .
          </motion.p>
        </motion.section>

        {/* Philosophy / narrative — scroll-revealed via Motion */}
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
