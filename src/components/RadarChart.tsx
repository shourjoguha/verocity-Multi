import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { FITNESS_ASPECTS, ASPECT_SCALE, type AspectKey } from '@/app.config';
import type { AspectMetrics, AspectScores } from '@/lib/types';
import type { Confidence } from '@/lib/aspects';
import { formatRound } from '@/lib/format';
import { EASE } from '@/components/anim';

export type RadarSeries = {
  label: string;
  scores: AspectScores;
  variant: 'primary' | 'baseline';
  /** Raw measurements. Carry axes that have no baseline to be scored against. */
  metrics?: AspectMetrics;
  /** Per-axis confidence; only read for the primary series. */
  confidence?: Partial<Record<AspectKey, Confidence>>;
};

// Hand-rolled SVG radar (no chart dep, monochrome — consistent with the Stats
// Sparkline). Axes come from FITNESS_ASPECTS; up to two series overlay so the
// latest reading can be read against an earlier one.
//
// "Ghost" treatment: the comparison series is a soft filled AREA and the
// current one an OUTLINE over it, so "the line leaves the grey" reads as a gain
// without a legend. Rings are circles and only the middle one — "typical for
// you" — carries weight. The chart shows axis NAMES only; a score appears in a
// popup on hover (pointer: fine) or tap (touch), because six numbers at 9px
// around the shape were the clutter this replaced.
const SIZE = 260;
const C = SIZE / 2;
const R = C - 40; // leave room for axis labels
const RINGS = [0.25, 0.75, 1];

