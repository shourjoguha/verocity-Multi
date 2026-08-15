import { useState } from 'react';
import { ECHO_HERO, EchoText } from '@/components/EchoText';
import ForceField from '@/components/ForceField';
import { ShowcaseReel } from '@/components/ShowcaseReel';
import { SHOWCASE_ALIAS } from '@/lib/showcase';

// The public showcase's hero band: an interactive particle field with the
// wordmark inside it, the "Showcase" eyebrow, and the one control on the page
// that opens something (the reel).
//
// It replaces the eyebrow + EchoText pair that /showcase used to share with
// /app — this surface is the one place where the wordmark IS the content, which
// is exactly what ECHO_HERO's ramp is for.
//
// The name is SHOWCASE_ALIAS, never `profile.display_name`: /showcase is served
// to anyone with the URL.
export function ShowcaseHero() {
  // Flipped by the canvas's first painted frame, not by the module resolving.
  const [live, setLive] = useState(false);

  return (
    // `bg-bg` is not decoration: the band is transparent by construction (the
    // canvas clears rather than painting a ground, so it never hardcodes a
    // colour), and without an opaque ground the shared BackgroundLayer — which
    // on a desktop defaults to the 3D `aurora` preset — shows straight through
    // and the particle field becomes unreadable against it.
    <section className="relative -mx-4 -mt-8 mb-8 h-[clamp(220px,42vh,380px)] overflow-hidden border-b border-border bg-bg sm:-mx-6">
      <ForceField onReady={() => setLive(true)} />

      {/* Chrome. `pointer-events-none` on the column so the force field keeps
          receiving the cursor everywhere except the button itself — the whole
          band is the interaction surface, not just the gaps between words. */}
      <div className="pointer-events-none relative z-10 mx-auto flex h-full max-w-3xl flex-col justify-between px-4 py-5 sm:px-6">
        <div className="t-eyebrow text-muted">Showcase</div>
        <div className="pointer-events-auto self-start">
          <ShowcaseReel />
        </div>
      </div>

      {/* The typographic wordmark, centred on the same point the particle field
          draws its own. It is always in the DOM — it is the page's heading, and
          it is what a reduced-motion visitor sees, and what everyone else sees
          for the second or two before p5 has loaded and built its brightness
          map. Once the field paints it crossfades out rather than being pulled
          from the layout, so nothing on the band moves. Opacity, not `hidden`:
          it stays in the accessibility tree either way. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
        <EchoText
          text={SHOWCASE_ALIAS.toUpperCase()}
          as="h1"
          className={`${ECHO_HERO} transition-opacity duration-500 ${live ? 'opacity-0' : ''}`}
        />
      </div>
    </section>
  );
}

export default ShowcaseHero;
