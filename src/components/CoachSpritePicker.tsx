import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { CoachSprite } from '@/components/CoachSprite';
import { SPRITES, SPRITE_GRIDS, SPRITE_KEYS } from '@/lib/coachSprites';
import {
  COACH_SPRITE_INKS,
  COACH_SPRITE_MOTIONS,
  COACH_SPRITE_SIZES,
  COACH_SPRITE_SPEEDS,
  setCoachSpritePrefs,
  useCoachSpritePrefs,
  type CoachSpritePrefs,
} from '@/lib/coachSpritePrefs';

const INK_LABEL = { mono: 'Mono', colour: 'Colour' } as const;
const MOTION_LABEL = { always: 'Always', new: 'New', off: 'Off' } as const;
const speedLabel = (s: number) => (s === 0.5 ? '½×' : `${s}×`);

// Settings → Appearance → Coach icon. The preview moves unless Motion is Off;
// on Home, "New" moves only while a coach finding is unseen.
export function CoachSpritePicker() {
  const prefs = useCoachSpritePrefs();
  const update = (patch: Partial<CoachSpritePrefs>) => setCoachSpritePrefs({ ...prefs, ...patch });

  // One labelled single-select per setting; every option list comes from
  // lib/coachSpritePrefs.ts so the stored value and the control cannot drift.
  const field = <K extends keyof CoachSpritePrefs>(
    key: K,
    label: string,
    options: readonly CoachSpritePrefs[K][],
    show: (v: CoachSpritePrefs[K]) => string,
  ) => (
    <div className="grid min-w-0 gap-1">
      <span className="t-label text-muted">{label}</span>
      <SegmentedTabs
        as="radiogroup"
        size="sm"
        ariaLabel={`Coach icon ${label.toLowerCase()}`}
        tabs={options.map((o) => ({ key: String(o), label: show(o) }))}
        active={String(prefs[key])}
        onChange={(k) => update({ [key]: options.find((o) => String(o) === k) } as Partial<CoachSpritePrefs>)}
      />
    </div>
  );

  return (
    <div className="grid gap-3">
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          {field('sprite', 'Character', SPRITE_KEYS, (k) => SPRITES[k].label)}
        </div>
        <div className="flex h-16 w-16 shrink-0 items-end justify-center border-b border-border text-fg">
          <CoachSprite
            sprite={prefs.sprite}
            grid={prefs.grid}
            ink={prefs.ink}
            size={prefs.size}
            speed={prefs.speed}
            animate={prefs.motion !== 'off'}
            className="-mb-px"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field('ink', 'Ink', COACH_SPRITE_INKS, (v) => INK_LABEL[v])}
        {field('motion', 'Motion', COACH_SPRITE_MOTIONS, (v) => MOTION_LABEL[v])}
        {field('grid', 'Resolution', SPRITE_GRIDS, String)}
        {field('size', 'Slot', COACH_SPRITE_SIZES, (v) => `${v}px`)}
        {field('speed', 'Speed', COACH_SPRITE_SPEEDS, speedLabel)}
      </div>
    </div>
  );
}
