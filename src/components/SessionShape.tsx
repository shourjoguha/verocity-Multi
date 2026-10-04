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

// Abbreviated so the legend holds one line at 375px; the popover spells each
// one out and <abbr title> carries the full name. Warm-up and cool-down share
// a fill, so they share an entry.
const LEGEND: { cls: string; label: string; full: string }[] = [
  { cls: 'shape-warmup', label: 'Warm/Cool', full: 'Warm-up and cool-down' },
  { cls: 'shape-main', label: 'Main', full: 'Main' },
  { cls: 'shape-accessory', label: 'Acc', full: 'Accessory' },
  { cls: 'shape-conditioning', label: 'Cond', full: 'Conditioning' },
  { cls: 'shape-hr', label: 'HR', full: 'Heart rate' },
];

export function SessionShapeLegend() {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.6rem] text-muted">
      {LEGEND.map((l) => (
        <span key={l.cls} className="inline-flex items-center gap-1">
          <span aria-hidden="true" className={`inline-block h-2 w-3 ${l.cls}`} />
          {l.label === l.full ? (
            l.label
          ) : (
            <abbr title={l.full} className="no-underline">
              {l.label}
            </abbr>
          )}
        </span>
      ))}
      <InfoPopover label="How the bars are drawn">
        Warm/Cool: warm-up and cool-down. Acc: accessory. Cond: conditioning. HR: heart rate.
        Width: share of the session's sets. Height: that block vs. your {SESSION_SHAPE.referencePercentile}th percentile for it in
        sessions with the same tag. Sport and endurance: height is heart rate (mostly average, a
        little max). Dashed outline: no heart rate logged.
      </InfoPopover>
    </div>
  );
}
