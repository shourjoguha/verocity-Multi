import type { ReactNode } from 'react';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { Disclosure } from '@/components/ui/Disclosure';
import {
  BODY_MAP_INKS,
  BODY_MAP_STYLES,
  setBodyMapInk,
  setBodyMapStyle,
  useBodyMapInk,
  useBodyMapStyle,
  type BodyMapInkPref,
  type BodyMapStyle,
} from '@/lib/bodyMapPrefs';

const LABEL: Record<BodyMapStyle, string> = { plates: 'Plates', engraved: 'Engraved', thermal: 'Thermal' };
const INK_LABEL: Record<BodyMapInkPref, string> = { mono: 'Mono', colour: 'Colour' };

// You → Appearance → Body map, as one row of the Appearance card. Per-device;
// the Body view reads it live. The caption explaining it lives in the caller's
// title popover.
export function BodyMapStylePicker({ id, title }: { id?: string; title: ReactNode }) {
  const style = useBodyMapStyle();
  const ink = useBodyMapInk();
  return (
    <Disclosure
      id={id}
      variant="row"
      title={title}
      headerRight={style === 'plates' ? `${LABEL[style]} · ${INK_LABEL[ink]}` : LABEL[style]}
    >
      <div className="flex flex-col gap-1">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="t-label shrink-0 text-muted">Style</span>
          <SegmentedTabs
            as="radiogroup"
            size="sm"
            ariaLabel="Body map style"
            tabs={BODY_MAP_STYLES.map((s) => ({ key: s, label: LABEL[s] }))}
            active={style}
            onChange={(k) => setBodyMapStyle(k as BodyMapStyle)}
            className="min-w-0 max-w-60 flex-1"
          />
        </div>
        {style === 'plates' ? (
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="t-label shrink-0 text-muted">Ink</span>
            <SegmentedTabs
              as="radiogroup"
              size="sm"
              ariaLabel="Body map ink"
              tabs={BODY_MAP_INKS.map((k) => ({ key: k, label: INK_LABEL[k] }))}
              active={ink}
              onChange={(k) => setBodyMapInk(k as BodyMapInkPref)}
              className="min-w-0 max-w-60 flex-1"
            />
          </div>
        ) : null}
      </div>
    </Disclosure>
  );
}
