import { useEffect, useRef, useState, type ReactNode } from 'react';

// A number value that you can tap to type directly (numeric keyboard on mobile),
// committing on blur/Enter and cancelling on Escape. Shared by the set-row
// steppers (reps/weight/time/distance/RPE) so entry isn't only +/- tapping.
export function EditableNumber({
  value,
  onCommit,
  clampParse,
  ariaLabel,
  className = '',
  children,
}: {
  value: number;
  onCommit: (v: number) => void;
  clampParse: (n: number) => number;
  ariaLabel: string;
  className?: string;
  children?: (v: number) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) onCommit(clampParse(n));
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        defaultValue={String(value || 0)}
        aria-label={ariaLabel}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          else if (e.key === 'Escape') setEditing(false);
        }}
        className={`w-full border border-subtle bg-surface text-center outline-none ${className}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit ${ariaLabel}`}
      className={`w-full text-center ${className}`}
    >
      {children ? children(value) : value || 0}
    </button>
  );
}
