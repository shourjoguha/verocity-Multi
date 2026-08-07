import type { CSSProperties, ReactNode } from 'react';
import { AnimatedNumber } from '@/components/anim';

// Shared primitives. Tokens only (classes map to --color-* tokens); dynamic
// accent colors (activity tags / training blocks) come from app.config via
// inline style. Micro-interactions are CSS; orchestrated motion lives in the
// screens via Motion (see components/anim.tsx).
//
// Flat hairline identity: separation is a 1px border and a surface-tone step,
// never a cast shadow. `.lift` / `.hill-btn` still carry the radius and the
// state transitions — see their definitions in global.css.

export function Card({
  children,
  className = '',
  interactive = false,
  flat = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  flat?: boolean;
}) {
  const depth = flat ? '' : `lift${interactive ? ' lift-interactive' : ''}`;
  return (
    <div className={`border border-border bg-surface p-4 ${depth} ${className}`}>{children}</div>
  );
}

// The section header is a quiet caps micro-label, not a display heading — the
// content below it should carry the weight. `action` is the optional trailing
// affordance the design puts on nearly every section ("All →", "Full map", a
// date range); it is a slot rather than a prop-per-shape so callers can pass a
// link, a button or plain text.
export function SectionHeader({
  children,
  action,
  className = '',
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex items-baseline justify-between gap-2 ${className}`}>
      <h2 className="t-label text-muted">{children}</h2>
      {action}
    </div>
  );
}

// A bordered N-up row of label/value cells divided by INNER hairlines. The
// outer border is --color-border, the dividers --color-border-soft: that
// distinction is what stops a strip of numbers reading as a grid of separate
// cards. Cells stay flat by design — a shadow here would muddy the hairlines.
export function StatStrip({
  stats,
  className = '',
}: {
  stats: { label: string; value: string | number; unit?: string }[];
  className?: string;
}) {
  return (
    <div
      className={`grid overflow-hidden rounded-card border border-border bg-surface ${className}`}
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={`px-3 py-2.5 ${i === 0 ? '' : 'border-l border-border-soft'}`}
        >
          <div className="t-label text-muted">{s.label}</div>
          {/* min-w-0 + the grid's minmax(0,1fr) above: without both, a long
              value forces the column wider than its share and the strip
              overflows at 375px instead of truncating. */}
          <div className="mt-1 min-w-0 font-display text-lg leading-[1.1] tabular-nums tracking-[-0.02em] text-fg">
            {typeof s.value === 'number' ? <AnimatedNumber value={s.value} /> : s.value}
            {s.unit ? <span className="ml-1 text-xs font-medium text-muted">{s.unit}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// One bordered card whose children are hairline-divided rows. The single most
// repeated pattern in the reference design (recent sessions, settings rows,
// region lists, quick links), and previously rebuilt per screen. Rows are
// separated with a CSS sibling selector rather than a JS-inserted <Divider>, so
// a caller can conditionally render rows without the separators going wrong.
export function ListCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-card border border-border bg-surface [&>*+*]:border-t [&>*+*]:border-border-soft ${className}`}
    >
      {children}
    </div>
  );
}

// Signed change indicator. The arrow glyph and the sign both carry the meaning
// on their own — the colour is reinforcement, so this stays legible without
// colour vision. `0` renders as an em dash rather than "+0", which reads as a
// measurement rather than a non-event.
export function Delta({ value, className = '' }: { value: number; className?: string }) {
  const tone = value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-faint';
  const glyph = value > 0 ? '↑' : value < 0 ? '↓' : '—';
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${tone} ${className}`}>
      <span aria-hidden="true">{glyph}</span>
      <span className="text-xs font-bold">{value === 0 ? '' : Math.abs(value)}</span>
      <span className="sr-only">
        {value > 0 ? `up ${value}` : value < 0 ? `down ${Math.abs(value)}` : 'unchanged'}
      </span>
    </span>
  );
}

// A 1..max block meter — the readable replacement for a bare number, and the
// unit the Stats scorecard is built from. `prev` renders as a dimmer tier in
// place, so "where you were" needs no second chart.
export function SegmentMeter({
  value,
  prev,
  max = 10,
  label,
}: {
  value: number;
  prev?: number;
  max?: number;
  label?: string;
}) {
  return (
    <div
      className="flex gap-[3px]"
      role="img"
      aria-label={
        label
          ? `${label}: ${value} of ${max}${prev === undefined ? '' : `, previously ${prev}`}`
          : `${value} of ${max}`
      }
    >
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-[1px] ${
            i < value ? 'bg-fg' : prev !== undefined && i < prev ? 'bg-muted' : 'bg-elevated'
          }`}
        />
      ))}
    </div>
  );
}

