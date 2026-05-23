import { useRef } from 'react';
import { METRICS, TOUCH, UNITS } from '@/app.config';

const STEP = METRICS.weight.step;
const PX_PER_STEP = 8;

// Drum-style weight picker: large value with +/- targets and pointer-drag
// scrubbing (drag horizontally to change). kg-only for v1.
export function WeightWheel({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const drag = useRef<{ x: number; v: number } | null>(null);

  const clamp = (v: number) => Math.max(0, Math.round(v / STEP) * STEP);

  return (
    <div className="flex select-none items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(clamp(value - STEP))}
        className="flex h-11 w-11 items-center justify-center border border-border text-fg hover:border-subtle"
        aria-label="Decrease weight"
      >
        −
      </button>
      <div
        className="min-w-24 cursor-ew-resize touch-none text-center"
        style={{ minHeight: TOUCH.minTargetPx }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, v: value };
          (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const steps = Math.round((e.clientX - drag.current.x) / PX_PER_STEP);
          onChange(clamp(drag.current.v + steps * STEP));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span className="font-display text-3xl tabular-nums text-fg">{value || 0}</span>
        <span className="ml-1 text-sm text-muted">{UNITS.weight}</span>
      </div>
      <button
        type="button"
        onClick={() => onChange(clamp(value + STEP))}
        className="flex h-11 w-11 items-center justify-center border border-border text-fg hover:border-subtle"
        aria-label="Increase weight"
      >
        +
      </button>
    </div>
  );
}
