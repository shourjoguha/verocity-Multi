import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatDate, formatDuration } from '@/lib/format';
import { DAY_BANDS, monotone, type DayBand, type DaySummary } from '@/lib/dayLog';

// The selected month's lifting as one smoothed stacked area: x is the day of
// the month, height is completed sets, split into four bands. Sessions with no
// sets (sport, runs, recovery) sit as tag-coloured dots on a rail under it, so
// they are on the chart without a faked set count.
//
// Honest about one thing it invents: the curve between two sessions is drawn
// across the days in between. The dots on the top edge are the real days.
//
// No legend on the plot: one quiet key row under the dates, and a readout line
// above that names the selected day (tap or arrow keys to move it).

const H = 172;
const PAD = 4;
const TOP = 10;
const BASE = 112;
const RAIL = 124;
const AXIS = 144;
const KEY = 166;
const SAMPLES = 160;
const LABEL_PX = 10;

const BAND: Record<DayBand, { label: string; fill: string }> = {
  warmcool: { label: 'Warm/Cool', fill: 'var(--color-faint)' },
  main: { label: 'Main', fill: 'var(--color-fg)' },
  accessory: { label: 'Acc', fill: 'var(--color-muted)' },
  conditioning: { label: 'Cond', fill: 'url(#month-area-hatch)' },
};

const bandTotal = (d: DaySummary) => DAY_BANDS.reduce((a, k) => a + d.bands[k], 0);

