// One animated coach character, drawn from lib/coachSprites.ts as SVG paths.
// Mono: two paths in currentColor (full ink, and ink at reduced opacity), so it
// follows the theme like any other chrome. Colour: one path per palette char,
// filled from the `--spr-*` tokens in global.css, which both themes define.
//
// Motion is a timer stepping through the sprite's beats, not a CSS keyframe:
// the frames are generated and the speed is a user setting, so a keyframe strip
// would need its keyframes generated per sprite per speed. One <path> swap per
// beat (~14/s at most) on one small island. Whether to move is the caller's
// call (`animate`) — see COACH_SPRITE_MOTIONS for why it ignores Reduce Motion.
import { useEffect, useState } from 'react';
import { SPRITES, colourPaths, spriteFrame, tonePath, type SpriteGrid, type SpriteKey } from '@/lib/coachSprites';

export function CoachSprite({
  sprite,
  grid,
  ink,
  size,
  speed,
  animate,
  className = '',
}: {
  sprite: SpriteKey;
  grid: SpriteGrid;
  ink: 'mono' | 'colour';
  size: number;
  speed: number;
  animate: boolean;
  className?: string;
}) {
  const beats = SPRITES[sprite].beats;
  const [i, setI] = useState(0);

  useEffect(() => {
    setI(0);
    if (!animate) return;
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

  const rows = spriteFrame(sprite, beats[animate ? i : 0], grid);
  return (
    <svg
      viewBox={`0 0 ${grid} ${grid}`}
      aria-hidden
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {ink === 'colour' ? (
        colourPaths(rows).map(({ token, d }) => <path key={token} d={d} fill={`var(${token})`} />)
      ) : (
        <>
          <path d={tonePath(rows, 2)} fill="currentColor" opacity={0.45} />
          <path d={tonePath(rows, 1)} fill="currentColor" />
        </>
      )}
    </svg>
  );
}
