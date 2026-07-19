import { ACTIVITY_TAGS, type ActivityTagKey } from '@/app.config';

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