function useWidth<T extends Element>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function MonthArea({ days, month }: { days: DaySummary[]; month: Date }) {
  const [ref, W] = useWidth<HTMLDivElement>(343);
  const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const dayNum = (d: DaySummary) => Number(d.date.slice(8, 10));
  const X = (d: number) => PAD + ((d - 0.5) / daysInMonth) * (W - 2 * PAD);

  const ordered = useMemo(() => [...days].sort((a, b) => a.date.localeCompare(b.date)), [days]);
  const lifts = ordered.filter((d) => bandTotal(d) > 0);
  const timeOnly = ordered.filter((d) => bandTotal(d) === 0);

  const [selected, setSelected] = useState<string | null>(null);
  const sel = ordered.find((d) => d.date === selected) ?? ordered[ordered.length - 1];

  // Cheap (4 bands × 160 samples), so it is simply recomputed per render.
  const geometry = (() => {
    if (lifts.length === 0) return null;
    // The area starts and ends at the first and last session, square-edged.
    // A lone session gets zeros half a day either side, so it is a hill
    // rather than a line one pixel wide.
    const lone = lifts.length === 1;
    const xs = lone
      ? [dayNum(lifts[0]) - 0.5, dayNum(lifts[0]), dayNum(lifts[0]) + 0.5]
      : lifts.map(dayNum);
    const peak = Math.max(...lifts.map(bandTotal));
    const scale = (v: number) => (v / peak) * (BASE - TOP);
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const samples = Array.from({ length: SAMPLES + 1 }, (_, j) => x0 + ((x1 - x0) * j) / SAMPLES);
    let base = samples.map(() => 0);
    const paths = DAY_BANDS.map((k) => {
      // Smooth each band's THICKNESS, then stack: bands can never cross.
      const f = monotone(xs, lone ? [0, lifts[0].bands[k], 0] : lifts.map((d) => d.bands[k]));
      const top = base.map((b, j) => b + Math.max(0, f(samples[j])));
      const up = samples.map((x, j) => `${X(x).toFixed(1)},${(BASE - scale(top[j])).toFixed(1)}`);
      const down = samples.map((x, j) => `${X(x).toFixed(1)},${(BASE - scale(base[j])).toFixed(1)}`).reverse();
      base = top;
      return { k, d: `M${up.join('L')}L${down.join('L')}Z` };
    });
    const nodes = lifts.map((d) => ({ x: X(dayNum(d)), y: BASE - scale(bandTotal(d)), date: d.date }));
    return { paths, nodes };
  })();

  if (ordered.length === 0) return null;

  const mondays: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), d)).getUTCDay() === 1) mondays.push(d);
  }

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    const pool = py > BASE + 4 && timeOnly.length ? timeOnly : lifts.length ? lifts : timeOnly;
    let best = pool[0];
    for (const d of pool) if (Math.abs(X(dayNum(d)) - px) < Math.abs(X(dayNum(best)) - px)) best = d;
    setSelected(best.date);
  };

  const step = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = ordered.indexOf(sel);
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
    setSelected(next.date);
  };

  // Key row, laid out right-to-left from an estimated label width.
  let kx = W - PAD;
  const key = lifts.length
    ? [...DAY_BANDS].reverse().map((k) => {
        kx -= BAND[k].label.length * LABEL_PX * 0.56;
        const tx = kx;
        kx -= 12;
        const rx = kx;
        kx -= 10;
        return { k, tx, rx };
      })
    : [];

  return (
    <div ref={ref} className="mb-3">
      <div className="mb-1.5 flex min-h-5 items-baseline gap-2 text-[0.8rem] tabular-nums" aria-live="polite">
        <span className="font-semibold text-fg">{formatDate(sel.date)}</span>
        <span className="min-w-0 truncate text-subtle">{sel.label}</span>
        <span className="ml-auto shrink-0 text-xs text-muted">
          {sel.sets ? `${sel.sets} sets · ` : ''}
          {formatDuration(sel.seconds)}
        </span>
      </div>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block max-w-full cursor-crosshair touch-pan-y outline-none focus-visible:ring-1 focus-visible:ring-teal"
        role="img"
        aria-label={`Sets per day this month, by block. ${lifts.length} lifting days, ${timeOnly.length} time-only days. Arrow keys move the readout.`}
        tabIndex={0}
        onPointerUp={pick}
        onKeyDown={step}
      >
        <defs>
          <pattern id="month-area-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--color-surface)" />
            <rect width="1.5" height="4" fill="var(--color-fg)" />
          </pattern>
        </defs>
        {mondays.map((d) => (
          <g key={d}>
            <line x1={X(d)} x2={X(d)} y1={TOP} y2={RAIL + 6} stroke="var(--color-border-soft)" />
            <text x={X(d)} y={AXIS} textAnchor="middle" fontSize={LABEL_PX} fill="var(--color-muted)">
              {d}
            </text>
          </g>
        ))}
        <line x1={PAD} x2={W - PAD} y1={BASE} y2={BASE} stroke="var(--color-border)" />
        {geometry?.paths.map((p) => <path key={p.k} d={p.d} fill={BAND[p.k].fill} />)}
        {geometry?.nodes.map((n) => <circle key={n.date} cx={n.x} cy={n.y} r={1.8} fill="var(--color-fg)" />)}
        {timeOnly.flatMap((d) =>
          d.colors.map((c, i) => (
            <circle key={`${d.date}-${i}`} cx={X(dayNum(d)) + i * 7} cy={RAIL} r={3.2} fill={c} />
          )),
        )}
        <line
          x1={X(dayNum(sel))}
          x2={X(dayNum(sel))}
          y1={TOP - 6}
          y2={RAIL + 6}
          stroke="var(--color-fg)"
          strokeDasharray="2 2"
        />
        <line x1={PAD} x2={W - PAD} y1={KEY - 15} y2={KEY - 15} stroke="var(--color-border-soft)" />
        {key.map(({ k, tx, rx }) => (
          <g key={k}>
            <rect x={rx} y={KEY - 8} width={8} height={8} rx={1} fill={BAND[k].fill} stroke="var(--color-border)" />
            <text x={tx} y={KEY} fontSize={LABEL_PX} fill="var(--color-muted)">
              {BAND[k].label}
            </text>
          </g>
        ))}
        {timeOnly.length ? (
          <g>
            <circle cx={PAD + 3} cy={KEY - 4} r={3} fill="var(--color-muted)" />
            <text x={PAD + 10} y={KEY} fontSize={LABEL_PX} fill="var(--color-muted)">
              Time only
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
