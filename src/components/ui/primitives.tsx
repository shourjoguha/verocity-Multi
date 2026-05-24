import type { CSSProperties, ReactNode } from 'react';

// Editorial light primitives. Tokens only (classes map to --color-* tokens);
// dynamic accent colors (activity tags / training blocks) come from app.config
// via inline style. Micro-interactions are CSS; orchestrated motion lives in
// the screens via Motion (see components/anim.tsx).

export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  const hover = interactive
    ? 'transition-transform duration-300 ease-[cubic-bezier(0.77,0,0.175,1)] hover:-translate-y-0.5'
    : '';
  return <div className={`border border-border bg-surface p-4 ${hover} ${className}`}>{children}</div>;
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
        {value}
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
  const base =
    'inline-flex min-h-11 items-center justify-center px-4 text-sm uppercase tracking-wider transition duration-150 active:scale-[0.98] disabled:opacity-40';
  const styles =
    variant === 'primary'
      ? 'bg-fg text-bg hover:bg-fg/85'
      : 'border border-border text-fg hover:border-fg';
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
