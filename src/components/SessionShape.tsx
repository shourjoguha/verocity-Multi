import { SESSION_SHAPE } from '@/app.config';
import type { SessionShape } from '@/lib/sessionShape';
import { InfoPopover } from '@/components/ui/InfoPopover';

const BLOCK_LABEL = {
  warmup: 'Warm-up',
  main: 'Main',
  accessory: 'Accessory',
  conditioning: 'Conditioning',
  cooldown: 'Cool-down',
} as const;

// One bar per session. Fixed to its column's width, so the row can never
// overflow however many sets were logged — the old per-set strip grew 5px a
// set and ran into the tag at ~30 sets.
export function SessionShapeBar({ shape }: { shape: SessionShape | null }) {
  if (!shape) return <div className="h-[22px] min-w-0 flex-1" aria-hidden="true" />;

  if (shape.kind !== 'sets') {
    const label =
      shape.kind === 'hr'
        ? `Heart rate avg ${shape.avg}${shape.max ? `, max ${shape.max}` : ''}`
        : 'No heart rate logged';
    return (
      <div role="img" aria-label={label} className="flex h-[22px] min-w-0 flex-1 items-end">
        <span
          className={`w-full ${shape.kind === 'hr' ? 'shape-hr' : 'shape-no-hr'}`}
          style={{ height: shape.kind === 'hr' ? `${shape.height * 100}%` : '50%' }}
        />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={shape.blocks.map((b) => `${BLOCK_LABEL[b.key]} ${b.sets} sets`).join(', ')}
      className="flex h-[22px] min-w-0 flex-1 items-end"
    >
      {shape.blocks.map((b, i) => (
        <div
          key={b.key}
          className={`flex h-full min-w-0 items-end ${i > 0 ? 'border-l border-dotted border-surface' : ''}`}
          style={{ flex: `${b.share} 0 0` }}
        >
          <span className={`w-full shape-${b.key}`} style={{ height: `${b.height * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

const LEGEND: { cls: string; label: string }[] = [
  { cls: 'shape-warmup', label: 'Warm-up' },
  { cls: 'shape-main', label: 'Main' },
  { cls: 'shape-accessory', label: 'Accessory' },
  { cls: 'shape-conditioning', label: 'Conditioning' },
  { cls: 'shape-cooldown', label: 'Cool-down' },
  { cls: 'shape-hr', label: 'Heart rate' },
];

export function SessionShapeLegend() {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-muted">
      {LEGEND.map((l) => (
        <span key={l.cls} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block h-2.5 w-4 ${l.cls}`} />
          {l.label}
        </span>
      ))}
      <InfoPopover label="How the bars are drawn">
        Width: share of the session's sets. Height: that block vs. your {SESSION_SHAPE.referencePercentile}th percentile for it in
        sessions with the same tag. Sport and endurance: height is heart rate (mostly average, a
        little max). Dashed outline: no heart rate logged.
      </InfoPopover>
    </div>
  );
}
