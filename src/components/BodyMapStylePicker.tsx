import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { BODY_MAP_STYLES, setBodyMapStyle, useBodyMapStyle, type BodyMapStyle } from '@/lib/bodyMapPrefs';

const LABEL: Record<BodyMapStyle, string> = { plates: 'Plates', engraved: 'Engraved', thermal: 'Thermal' };

// Settings → Appearance → Body map. Per-device; the Body view reads it live.
export function BodyMapStylePicker() {
  const style = useBodyMapStyle();
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
      <p className="text-xs text-muted">How muscles are drawn on the Body page. Saved on this device.</p>
    </div>
  );
}
