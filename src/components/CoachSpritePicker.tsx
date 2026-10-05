import { useEffect, useState } from 'react';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { CoachSprite } from '@/components/CoachSprite';
import { SPRITES, SPRITE_KEYS } from '@/lib/coachSprites';
import {
  COACH_SPRITE_DEFAULTS,
  COACH_SPRITE_SIZES,
  COACH_SPRITE_SPEEDS,
  getCoachSpritePrefs,
  setCoachSpritePrefs,
  type CoachSpritePrefs,
} from '@/lib/coachSpritePrefs';

const speedLabel = (s: number) => (s === 0.5 ? '½×' : `${s}×`);

// Settings → Appearance → Coach icon. The preview always moves; on Home the
// character moves only while a coach finding is unseen.
export function CoachSpritePicker() {
  const [prefs, setPrefs] = useState<CoachSpritePrefs>(COACH_SPRITE_DEFAULTS);
  useEffect(() => setPrefs(getCoachSpritePrefs()), []);

  const update = (patch: Partial<CoachSpritePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setCoachSpritePrefs(next);
  };

  return (
    <div className="flex items-end gap-4">
      <div className="grid min-w-0 flex-1 gap-2">
        <SegmentedTabs
          as="radiogroup"
          size="sm"
          ariaLabel="Coach character"
          tabs={SPRITE_KEYS.map((k) => ({ key: k, label: SPRITES[k].label }))}
          active={prefs.sprite}
          onChange={(k) => update({ sprite: k as CoachSpritePrefs['sprite'] })}
        />
        <div className="grid grid-cols-2 gap-2">
          <SegmentedTabs
            as="radiogroup"
            size="sm"
            ariaLabel="Coach icon size"
            tabs={COACH_SPRITE_SIZES.map((s) => ({ key: String(s), label: `${s}px` }))}
            active={String(prefs.size)}
            onChange={(k) => update({ size: Number(k) as CoachSpritePrefs['size'] })}
          />
          <SegmentedTabs
            as="radiogroup"
            size="sm"
            ariaLabel="Coach icon speed"
            tabs={COACH_SPRITE_SPEEDS.map((s) => ({ key: String(s), label: speedLabel(s) }))}
            active={String(prefs.speed)}
            onChange={(k) => update({ speed: Number(k) as CoachSpritePrefs['speed'] })}
          />
        </div>
      </div>
      <div className="flex h-16 w-16 shrink-0 items-end justify-center border-b border-border text-fg">
        <CoachSprite sprite={prefs.sprite} size={prefs.size} speed={prefs.speed} animate className="-mb-px" />
      </div>
    </div>
  );
}