// Proportional segments + legend. Replaces a column of separate percentage
// meters with one bar, which is the comparison the numbers were there to make.
// Colours are passed in (they come from app.config's domain palette), never
// chosen here.
export function StackedBar({
  segments,
  legend = true,
  className = '',
}: {
  segments: { name: string; pct: number; color: string }[];
  legend?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        className="flex h-2.5 gap-[2px] overflow-hidden rounded-[2px]"
        role="img"
        aria-label={segments.map((s) => `${s.name} ${s.pct}%`).join(', ')}
      >
        {segments.map((s) => (
          <div
            key={s.name}
            className="min-w-[3px]"
            style={{ width: `${s.pct}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      {legend ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {segments.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-[1px]"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-xs text-muted">
                {s.name} <span className="font-semibold text-fg">{s.pct}%</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  // px-2 on phones is not stinginess — it is the 8px that lets a 2-digit-hour
  // duration ("13h 28m") stay on one line in a 375px 3-up column.
  // Restored to px-4 at sm:, where the column is ~171px+ and nothing competes.
  return (
    <div className="rounded-card border border-border bg-surface px-2 py-3 sm:px-4">
      <div className="t-label text-muted">{label}</div>
      {/* Sized to fit on ONE line, which is the whole point: in a 3-up grid at
          375px each value gets 87.7px, and a duration like "3h 52m" needed
          120px at text-3xl and 96px at text-2xl — so it always wrapped to a
          second line and the tile cost 125px. The sm: step back up is not
          decoration: nothing constrains the width above 640px.
          leading-[1.1] rather than leading-none because the unit renders "kg"
          and the descender clips at a 1.0 line box.

          RE-MEASURE PENDING. The text-xl choice was made against Clash Display
          with 2.2px of headroom (93.5px in a 95.7px column). Archivo Black is
          a wider face, and NO audit here can see the difference — the fonts do
          not load in the Playwright harness (document.fonts is empty), and a
          wrap is neither overflow nor a tap target. text-lg is the interim
          value; confirm with a hidden white-space:nowrap probe in a real
          browser at 375px before settling it. See docs/LESSONS.md § "A stat
          tile is far taller than its font sizes predict". */}
      <div className="mt-1.5 font-display text-lg leading-[1.1] tabular-nums tracking-[-0.02em] text-fg sm:text-2xl">
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        {unit ? <span className="ml-1 text-sm font-medium text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

// `selected` fills the chip in ink — the reference design's on/off treatment
// for equipment and discipline pickers, which were previously hand-rolled per
// screen. A colored (domain-palette) tag ignores `selected`: the two are
// different jobs and stacking them would produce an unreadable fill.
export function Tag({
  label,
  color,
  selected = false,
}: {
  label: string;
  color?: string;
  selected?: boolean;
}) {
  const style: CSSProperties | undefined = color ? { borderColor: color, color } : undefined;
  const neutral = selected
    ? 'border-fg bg-fg text-bg'
    : 'border-border bg-surface text-muted';
  return (
    <span
      className={`t-label inline-flex items-center rounded-chip border px-2 py-1 ${color ? '' : neutral}`}
      style={style}
    >
      {label}
    </span>
  );
}

export function Button({
  children,
  variant = 'primary',
  onClick,
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode;
  variant?: 'primary' | 'ghost';
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  // `.hill-btn` carries the radius and the fill/border state changes; it no
  // longer casts or presses (see global.css). `min-h-11` is TOUCH.minTargetPx
  // and is what audit:mobile rule 2 measures — do not drop it for a tighter
  // button. Primary needs an explicit border so it matches ghost's box
  // exactly: without one the two variants differ by 2px and misalign whenever
  // they sit side by side in a row.
  const base =
    'hill-btn t-control inline-flex min-h-11 items-center justify-center border px-4 disabled:opacity-40';
  const styles =
    variant === 'primary'
      ? 'border-fg bg-fg text-bg hover:bg-subtle'
      : 'border-border bg-surface text-fg';
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

// Branded full-view loading state — replaces the plain "Loading…" string across
// the read islands. A teal hairline sweep (the functional accent) over a muted
// label; reduced-motion-safe via the .loading-sweep rule.
export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16">
      <div className="loading-sweep h-px w-32 overflow-hidden bg-border" />
      <span className="t-label text-muted">{label}</span>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}
