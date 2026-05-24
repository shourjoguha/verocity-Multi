import { METRICS, RPE, type MetricKey } from '@/app.config';
import type { LogSet, SetActual } from '@/lib/types';
import { WeightWheel } from '@/components/logger/WeightWheel';
import { RepsStepper } from '@/components/logger/RepsStepper';
import { MetricStepper } from '@/components/logger/MetricStepper';

// One set row. The numeric inputs shown follow the item's primary metric
// (metric swap), with RPE available as a secondary except when RPE is primary.
export function SetRow({
  metric,
  set,
  onPatch,
  onToggle,
  onRemove,
  onCloneForward,
}: {
  metric: MetricKey;
  set: LogSet;
  onPatch: (patch: Partial<SetActual>) => void;
  onToggle: () => void;
  onRemove: () => void;
  onCloneForward?: () => void;
}) {
  const a = set.actual;

  const inputs = () => {
    switch (metric) {
      case 'weight':
        return (
          <>
            <WeightWheel value={a.weight ?? 0} onChange={(v) => onPatch({ weight: v })} />
            <RepsStepper value={a.reps ?? 0} onChange={(v) => onPatch({ reps: v })} />
          </>
        );
      case 'reps':
        return <RepsStepper value={a.reps ?? 0} onChange={(v) => onPatch({ reps: v })} />;
      case 'time':
        return (
          <MetricStepper
            value={a.time ?? 0}
            onChange={(v) => onPatch({ time: v })}
            step={METRICS.time.step}
            label="time"
            unit={METRICS.time.unit}
          />
        );
      case 'distance':
        return (
          <MetricStepper
            value={a.distance ?? 0}
            onChange={(v) => onPatch({ distance: v })}
            step={METRICS.distance.step}
            label="dist"
            unit={METRICS.distance.unit}
          />
        );
      case 'rpe':
        return null;
    }
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-3 border-l-2 pl-3 ${
        a.completed ? 'border-accent' : 'border-border'
      }`}
    >
      {set.planned ? (
        <span className="w-12 shrink-0 text-[0.7rem] uppercase tracking-wider text-muted">
          {set.planned}
        </span>
      ) : null}

      {inputs()}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPatch({ rpe: Math.max(RPE.min, (a.rpe ?? RPE.min) - RPE.step) })}
          className="flex h-9 w-9 items-center justify-center border border-border text-fg"
          aria-label="Lower RPE"
        >
          −
        </button>
        <span className="w-12 text-center text-sm tabular-nums text-subtle">@{a.rpe ?? '—'}</span>
        <button
          type="button"
          onClick={() => onPatch({ rpe: Math.min(RPE.max, (a.rpe ?? RPE.min) + RPE.step) })}
          className="flex h-9 w-9 items-center justify-center border border-border text-fg"
          aria-label="Raise RPE"
        >
          +
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {a.completed && onCloneForward ? (
          <button
            type="button"
            onClick={onCloneForward}
            className="flex h-11 w-9 items-center justify-center border border-border text-muted hover:text-fg"
            aria-label="Copy to next set"
            title="Copy to next set"
          >
            ↓
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          className="flex h-11 w-9 items-center justify-center border border-border text-muted hover:text-fg"
          aria-label="Remove set"
        >
          ×
        </button>
        <button
          type="button"
          onClick={onToggle}
          className={`flex h-11 w-11 items-center justify-center border ${
            a.completed ? 'border-accent bg-accent text-accent-fg' : 'border-border text-muted'
          }`}
          aria-label="Toggle completed"
          aria-pressed={a.completed}
        >
          ✓
        </button>
      </div>
    </div>
  );
}
