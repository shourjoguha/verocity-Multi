import type { ReactNode } from 'react';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { Disclosure } from '@/components/ui/Disclosure';
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
const sizeLabel = (v: number) => `${v}px`;

// You → Appearance → Coach icon, as one row of the Appearance card. Collapsed,
// the row shows a still preview and "Character · Ink". Open, Character / Ink /
// Motion sit label-left, control-right; Resolution / Slot / Speed fold behind a
// second row with their current values as its summary. Every knob is kept (owner
// decision). The large preview moves unless Motion is Off; on Home, "New" moves
// only while a coach finding is unseen.
export function CoachSpritePicker({ id, title }: { id?: string; title: ReactNode }) {
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
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span className="t-label shrink-0 text-muted">{label}</span>
      <SegmentedTabs
        as="radiogroup"
        size="sm"
        ariaLabel={`Coach icon ${label.toLowerCase()}`}
        tabs={options.map((o) => ({ key: String(o), label: show(o) }))}
        active={String(prefs[key])}
        onChange={(k) => update({ [key]: options.find((o) => String(o) === k) } as Partial<CoachSpritePrefs>)}
        className="min-w-0 max-w-60 flex-1"
      />
    </div>
  );

  return (
    <Disclosure
      id={id}
      variant="row"
      title={title}
      headerRight={
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex text-fg">
            <CoachSprite
              sprite={prefs.sprite}
              grid={prefs.grid}
              ink={prefs.ink}
              size={COACH_SPRITE_SIZES[0]}
              speed={prefs.speed}
              animate={false}
            />
          </span>
          {SPRITES[prefs.sprite].label} · {INK_LABEL[prefs.ink]}
        </span>
      }
    >
      <div className="flex flex-col gap-1">
        <div className="flex justify-end">
          <div className="flex h-16 w-16 shrink-0 items-end justify-center border-b border-border-soft text-fg">
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
        {field('sprite', 'Character', SPRITE_KEYS, (k) => SPRITES[k].label)}
        {field('ink', 'Ink', COACH_SPRITE_INKS, (v) => INK_LABEL[v])}
        {field('motion', 'Motion', COACH_SPRITE_MOTIONS, (v) => MOTION_LABEL[v])}
      </div>
      <div className="-mx-3 -mb-3 mt-2">
        <Disclosure
          variant="row"
          title="Size, detail & speed"
          headerRight={`${prefs.grid} · ${sizeLabel(prefs.size)} · ${speedLabel(prefs.speed)}`}
        >
          <div className="flex flex-col gap-1">
            {field('grid', 'Resolution', SPRITE_GRIDS, String)}
            {field('size', 'Slot', COACH_SPRITE_SIZES, sizeLabel)}
            {field('speed', 'Speed', COACH_SPRITE_SPEEDS, speedLabel)}
          </div>
        </Disclosure>
      </div>
    </Disclosure>
  );
}
