// Pure meal-logging product logic — no React, no Supabase. Everything here is
// unit-tested (mealDraft.test.ts).

import {
  MEAL_DEFAULTS,
  MEAL_MACRO_TAGS,
  MEAL_MIX_STEP,
  MEAL_TAG_KEYS,
  MEAL_TIME_ROUND_MINUTES,
  type MealKindKey,
  type MealSizeKey,
  type MealSourceKey,
} from '@/app.config';
import { macroMix, type MacroKey } from '@/lib/mealInsights';
import type { MealLog, MealLogInput, MealPreset, MealPresetInput, MealTagMix } from '@/lib/types';

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
 * The UI-side draft. Deliberately camelCase and deliberately NOT the DB row.
 *
 * `tags` is the fixed vocabulary only — there is no free-text tag any more; a
 * meal you repeat is a saved meal (meal_presets). When an older row is opened
 * for editing, any tag outside the vocabulary (a pre-0047 `veg`) rides along
 * untouched, so editing a meal never silently drops what it recorded.
 *
 * `tagMix` is null until the athlete actually sets the split. The bar shows an
 * even split as a dashed placeholder, but a placeholder is never saved: a
 * seeded 60/40 that nobody touched would read as a measurement.
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
  tags: string[];
  tagMix: MealTagMix | null; // P/C/F percents summing to 100, or null = not set
  carbFibrePct: number | null; // share of the carbs; null without carbs
  presetId: string | null; // the saved meal this draft started from
  hungerBefore: number; // 1-5
  hungerAfter: number; // 1-5
  notes: string;
  photoUrl: string | null;
}

/** What opened the drawer: a generic chip, or a saved meal. */
export type MealOpener = { kind: 'meal' } | { kind: 'snack' } | { kind: 'preset'; preset: MealPreset };

function blankDraft(now: Date): MealDraft {
  return {
    time: nowRounded(now),
    size: MEAL_DEFAULTS.size,
    kind: MEAL_DEFAULTS.kind,
    source: MEAL_DEFAULTS.source,
    date: todayLocal(now),
    tags: [...MEAL_DEFAULTS.tags],
    tagMix: null,
    carbFibrePct: null,
    presetId: null,
    hungerBefore: MEAL_DEFAULTS.hungerBefore,
    hungerAfter: MEAL_DEFAULTS.hungerAfter,
    notes: '',
    photoUrl: null,
  };
}

/**
 * A fresh draft. Time and date are always "now", local.
 *   meal    -> kind = 'meal'
 *   snack   -> kind = 'snack', size = 'light'
 *   preset  -> the saved meal's fields
 */
export function draftFor(opener: MealOpener, now = new Date()): MealDraft {
  const draft = blankDraft(now);
  switch (opener.kind) {
    case 'meal':
      return { ...draft, kind: 'meal' };
    case 'snack':
      return { ...draft, kind: 'snack', size: 'light' };
    case 'preset':
      return applyPreset(draft, opener.preset);
  }
}

/** Overwrite a draft's meal fields with a saved meal's, keeping when/how-hungry. */
export function applyPreset(draft: MealDraft, preset: MealPreset): MealDraft {
  const tags = knownTags(preset.tags);
  return {
    ...draft,
    size: preset.size,
    kind: preset.kind,
    source: preset.source,
    tags,
    tagMix: storedMix(tags, preset.tag_mix),
    carbFibrePct: tags.includes('carbs') ? preset.carb_fibre_pct : null,
    presetId: preset.id,
  };
}

/** "Start from" tapped again on the active saved meal: back to a plain draft. */
export function clearPreset(draft: MealDraft, now = new Date()): MealDraft {
  const blank = blankDraft(now);
  return { ...blank, time: draft.time, date: draft.date, kind: draft.kind, notes: draft.notes };
}

const knownTags = (tags: string[]) => tags.filter((t) => (MEAL_TAG_KEYS as string[]).includes(t));

/** The macros in a tag list, canonical P → C → F order. */
export function macrosIn(tags: string[]): MacroKey[] {
  return MEAL_MACRO_TAGS.filter((k) => tags.includes(k));
}

/** A stored mix, as the draft holds it: only when 2+ macros make a split meaningful. */
function storedMix(tags: string[], mix: MealTagMix | null): MealTagMix | null {
  if (macrosIn(tags).length < 2) return null;
  return macroMix(tags, mix) as MealTagMix | null;
}

/**
 * Toggle one tag. Changing WHICH macros are present invalidates the split (a
 * 60/40 of protein/carbs says nothing about protein/carbs/fat), so it resets
 * to "not set". Dropping carbs drops the fibre share with it: it is a share of
 * the carbs, and a share of nothing means nothing.
 */