// Raw metrics span kilograms, minutes per week and a 0–1 index, so the precision
// that reads well differs per axis.
function formatMetric(value: number, unit: string): string {
  const digits = unit === 'index' ? 2 : unit === 'kg' ? 0 : 1;
  return unit === 'index' ? formatRound(value, digits) : `${formatRound(value, digits)} ${unit}`;
}

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
  const baseline = series.find((s) => s.variant === 'baseline');

  // An axis is only scored when there is enough of the user's own history to be
  // relative to. Below that it still has a real measurement, which the popup
  // reports in its own units rather than as an invented position on 1–10.
  const isScored = (s: RadarSeries, key: AspectKey) => s.scores[key] != null;
  const measured = (s: RadarSeries) =>
    axes.filter((a) => s.metrics?.[a.key as AspectKey] != null || isScored(s, a.key as AspectKey));
  // A polygon over a partly-scored series would be a shape built from a mix of
  // ratings and zeros, which is the kind of quiet lie this chart is trying to
  // stop telling. Mixed states get vertex dots and no outline.
  const fullyScored = (s: RadarSeries) =>
    measured(s).length > 0 && measured(s).every((a) => isScored(s, a.key as AspectKey));

  const isLow = (key: AspectKey) => primary?.confidence?.[key] === 'low';
  const hasUnscored = primary
    ? measured(primary).some((a) => !isScored(primary, a.key as AspectKey))
    : false;
  const anyScored = primary ? measured(primary).some((a) => isScored(primary, a.key as AspectKey)) : false;

  // Which axis's popup is open. `pinned` is a tap/click (stays until tapped
  // away); hover only ever shows, on a fine pointer, and leaves a pin alone.
  const [open, setOpen] = useState<number | null>(null);
  const pinned = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open == null) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        pinned.current = false;
        setOpen(null);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pinned.current = false;
        setOpen(null);
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const popup = (() => {
    if (open == null || !primary) return null;
    const a = axes[open];
    const key = a.key as AspectKey;
    const score = primary.scores[key];
    const metric = primary.metrics?.[key];
    if (score == null && metric == null) return null;
    const was = baseline?.scores[key];
    const delta = score != null && was != null ? Math.round((score - was) * 10) / 10 : null;
    const [x, y] = score != null ? at(open, ratioOf(primary.scores, key)) : at(open, 1);
    return {
      label: a.label,
      value: score != null ? formatRound(score, 1) : formatMetric(metric as number, a.unit),
      delta,
      note: score == null ? 'Not enough history to score yet' : isLow(key) ? 'Thin baseline' : null,
      left: `${(x / SIZE) * 100}%`,
      top: `${(y / SIZE) * 100}%`,
    };
  })();

  return (
    <div className="flex flex-col items-center">
      <div ref={box} className="relative w-full max-w-[300px]">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block w-full" role="img" aria-label="Fitness profile radar">
          {RINGS.map((ring) => (
            <circle
              key={ring}
              cx={C}
              cy={C}
              r={R * ring}
              fill="none"
              stroke="var(--color-fg)"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
          ))}
          {/* the middle ring is the median of your own history */}
          <circle
            cx={C}
            cy={C}
            r={R * 0.5}
            fill="none"
            stroke="var(--color-fg)"
            strokeOpacity={0.28}
            strokeWidth={1}
            strokeDasharray="1 3"
            strokeLinecap="round"
          />
          {axes.map((a, i) => {
            const key = a.key as AspectKey;
            const [ex, ey] = at(i, 1);
            const [lx, ly] = at(i, 1.2);
            const unscored = primary ? !isScored(primary, key) : true;
            return (
              <g key={a.key}>
                <line
                  x1={C}
                  y1={C}
                  x2={ex}
                  y2={ey}
                  stroke="var(--color-fg)"
                  strokeOpacity={0.08}
                  strokeWidth={1}
                  strokeDasharray={isLow(key) || unscored ? '2 3' : undefined}
                />
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={open === i ? 'fill-fg' : 'fill-muted'}
                  style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.12em' }}
                >
                  {a.label}
                </text>
              </g>
            );
          })}
          {/* series — bloom out from the centre on mount, then rest fully
              visible. Uses animate (not whileInView) so it can never get stuck
              hidden if the observer doesn't fire; reduced-motion renders it in
              place. */}
          <motion.g
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={reduce ? undefined : { scale: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease: EASE }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            {baseline && fullyScored(baseline) ? (
              <polygon points={polygon(baseline.scores)} fill="var(--color-fg)" fillOpacity={0.13} stroke="none" />
            ) : null}
            {primary && fullyScored(primary) ? (
              <polygon
                points={polygon(primary.scores)}
                fill="none"
                stroke="var(--color-fg)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ) : null}
            {/* vertex markers carry the confidence: filled = scored against a
                settled baseline, hollow = scored against a thin one */}
            {primary
              ? axes.map((a, i) => {
                  const key = a.key as AspectKey;
                  if (primary.scores[key] == null) return null;
                  const [x, y] = at(i, ratioOf(primary.scores, key));
                  return (
                    <circle
                      key={a.key}
                      cx={x}
                      cy={y}
                      r={open === i ? 4 : 3}
                      fill={isLow(key) ? 'var(--color-surface)' : 'var(--color-fg)'}
                      stroke="var(--color-fg)"
                      strokeWidth={1.4}
                    />
                  );
                })
              : null}
          </motion.g>
          {/* Hit areas, last so they sit on top: a circle on the point plus the
              label's box. r=20 in a 260 viewBox drawn at ~300px is ~46px, so
              the point alone clears TOUCH.minTargetPx. */}
          {primary
            ? axes.map((a, i) => {
                const key = a.key as AspectKey;
                if (primary.scores[key] == null && primary.metrics?.[key] == null) return null;
                const [x, y] =
                  primary.scores[key] != null ? at(i, ratioOf(primary.scores, key)) : at(i, 1);
                const [lx, ly] = at(i, 1.2);
                return (
                  <g
                    key={a.key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${a.label} details`}
                    aria-pressed={open === i}
                    className="cursor-pointer outline-none"
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'mouse' && !pinned.current) setOpen(i);
                    }}
                    onPointerLeave={(e) => {
                      if (e.pointerType === 'mouse' && !pinned.current) setOpen(null);
                    }}
                    onClick={() => {
                      if (pinned.current && open === i) {
                        pinned.current = false;
                        setOpen(null);
                      } else {
                        pinned.current = true;
                        setOpen(i);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pinned.current = open !== i;
                        setOpen(open === i ? null : i);
                      }
                    }}
                    onFocus={() => setOpen(i)}
                    onBlur={() => {
                      pinned.current = false;
                      setOpen(null);
                    }}
                  >
                    <circle cx={x} cy={y} r={20} fill="transparent" />
                    <rect x={lx - 38} y={ly - 14} width={76} height={28} fill="transparent" />
                  </g>
                );
              })
            : null}
        </svg>
        {popup ? (
          <div
            role="status"
            className="pointer-events-none absolute z-10 grid gap-0.5 whitespace-nowrap rounded-control bg-fg px-2 py-1.5 text-surface"
            style={{ left: popup.left, top: popup.top, transform: 'translate(-50%, calc(-100% - 10px))' }}
          >
            <span className="t-label opacity-70">{popup.label}</span>
            <span className="font-display text-base leading-tight tabular-nums">
              {popup.value}
              {popup.delta != null ? (
                <span className="ml-1.5 font-sans text-xs font-bold">
                  {popup.delta > 0 ? '↑' : popup.delta < 0 ? '↓' : '—'}{' '}
                  {popup.delta === 0 ? '' : Math.abs(popup.delta)}
                </span>
              ) : null}
            </span>
            {popup.note ? <span className="text-[0.65rem] opacity-70">{popup.note}</span> : null}
          </div>
        ) : null}
      </div>
      {/* Only the states that would otherwise mislead get a caption; the
          standard reading of the chart lives in the (!) sheet. */}
      {!anyScored || hasUnscored ? (
        <p className="mb-2 text-center text-[0.65rem] leading-relaxed text-subtle">
          {!anyScored
            ? 'Showing raw measurements — tap a point. Scores appear once there is enough of your own history to compare against.'
            : 'Axes on a dashed spoke are not scored yet; tap one for its raw measurement.'}
        </p>
      ) : null}
    </div>
  );
}
