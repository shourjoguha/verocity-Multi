import type { CSSProperties, ElementType } from 'react';

// Typographic Echo Stack (design spec §"Special Components"). Renders the same
// word N times: 4 background layers shifted up-left by -0.04em increments and
// fading from #bfbfbf → #d9d9d9, with the foreground (#111) on top. Background
// layers are aria-hidden + pointer-events:none. Pure CSS animation (see
// global.css .echo) — renders to static HTML in Astro with no client directive.

const LAYERS = [
  { dx: '-0.04em', color: 'var(--color-echo-1)' },
  { dx: '-0.08em', color: 'var(--color-echo-2)' },
  { dx: '-0.12em', color: 'var(--color-echo-3)' },
  { dx: '-0.16em', color: 'var(--color-echo-4)' },
] as const;

type EchoTextProps = {
  text: string;
  as?: ElementType;
  className?: string;
  animate?: boolean;
  layers?: number;
};

export function EchoText({ text, as, className = '', animate = false, layers = 4 }: EchoTextProps) {
  const Tag = (as ?? 'span') as ElementType;
  const used = LAYERS.slice(0, Math.max(0, Math.min(layers, LAYERS.length)));
  return (
    <Tag className={`echo ${className}`} data-animate={animate ? 'true' : undefined}>
      {used.map((l) => (
        <span
          key={l.dx}
          aria-hidden="true"
          className="echo-layer"
          style={{ '--echo-dx': l.dx, color: l.color } as CSSProperties}
        >
          {text}
        </span>
      ))}
      <span className="echo-top">{text}</span>
    </Tag>
  );
}

export default EchoText;
