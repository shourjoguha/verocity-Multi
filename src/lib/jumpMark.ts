import { JUMP_MARK } from '@/app.config';
import { normalizeMovementName } from '@/lib/movementTaxonomy';
import type { JumpMarkKind, LogItem } from '@/lib/types';

// Jump marks: how high (box) or how far (landing) a plyometric rep went.
//
// The default comes from the movement name (JUMP_MARK in app.config); the
// athlete can override it per movement in its options sheet, which is stored on
// the item as `markKind`. Values are always centimetres on `SetActual.mark`.

const CM_PER_IN = 2.54;

const has = (name: string, patterns: readonly string[]) => patterns.some((p) => name.includes(p));

/** The default mark for a movement name, or null when it is not a marked jump. */
export function defaultMarkKind(movement: string): JumpMarkKind | null {
  const name = normalizeMovementName(movement);
  if (has(name, JUMP_MARK.exclude)) return null;
  if (has(name, JUMP_MARK.height)) return 'height';
  if (has(name, JUMP_MARK.distance)) return 'distance';
  return null;
}

/** What this item marks: its own setting first, then the name's default. */
export function markKindOf(item: Pick<LogItem, 'movement' | 'markKind'>): JumpMarkKind | null {
  if (item.markKind === 'off') return null;
  return item.markKind ?? defaultMarkKind(item.movement);
}

export const inToCm = (inches: number) => Math.round(inches * CM_PER_IN);
export const cmToIn = (cm: number) => Math.round(cm / CM_PER_IN);

/** "61cm box (24in)" / "212cm" — the set-row phrase. Empty when unmarked. */
export function markLabel(kind: JumpMarkKind, cm: number | undefined): string {
  if (!cm) return '';
  return kind === 'height' ? `${cm}cm box (${cmToIn(cm)}in)` : `${cm}cm`;
}