export function toggleTag(draft: MealDraft, key: string): MealDraft {
  const tags = draft.tags.includes(key) ? draft.tags.filter((t) => t !== key) : [...draft.tags, key];
  const macroSetChanged = macrosIn(tags).join() !== macrosIn(draft.tags).join();
  return {
    ...draft,
    tags,
    tagMix: macroSetChanged ? null : draft.tagMix,
    carbFibrePct: tags.includes('carbs') ? draft.carbFibrePct : null,
  };
}

// ---- The split bar ---------------------------------------------------------

/** The dashed placeholder shown before the split is set: even, in MEAL_MIX_STEP. */
export function placeholderMix(macros: MacroKey[]): MealTagMix {
  const out: MealTagMix = {};
  if (macros.length === 0) return out;
  const base = Math.floor(100 / macros.length / MEAL_MIX_STEP) * MEAL_MIX_STEP;
  macros.forEach((k, i) => {
    out[k] = i === macros.length - 1 ? 100 - base * (macros.length - 1) : base;
  });
  return out;
}

/**
 * Move divider `index` (between macros[index] and macros[index + 1]) to
 * `position` percent along the bar. Only its two neighbours change; each keeps
 * at least one step, and the position snaps to MEAL_MIX_STEP.
 */
export function moveDivider(mix: MealTagMix, macros: MacroKey[], index: number, position: number): MealTagMix {
  if (index < 0 || index >= macros.length - 1) return mix;
  const cum: number[] = [];
  let c = 0;
  for (const k of macros) {
    c += mix[k] ?? 0;
    cum.push(c);
  }
  const before = index === 0 ? 0 : cum[index - 1];
  const lo = before + MEAL_MIX_STEP;
  const hi = cum[index + 1] - MEAL_MIX_STEP;
  const snapped = Math.round(position / MEAL_MIX_STEP) * MEAL_MIX_STEP;
  const p = Math.min(hi, Math.max(lo, snapped));
  return { ...mix, [macros[index]]: p - before, [macros[index + 1]]: cum[index + 1] - p };
}

// ---- Persistence -----------------------------------------------------------

/** Draft -> DB input. The note trims to null; fields that mean nothing drop. */
export function toInput(draft: MealDraft, photoPath: string | null): MealLogInput {
  const note = draft.notes.trim();
  return {
    log_date: draft.date,
    eaten_time: draft.time,
    size: draft.size,
    kind: draft.kind,
    source: draft.source,
    tags: draft.tags,
    tag_mix: storedMix(draft.tags, draft.tagMix),
    carb_fibre_pct: draft.tags.includes('carbs') ? draft.carbFibrePct : null,
    preset_id: draft.presetId,
    note: note ? note : null,
    hunger_before: draft.hungerBefore,
    hunger_after: draft.hungerAfter,
    photo_path: photoPath,
  };
}

/** DB row -> draft, for editing an existing meal. */
export function toDraft(row: MealLog): MealDraft {
  return {
    time: row.eaten_time,
    size: row.size,
    kind: row.kind,
    source: row.source,
    date: row.log_date,
    tags: row.tags,
    tagMix: storedMix(row.tags, row.tag_mix),
    carbFibrePct: row.tags.includes('carbs') ? row.carb_fibre_pct : null,
    presetId: row.preset_id,
    hungerBefore: row.hunger_before,
    hungerAfter: row.hunger_after,
    notes: row.note ?? '',
    photoUrl: null,
  };
}

/** The saved-meal fields of a draft. Only the vocabulary is saved as tags. */
export function presetInputFromDraft(draft: MealDraft, name: string): MealPresetInput {
  const tags = knownTags(draft.tags);
  return {
    name: name.trim(),
    size: draft.size,
    kind: draft.kind,
    source: draft.source,
    tags,
    tag_mix: storedMix(tags, draft.tagMix),
    carb_fibre_pct: tags.includes('carbs') ? draft.carbFibrePct : null,
  };
}

/**
 * Did the athlete change a saved meal's fields after starting from it? Decides
 * whether Save asks "update the saved meal, or log once?". Time, date, hunger,
 * photo and note are per-meal and never count.
 */
export function differsFromPreset(draft: MealDraft, preset: MealPreset): boolean {
  const a = presetInputFromDraft(draft, preset.name);
  const tags = knownTags(preset.tags);
  const b: MealPresetInput = {
    name: preset.name,
    size: preset.size,
    kind: preset.kind,
    source: preset.source,
    tags,
    tag_mix: storedMix(tags, preset.tag_mix),
    carb_fibre_pct: tags.includes('carbs') ? preset.carb_fibre_pct : null,
  };
  return (
    a.size !== b.size ||
    a.kind !== b.kind ||
    a.source !== b.source ||
    [...a.tags].sort().join() !== [...b.tags].sort().join() ||
    JSON.stringify(a.tag_mix) !== JSON.stringify(b.tag_mix) ||
    a.carb_fibre_pct !== b.carb_fibre_pct
  );
}
