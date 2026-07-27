import type { CSSProperties, ReactNode } from 'react';
import { AnimatedNumber } from '@/components/anim';

// Editorial light primitives. Tokens only (classes map to --color-* tokens);
// dynamic accent colors (activity tags / training blocks) come from app.config
// via inline style. Micro-interactions are CSS; orchestrated motion lives in
// the screens via Motion (see components/anim.tsx).

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

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-[0.04em] text-fg">
      {children}
    </h2>
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
  // duration ("13h 28m", 93.5px) stay on one line in a 375px 3-up column.
  // Restored to px-4 at sm:, where the column is ~171px+ and nothing competes.
  return (
    <div className="border border-border bg-surface px-2 py-3 sm:px-4">
      <div className="t-label text-muted">{label}</div>
      {/* Sized to fit on ONE line, which is the whole point: in a 3-up grid at
          375px each value gets 87.7px, and a duration like "3h 52m" needs
          120px at the old text-3xl and 96px at text-2xl — so it always wrapped
          to a second line and the tile cost 125px. At text-xl it measures
          80.2px and fits. The sm: step back up is not decoration: nothing
          constrains the width above 640px, where the column is ~171px+.
          leading-[1.1] rather than leading-none because the unit renders "kg"
          and the descender clips at a 1.0 line box. */}
      <div className="mt-1.5 font-display text-xl font-semibold leading-[1.1] tabular-nums tracking-[-0.03em] text-fg sm:text-2xl">
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        {unit ? <span className="ml-1 text-sm font-medium text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

export function Tag({ label, color }: { label: string; color: string }) {
  const style: CSSProperties = { borderColor: color, color };
  return (
    <span
      className="t-label inline-flex items-center border px-2 py-0.5"
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
  // hill-btn handles the press feedback now (transform + shadow inversion),
  // so the legacy active:scale is dropped to avoid double-squishing. Ghost
  // gets bg-surface so the pillow effect has a body to dome from — a fully
  // transparent ghost can't render the highlight, which would leave the
  // pillow asymmetric.
  const base =
    'hill-btn inline-flex min-h-11 items-center justify-center px-4 text-sm uppercase tracking-wider transition-colors duration-150 disabled:opacity-40';
  const styles =
    variant === 'primary'
      ? 'bg-fg text-bg hover:bg-fg/85'
      : 'border border-border bg-surface text-fg hover:border-fg';
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
    <div className="border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}
