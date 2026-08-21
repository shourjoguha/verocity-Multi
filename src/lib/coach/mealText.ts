// A deliberately dumb reader for the free text on a meal.
//
// WHAT THIS IS FOR. `meal_logs.note` is where the athlete actually says what they
// ate — "Fish and rice", "Eggs and toast", "Chicken, buckwheat, broccoli",
// "Fish and chips, all fried". The `tags` array says a meal had carbs; only the
// note says which carbs. That is the difference between "you eat carbs" and
// "your carbs are rice, bread and pasta", and the second is the one worth
// reading back to someone.
//
// WHAT IT IS DELIBERATELY NOT. Not a food database, not a macro estimator, not
// an LLM. A fixed lexicon of substrings, matched on word boundaries, producing
// counts. It cannot tell 200g of rice from a spoonful and it never tries — this
// stays on the right side of the same line rules/nutrition.ts draws: describe
// what was written down, never manufacture a quantity.
//
// IT WILL MISS THINGS AND THAT IS FINE. Notes are optional, often blank, and
// full of typos ("Cerial", "Cashes"). Every consumer treats a miss as absent
// data rather than as an absence of that food — a note that says nothing about
// vegetables is not evidence that no vegetables were eaten. Coverage is
// reported alongside every count for exactly this reason.
//
// FIRST VERSION ON PURPOSE. The operator's framing is that this earns its keep
// by being directionally useful now and getting better later; the lexicon below
// is the vocabulary that actually appears in their log, not an attempt at
// completeness.

/** Carb families worth telling apart. Keys are stable — they reach rule text. */
export const CARB_SOURCES = {
  rice: { label: 'rice', terms: ['rice', 'risotto', 'sushi'] },
  bread: { label: 'bread', terms: ['bread', 'toast', 'sandwich', 'wrap', 'bagel', 'pita'] },
  pasta: { label: 'pasta', terms: ['pasta', 'spaghetti', 'noodle', 'noodles', 'penne', 'lasagne'] },
  potato: { label: 'potato', terms: ['potato', 'potatoes', 'fries', 'chips', 'mash'] },
  grain: {
    label: 'other grains',
    terms: ['buckwheat', 'quinoa', 'oats', 'oatmeal', 'porridge', 'couscous', 'barley', 'bulgur'],
  },
  cereal: { label: 'cereal', terms: ['cereal', 'cerial', 'granola', 'muesli'] },
} as const;

export type CarbSourceKey = keyof typeof CARB_SOURCES;

/**
 * Whole vegetables. Per the operator: a `veg` TAG already means whole
 * vegetables, so this exists to catch the meals where the vegetable is named in
 * the note but the tag was not ticked — not to second-guess the tag.
 */
export const VEG_TERMS = [
  'broccoli', 'spinach', 'salad', 'greens', 'kale', 'carrot', 'carrots', 'pepper', 'peppers',
  'tomato', 'tomatoes', 'courgette', 'zucchini', 'aubergine', 'cabbage', 'cauliflower',
  'asparagus', 'beans', 'peas', 'onion', 'mushroom', 'mushrooms', 'cucumber', 'veg',
  'vegetable', 'vegetables',
];

/**
 * How it was cooked, where the athlete volunteered it. Only markers that are
 * unambiguous in a food note — "fried" means fried. No inference about oils,
 * quantities or calories follows from these; they are surfaced, not scored.
 */
export const PREPARATION = {
  fried: ['fried', 'deep fried', 'deep-fried', 'battered'],
  grilled: ['grilled', 'baked', 'roast', 'roasted', 'steamed', 'boiled', 'poached'],
} as const;

export type PreparationKey = keyof typeof PREPARATION;

/**
 * Word-boundary match, case-insensitive.
 *
 * Boundaries matter more than they look: without them "peas" matches inside
 * "peanuts" — which is in the athlete's own log, as "Cashes, almond and pea
 * nuts" — and a bag of nuts is silently counted as a vegetable. Terms are
 * escaped because several contain no metacharacters today and might tomorrow.
 */
function mentions(text: string, terms: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(haystack);
  });
}

export interface MealTextRead {
  /** Carb families named in the note. Empty means the note named none. */
  carbs: CarbSourceKey[];
  /** Whether a whole vegetable was named. */
  veg: boolean;
  preparation: PreparationKey[];
  /** False when the note was blank — the caller must not read that as "none". */
  hasText: boolean;
}

export function readMealText(note: string | null | undefined): MealTextRead {
  const text = (note ?? '').trim();
  if (!text) return { carbs: [], veg: false, preparation: [], hasText: false };
  return {
    carbs: (Object.keys(CARB_SOURCES) as CarbSourceKey[]).filter((k) =>
      mentions(text, CARB_SOURCES[k].terms),
    ),
    veg: mentions(text, VEG_TERMS),
    preparation: (Object.keys(PREPARATION) as PreparationKey[]).filter((k) =>
      mentions(text, PREPARATION[k]),
    ),
    hasText: true,
  };
}

export interface MealTextSummary {
  /** Meals whose note said anything at all — the denominator for every share. */
  described: number;
  /** Meals in the window, described or not. */
  total: number;
  /** Notes naming at least one carb family. */
  withCarbSource: number;
  /** Meals per carb family, descending by count. */
  carbCounts: { key: CarbSourceKey; label: string; count: number }[];
  /** Meals where a vegetable was tagged OR named in the note. */
  vegMeals: number;
  friedMeals: number;
}

/**
 * Aggregate the notes on a set of meals.
 *
 * `vegMeals` unions the `veg` TAG with a note mention, because the operator
 * treats the tag as authoritative for whole vegetables and the note is the
 * fallback for meals where the tag was not ticked.
 */
export function summarizeMealText(
  meals: { note: string | null; tags: string[] }[],
): MealTextSummary {
  const counts = new Map<CarbSourceKey, number>();
  let described = 0;
  let withCarbSource = 0;
  let vegMeals = 0;
  let friedMeals = 0;

  for (const meal of meals) {
    const read = readMealText(meal.note);
    if (read.hasText) described += 1;
    if (read.carbs.length > 0) withCarbSource += 1;
    for (const k of read.carbs) counts.set(k, (counts.get(k) ?? 0) + 1);
    if (meal.tags.includes('veg') || read.veg) vegMeals += 1;
    if (read.preparation.includes('fried')) friedMeals += 1;
  }

  return {
    described,
    total: meals.length,
    withCarbSource,
    carbCounts: [...counts.entries()]
      .map(([key, count]) => ({ key, label: CARB_SOURCES[key].label, count }))
      .sort((a, b) => b.count - a.count),
    vegMeals,
    friedMeals,
  };
}
