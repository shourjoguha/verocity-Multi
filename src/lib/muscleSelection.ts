// The muscle picker behind TaxonomyEditor, as pure functions so vitest's node
// environment can test it without a DOM.
//
// A selection is an ordered list: index 0 is the PRIMARY muscle, the rest are
// HELPERS. The user picks muscles, never weights (decision D3): a primary alone
// is 100%, otherwise the primary takes 65% and the helpers split 35% equally.
// Typing a number would be a worse question than the one being answered.

import { MUSCLES, MUSCLE_KEYS, type MovementProfile, type MuscleKey } from '@/app.config';
import { musclesFromRegions } from '@/lib/movementTaxonomy';

export const MUSCLE_SHARES = {
  primary: 0.65,
  helpers: 0.35,
  // A muscle a region-only override reaches through the default split is
  // preselected as a helper only at or above this weight.
  helperFloor: 0.1,
} as const;

export type MuscleSelection = readonly MuscleKey[];

/** Tap/toggle: add as primary if empty, else as a helper; tap again removes.
 *  Removing the primary promotes the first helper, by construction. */
export function toggleMuscle(sel: MuscleSelection, m: MuscleKey): MuscleKey[] {
  return sel.includes(m) ? sel.filter((k) => k !== m) : [...sel, m];
}

export type MuscleRole = 'primary' | 'helper' | null;

export function roleOf(sel: MuscleSelection, m: MuscleKey): MuscleRole {
  const i = sel.indexOf(m);
  return i < 0 ? null : i === 0 ? 'primary' : 'helper';
}

export function weightsFromSelection(sel: MuscleSelection): Partial<Record<MuscleKey, number>> {
  const [primary, ...helpers] = sel;
  if (!primary) return {};
  if (helpers.length === 0) return { [primary]: 1 };
  const out: Partial<Record<MuscleKey, number>> = { [primary]: MUSCLE_SHARES.primary };
  for (const h of helpers) out[h] = MUSCLE_SHARES.helpers / helpers.length;
  return out;
}

/**
 * Preselect from a stored override or profile. Authored `muscles` reopen as
 * written (heaviest first). A region-only override is expanded through the
 * default split: the top muscle is primary, anything at or above the helper
 * floor is a helper.
 */
export function selectionFromProfile(p?: Partial<MovementProfile> | null): MuscleKey[] {
  if (!p) return [];
  const hasMuscles = p.muscles != null && Object.keys(p.muscles).length > 0;
  const weights = hasMuscles ? p.muscles! : musclesFromRegions(p.regions ?? {});
  const ranked = (Object.entries(weights) as [string, number][])
    .filter(([k, v]) => (MUSCLE_KEYS as string[]).includes(k) && typeof v === 'number' && v > 0)
    .sort((a, b) => b[1] - a[1]) as [MuscleKey, number][];
  if (ranked.length === 0) return [];
  const [top, ...rest] = ranked;
  const floor = hasMuscles ? 0 : MUSCLE_SHARES.helperFloor;
  return [top[0], ...rest.filter(([, v]) => v >= floor - 1e-9).map(([k]) => k)];
}

/** "Quads 65 · Glute max 18 · Adductors 17": whole percentages that sum to 100
 *  (largest remainder), so the readout never shows 101. */
export function splitReadout(sel: MuscleSelection): string {
  const w = weightsFromSelection(sel);
  const keys = sel.filter((k) => w[k] != null);
  const raw = keys.map((k) => (w[k] ?? 0) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - floors[i] })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return keys.map((k, i) => `${MUSCLES[k].label} ${floors[i]}`).join(' · ');
}

export interface HitCandidate {
  key: MuscleKey;
  // Outline samples in the same (screen) space as the tap point.
  points: readonly { x: number; y: number }[];
}

/** Nearest candidate whose outline comes within `radius` of the point, else null. */
export function nearestWithin(
  point: { x: number; y: number },
  candidates: readonly HitCandidate[],
  radius: number,
): MuscleKey | null {
  let best: MuscleKey | null = null;
  let bestD = radius * radius;
  for (const c of candidates) {
    for (const q of c.points) {
      const d = (q.x - point.x) ** 2 + (q.y - point.y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = c.key;
      }
    }
  }
  return best;
}
