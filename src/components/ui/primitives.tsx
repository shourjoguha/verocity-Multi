import type { CSSProperties, ReactNode } from 'react';

// Swiss-minimalist primitives. Tokens only (classes map to --color-* tokens);
// dynamic accent colors come from app.config via inline style.

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-border bg-surface p-4 ${className}`}>{children}</div>
  );
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-[0.7rem] font-medium uppercase tracking-[0.25em] text-muted">
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
    <div className="border border-border bg-surface px-4 py-3">
      <div className="text-[0.65rem] uppercase tracking-[0.2em] text-muted">{label}</div>
      <div className="mt-1 font-display text-3xl font-medium tabular-nums text-fg">
        {value}
        {unit ? <span className="ml-1 text-base text-subtle">{unit}</span> : null}
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
    'inline-flex min-h-11 items-center justify-center px-4 text-sm uppercase tracking-wider transition-colors disabled:opacity-40';
  const styles =
    variant === 'primary'
      ? 'bg-fg text-bg hover:bg-subtle'
      : 'border border-border text-fg hover:border-subtle';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}
