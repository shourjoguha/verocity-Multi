import { createElement, type CSSProperties, type ElementType } from 'react';

// Typographic Echo Stack (design spec §"Special Components"). Renders the same
// word N times: 4 background layers shifted up-left by -0.04em increments and
// fading from #bfbfbf → #d9d9d9, with the foreground (#111) on top. Background
// layers are aria-hidden + pointer-events:none. Pure CSS animation (see
// global.css .echo) — renders to static HTML in Astro with no client directive.

// Each layer recedes by an additional -8px on Z. Combined with the parent's
// perspective(800px), this gives the stack real depth — not just the 2D
// shadow-offset look of the original version.
const LAYERS = [
  { dx: '-0.04em', tz: '-8px', color: 'var(--color-echo-1)' },
  { dx: '-0.08em', tz: '-16px', color: 'var(--color-echo-2)' },
  { dx: '-0.12em', tz: '-24px', color: 'var(--color-echo-3)' },
  { dx: '-0.16em', tz: '-32px', color: 'var(--color-echo-4)' },
] as const;

// The two title tiers, so the class string stops being copy-pasted per screen.
//
// HERO is the full responsive ramp, and stays on the surfaces where the
// wordmark IS the content: /login, /signup, /reset-password, Landing,
// onboarding.
//
// APP_TITLE is one size, no ramp. Inside /app the header and the tab bar
// already say where you are, so a title that ramps to text-7xl was spending
// ~120px of a 375px screen restating it — and competing with the content
// headline (the Takeaway on Stats, the session name on Home) that the design
// wants carrying the display weight. No `font-bold`: Archivo Black is a single
// weight and the utility would only ask for a synthesised one (see the
// .font-display rule in global.css).
export const ECHO_HERO =
  'font-display text-3xl uppercase leading-[0.9] tracking-[-0.04em] text-fg sm:text-5xl md:text-7xl';
export const ECHO_APP_TITLE =
  'font-display text-2xl uppercase leading-[0.95] tracking-[-0.03em] text-fg';

type EchoTextProps = {
  text: string;
  as?: ElementType;
  className?: string;
  animate?: boolean;
  layers?: number;
};

export function EchoText({ text, as, className = '', animate = false, layers = 4 }: EchoTextProps) {
  const Tag: ElementType = as ?? 'span';
  const used = LAYERS.slice(0, Math.max(0, Math.min(layers, LAYERS.length)));
  return createElement(
    Tag,
    { className: `echo ${className}`, 'data-animate': animate ? 'true' : undefined },
    ...used.map((l) =>
      createElement(
        'span',
        {
          key: l.dx,
          'aria-hidden': 'true',
          className: 'echo-layer',
          style: { '--echo-dx': l.dx, '--echo-tz': l.tz, color: l.color } as CSSProperties,
        },
        text,
      ),
    ),
    createElement('span', { key: 'top', className: 'echo-top' }, text),
  );
}

export default EchoText;
