import { motion, MotionConfig, type Variants } from 'motion/react';
import { EchoText } from '@/components/EchoText';
import { EASE } from '@/components/anim';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
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

export default function Landing() {
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
            variants={fadeUp}
            className="mb-7 text-xs uppercase tracking-[0.45em] text-subtle"
          >
            Strength · Training · Log
          </motion.p>
          <motion.div variants={fadeUp}>
            <EchoText
              text="VEROCITY"
              as="h1"
              className="whitespace-nowrap font-display text-[13vw] font-bold leading-[0.9] tracking-[-0.05em] text-fg md:text-[10rem]"
            />
          </motion.div>
          <motion.p
            variants={fadeUp}
            className="mt-8 max-w-xl text-balance text-base text-subtle md:text-lg"
          >
            A faster, multi-profile training logger. Private by default, with a read-only public
            showcase. Built on Astro islands and Supabase.
          </motion.p>
          <motion.div
            variants={fadeUp}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <a
              href="/app"
              className="inline-flex h-12 items-center rounded-full bg-fg px-7 text-sm uppercase tracking-wider text-bg transition-transform duration-200 hover:scale-[1.03]"
            >
              Open app
            </a>
            <a
              href="/showcase"
              className="inline-flex h-12 items-center rounded-full border border-fg px-7 text-sm uppercase tracking-wider text-fg transition-colors duration-200 hover:bg-fg hover:text-bg"
            >
              View showcase
            </a>
          </motion.div>
        </motion.section>

        {/* Philosophy / narrative — scroll-revealed via Motion */}
        <section className="mx-auto max-w-5xl px-6 pb-32">
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
