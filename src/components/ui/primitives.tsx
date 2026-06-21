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
  return (
    <div className="border border-border bg-surface px-4 py-4">
      <div className="text-[0.65rem] uppercase tracking-[0.2em] text-muted">{label}</div>
      <div className="mt-2 font-display text-3xl font-semibold tabular-nums tracking-[-0.03em] text-fg">
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        {unit ? <span className="ml-1 text-base font-medium text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

export function Tag({ label, color }: { label: string; color: string }) {
  const style: CSSProperties = { borderColor: color, color };
  return (
    <span
      className="inline-flex items-center border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider"
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

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}
