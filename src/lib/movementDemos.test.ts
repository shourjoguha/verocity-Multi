import { describe, expect, it } from 'vitest';
import {
  DEMO_ATTRIBUTION,
  demoGifUrl,
  demoThumbUrl,
  getMovementDemo,
  type MovementDemo,
} from '@/lib/movementDemos';

// The 63 seeded shared movements (migrations 0024/0028/0029), split into the
// ones we curated a demo for and the ones with no usable GIF in the set. This
// fixture pins the current coverage: adding a mapping moves a name from
// UNCOVERED to COVERED, and both lists are asserted below.
const COVERED = [
  'Alternating Lunge', 'Back Squat', 'Banded Pull-up', 'Bench Press', 'Bike',
  'Box Jump', 'Box Step-up', 'Burpee', 'Chest-to-Bar Pull-up', 'Clean',
  'Clean and Jerk', 'Deadlift', 'Double-Under', 'Dumbbell Box Step-up',
  'Dumbbell Farmers Carry', 'Dumbbell Hang Power Clean', 'Dumbbell Hang Snatch',
  'Dumbbell Push Press', 'Dumbbell-Facing Burpee', 'Foot-Assisted Pull-up',
  'Foot-Assisted Ring Dip', 'Front Squat', 'Hand-Elevated Push-up',
  'Hand-Release Push-up', 'Handstand Push-up', 'Hang Power Snatch',
  'Hanging Knee Raise', 'Jumping Pull-up', 'Knee Push-up', 'Low-Hang Squat Snatch',
  'Lunge', 'Muscle-up', 'Overhead Squat', 'Pike Push-up', 'Power Clean',
  'Power Snatch', 'Pull-up', 'Push Jerk', 'Push Press', 'Push-up', 'Ring Row',
  'Rope Climb', 'Run', 'Sandbag Lunge', 'Shoulder Press', 'Single-Under',
  'Sit-up', 'Ski Erg', 'Squat Clean', 'Thruster', 'V-Up', 'Walkout to Push-up',
];

const UNCOVERED = [
  'Air Squat', 'Burpee Box Jump-Over', 'Burpee Box Step-Over', 'Burpee Broad Jump',
  'Devil Press', 'Pull-to-Stand', 'Row', 'Sled Pull', 'Sled Push', 'Toes-to-Bar',
  'Wall Ball',
];

const ASSET_RE = /^\d{4}-[A-Za-z0-9]+$/;

describe('getMovementDemo', () => {
  it('resolves every curated movement to a well-formed demo', () => {
    for (const name of COVERED) {
      const demo = getMovementDemo(name);
      expect(demo, name).not.toBeNull();
      expect(demo!.asset, name).toMatch(ASSET_RE);
      expect(typeof demo!.exact, name).toBe('boolean');
    }
  });

  it('returns null for movements with no usable GIF', () => {
    for (const name of UNCOVERED) {
      expect(getMovementDemo(name), name).toBeNull();
    }
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    const canonical = getMovementDemo('Thruster');
    expect(canonical).not.toBeNull();
    expect(getMovementDemo('thruster')).toEqual(canonical);
    expect(getMovementDemo('  THRUSTER  ')).toEqual(canonical);
  });

  it('returns null for an unknown / custom movement name', () => {
    expect(getMovementDemo('Zercher Carry')).toBeNull();
    expect(getMovementDemo('')).toBeNull();
  });

  it('keeps the exact-vs-close split honest', () => {
    // A direct depiction is exact; a stand-in variation is not. Pin one of each
    // so a careless remap can't silently flip the flag.
    expect(getMovementDemo('Deadlift')?.exact).toBe(true);
    expect(getMovementDemo('Pull-up')?.exact).toBe(true);
    expect(getMovementDemo('Sandbag Lunge')?.exact).toBe(false);
    expect(getMovementDemo('Double-Under')?.exact).toBe(false);
  });
});

describe('demo asset urls', () => {
  it('build gif and thumbnail paths under the static base', () => {
    const demo = getMovementDemo('Burpee') as MovementDemo;
    expect(demoGifUrl(demo.asset)).toBe('/demos/1160-dK9394r.gif');
    expect(demoThumbUrl(demo.asset)).toBe('/demos/1160-dK9394r.jpg');
  });

  it('carries the required Gym Visual attribution', () => {
    expect(DEMO_ATTRIBUTION).toMatch(/gym\s*visual/i);
  });
});
