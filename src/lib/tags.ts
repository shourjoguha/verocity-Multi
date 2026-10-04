import { ACTIVITY_TAGS, type ActivityTagKey } from '@/app.config';

// Switch the ActivityLogger's type and carry that type's default tag with it.
// `autoTag` is the tag the PREVIOUS type switched on by itself; it comes off on
// the way out, so picking Padel and then Run does not leave a run tagged Sport.
// A tag the athlete set by hand is never removed, and never becomes automatic.
export function retagForType(
  tags: string[],
  autoTag: string | null,
  nextDefault: string | null,
): { tags: string[]; autoTag: string | null } {
  const kept = autoTag && autoTag !== nextDefault ? tags.filter((t) => t !== autoTag) : tags;
  if (!nextDefault) return { tags: kept, autoTag: null };
  if (kept.includes(nextDefault)) {
    return { tags: kept, autoTag: autoTag === nextDefault ? autoTag : null };
  }
  return { tags: [...kept, nextDefault], autoTag: nextDefault };
}

// Resolve an activity tag to its token color; unknown tags fall back to muted.
export function tagColor(tag: string): string {
  const known = ACTIVITY_TAGS[tag as ActivityTagKey];
  return known ? known.color : 'hsl(0 0% 42%)';
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
