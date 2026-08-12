import { ACTIVITY_TAGS, MEAL_TAGS, type ActivityTagKey } from '@/app.config';

// Resolve an activity tag to its token color; unknown tags fall back to muted.
export function tagColor(tag: string): string {
  const known = ACTIVITY_TAGS[tag as ActivityTagKey];
  return known ? known.color : 'hsl(0 0% 42%)';
}

// Meal-tag colour is DERIVED from the tag key, not stored — so a suggested tag
// and a brand-new custom tag are coloured by the same rule and no config edit is
// needed to add one. Only the hue is generated; the saturation/lightness come
// from the --meal-tag-* tokens (defined per theme in global.css) so the same tag
// stays readable on paper and on carbon. Deterministic hash ⇒ a tag keeps its
// hue across renders; the golden angle spreads adjacent keys far apart.
export function mealTagColor(tag: string): string {
  const key = tag.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }
  const hue = Math.round((hash * 137.508) % 360);
  return `hsl(${hue} var(--meal-tag-sat) var(--meal-tag-light))`;
}

// The single letter shown on a macro chip. Uses the configured label's first
// character (P/C/F) so it reads sensibly for any macro tag added later.
export function macroInitial(tag: string): string {
  const key = tag.trim().toLowerCase();
  const known = MEAL_TAGS.find((t) => t.key === key);
  return (known?.label ?? key).charAt(0).toUpperCase();
}

// Distinct stacked colors for one session's tags (order-preserving, deduped).
// Falls back to activity_type / 'strength' when a log has no tags.
export function sessionTagColors(tags: string[], activityType?: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const c = tagColor(t);
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out.length ? out : [tagColor(activityType ?? 'strength')];
}

// 45° stripes for a day that mixed activities (the consistency heatmap). Returns
// undefined below two colors so the caller keeps its solid `backgroundColor`
// path — a one-color "gradient" would paint the same fill at extra cost, and the
// caption only promises stripes where there really was more than one activity.
export function stripeBackground(colors: string[], bandPx = 4): string | undefined {
  if (colors.length < 2) return undefined;
  const stops = colors
    .map((c, i) => `${c} ${i * bandPx}px ${(i + 1) * bandPx}px`)
    .join(', ');
  return `repeating-linear-gradient(45deg, ${stops})`;
}

// Classify a plan day's label into an activity tag — used to tint upcoming
// ("planned") days on the plan-progress ribbon, where there is no log to color by.
export function dayTagFromLabel(label: string): ActivityTagKey {
  const t = label.toLowerCase();
  if (/recover|rest|deload/.test(t)) return 'recovery';
  if (/mobility|stretch|yoga|cooldown|cool-down/.test(t)) return 'mobility';
  if (/sport|game|match|skill|play/.test(t)) return 'sport';
  if (/endurance|condition|cardio|zone|metcon|run|row|bike|swim|jog/.test(t)) return 'endurance';
  return 'strength';
}
