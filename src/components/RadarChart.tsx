import { motion, useReducedMotion } from 'motion/react';
import { FITNESS_ASPECTS, ASPECT_SCALE, type AspectKey } from '@/app.config';
import type { AspectScores } from '@/lib/types';
import type { Confidence } from '@/lib/aspects';
import { EASE } from '@/components/anim';

export type RadarSeries = {
  label: string;
  scores: AspectScores;
  variant: 'primary' | 'baseline';
  /** Per-axis confidence; only read for the primary series. */
  confidence?: Partial<Record<AspectKey, Confidence>>;
};

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
  const ratioOf = (scores: AspectScores, key: AspectKey) =>
    (scores[key] ?? 0) / ASPECT_SCALE.max;
  const polygon = (scores: AspectScores) =>
    axes
      .map((a, i) => {
        const [x, y] = at(i, ratioOf(scores, a.key as AspectKey));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const primary = series.find((s) => s.variant === 'primary');
  // An axis scored from too little history is a guess against a fixed anchor,
  // not a measurement. It gets a hollow vertex and a dotted spoke so it cannot
  // be read with the same authority as the rest of the shape.
  const isLow = (key: AspectKey) => primary?.confidence?.[key] === 'low';
  const hasLow = axes.some((a) => isLow(a.key as AspectKey));

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
          const low = isLow(a.key as AspectKey);
          return (
            <g key={a.key}>
              <line
                x1={C}
                y1={C}
                x2={ex}
                y2={ey}
                stroke="var(--color-fg)"
                strokeOpacity={0.12}
                strokeWidth={1}
                strokeDasharray={low ? '2 3' : undefined}
              />
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
              {primary?.scores[a.key as AspectKey] != null ? (
                <text
                  x={lx}
                  y={ly + 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-fg tabular-nums"
                  style={{ fontSize: 9 }}
                >
                  {primary.scores[a.key as AspectKey]}
                </text>
              ) : null}
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
          {/* vertex markers carry the confidence: filled = scored against your
              own history, hollow = still on the cold-start anchor */}
          {primary
            ? axes.map((a, i) => {
                const key = a.key as AspectKey;
                if (primary.scores[key] == null) return null;
                const [x, y] = at(i, ratioOf(primary.scores, key));
                const low = isLow(key);
                return (
                  <circle
                    key={a.key}
                    cx={x}
                    cy={y}
                    r={2.5}
                    fill={low ? 'var(--color-surface)' : 'var(--color-fg)'}
                    stroke="var(--color-fg)"
                    strokeWidth={1.2}
                  />
                );
              })
            : null}
        </motion.g>
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-4 t-control text-muted">
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
      {/* What a ring means. Numbering the rings themselves collided with the
          per-axis values on the vertical spoke, and the vertex numbers already
          say where each axis sits — so the scale is stated once, in words. */}
      <p className="mt-2 text-center text-[0.65rem] leading-relaxed text-subtle">
        Each axis is scored {ASPECT_SCALE.min}–{ASPECT_SCALE.max} against your own history — the
        middle ring is typical for you.
        {hasLow
          ? ' Hollow points are estimated against typical values until you have logged more months.'
          : ''}
      </p>
    </div>
  );
}
