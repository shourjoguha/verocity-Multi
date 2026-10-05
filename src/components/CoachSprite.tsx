// One animated coach character, drawn from lib/coachSprites.ts as two SVG
// paths in currentColor: full ink, and ink at reduced opacity for the second
// tone. Monochrome by construction, and both themes come free.
//
// Motion is a timer stepping through the sprite's beats, not a CSS keyframe:
// the frames are generated and the speed is a user setting, so a keyframe strip
// would need its keyframes generated per sprite per speed. One <path> swap per
// beat (~10/s at most) on one small island. Reduced motion holds the first pose.
import { useEffect, useState } from 'react';
import { SPRITES, SPRITE_GRID, spriteFrame, tonePath, type SpriteKey } from '@/lib/coachSprites';

export function CoachSprite({
  sprite,
  size,
  speed,
  animate,
  className = '',
}: {
  sprite: SpriteKey;
  size: number;
  speed: number;
  animate: boolean;
  className?: string;
}) {
  const beats = SPRITES[sprite].beats;
  const [i, setI] = useState(0);

  useEffect(() => {
    setI(0);
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let at = 0;
    let t: number;
    const step = () => {
      t = window.setTimeout(() => {
        at = (at + 1) % beats.length;
        setI(at);
        step();
      }, beats[at].ms / speed);
    };
    step();
    return () => window.clearTimeout(t);
  }, [sprite, speed, animate, beats]);

  const rows = spriteFrame(sprite, beats[animate ? i : 0]);
  return (
    <svg
      viewBox={`0 0 ${SPRITE_GRID} ${SPRITE_GRID}`}
      aria-hidden
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <path d={tonePath(rows, 2)} fill="currentColor" opacity={0.45} />
      <path d={tonePath(rows, 1)} fill="currentColor" />
    </svg>
  );
}
