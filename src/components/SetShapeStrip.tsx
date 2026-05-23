import type { LogDocument } from '@/lib/types';

// Signature data-viz: a compact strip of bars, one per logged set. Bar height
// encodes relative intensity (weight, else reps); completed sets are solid,
// incomplete are faint. Reads directly from a log's LogDocument.
export function SetShapeStrip({ data, className = '' }: { data: LogDocument; className?: string }) {
  const sets = (data?.sections ?? []).flatMap((section) =>
    section.groups.flatMap((group) => group.items.flatMap((item) => item.sets)),
  );
  if (sets.length === 0) return null;

  const intensities = sets.map((s) => s.actual.weight ?? s.actual.reps ?? s.actual.time ?? 0);
  const max = Math.max(...intensities, 1);

  return (
    <div className={`flex h-6 items-end gap-[2px] ${className}`} aria-hidden="true">
      {sets.map((s, i) => {
        const ratio = intensities[i] / max;
        const heightPct = 25 + ratio * 75; // floor so empty-ish sets still show
        return (
          <span
            key={i}
            className="w-[3px] bg-fg"
            style={{ height: `${heightPct}%`, opacity: s.actual.completed ? 1 : 0.3 }}
          />
        );
      })}
    </div>
  );
}
