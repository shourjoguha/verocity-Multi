import { motion, useReducedMotion } from 'motion/react';
import { FITNESS_ASPECTS, ASPECT_SCALE, type AspectKey } from '@/app.config';
import type { AspectScores } from '@/lib/types';
import { EASE } from '@/components/anim';

export type RadarSeries = { label: string; scores: AspectScores; variant: 'primary' | 'baseline' };

// Hand-rolled SVG radar (no chart dep, monochrome — consistent with the Stats
// Sparkline). Axes come from FITNESS_ASPECTS; up to two series overlay so the
// latest snapshot can be read against an earlier baseline.
const SIZE = 260;
const C = SIZE / 2;
const R = C - 46; // leave room for axis labels
const RINGS = [0.25, 0.5, 0.75, 1];

export function RadarChart({ series }: { series: RadarSeries[] }) {
  const reduce = useReducedMotion();
  const axes = FITNESS_ASPECTS;
  const n = axes.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const at = (i: number, ratio: number): [number, number] => [
    C + R * ratio * Math.cos(angle(i)),
    C + R * ratio * Math.sin(angle(i)),
  ];
  const polygon = (scores: AspectScores) =>
    axes
      .map((a, i) => {
        const v = scores[a.key as AspectKey] ?? 0;
        const [x, y] = at(i, v / ASPECT_SCALE.max);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[300px]" role="img" aria-label="Fitness profile radar">
        {/* grid rings */}
        {RINGS.map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => at(i, ring).join(',')).join(' ')}
            fill="none"
            stroke="var(--color-fg)"
            strokeOpacity={0.12}
            strokeWidth={1}
          />
        ))}
        {/* spokes + labels */}
        {axes.map((a, i) => {
          const [ex, ey] = at(i, 1);
          const [lx, ly] = at(i, 1.18);
          return (
            <g key={a.key}>
              <line x1={C} y1={C} x2={ex} y2={ey} stroke="var(--color-fg)" strokeOpacity={0.12} strokeWidth={1} />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted"
                style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}
              >
                {a.label}
              </text>
            </g>
          );
        })}
        {/* series polygons (baseline first so primary sits on top) — bloom out
            from the centre on mount, then rest fully visible. Uses animate (not
            whileInView) so it can never get stuck hidden if the observer doesn't
            fire; reduced-motion renders it in place. */}
        <motion.g
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={reduce ? undefined : { scale: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: EASE }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          {[...series]
            .sort((a) => (a.variant === 'baseline' ? -1 : 1))
            .map((s) =>
              s.variant === 'baseline' ? (
              <polygon
                key={s.label}
                points={polygon(s.scores)}
                fill="none"
                stroke="var(--color-fg)"
                strokeOpacity={0.4}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : (
              <polygon
                key={s.label}
                points={polygon(s.scores)}
                fill="var(--color-fg)"
                fillOpacity={0.08}
                stroke="var(--color-fg)"
                strokeWidth={1.5}
              />
            ),
            )}
        </motion.g>
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-[0.65rem] uppercase tracking-wider text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-4"
              style={
                s.variant === 'baseline'
                  ? { borderTop: '1px dashed var(--color-fg)', opacity: 0.5 }
                  : { background: 'var(--color-fg)' }
              }
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
