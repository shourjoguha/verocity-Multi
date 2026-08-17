// Pure meal-logging product logic — no React, no Supabase. Everything here is
// unit-tested (mealDraft.test.ts).

import {
  MEAL_DEFAULTS,
  MEAL_MIX,
  MEAL_REPEAT_LIMIT,
  MEAL_REPEAT_SEED,
  MEAL_TAG_KEYS,
  MEAL_TIME_ROUND_MINUTES,
  type MealKindKey,
  type MealSizeKey,
  type MealSourceKey,
} from '@/app.config';
import type { MealLog, MealLogInput, MealTagMix } from '@/lib/types';

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
  // Composition: integer percents per participating tag, summing to 100. Empty
  // when nothing is selected. Recomputed from the selection whenever a tag is
  // toggled (see recomputeMix); the slider UI then edits it via setMixValue.
  tagMix: MealTagMix;
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
    tagMix: {},
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
      return recomputeMix({ ...draft, kind: 'meal', customTags: [preset.tag] });
  }
}

// ---- Tag composition (the mix sliders) ------------------------------------

const FLAT_TAGS = MEAL_MIX.flatTags as readonly string[];

/** Distribute `total` evenly across keys, giving the remainder to the first. */
function distributeEven(keys: string[], total: number): MealTagMix {
  const out: MealTagMix = {};
  if (keys.length === 0) return out;
  const base = Math.floor(total / keys.length);
  let rem = total - base * keys.length;
  for (const k of keys) {
    out[k] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
  }
  return out;
}

/** Split `total` across keys by percentage weights, absorbing rounding on the
 *  largest weight so the parts still sum to exactly `total`. */
function distributeByWeights(keys: string[], weights: Record<string, number>, total: number): MealTagMix {
  const out: MealTagMix = {};
  let assigned = 0;
  for (const k of keys) {
    out[k] = Math.round((total * (weights[k] ?? 0)) / 100);
    assigned += out[k];
  }
  // Push the drift onto whichever key carries the most weight.
  const heaviest = keys.reduce((a, b) => ((weights[b] ?? 0) > (weights[a] ?? 0) ? b : a), keys[0]);
  out[heaviest] += total - assigned;
  return out;
}

/**
 * The seed composition for a set of selected tags. Per the product rules:
 *   - protein alone      -> 80 protein / 20 fat (fat joins the mix)
 *   - coffee / sweet     -> a flat 5 each, the rest split by the ratios below
 *   - {protein,carbs}    -> 60 / 40
 *   - {protein,carbs,veg}-> 40 / 40 / 20
 *   - anything else      -> an even split (covers custom tags, single tags, etc.)
 * Always returns integer percents summing to 100 (or {} for no tags).
 */
export function defaultTagMix(selected: string[]): MealTagMix {
  const sel = [...new Set(selected)];
  if (sel.length === 0) return {};
  if (sel.length === 1 && sel[0] === 'protein') return { ...MEAL_MIX.proteinOnly };

  const flat = sel.filter((t) => FLAT_TAGS.includes(t));
  const rest = sel.filter((t) => !FLAT_TAGS.includes(t));

  const mix: MealTagMix = {};
  for (const t of flat) mix[t] = MEAL_MIX.flatShare;
  const remaining = Math.max(0, 100 - flat.length * MEAL_MIX.flatShare);

  if (rest.length === 0) return distributeEven(flat, 100);

  const set = new Set(rest);
  let portion: MealTagMix;
  if (set.size === 2 && set.has('protein') && set.has('carbs')) {
    portion = distributeByWeights(rest, MEAL_MIX.proteinCarbs, remaining);
  } else if (set.size === 3 && set.has('protein') && set.has('carbs') && set.has('veg')) {
    portion = distributeByWeights(rest, MEAL_MIX.proteinCarbsVeg, remaining);
  } else {
    portion = distributeEven(rest, remaining);
  }
  return { ...mix, ...portion };
}

/** Mix keys in a stable order: known tags in MEAL_TAGS order, then custom tags
 *  alphabetically. The LAST key is the auto-balanced one. */
export function mixKeysOrdered(mix: MealTagMix): string[] {
  const order = MEAL_TAG_KEYS as readonly string[];
  const known = order.filter((k) => k in mix);
  const custom = Object.keys(mix)
    .filter((k) => !order.includes(k))
    .sort();
  return [...known, ...custom];
}

/**
 * Set one tag's percent and rebalance. The last tag (mixKeysOrdered) is the
 * balancer: it always holds 100 minus the others, so the total stays 100 and
 * the user only ever drags the first n-1. Dragging the balancer itself is a
 * no-op. The dragged value is clamped so the balancer never goes negative.
 */
export function setMixValue(mix: MealTagMix, key: string, value: number): MealTagMix {
  const keys = mixKeysOrdered(mix);
  if (keys.length <= 1 || !(key in mix)) return mix;
  const balancer = keys[keys.length - 1];
  if (key === balancer) return mix;
  const othersSum = keys
    .filter((k) => k !== balancer && k !== key)
    .reduce((s, k) => s + (mix[k] ?? 0), 0);
  const clamped = Math.max(0, Math.min(Math.round(value), 100 - othersSum));
  const next: MealTagMix = { ...mix, [key]: clamped };
  const nonBalancerSum = keys
    .filter((k) => k !== balancer)
    .reduce((s, k) => s + (next[k] ?? 0), 0);
  next[balancer] = 100 - nonBalancerSum;
  return next;
}

/** Re-seed the mix from the draft's current selection. Called whenever a tag is
 *  toggled — the composition set changed, so manual tweaks reset to the default
 *  split for the new set. */
export function recomputeMix(draft: MealDraft): MealDraft {
  return { ...draft, tagMix: defaultTagMix([...draft.tags, ...draft.customTags]) };
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
    tag_mix: Object.keys(draft.tagMix).length > 0 ? draft.tagMix : null,
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
    // Prefer the saved mix; for an older meal with tags but no mix, seed the
    // default so the sliders are ready to adjust rather than blank.
    tagMix:
      row.tag_mix && Object.keys(row.tag_mix).length > 0
        ? row.tag_mix
        : defaultTagMix(row.tags),
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
