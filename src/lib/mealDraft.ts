// Pure meal-logging product logic — no React, no Supabase. Everything here is
// unit-tested (mealDraft.test.ts).

import {
  MEAL_DEFAULTS,
  MEAL_REPEAT_LIMIT,
  MEAL_REPEAT_SEED,
  MEAL_TAG_KEYS,
  MEAL_TIME_ROUND_MINUTES,
  type MealKindKey,
  type MealSizeKey,
  type MealSourceKey,
} from '@/app.config';
import type { MealLog, MealLogInput } from '@/lib/types';

// Duplicated from mealPhoto.ts rather than imported: this module is pure (no
// React, no Supabase), and mealPhoto.ts pulls in the Supabase client for
// storage calls. Two tiny functions, kept identical on both sides.
function nowRounded(d: Date): string {
  const rounded = new Date(d);
  const minutes = rounded.getMinutes();
  const rem = minutes % MEAL_TIME_ROUND_MINUTES;
  const roundedMinutes = rem < MEAL_TIME_ROUND_MINUTES / 2 ? minutes - rem : minutes + (MEAL_TIME_ROUND_MINUTES - rem);
  rounded.setMinutes(roundedMinutes, 0, 0);
  const hh = String(rounded.getHours()).padStart(2, '0');
  const mm = String(rounded.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function todayLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The UI-side draft, as specified by the product brief. Deliberately camelCase
 * and deliberately NOT the DB row: `tags` and `customTags` are separate here
 * because the tag section groups them visually, but they persist to ONE
 * `tags` column (see toInput). Keeping two columns would let them disagree.
 *
 * `photoUrl` is a local blob: URL for preview only. It never reaches the
 * database — `toInput` drops it, and the caller supplies the uploaded
 * `photo_path` separately.
 */
export interface MealDraft {
  time: string; // 'HH:MM'
  size: MealSizeKey;
  kind: MealKindKey;
  source: MealSourceKey;
  date: string; // 'YYYY-MM-DD'
  tags: string[]; // selected suggested tags
  customTags: string[]; // user-created tags, selected
  hungerBefore: number; // 1-5
  hungerAfter: number; // 1-5
  notes: string;
  photoUrl: string | null;
}

/** Which preset chip opened the drawer. */
export type MealPreset =
  | { kind: 'custom' }
  | { kind: 'meal' }
  | { kind: 'snack' }
  | { kind: 'repeat'; tag: string };

function blankDraft(now: Date): MealDraft {
  return {
    time: nowRounded(now),
    size: MEAL_DEFAULTS.size,
    kind: MEAL_DEFAULTS.kind,
    source: MEAL_DEFAULTS.source,
    date: todayLocal(now),
    tags: [],
    customTags: [],
    hungerBefore: MEAL_DEFAULTS.hungerBefore,
    hungerAfter: MEAL_DEFAULTS.hungerAfter,
    notes: '',
    photoUrl: null,
  };
}

/**
 * A fresh draft for a preset. Per the spec:
 *   custom  -> blank draft (all defaults)
 *   meal    -> kind = 'meal'
 *   snack   -> kind = 'snack', size = 'light'
 *   repeat  -> meal draft with that custom tag preselected
 * Time and date are always "now", local.
 */
export function draftFor(preset: MealPreset, now = new Date()): MealDraft {
  const draft = blankDraft(now);
  switch (preset.kind) {
    case 'custom':
      return draft;
    case 'meal':
      return { ...draft, kind: 'meal' };
    case 'snack':
      return { ...draft, kind: 'snack', size: 'light' };
    case 'repeat':
      return { ...draft, kind: 'meal', customTags: [preset.tag] };
  }
}

/** Draft -> DB input. Merges tags + customTags, trims the note to null if empty. */
export function toInput(draft: MealDraft, photoPath: string | null): MealLogInput {
  const note = draft.notes.trim();
  return {
    log_date: draft.date,
    eaten_time: draft.time,
    size: draft.size,
    kind: draft.kind,
    source: draft.source,
    tags: [...draft.tags, ...draft.customTags],
    note: note ? note : null,
    hunger_before: draft.hungerBefore,
    hunger_after: draft.hungerAfter,
    photo_path: photoPath,
  };
}

/** DB row -> draft, for editing an existing meal. */
export function toDraft(row: MealLog): MealDraft {
  const { suggested, custom } = splitTags(row.tags);
  return {
    time: row.eaten_time,
    size: row.size,
    kind: row.kind,
    source: row.source,
    date: row.log_date,
    tags: suggested,
    customTags: custom,
    hungerBefore: row.hunger_before,
    hungerAfter: row.hunger_after,
    notes: row.note ?? '',
    photoUrl: null,
  };
}

/** Splits a persisted tag array into [suggested, custom] by set difference. */
export function splitTags(tags: string[]): { suggested: string[]; custom: string[] } {
  const suggested = tags.filter((t) => (MEAL_TAG_KEYS as string[]).includes(t));
  const custom = tags.filter((t) => !(MEAL_TAG_KEYS as string[]).includes(t));
  return { suggested, custom };
}

/**
 * Normalise a typed custom tag: trim, collapse inner whitespace, lowercase.
 * Returns null if empty after trimming. Lowercasing is what makes "Post Workout"
 * and "post workout" the same shortcut rather than two.
 */
export function normalizeTag(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Repeat-meal shortcuts for the chip rail: the distinct custom tags of recent
 * meals, newest meal first, unioned with MEAL_REPEAT_SEED, capped at
 * MEAL_REPEAT_LIMIT. Newest first is the spec's "newly created shortcuts should
 * be placed before older shortcuts" — and it falls out of the query order for
 * free, since getMealLogs already returns newest first.
 */
export function repeatShortcuts(meals: MealLog[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const meal of meals) {
    const { custom } = splitTags(meal.tags);
    for (const tag of custom) {
      if (!seen.has(tag)) {
        seen.add(tag);
        ordered.push(tag);
      }
    }
  }
  for (const tag of MEAL_REPEAT_SEED) {
    if (!seen.has(tag)) {
      seen.add(tag);
      ordered.push(tag);
    }
  }
  return ordered.slice(0, MEAL_REPEAT_LIMIT);
}
