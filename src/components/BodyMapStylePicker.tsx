import SegmentedTabs from '@/components/ui/SegmentedTabs';
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

// Settings → Appearance → Body map. Per-device; the Body view reads it live.
export function BodyMapStylePicker() {
  const style = useBodyMapStyle();
  const ink = useBodyMapInk();
  return (
    <div className="grid gap-2">
      <SegmentedTabs
        as="radiogroup"
        size="sm"
        ariaLabel="Body map style"
        tabs={BODY_MAP_STYLES.map((s) => ({ key: s, label: LABEL[s] }))}
        active={style}
        onChange={(k) => setBodyMapStyle(k as BodyMapStyle)}
      />
      {style === 'plates' ? (
        <SegmentedTabs
          as="radiogroup"
          size="sm"
          ariaLabel="Body map ink"
          tabs={BODY_MAP_INKS.map((k) => ({ key: k, label: INK_LABEL[k] }))}
          active={ink}
          onChange={(k) => setBodyMapInk(k as BodyMapInkPref)}
        />
      ) : null}
      <p className="text-xs text-muted">
        How muscles are drawn on the Body page, in seven shades from untrained to the busiest muscle. Plates can be
        inked in grey or colour. Saved on this device.
      </p>
    </div>
  );
}
